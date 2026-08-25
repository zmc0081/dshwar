# 待提交的上游 issue:`ctx.agents.create()` 无法继承调用方的 context 作用域

> **状态**:🔴 **正文需要重写后才能提** —— 在 `0.1.1-rc.2` 上重测后,四条路里有一条已被上游修掉,另有一个新钩子覆盖了部分诉求。详见下方重测小节。
> 提交是对外动作 —— 由仓库所有者决定时机。
> ~~本仓当前没有配置任何 remote~~ 已不成立:仓库已 public
> (<https://github.com/zmc0081/dshwar>),正文里引用的
> `docs/DECISIONS/principal-scope-binding.md` **可以直接给链接**,
> 不必再让对方「在我们仓库里找」。
> 提交后请把 issue 链接回填到本文件与
> [`docs/DECISIONS/principal-scope-binding.md`](DECISIONS/principal-scope-binding.md)。
>
> **目标仓库**:DeepSeek Harness(`@deepseek-ai/dsh-*` 的上游)
> **依据**:CLAUDE.md 硬规则 1 —— 需要改上游才能实现 → 提 issue,不建 patch 目录。

## 为什么现在提

**口径已改(V0.4.7)。** 最初写的是「希望有个更干净的绑定方式」——那低估了它。
补测之后确认:**这是通往低成本多租户模式的唯一路径。**

没有这个钩子,一个 runtime 只能服务一个 principal,多租户就只剩「一人一进程」
一条路 —— 50 人团队 = 50 进程 ≈ **3.2 GB** 常驻(Linux 实测 63 MB/进程;
Windows 是 58 MB,≈ 2.9 GB)。有了它,同一个 runtime 能安全地服务多个主体,
内存成本降一到两个数量级。

上游还在 `0.1.x-rc.x` 快速迭代,**API 尚未定型** —— 这是影响它的最高性价比窗口。

> 🚨 **提交前必须先处理这一条(2026-08-24 核实)。**
>
> 正文里的全部实测都是对着 **`0.1.0-rc.6`** 做的,而上游 npm 上现在是
> **`0.1.1-rc.2`**(`@deepseek-ai/dsh` 的 `latest` 与 `next` 都指向它)。
> 本仓仍锁在 `0.1.0-rc.6`。
>
> **「这个在最新版上还复现吗?」几乎一定是对方的第一句话。** 两个选择:
>
> | 做法                                   | 代价     | 得到什么                   |
> | -------------------------------------- | -------- | -------------------------- |
> | 先在 `0.1.1-rc.2` 上重测一遍再提       | 一次实测 | 不给对方一个合理的搁置理由 |
> | 照提,但在正文里写明测的是 `0.1.0-rc.6` | 0        | 诚实,但很可能换来一次往返  |
>
> ⚠️ 无论走哪条,**正文里的版本号必须与实际测过的那个一致** ——
> 这正是本仓反复付学费的那一类:一个没验过的前提,写下来就会被当成事实。
> DSHWAR 大概率是第一个认真做多租户的消费方,这个约束对单用户场景完全不可见,
> 所以不主动提,上游没有理由发现它。

它是异步的,回复可能几周,**不阻塞 DSHWAR 任何工作** —— 进程隔离档已经可用。

---

## 🚨 在 `0.1.1-rc.2` 上重测的结果(2026-08-24)——**不要按原文提交**

按裁决在上游最新版上重跑了四条路。**结论有变化,而且变化足以改写这份 issue。**
重测脚本在 `docs/UPSTREAM-ISSUE-retest/`(不进 workspace),逐条对如下。

### 逐条

| 路                                      | `0.1.0-rc.6`  | `0.1.1-rc.2` 实测                             |
| --------------------------------------- | ------------- | --------------------------------------------- |
| 1 · 根上 provide(污染所有 agent)        | ❌ 能用但污染 | ❌ **不变**:两个 agent 读到同一个值           |
| 2 · 每个 agent 自己的 ctx 上 provide    | ❌ 第二个抛   | ❌ **不变**:`service "X" has been registered` |
| 3 · 从服务视角把 ctx 解回 agent 身份    | ❌ 走不通     | ✅ **已修** —— 见下                           |
| 4 · 给 agent 装一份自己的服务实例(遮蔽) | ❌ 抛         | ❌ **不变**:同一机制                          |

### ✅ 路 3 已经不成立了 —— 上游给了 `Context.agent`

`0.1.1-rc.2` 的 `dsh-agent` 里新增了一个**公开字段**:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The agent association installed as an own property on `Agent.ctx`.
        Contexts derived from `Agent.ctx` inherit the association. */
    agent?: Agent
  }
}
```

实测:两个 agent 的 `ctx.agent` 分别解回各自的 session id,
**且从 `agent.ctx` 派生出来的 ctx 继承这个关联**(服务方法里的 `this.ctx`
通常正是派生出来的那种)。

⇒ **issue 正文里「Walk the fiber chain … `cannot get property "ctx" without inject`」
那一行现在是错的。** 照原文提交,等于拿一条已经被修掉的观察去要一个新 API。

### ⚠️ 还有一个新钩子:`create({ setup })`

`CreateAgentOptions` 新增了 `setup?: (agentCtx: Context) => …`,文档写着:

> Creation-time composition of the agent's scoped world. The factory awaits setup
> after minting `agentCtx` but BEFORE inserting or announcing either the session
> or agent … Everything registered through `agentCtx` … exists before
> `session/created`, `agent/created` …

这与本 issue 「Proposed change」里求的 `parentCtx` **不是同一个东西,但覆盖了
同一类需求的一部分**:调用方现在能在 agent 发布之前往它的作用域里放东西。

**但它没有解决路 2 / 路 4**:实测在 `setup` 里给两个 agent 各装一份同名服务,
第一个成功、第二个仍然抛 `service "tenantFs" has been registered at <TenantFs>`。
**服务名的注册是跨作用域全局的,这一条没变。**

### ⚠️ 一条我没能可信测出来的

issue 正文第一张表(scoped 绑定在 `agent.ctx` 上可不可见,三行全 ✗)
**我这次没有做出可信的复现**。三次尝试都出现了一个自相矛盾的结果:
**在作用域建立之前就创建好的 agent,也「读到」了那个值** ——
若真是作用域派生,那一行必须是 ✗。

⇒ 这说明**探针本身没做对**(多半是 `provide` 的 builtin 语义与 `isolate`
的相互作用),不是上游改了行为。按本仓的规矩:一条实验反复给出不可能的结果时,
**可疑的是实验,不是被测对象**。所以这一格记为**未测出**,不记为「已修」。

### ⇒ 提交前要做的事

1. **重写路 3 那一行** —— 它已经不成立。
2. **把 `setup` 写进正文**:先说明上游已经提供了什么,再说明**剩下的缺口**
   (服务名全局注册,导致 per-agent 服务实例仍然装不上)。
   否则对方第一句话会是「你说的这个我们上一版就加了」。
3. **重新判断 issue 还该不该提、以什么范围提。** 今天真正剩下的诉求只有一条:
   **让同名服务能按 agent 作用域各装一份**(或等价地,让 `restrict()` /
   `isolate()` 的结果能落在 agent 自己的那个 ctx 上)。
   这比原来的 `parentCtx` 提案窄得多,也具体得多。
4. 第一张表要么按正确的探针重测,要么从正文里删掉 —— **不要留一张自己没验过的表**。

---

## ✅ 结论(2026-08-25):**仍然要提,但诉求换了一个,而且窄得多**

裁决要求「①② 做完确认一次上游 issue 还有没有剩余诉求」。逐条对完,结论如下。

### 原文里已经不成立的部分 —— 全部作废

| 原文的诉求                        | 现状                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| 路 3:把 ctx 解回 agent 身份       | ✅ **已修** —— `Context.agent` 是公开字段,派生 ctx 继承         |
| 「Proposed change」的 `parentCtx` | ⚠️ 被 `create({ setup })` 覆盖了一部分(创建期组装 agent 作用域) |
| 路 1 / 路 2 / 路 4                | ❌ 仍然如此,**但已经不需要它们** —— 见下                        |
| 第一张表(scoped 绑定可见性)       | ⚠️ **未测出**(探针自相矛盾),不能拿它当依据                      |

**路 2 / 路 4 不再需要**的原因:上游的答案根本不是「把身份放进 ctx」,
而是**按调用传**。`dsh-tool-fs` 用 `exec.agent.session.header.cwd` 决定
相对路径解析到哪,而那个值来自 `CreateAgentOptions.meta.cwd`。
DSHWAR 现在就是这么接的,**零上游改动**。

### 仍然成立的那一条 —— 而且现在说得清了

「按调用传」解决的是**路径**这一维。它解决不了另外几维:

| 维度                    | 身份怎么到达                   |
| ----------------------- | ------------------------------ |
| 文件路径                | ✅ `session.header.cwd`,已解决 |
| **每 principal 的凭据** | ❌ 没有对应的「按调用传」通道  |
| **用量归属 / 配额判定** | ❌ 同上                        |
| **审计的调用者字段**    | ❌ 同上                        |

这几维的共同形状是:**一个装在根上的服务,被工具层调到时,
需要知道「现在是谁在问」**。而实测:那条路径上 `this.ctx.agent` 是 `undefined`
(工具从插件自己的 ctx 拿服务,而那通常是根)。

⇒ **收窄后的诉求(一句话)**:

> 让**从工具层调进来的服务**也能解到调用方 agent —— 要么让服务侧拿得到
> 与 `exec.agent` 等价的东西,要么明确 `agent.ctx` 是那条正路并说明
> 为什么需要 `ctx.get()`(inject 保护会拦住直接读)。

比原来的 `parentCtx` 窄得多,也具体得多:它不要求改 agent 的派生关系,
只要求把**已经存在于工具层的信息**(`exec.agent`)在服务层也拿得到。

### ⚠️ 提之前还要做的两件事

1. **正文重写**,不是改几句 —— 路 3 那一行、四条路那张表、「Proposed change」
   三处都要按上面重来。第一张表**要么按正确探针重测,要么删掉**:
   不留一张自己没验过的表。
2. **顺手带上一个好消息**:`meta.cwd` 这条路我们跑通了,并且它替我们解决了
   最难的一维。这不是客套 —— 它让对方知道我们**读懂了他们的设计**,
   而剩下的诉求是那个设计还没覆盖到的地方。

---

## 正文(可直接贴)

### Title

`ctx.agents.create()` should let callers control the context the agent derives from

### Body

**Summary**

`AgentHandle.agent.ctx` is derived from the `AgentRegistry` plugin's own fiber,
which is fixed at plugin-load time (the root context). There is currently no way
for a caller to have the created agent derive from _their_ context instead.

For single-user Harness this is invisible. For a multi-tenant consumer it means
**any context-scoped service cannot reach the agent's execution layer** — tools
and adapters run under a context that never sees the caller's scope.

**What we observed** (measured against `0.1.0-rc.6`)

We bind a per-request value with `ctx.isolate(SLOT)` + `ctx.provide(SLOT, value)`
and expect services accessed during agent execution to see it. They do not:

| how the agent was created                        | binding visible on `agent.ctx` |
| ------------------------------------------------ | ------------------------------ |
| outside the scoped context                       | ✗                              |
| **`create()` called on the scoped context**      | ✗                              |
| entirely inside the scope, awaited to completion | ✗                              |

The third row is the important one: it is not a lifetime problem. Even with the
scope alive for the whole turn, the binding is not visible — because `agent.ctx`
simply is not derived from the context that `create()` was called on.

**Every workaround we could find, and why each fails**

This is the part we would most like a second opinion on — we tried four routes
and all of them dead-end:

| Route                                                                         | Result                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provide the value on the **root** context                                     | Works, but applies to **every** agent — a shared process would attribute Bob's session to Alice                                                                                                                        |
| Provide it on **each agent's own** `ctx`                                      | First agent succeeds; the second throws `service "X" has been registered at <scope>`. Worse: if that error is swallowed (a very ordinary `try/catch`), the second agent **silently inherits the first one's identity** |
| Walk the fiber chain from the service's `this.ctx` back to the owning agent   | `cannot get property "ctx" without inject` — the inject guard blocks ancestry traversal                                                                                                                                |
| Plug a **per-agent instance** of the service onto the agent's ctx (shadowing) | `service "fs" has been registered at <TenantFileSystem>` — same mechanism as row 2                                                                                                                                     |

**The discriminating information exists** — `this.ctx` inside a service method
_is_ different per agent (we verified this). What is missing is any public API to
resolve that back to an agent identity.

**Why this matters beyond tidiness**

Without it, a runtime can serve exactly one principal, so multi-tenancy costs one
process per user. Measured, five-sample median:

| platform | cold start | resident per process |
| -------- | ---------- | -------------------- |
| Linux    | 86 ms      | 63 MB                |
| Windows  | 115 ms     | 58 MB                |

A 50-person deployment is ~3.2 GB resident before doing any work. With it, one
runtime could serve many principals safely.

**Proposed change**

Let the caller supply the context to derive from:

```ts
await ctx.agents.create({
  sessionId,
  agentOptions,
  // new, optional; defaults to today's behaviour
  parentCtx: scopedCtx,
})
```

Anything derived from that context — tool execution, adapter calls — would then
observe the caller's scope. This is additive and does not change existing
behaviour when the option is omitted.

**Alternative**

If exposing the parent context is undesirable, a documented statement that
`agent.ctx` is _intentionally_ rooted (and that consumers must not rely on
ambient context scoping during agent execution) would also help — right now the
behaviour is discoverable only by measurement.

**Context**

We are building a multi-tenant product layer on top of Harness. Full write-up of
the investigation, including the falsified hypotheses and the measurements above:
`docs/DECISIONS/principal-scope-binding.md` in our repository.

Happy to supply a minimal reproduction or test a patch.
