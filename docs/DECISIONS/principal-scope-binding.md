# principal 作用域绑定

> **状态**:V0.4.7 实施 B + 守卫。**A 已证伪** —— 需要上游钩子,提 issue,不排期。
> **日期**:2026-08-16 · **发现于**:V0.4.6 Session 0

## 问题

> ⚠️ **本节的机理曾被写错两次,两次都写成「AsyncLocalStorage 的作用域过期」。**
> 那个解释直觉上很顺(请求返回了、作用域自然没了),但**实现里根本没有 ALS**。
> 记在这里,因为错误的机理会导出错误的修法 —— 按 ALS 的思路会去想「怎么让
> 作用域活得更久」,而真正的问题与生命周期无关。

principal 的传播用的是 **cordis 的上下文槽位**:

```ts
// packages/principal/src/service.ts
export function runWithPrincipal(ctx, principal, fn) {
  const scoped = ctx.isolate(PRINCIPAL_BINDING)   // 派生一个新 context
  const dispose = scoped.provide(PRINCIPAL_BINDING, principal)
  try { return await fn(scoped) } finally { await dispose() }
}

current(): Principal {
  return (this.ctx.get(PRINCIPAL_BINDING) as Principal) ?? ANONYMOUS
}
```

绑定**只存在于那个派生出来的 context 对象上**,没有任何环境传播。
`current()` 读的是 `this.ctx`,而 cordis 的 Proxy 会把它重绑到**访问方**的 context。

于是真正的问题是:**agent 拿到的是哪个 context?**

实测(V0.4.6 Session 0):

```
从 scoped ctx 建 agent → agent.ctx 的 principal 绑定 = anonymous
作用域外建 agent       → agent.ctx 的 principal 绑定 = anonymous
```

**即使把 `createAgent` 整个包进 `runWithPrincipal` 也没用。** agent 的 ctx 由
`AgentRegistry` 插件自己的 fiber 派生 —— 那个 fiber 在**插件加载时**就确定了
(根上下文),与调用 `create()` 时传进去的作用域无关。

工具与适配器都跑在 agent 自己的 ctx 上,所以它们看到的都是匿名:

```
HTTP 请求内(scoped ctx)→ {root}/acme/alice-e6f1/default/note.txt
agent 执行时(agent.ctx)→ {root}/anonymous/anonymous/default/note.txt
```

**与「请求返回得早不早」「轮次跑多久」全都无关。** 就算把整轮 await 到底、
全程待在作用域内,agent.ctx 里也没有那个绑定。

## 清点:谁受影响

判据是「principal 从哪来」——读环境的受影响,读会话上存的字段的不受影响。

| 消费方                       | principal 来源                    | 受影响 | 失败形态                          |
| ---------------------------- | --------------------------------- | ------ | --------------------------------- |
| `credentials-multiuser:99`   | `ctx.principal.current()`         | ✅     | fail closed → 拿不到凭据(拒绝服务) |
| **`fs-tenant:125`**          | `ctx.principal.current()`         | ✅     | ⚠️ **静默写进 `anonymous/anonymous/`,跨租户共用** |
| `storage-scoped:120`         | `ctx.principal.current()`         | ✅     | 同上;当前默认不装配,V0.5.5 会装配 |
| `metering`                   | `obs.session.subjectId`           | ❌     | —                                 |
| `policy`(配额)               | `session.subjectId`               | ❌     | —                                 |
| `policy`(模型准入)           | 建会话时的 `principal.id`         | ❌     | —                                 |
| `audit`                      | Admin Key 的 `admin.label`        | ❌     | —                                 |

**严重性的差别在于失败方向。** 凭据 fail closed —— 拒绝服务,吵闹但不泄漏。
`fs-tenant` 与 `storage-scoped` **不 fail closed**:它们老老实实在 `anonymous`
目录下写文件、用 `anonymous` 前缀存键。那是跨租户数据混放,而且没有任何报错。

> **路径钉死本身没坏。** `tenantWorkspaceRoot()` 的逐段校验、四步顺序、白名单
> 编码全部正常工作 —— 坏的是喂给它的 principal。这一点值得单独记下来:
> `fs-tenant` 有 18 处工作区断言全绿,因为那些测试都在 HTTP 作用域里直接调。
> **被测对象没坏,是喂给它的东西坏了**,而现有测试照不到这一类。

## 两种修法

### B —— 逐点显式重入(V0.4.7,治标但立刻止血)

在建会话时**捕获** principal,消费点显式重新进入它的作用域:

```ts
const bound = principal                    // 建会话时捕获
resolveApiKey: () => runWithPrincipal(ctx, bound, (scoped) =>
  scoped.credentials.resolve(ref))
```

已实测可行:

```
环境里的 principal   = "anonymous"
显式重入后解析到     = "alice-e6f1"
```

**缺陷是它依赖人记得。** 每新增一个 principal 消费方就要重入一次,而忘了的那次
是静默的 —— 正是这次的失败模式。所以 **B 必须与守卫配套**,见下。

### ★ C —— 进程隔离档:装配时把 principal 钉到根上(V0.4.6 实测可行)

一进程一 principal,所以可以在装配时直接 `ctx.provide(PRINCIPAL_BINDING, principal)`。
插件 fiber 派生自这个根,`agent.ctx` 于是看得到。实测:

```
根上 provide → agent 驱动一轮后 agent.ctx 读到 = alice-e6f1
                                    工作区落点 = /acme/alice-e6f1/default
```

**不是脆弱的顺序依赖** —— 装配之前或之后 provide 都生效(绑定读的是槽位的
当前值,不是插件加载时的快照)。

⚠️ **只对进程档成立。** 逻辑档一进程多 principal,根上的绑定对**每个** agent
都生效 —— 那不是修好了隔离,是把 bob 的会话也算成 alice 的。已有测试钉住这条
反面(`gateway/test/principal-reach.test.ts`)。

**范围影响**:进程档不需要任何逐点回调。三个消费方的改造**只有逻辑档要用**。

### A —— 在 `createAgent` 处一次绑定 ❌ **已证伪**

原假设:`AsyncLocalStorage` 的存储会传播给在回调内启动的整条异步资源链,
所以把 `createAgent` 包进 `runWithPrincipal` 就够了。

**两个前提都不成立:**

1. 实现里没有 ALS,是 cordis 上下文槽位 —— 谈不上「传播」。
2. 实测:从 scoped ctx 建 agent,`agent.ctx` 里**依然没有**那个绑定。

三组对照全部读到 `anonymous`(作用域外建 / 作用域内建 / 全程在作用域内并
await 到底)。**没有任何调用时的包裹能改变 agent.ctx 的来源。**

要走 A 这条路,只能是:

- 让上游 `ctx.agents.create()` 接受一个「用这个 ctx 派生 agent」的参数,或
- DSHWAR 自己按 principal 隔离出多份 `AgentRegistry` 插件实例(一 principal
  一套 agent 插件 —— 那是进程隔离级别的代价,却只为了传一个 id)

前者要提上游 issue(硬规则 1:需要改上游 → 提 issue,不建 patch)。
**在上游给出钩子之前,A 不可行。**

> 📌 **A 路线的外部依赖**:issue 草稿见
> [`docs/UPSTREAM-ISSUE-agent-ctx.md`](../UPSTREAM-ISSUE-agent-ctx.md)。
> 提交后把链接回填到那里与本处。现在提的理由:上游还在 `0.1.0-rc.x` 快速迭代,
> API 未定型,这是影响它的最高性价比窗口;而且它是异步的,不阻塞任何事。

## 决策

### 为什么绑 principal 而不是绑 key 值

**吊销仍然生效。** 捕获的是 principal(id + tenantId),每次请求仍走
`credentials.resolve(ref)` 重新读取 —— 凭据后端里改掉或删掉的 key,下一次解析
立刻反映。若捕获的是 key 值,那就等于在会话生命周期里造了一份密钥副本,
吊销要等会话结束才生效,而一个会话可以开着几天。

### 快照语义的时间窗 —— 停用**不是**即时的

principal 对象在会话生命周期内是**快照**。这带来一个必须写明的窗口:

> **在 IdP 侧停用某人之后,该用户已经开始的那一轮不会被中断。**

V0.3.0 的生命周期校验(`@dshwar/subject` 的双路停用)发生在**建会话**时,
不在轮次执行中。一轮通常几分钟,所以窗口是分钟级 —— 可接受,但**不能对外
宣称停用是即时的**。需要即时性的部署应当缩短会话生命周期,或在
`POST /turns` 上加一次生命周期复查(尚未实现)。

### 角色中途变更同样不反映

同一个快照语义:会话开始后在 IdP 侧改了角色,该会话读到的仍是旧的。
对**凭据解析**无影响(解析只用 id + tenantId),对将来任何按 `roles` 做的
判定则有影响 —— 那类判定应当读会话簿里存的字段,或在每次请求时重新取。

### 为什么 B 先上而不是等 A

这个 bug **现在就存在**,而 **A 已证伪、在上游给出钩子之前不可行**。
B 是当前唯一验证过可行的修法,它的唯一缺陷(依赖人记得)由守卫补掉:

- **C(根上 provide)** = 进程档的修法,零逐点回调 → V0.4.7
- **B + 守卫** = 逻辑档的修法 → V0.4.7
- **A** = 需要上游钩子 → 提 issue,不排期

⚠️ **守卫已在 V0.4.6 落地**(`principal.current()` 调用点白名单,
含两个方向的负向验证 16 / 16b),不必重做。

⚠️ **B 对 `fs-tenant` 的形态与对凭据的不同。** 凭据那处可以在
`resolveApiKey` 回调里显式重入;而 `fs-tenant` 的 `currentWorkspaceRoot()`
读的是 `this.ctx`(被重绑到访问方 = 工具 = agent.ctx),拿不到重入的机会。
它需要的是**配置注入**:加一个 `principalOf?: () => Principal` 回调,
与该包已有的 `workspaceOf?: () => string | undefined` 同款 —— 那个回调正是
为同类问题加的,已有先例。`storage-scoped` 同理。

⚠️ **`storage-scoped` 的修复必须赶在它被装配之前落地。** 它当前在
`gateway/src/runtime.ts` 的 `DELIBERATELY_OMITTED` 里,而 **V0.5.5 工作台后端会
装配它** —— 那时若还没修,同一个 bug 会以「跨租户键前缀混放」的形式再来一次。

## 配套守卫

B 靠人记得,所以必须有机器兜底:**`ctx.principal.current()` 的调用点必须登记在
白名单里**,新增未登记的调用点即 CI 红。机制照 adapters 边界 lint 与
`tsconfig.test.json` 登记的同一套模式,见 `scripts/check-guards.mjs`。

## A 的可行性证伪结论(V0.4.6 Session 0)

**❌ 证伪。** 见上方「A —— 在 createAgent 处一次绑定」。

三组对照:

| 形态                                   | `agent.ctx` 的 principal 绑定 |
| -------------------------------------- | ----------------------------- |
| 作用域外建 agent                       | `anonymous`                   |
| 作用域内建 agent(followup 在作用域外) | `anonymous`                   |
| 全程在作用域内,await 到底              | `anonymous`                   |

**副产物:一个值得单独记住的教训。** 第一版探针在适配器里读**根 ctx** 的
`principal.current()`,那当然永远是匿名 —— 无论作用域有没有生效。
那条探针会「验证」出任何你想要的结论,因为它测的东西和作用域无关。
写作用域类的探针时,**必须先确认自己读的是哪一个 context**。
这一条进 V0.4.6 Session 3 的探针清单。
