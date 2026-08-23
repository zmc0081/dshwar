# M0.8.0 —— 实现细节归档

---

### Session 0 · 生成器选型裁决 + 「谁会红」的四象限

**起手式按 CLAUDE.md 的设计准则**:第一问不是「生成器跑没跑」,
而是**「生成器坏掉时谁会红」**。先把坏法穷举出来,再决定要几道防线。

| 生成器的坏法              | 谁会红                                      |
| ------------------------- | ------------------------------------------- |
| 改了契约**没重新生成**    | 同步断言(重渲染 vs 已提交),**三语言各一条** |
| 生成器**悄悄漏掉** schema | 覆盖断言(逐 schema 数出口,不是数入口)       |
| 生成器把**类型映射错**    | 映射断言(契约类型 → 目标语言类型,逐条)      |
| 生成器输出**语法不合法**  | ⚠️ 需要编译器 —— 见裁决                     |

**交付**:`docs/DECISIONS/mobile-sdk-generation.md`,含工具链实测与四象限。

---

### Session 1 · Kotlin SDK 模型

**交付**:`sdk/kotlin/src/generated/Models.kt`(42 个模型)、
`sdk/kotlin/scripts/render.ts`(纯渲染函数,与校验测试共用)、
`sdk/kotlin/test/generated.test.ts`(同步 + 覆盖 + 映射三道断言)。

⚠️ **范围已在 2026-08-22 收窄:不含客户端与可运行示例。**
原文写的是「生成的模型 + 客户端」与 `examples/kotlin-session`,
两者**都没有交付**,而 Session 一度标着 ✅ —— 见块首的范围更正。

---

### Session 2 · Swift SDK 模型

**交付**:`sdk/swift/src/generated/Models.swift`(42 个模型)、
`sdk/swift/src/Support.swift`(手写的 `AnyCodable`,与生成目录分开)、
`sdk/swift/scripts/render.ts`、`sdk/swift/test/generated.test.ts`。

⚠️ 同 Session 1:**不含客户端与可运行示例**。

---

### Session 3 · 三语言守卫统一 + 收口

**交付**:`scripts/check-guards.mjs` 的「每个 SDK 都有同步断言」守卫、
`scripts/verify-assertions.mjs` 的探针 16/17/18(**一语言一条,不合并**)、
`scripts/verify-guards.mjs` 的 29a/29b/29c(含正向对照)。

**验收**:改契约不重新生成 → 三语言的断言**各自**变红(已逐条实测)。

---

# M0.6.5 · 本地模型 + 离线能力 —— 实现细节归档

---

### Session 0 · 调研落档

**已实测**(2026-08-17,写进决策文档即验收):

- `LlmAdapter` 契约:`providerInfo / providerRetryPolicy / listModels / resolveModel`,
  实现另有 `stream / request`;注册走 `ctx.llm.registerAdapter([provider], adapter)`(公开 API)
- `DeepSeekAdapter` 构造注入 `{ options, resolveApiKey, resolveUserId }`,
  `resolveAdapterOptions` 支持 `baseURL` 与 `models` 清单 —— 指向本地端点即可
- 本机 Ollama 服务在 11434 响应 `/api/tags`(即使 CLI 报未运行 ——
  服务与 CLI 是两回事,探测要打 HTTP 不要调 CLI)

**交付**:`docs/DECISIONS/llm-local-reuses-upstream-adapter.md`,
含证据链、边界裁决(为什么这不违反「能力归上游」)、keyless 的
硬规则 6 论证(本地端点没有要保护的凭据,fail closed 无对象)。

---

### Session 1 · `@dshwar/llm-local`

**交付**:cordis 插件,把上游适配器实例注册为 `local` provider,
指向 OpenAI 兼容本地端点(默认 Ollama `http://127.0.0.1:11434/v1`;
llama.cpp 换 `baseUrl` 即可)。

- **keyless**:`resolveApiKey` 返回占位符 —— 本地端点不鉴权,没有凭据可保护;
  注释里写明这为什么不违反硬规则 6
- 模型清单来自配置(部署方声明装了哪些模型),不静默探测 ——
  探测到什么用什么会让「模型没装」在首个请求才炸
- **测试**:假 OpenAI 兼容端点(进程内 http server)恒跑;
  真 Ollama 探测式(D6:探测不到显式 skip)

---

### Session 2 · 离线判定与自动降级

**交付**:云端不可达 → 自动切到本地模型。裁决点与 model-router 同位
(createAgent 入口),但信号轴不同(可达性,不是预算)。

- **降级必须可见**(红线 3 同款):结果带 `downgraded` 语义,
  网关设响应头并落审计 —— 用户有权知道自己被换了模型
- 未配置本地模型时,离线 = 明确报错(Agent 推理离线不可用),不静默排队
- **负向验证**:拆掉可达性判定 → 降级测试红;拆掉可见性 → 审计断言红

---

### Session 3 · 本地用量统计 + 离线边界表 + 收口

**交付**:

- 本地 provider 的用量走既有 metering(provider=`local`),
  **统计口径与云端一致但不进账单** —— billing 出账时本地行金额恒 0,
  且文档写明这是「本地算力不计费」而非「没配价」
- README 落离线边界表(会话/文件 ✅ · 本地工具 ✅ · Agent 推理 ❌ 除非本地模型 · 云端 token ❌)
- 版本收口:压缩归档 + CHANGELOG + 版本号校验

---

# M0.6.0 · 支付 —— 实现细节归档

---

### Session 0 · principal 绑定改造(A4 改期插入)

> **这一条不属于支付。** 它是 V0.5.5 评估出来、由所有者改期提前的地基改动 ——
> 排在支付之前,因为越晚做爆炸半径越大(而非相反,见 A4 的实测数据)。

**改动**:装配时**无条件** provide;`current()` 对 `undefined` 抛。

| `ctx.get(PRINCIPAL_BINDING)` | 含义                    | 行为             |
| ---------------------------- | ----------------------- | ---------------- |
| 真实 principal               | 请求经过认证 / 进程档   | 返回它           |
| `ANONYMOUS`(**显式**)        | 单用户部署,装配时表过态 | 返回 `ANONYMOUS` |
| `undefined`                  | **装配没跑或被绕过**    | 🚨 抛            |

⚠️ **它不防漏挂中间件** —— 那种情形会回落到根绑定,不抛。
防线仍是 `auth-coverage.test.ts` 与探针 10。两者各防一件事,一个都不能少。
详见 [`undefined-vs-anonymous.md`](docs/DECISIONS/undefined-vs-anonymous.md)。

**实测影响面**:红 15 条 / 4 个文件,全部是裸建 Context 没有根 provide 的测试,
集中在 setup 辅助函数里。

**验收**:单用户档照常可用;裸建 Context 不 provide 时 `current()` 抛且信息可读。

---

### Session 1 · `@dshwar/billing` 契约 + `billing-local`

**交付**:计量 → 计费 → 出账的契约,与 `billing-local`(只记账不收款)。

⚠️ **钱一律用最小货币单位的整数**(分)。契约里不出现浮点 ——
`0.1 + 0.2 !== 0.3` 在账单上就是对不上账,而对不上账的账单会被客户
拿去质疑整个系统。

**验收**:`billing-local` 能从 `@dshwar/metering` 的用量算出一张账单,
且金额计算全程整数。

---

### Session 2 · `@dshwar/billing-stripe`(D4:**开源**)

**交付**:Stripe 适配器 + stripe-mock 测试。

**D5 的测试策略**:

| 层         | 打谁                                       | 进 `check:all`?     |
| ---------- | ------------------------------------------ | ------------------- |
| 自动化测试 | **stripe-mock**(官方模拟器,不需账号或 key) | ✅                  |
| live smoke | 真实 test key,走 `.env`                    | ❌ 无 key 自动 skip |

⚠️ **开源纯净度检查要改** —— `check-oss-purity.mjs` 原本会把
`billing-stripe` 当闭源组件拦下。

---

### Session 3 · Webhook 三条防线

**D5 强制**:验签 + 时间戳防重放 + 幂等键,**三条都要负向验证**:

1. 伪造签名 → 拒
2. 重放旧事件(时间戳过期)→ 拒
3. 重复投递同一事件 → 只生效一次

> **支付是唯一一处「测试没覆盖 = 真金白银出错」的地方**,
> 测试要求高于其它版本。

---

### Session 4 · 开源边界文档同步 + live smoke

**交付**:`CLAUDE.md` 第八节与 `README.md` 的开源/闭源边界改成 D4 的新口径;
live smoke 写进发布清单(需人工跑一次)。

**验收**:`check:oss` 绿,且**负向验证**证明它仍会拦真正的闭源组件 ——
放宽一处判据之后,必须证明其余部分没跟着松。

# M0.5.5 · 工作台后端 —— 实现细节归档

---

### Session 0 · 契约新增:四类端点一次定完

**为什么一次定完而不是逐个加**:契约是客户接进来之后换不掉的那一层,
**晚定一天成本高一天**。而且四类端点之间有引用关系(作业指向工作区、
产物是工作区里的文件、附件挂在会话或作业上)—— 分四次定会让前三次
不得不猜第四次的形状。

**交付**:`workspaces` / `deliverables` / `jobs` / `attachments` 的 schema 与路由。
未实现的按既有语义返回 **501 + `x-dshwar-status: planned`**,不是 404。

**验收**:契约冻结报**破坏性 0 处**,新增全部为 `path.added`;SDK 类型重新生成。

---

### Session 1 · 工作区 CRUD + 产物浏览

**核心决策(已定)**:**不引入独立产物模型 —— 产物即工作区文件。**

> 引入独立模型意味着要维护「文件系统里有什么」与「产物表里有什么」的一致性,
> 而 agent 随时会写文件。两者必然漂,且漂的方向是**产物表说有、文件已经没了**。
> 直接读文件系统没有这个问题:它就是唯一事实。

工作区语义按 V0.5.0 的定案(`docs/DECISIONS/workspace-semantics.md`):
每用户多工作区,项目容器,不跨用户共享。

**验收**:跨用户访问他人工作区一律 404(不是 403 —— 403 泄漏「这个 id 存在」)。

---

### Session 2 · 策略预授权

**核心决策(已定)**:**不做运行时审批弹窗。**

> 上游 SDK 协议的 server→client 请求是死能力,交互式弹窗今天做不到。
> 取而代之:工作区设置页配置允许的工具 / 路径 / 网络 / shell,**拒绝进审计**。

**验收**:被策略拒绝的动作必须**进审计**,而不是静默失败 ——
静默的拒绝会让用户以为是 bug,然后去绕过它。

---

### Session 3 · 作业队列

**核心决策(已定)**:**状态外置到 DSHWAR 库,dsh 进程只作执行器。**

> 状态留在 dsh 进程里的话,进程一死作业就没了 —— 而进程隔离档下
> 进程本来就会被空闲回收。外置之后支持跨重启恢复。

**验收**:进程重启后,未完成的作业能被重新拾起(而不是永久卡住)。

---

### Session 4 · 附件契约 + `attachment-tenant`

**交付**:附件契约 + `attachment-tenant`(fs 根)。
`attachment-object`(S3 兼容:MinIO / OSS / COS)**本版本只定契约,不实现** ——
它需要一个真实的对象存储来验证,而那是外部资源。

**验收**:附件路径与工作区一样按租户钉死,越界一律拒绝。

---

---

# M0.5.0 · 控制平面 / 企业自服务配置台 —— 实现细节归档

---

### Session 0 · 立项:console-contract 骨架 + 工作区语义定案

**交付**

1. `packages/console-contract` —— 共享类型与 OpenAPI 契约。**放主仓**的理由(D1):
   它要与运行时版本联动,放主仓才被 `check:all` 覆盖
2. `docs/DECISIONS/workspace-semantics.md` —— D3 定案:**每用户多工作区,
   工作区是项目容器,不跨用户共享**
3. 关闭 `docs/DECISIONS/one-process-per-tenant.md` 的待评估状态 ——
   该方案把 user 段变成常量,与 D3 直接冲突,**不做**
4. `docs/CONSOLE-SPLIT.md` —— 主仓与 `dshwar-console` 的分工

**验收**:新包被 `check:guards` 的全部登记类守卫认可(tsconfig / test tsconfig /
根 references),`pnpm check:all` 绿。

---

### Session 1 · 契约:租户 / 成员 / 角色 / 配额 / 用量 / 审计查询

**交付**:`console-contract` 的类型与 OpenAPI 片段。消费既有的
`@dshwar/subject`(身份镜像)、`@dshwar/policy`(配额)、`@dshwar/metering`(用量)、
`@dshwar/audit`(审计)—— **不另起一套模型**。

⚠️ **这是 console 平面的契约,不是 `/v1` 运行时契约。** 两者分开版本化:
`/v1` 是对最终用户的承诺,console 契约是对管理端的。混在一起会让
「改管理端」变成「破坏运行时契约」。

**验收**:契约冻结检查对 `/v1` 报零破坏(console 契约不进 `/v1` 冻结基线)。

---

### Session 2 · Admin API + 开户闸门(D2)

**核心**:把隔离档的约束表达在**开户流程**里,而不是登录时。

> **拦在「管理员建第二个成员」那一步。** 那才是第一次真正违反约束 ——
> 登录时拦太早(单用户部署会被误伤),运行时拦太晚(数据已经开始混)。

错误信息按 V0.4.7 闸门同款三要素:**给出路 · 写明代价(约 63 MB/进程)· 不吓退单用户**。

**验收**:三个方向都要断言 —— 单用户建第一个成员放行、逻辑档建第二个成员拒绝、
进程档建第二个成员放行。

---

### Session 3 · 容量端点

**交付**:一个只读端点,返回当前隔离档、按内存推导出的 `maxProcesses`、
可容纳成员数上限。数据来自 `@dshwar/supervisor` 的 `deriveMaxProcesses`
—— **同一个来源**,不另算一遍。

**验收**:端点返回值与 `deriveMaxProcesses()` 逐字段一致(而不是各算各的)。

---

### Session 4 · console-web + SDK 层 + D7 三条守卫

**交付**

1. `console-web/` —— 最小但真实的 React 应用,首页显示容量信息(D2 后半)
2. SDK 层:`baseURL` 可注入(为 V0.7.0 从远端切到 `127.0.0.1` 预留)
3. **D7 三条守卫**,每条带负向验证:
   - 路由必须 hash / memory,不得 history
   - 不得依赖浏览器专有 API
   - 所有请求走统一 SDK 层,不得散落 `fetch`

⚠️ **守卫不能建在空集上** —— 这是 `console-web/` 放主仓的理由(A1)。
扫描一个不存在的目录会永远绿,而那正是本仓反复强调的最危险的绿。

**验收**:三条守卫各有一条负向验证(植入违规 → 红)与至少一条正向对照
(合规写法 → 放行),证明规则不是「一律禁止」。

---

---

# DSHWAR Session 任务实现细节归档

> **本文件是 `SESSION_TASKS.md` 的实现细节归档,不参与日常开发。**

---

## M0.4.6 —— Session 3/4 的 prompt 与验证清单(第二趟补档)

```
读取 CLAUDE.md。本次任务:证明关键测试会在实现坏掉时变红。

★ 这是本版本的核心产出。做法是**故意弄坏实现，确认对应测试变红**，
  而不是做全量变异测试（投入产出比不划算，且会把 CI 拖到分钟级）。

1. 四处核心断言各写一个探针
   - 取消:把 agent.cancel() 改成空实现 → 取消测试必须红
   - 隔离:把 fs-tenant 的路径钉死去掉一段 → 隔离测试必须红
   - 配额:把配额判定改成永远 allow → 配额测试必须红
   - 契约:在 openapi 里删一个端点 → check:contract 必须红

   ★ 选这四处不是拍脑袋。版本块开头的「失效断言清单」是实测得来的,
     A 类四条里有三条落在假适配器与测试夹具上（假模型不忠实于上游、
     选项没有类型约束、索引取空后静默默认）——**探针要针对的正是这一类：
     被测对象没坏，是喂给它的东西坏了，于是断言测了个寂寞。**
     写探针时优先弄坏「实现」，但也要有一条弄坏「夹具」的
     （例如把 harness 的 FinishReason 改回字符串），确认对应测试变红。

2. 探针怎么实现
   - 不要真的改源码再改回来（会污染工作树，且中途失败会留下坏代码）
   - 建议:在临时目录里 patch 一份副本再跑，或用 vitest 的模块 mock 覆盖实现
   - ★ 探针失败的信息必须说清「哪条断言失去了效力」，
     而不只是「探针没通过」—— 后者要人再花十分钟才知道发生了什么

3. 纳入 check:all
   - ★ 红线 4:若把 check:all 拖过一分钟，拆成单独 script

== 测试 ==
- 四个探针各自跑通（即:弄坏后确实变红）
- 反向:不弄坏时探针不误报
```

验证:

- ★ 红线 1:不放宽任何已有的安全断言
- `/publish test: {v} session 3 assertion effectiveness probes`

```
读取 CLAUDE.md。本次任务:补上契约里写了却没实现的那条，并落实决策 1。

1. agent/error 送达 SSE 客户端
   - 实测（V0.4.5 Session 2）：agent/error 是挂在 cordis Context 上的事件
     （dsh-agent/lib/types/runtime-types.d.ts:316，签名带 this: Scoped<Agent>），
     不是 SessionEventMap 成员，所以 translateEvent 永远看不到它
   - 要在 GatewaySessionStore.register() 里另开一条 ctx.on('agent/error', …) 订阅
   - ★ 主要难点是 seq 分配：agent/error 没有 seq，而 EventBuffer 与
     Last-Event-ID 都按 seq 过滤。直接借 lastSeq + 1 会与随后到来的真实
     上游事件（如 turn/end）撞号
   - V0.4.5 的 fail() 能安全借号，前提是「终结之后不再有上游事件」——
     agent/error 不一定终结，不能照抄
   - 两个方案，先评估再动手：
     a. 网关自持 seq 计数器（彻底，但要改现有断言 seq 的测试）
     b. 为合成事件预留号段（局部，但要论证不破坏续传）

2. ErrorCode 补 unavailable（决策 1）
   - ErrorCode 加 'unavailable'，STATUS_BY_CODE 映射 503
   - gateway/src/isolation.ts 的 AtCapacityError 映射改为 unavailable
     （现在是 rate_limited，那里的注释写明了这是被红线逼出来的折中）
   - ★ 三件配套缺一不可，见决策 1

3. 契约规定「客户端必须优雅处理未知枚举值」
   - 写进 packages/api-contract 的对外说明与 OpenAPI 描述
   - SDK 侧确认:遇到未知枚举值不抛，走 default 分支

4. 冻结检查放行枚举新增
   - freeze.ts 的 enum.value.added 从 breaking 改为 additive
   - ★ 连同它现有的理由一起改 —— 那句「闭集枚举加值会让下游已写全的
     switch 编译失败」在没有第 3 条规定时是对的
   - enum.value.removed 保持 breaking（红线 3）

== 测试 ==
- agent 报错时 SSE 收到 error 事件（不是流静默停住）
- 续传（Last-Event-ID）在错误事件前后都不丢不重
- 进程池满返回 503 且 code 为 unavailable
- check:contract 对枚举新增放行、对枚举删除仍然拦
```

验证:

- ★ 红线 3:`enum.value.removed` 仍是破坏性变更
- `/publish feat: {v} session 4 agent error delivery and unavailable code`

---

## M0.4.6 —— Session 实现细节

### ⬜ Session 0: 端到端冒烟:真实路径(最高优先级)

> ⚠️ **这是本版本唯一的「必须做」。** 其余四个 Session 都是加固,
> 只有这一个回答一个至今无人回答的问题:**网关能不能发出一轮真实对话?**
>
> V0.2.0 的验收标准写着「第三方仅凭 HTTP 就能完成一次完整会话,不接触 dsh」。
> 那条标准一直由 `createTestHarness()` 验证 —— 而 harness 自带假模型,
> `assembleRuntime()` 不带。**两者的差异恰好落在没被测的那一格里。**

```
读取 CLAUDE.md。本次任务:让真实网关跑通一轮真实对话。不改测试架构。

1. 先查清 provider 从哪来
   - 上游 @deepseek-ai/dsh-llm 提供什么内置 adapter？有没有官方 DeepSeek provider 包？
   - ★ 先查再设计，不要凭空造一个 adapter
   - 硬规则 2：只有 adapters/dsh-<version>/ 允许 import 上游内部实现
   - 硬规则 3：上游依赖精确锁版

2. 把 provider 接进 assembleRuntime()
   - RuntimeOptions 加 provider 配置（provider 名 / 模型 / base URL / 凭据来源）
   - ★ 凭据必须走 @dshwar/credentials-multiuser 的 per-principal 解析
     不得从 process.env 直接读（硬规则 6 + 「配置只经 profile 注入」）
   - 若结论是「adapter 由部署方注册，网关不内置」：
     那也要让 assembleRuntime() 在没有任何 provider 时**拒绝启动或打醒目警告**，
     并在 docs/DEPLOYMENT.md 写清部署方必须做什么

3. 端到端冒烟
   - 起真实 server（startServer），用真实凭据发一轮，收到真实回复
   - 这一条**需要真实 API key**，属于外部资源。拿不到 key 时：
     用一个照上游契约写的最小 provider（本地 echo/stub），
     但它必须经 assembleRuntime() 的 provider 配置路径注册，
     ★ 不得走 createTestHarness()

4. 加守卫，不让缺口重现
   - 一条测试：assembleRuntime() 装出来的运行时，ctx.llm 里确实有已注册的 provider
   - 这条测试的作用是不让「测试布局掩盖产品缺口」再次发生

== 产出 ==
- 真实网关能发出一轮对话的证据（日志或测试输出，贴进 PR）
- 若走 stub：明确记录「真实 provider 仍未验证」，并进发布清单
```

验证:

- ★ 红线 2:冒烟走 `assembleRuntime()`,不走 `createTestHarness()`
- `/publish feat: {v} session 0 real-path smoke test`

---

### ✅ Session 1: `scripts/` 纳入类型检查(范围已缩窄)

> **交付**:`tsconfig.scripts.json` 机制 + 三条新守卫 + `.mjs` 夹具纳入检查。
>
> **实际做的比计划多,因为查证时发现同一类洞有三个:**
>
> | 盲区                          | 谁漏了                    | 后果                                                                                                                               |
> | ----------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
> | `scripts/*.ts` 不在任何项目里 | 两处构建脚本              | `generate-openapi.ts` 的 `document.version`(应为 `.info.version`)—— 有 `?? manifest.version` 兜底且两值相等,肉眼与运行时都看不出来 |
> | 完全没有 `tsconfig.json` 的包 | `examples/minimal-server` | README 首屏那段代码,新人第一眼看到的东西,从 V0.1.0 起没被 tsc 看过                                                                 |
> | `test/` 下的 `.mjs` 夹具      | 两个子进程夹具            | `child-agent.mjs` 的 `reason: 'stop'` 活了一整个版本                                                                               |
>
> ★ **三个洞是同一个形状**:守卫都从「**已经存在**的东西」出发遍历 ——
> 有 tsconfig 的目录、`.ts` 文件 —— 于是「本该存在却不存在」的东西对它们
> 完全不可见。第 19 条守卫(有 `src/*.ts` 却完全没有 tsconfig)就是专门堵
> 前两条守卫自己的洞。
>
> **`.mjs` 按方案 C 落地**(`allowJs` + `checkJs`,运行时零改动)。
> 三方案比较见 [`docs/DECISIONS/typecheck-mjs-fixtures.md`](docs/DECISIONS/typecheck-mjs-fixtures.md)。
> 开启后暴露 31 处,全部修完。负向验证把 `reason` 改回错误形状:
> `Type 'string' is not assignable to type 'FinishReason'` —— 精确指到行。
>
> 顺带修掉 `.mjs` 里同款的 `aborted` 重复读问题(`b635a2d` 在 `.ts` 侧修过一次,
> `.mjs` 当时不在检查范围内,于是又来了一遍)。
>
> **负向验证 23 条全绿**,新增四条(17/18/19/20)。

> ⚠️ **`test/` 部分已经做完了,不在本 Session 范围内。** 立项时以为要一起做,
> 但那份工作在 `b635a2d` 里独立完成并已合并(见本版本块开头的「合并进来的成果」)。
> 本 Session 只剩 `scripts/`,**照 `tsconfig.test.json` 那套现成机制照搬即可**。

**开工前已复核的实际状态**(2026-08-16 实测,不是推测):

| 目标                                                | 状态                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `sdk/typescript/scripts/`(generate + render)        | ✅ **已经干净** —— `render.ts` 被 `b635a2d` 顺手修了,只需登记进机制 |
| `packages/api-contract/scripts/generate-openapi.ts` | ❌ TS2339 **仍在**(第 40 行),是唯一已知的待修错误                   |
| `examples/minimal-server`                           | ❌ 仍无 `tsconfig.json`(`examples/sdk-session` 有,照它配)           |

```
读取 CLAUDE.md。本次任务:把 scripts/*.ts 纳入 tsc，机制与 test 相同。

1. 根级 tsconfig.scripts.json（决策 2）
   - ★ 照 tsconfig.test.json 抄，不要另发明一套。那份已经过一轮实战，
     连守卫、CI 接线、negative test 都齐了
   - noEmit: true，覆盖两处：
     packages/api-contract/scripts/、sdk/typescript/scripts/
   - 加 npm script（typecheck:scripts），接进 check:all

2. 修唯一已知的错误
   - packages/api-contract/scripts/generate-openapi.ts:40
     TS2339: Property 'version' does not exist on type 'OpenApiDocument'
     ★ 合并之后复测仍在
   - 注意 freeze.test.ts 已经因为同一个类型改成了
     buildOpenApiDocument('0.0.0-freeze-test')——修的时候看一眼那边的取舍

3. examples/minimal-server 补 tsconfig
   - 照 examples/sdk-session 配，登记进根 tsconfig references

4. check-guards.mjs 加守卫
   - 仿照已有的两条（根 tsconfig references / 根 tsconfig.test.json references）
   - 新增：「每个含 scripts/*.ts 的位置都已登记进 tsconfig.scripts.json」

5. ★ .mjs 夹具的盲区 —— 本 Session 只需记录，不必解决
   - tsconfig 那套机制结构上够不到 .mjs。全仓两个：
     packages/supervisor/test/fixtures/echo-child.mjs
     adapters/dsh-0.1.0/test/fixtures/child-agent.mjs
   - 后者曾有与 7 个 .ts 测试文件完全相同的 finish reason 形状错误
     （reason: 'stop' 应为 { kind: 'stop' }），已在合并时人工修掉 ——
     但它是**被人看出来的**，不是被检查抓出来的
   - 可选做法（评估后再定，别硬上）：改写成 .ts 走 strip-types 跑，
     或加 // @ts-check + JSDoc。两者都有代价，写清楚再选

== 测试 ==
- 负向:故意在某个 script 里写一个类型错误，确认 typecheck:scripts 变红
- 负向:新增一个未登记的 scripts 目录，确认守卫变红
```

验证:

- `/publish chore: {v} session 1 typecheck scripts`

---

### ✅ Session 2: 配额两段判定

> **交付**:`PolicyService.admit()`(同步、读快照)+ 网关建会话侧接线 + 11 条测试。
>
> **两段的分工**:`check()` 管**钱**(挂发起轮次,现算,精确);
> `admit()` 管**资源**(挂建会话,读快照,不阻塞)。
>
> ★ **`admit()` 同步是它存在的理由,不是优化。** `metering.query()` 是异步的,
> 而建会话是热路径 —— 每次都等一次用量查询,等于把计量组件放进会话创建的
> 故障域,与本包「计量是账目组件,不是安全组件」的既有立场直接矛盾。
> 有一条测试专门断言 `admit()` 的返回值**不是 Promise**。
>
> **三个细节**:
>
> 1. 精确判定顺手喂热快照 —— 两段共用同一个事实源,而不是各算各的
> 2. metering 读不到时**不更新**快照 —— 写一个「没烧完」的假事实,会让一次
>    网络抖动就把已耗尽的主体重新放行。有测试钉住
> 3. 并发建会话只触发一次后台刷新(20 次并发 → ≤1 次查询),否则热路径
>    会把 metering 打穿,而那正是准入要避免的
>
> **翻转了一条测试**:`isolation.test.ts` 里那条「【已知缺口】配额耗尽的租户仍能
> 建会话」从「钉死现状」改成「断言正确行为」—— 它的失败信息当初就写着
> 「若这里变成 429,说明缺口已修,请更新本测试」。现在断言**一个进程都没起**:
> 拒绝发生在付出 115 ms 冷启动 + 58 MB 之前。
>
> 另加一条两档一致性断言(红线 2):准入在 logical 与 process 下返回同样的 429 ——
> 只在 process 档做准入会让两档分叉。

```
读取 CLAUDE.md 与 packages/policy/src/index.ts 的 fail open 说明。
本次任务:堵住「配额耗尽的租户占满进程槽位」这个 DoS 向量。

1. 建会话侧:快照准入（决策 3）
   - 在 policy 包加一层配额快照，几秒过期（可配，默认建议 5s）
   - ★ 准入路径不得同步等 metering.query()（它是异步的，且是热路径）
   - 查不到快照就放行 —— fail open，与 policy 现有语义一致
   - 快照只为堵 DoS 向量，不为精确计费

2. /turns 侧:精确判定
   - 保持现状不动。那里本来就要等，精确值是对的

3. 与进程隔离联动
   - gateway/test/isolation.test.ts 里有一条
     「【已知缺口】配额耗尽的租户仍能建会话并占用进程槽位」
     ★ 它的失败信息写着「若这里变成 429，说明缺口已修，请更新本测试」——
     修完必须更新它，否则它会变成一条阻碍正确行为的测试

4. 两档隔离行为一致
   - ★ 红线 2（V0.4.5）：客户端不该知道自己跑在哪种隔离下
   - 准入行为在 logical 与 process 两档必须相同

== 测试 ==
- 配额耗尽的租户建会话被拒（两档都测）
- 准入不阻塞:metering 挂掉时建会话仍然成功（fail open）
- 快照过期后能刷新到新值
- 精确计费仍在 /turns，未被准入替代
```

验证:

- `/publish feat: {v} session 2 two-stage quota admission`

---

### ✅ Session 3: 断言有效性探针

> **交付**:`scripts/verify-assertions.mjs`(7 条探针)+ 两条补上的断言,
> 已接进 `check:all`(探针 18 秒,合计约 33 秒,在红线 4 的一分钟预算内)。
>
> **三类探针,每一类对应一个真实踩过的坑:**
>
> | 类别     | 探针                                                  | 对应的坑                                                                    |
> | -------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
> | 弄坏实现 | 取消失效 / 路径少钉一段 / 配额永远放行 / 准入永远放行 | 最直觉的一类                                                                |
> | 弄坏夹具 | 假模型少吐 token / 不吐推理增量                       | `pool.test.ts` 的 `Parameters<Function>` —— 被测对象没坏,是喂给它的东西坏了 |
> | 作用域   | `fs-tenant` 移出 principal 白名单 → 守卫变红          | V0.4.7 那个「靠人记得」的修法的兜底                                         |
>
> ★ **探针跑出来两条红的,查清之后是探针自己的前提错了,不是测试有洞。**
>
> 最初写的「把假模型的 finish reason 改成字符串」与「让假模型不再遵守 signal」
> 都不会让任何测试变红。原因:
>
> - **全仓没有任何代码读 `finish` chunk 的 `reason`**。`turn.completed.reason`
>   来自 `turn/end` 的 `cancelled` 字段。那个形状错误由**类型检查**覆盖
>   (`b635a2d` 正是这么抓到的),运行时没有可断言的行为
> - agent loop 自己会在取消后停止消费流,适配器遵不遵守 `signal` 在端到端
>   层面看不出差别
>
> **教训与 Session 0 的「在根 ctx 上读 principal」是同一类**:写探针前必须先
> 确认那个属性在下游真的有后果。否则探针会一直红,而红的原因是它自己没道理 ——
> 那比没有探针更浪费人。理由已写进脚本注释,免得后人再加回来。
>
> **顺带补上两条契约早就承诺、却从没人验证的断言**:
> `turn.completed` 的 `reason` 字段(契约说客户端靠它区分「完成」与「已停止」,
> 而全仓从未断言过它)、以及取消之后输出**真的截断**(不是只看接口返回 200)。

---

### ✅ Session 4: `agent/error` 送达 + `unavailable`

> **交付**:`agent/error` 接线(含跨进程)+ 网关自持序号 + `ErrorCode` 补
> `unavailable` + 冻结检查放宽枚举新增。13 条新测试,负向验证 25 条全绿。
>
> #### 1. `agent/error` —— 映射表是承诺,不是描述
>
> 契约的事件映射表从 V0.2.0 起就写着 `agent/error → error`,但**直到本 Session
> 才真的有人接线**。在那之前 agent 报错 = 客户端的流静默停住,它无从区分
> 「模型在想」与「已经炸了」。
>
> 漏三个版本的原因:它挂在 cordis **Context** 上,不是 `SessionEventMap` 的成员,
> `translateEvent` 永远看不到 —— 而没人核对过那张表是不是真的实现了。
> **写进映射表的每一行都该有一条测试盯着。**
>
> 跨进程也接了(worker 转发 + remote 分发)。不接的话进程隔离档会悄悄丢掉
> 错误通知,而红线 2 要求两档一致 **包括出错的时候**。
> ⚠️ 只转发 `turn`/`step`,**不转发 error 对象本身** —— 它要过 IPC 的 JSON
> 序列化,而上游的错误可能带着请求 URL 甚至凭据片段。
>
> #### 2. 网关自持序号 —— 让「借号」这个问题消失
>
> 合成事件(`agent/error` 翻出来的 `error`、进程死亡的终结通知)没有上游 seq,
> 而 `Last-Event-ID` 按 `seq >` 过滤,借号就可能与随后到来的真实事件撞号。
>
> V0.4.5 的 `fail()` 靠「终结之后不会再有上游事件」论证借号安全 —— 那个论证
> 对 `agent/error` **不成立**(它不一定终结)。改成网关自持一个计数器,
> 撞号在**结构上**就不存在,而不是每次都论证一遍。
>
> 影响面很小:跨进程对照测试比的是**原始上游事件**的 seq,不经缓冲;
> 续传测试用的是相对号。契约只承诺 seq 单调,从没承诺它等于任何东西。
>
> #### 3. `unavailable` —— 撤销 V0.4.5 那个被逼出来的折中
>
> 进程池满从 `rate_limited`(429)改为 `unavailable`(503)。三件配套缺一不可,
> 且**顺序不能反**:
>
> 1. 先在契约里立下「客户端必须优雅处理未知枚举值」
> 2. 再把 `enum.value.added` 从破坏性改为相容
> 3. 才加 `unavailable`
>
> 只做第 2 步是把安全网剪个洞 —— `freeze.ts` 原本那句「加值会打穿下游写全的
> `switch`」在没有第 1 步时是**对的**。`enum.value.removed` 保持破坏性(红线 3):
> 删值会让下游正在处理的分支变成死代码,`default` 兜不住。
>
> #### 4. 四条编码了旧规则的测试,尽职地拦住了我
>
> `contract.test.ts`(错误码清单)、`freeze.test.ts`(加值必须红)、
> `isolation.test.ts`(期望 429)、`generated.test.ts`(SDK 的 `never` 穷尽断言)。
>
> ★ 最后一条值得单说:SDK 的测试是**消费方抄写的参照**,留着 `never` 断言
> 等于教人写出下一版编译不过的代码。已改写成正确的形状 —— 认识的码逐一映射,
> 不认识的走 `default` 兜底,并加一条「模拟服务端比客户端新」的断言。

---

---

## M0.4.1 —— Session 实现细节

### ✅ Session 0: 路径模型变更与逃逸测试重写

```
读取 CLAUDE.md 与 SESSION_TASKS.md 中本 Session 的任务详情。

本次任务:把 fs-tenant 的路径模型从三段改为四段。

⚠️ 这是整个项目安全性的重心。逃逸测试的要求高于其它任何 Session——
多一层路径段意味着每一种绕过手法都要重新验证一遍，不能假设原有测试仍然覆盖。

1. 路径模型
   - {root}/{tenantId}/{userId}/{workspaceId}
   - workspaceId 与 tenantId、userId 同级对待：白名单字符校验通过后才参与拼接
   - 校验顺序：先校验每一段，再拼接，再 resolve，最后断言仍在根内
   - 不要用「拼接后再检查」替代「拼接前先校验」，两者都要

2. 缺省工作区（R2）
   - 未指定 workspaceId 时落到 default
   - 目的是让现有调用方零改动仍能工作
   - default 不是特殊值，走完全相同的校验路径

3. 逃逸测试全量重写（R1）
   逐条写测试，每一条都要有对应的拒绝断言：
   - ../ 与多级 ../../，在四段路径的每一个位置分别尝试
   - 绝对路径
   - 符号链接指向根外
   - Windows 8.3 短名与 UNC 路径
   - URL 编码与 Unicode 规范化绕过
   - 空 tenantId / userId / workspaceId
   - workspaceId 伪造成路径分隔符或点号序列
   - 跨工作区读写（同一用户的两个工作区之间也要隔离）

4. 与上游沙箱的关系
   - 本包只做路径钉死，不重做沙箱
   - 策略计算结果仍喂给上游 sandbox-policy / fs-sandbox

== 测试 ==
- 上述每一条逃逸手法都有对应的拒绝测试
- 两租户互相不可见（正向与反向各测）
- 同用户两工作区互相不可见
- 未指定 workspaceId 时行为与改造前一致（对照 single-user.yml）
```

验证:

- 逃逸测试全绿,`single-user.yml` 对照基线行为不变
- `/publish feat: {v} session 0 multi-workspace path model`

---

### ✅ Session 1: 连带影响面

```
读取 CLAUDE.md。本次任务:处理路径模型变更的连带影响。

Session 0 改了路径根，以下几处会跟着受影响，逐一处理。凡是「先评估再决定」的，
把结论写进 docs/DECISIONS/ 下的对应文件，不要默默做了。

1. 附件存储路径（R3）
   - 附件挂到工作区下：{workspace}/.attachments/
   - 确认上游 attachment-local 的路径假设是否被打破

2. 会话与查询（R4）
   - 会话持久化目录随工作区分层
   - session-query 增加工作区维度过滤
   - 确认跨工作区查询被拒绝，而不是靠调用方自觉

3. storage-scoped 是否需要工作区维度（R5，先评估）
   - 存储键的语义是「租户数据」还是「工作区数据」？两者都有可能
   - 评估结论写入 docs/DECISIONS/storage-workspace-scoping.md
   - 若结论是不需要，说明理由，不要为了对称而加

4. Gateway 端点如何携带 workspaceId（R6，先评估）
   - 选项 A：查询参数 ?workspaceId=
   - 选项 B：路径段 /v1/workspaces/{id}/sessions
   - 关键约束：V0.2.0 的 /v1 契约已冻结，任何变更需按契约冻结检查显式声明兼容性
   - 评估结论写入 docs/DECISIONS/workspace-in-api.md，并给出兼容性声明

5. 配额模型扩展（R7）
   - 每用户工作区数上限
   - 单工作区容量上限
   - 与 V0.4.0 已完成的 policy / metering 对齐，不要另起一套

== 测试 ==
- 附件在正确的工作区目录下
- 跨工作区的会话查询被拒绝
- 超出工作区数上限时创建被拒绝
- 契约冻结检查通过（若改了 OpenAPI）
```

验证:

- 两份决策文档已写,契约兼容性已声明
- `/publish feat: {v} session 1 multi-workspace ripple effects`

---

### ✅ Session 2: 文档、profile 与 V0.1.0 发布准备

```
读取 CLAUDE.md（第三节 文档瘦身、第四节 版本号统一更新）。

本次任务:收尾并为 V0.1.0 发布做准备。

1. 文档
   - fs-tenant 的 README 更新路径模型说明
   - 隔离模型章节补一句：同一用户的不同工作区之间也是隔离的，
     但隔离级别与租户间相同——逻辑隔离仅适用于互相信任的场景
   - ARCHITECTURE.md 的隔离模型章节同步

2. profiles/
   - single-user.yml / team.yml / enterprise.yml 补工作区相关配置
   - single-user.yml 必须保持对照基线语义：单用户单工作区行为与原生 dsh 一致

3. V0.1.0 发布前检查（本 Session 的真正目的）
   - 版本号一致性检查通过（scripts/check-version）
   - 全部契约测试双 profile 跑绿
   - PR 自查 grep 全为 0
   - 从空目录安装 npm 包并跑通 examples/minimal-server
   - 确认安装包/构建产物中不含任何闭源组件
     （这是 SignPath Foundation 的资格条件，也是 open-core 边界）

4. 报告
   - 明确回答：V0.1.0 现在是否可以发布？若否，列出阻塞项

== 测试 ==
- check-version 通过
- 双 profile 契约测试全绿
- 空目录安装可跑通
```

验证:

- V0.1.0 具备发布条件
- `/publish docs: {v} session 2 multi-workspace docs and release readiness`

---

---

## M0.4.5 · supervisor 进程隔离(Session 0-4)

### ⚠️ 开工前的一处更正:动机里不含「解决无 cancel」

路线图里这一版的引言写着「顺带解决上游 SDK 协议没有 cancel 的问题」。
**这句话是错的,且 `ARCHITECTURE.md` §2.4 明确警告过它会误导:**

> V0.2.0 Session 0 实测:**进程内**的 `Agent` 接口有 `cancel(cause)`,
> `AgentHandle.dispose()` 亦然,两者都真的截断输出。DSHWAR 网关走进程内驱动,
> **不受此限**。把「取消」列为 supervisor 的动机,会让人误以为 V0.2.0 的网关
> 做不了取消,从而在错误的时间提前一个组件。

网关的取消**早在 V0.2.0 就能用**,`DELETE /v1/sessions/{id}` 有测试。
**本版本唯一的动机是跨信任边界的安全隔离。**

⚠️ 反过来说,**进程隔离会把已经好用的取消变成一个需要重新解决的问题** ——
子进程里的 agent 不再有进程内句柄可调。这是本版本的**代价**而非收益,
Session 0 必须先验证它能被解决。

### ✅ Session 0: 可行性证伪:跨进程驱动(2 天,止损点)

> **结论:可行,不触发止损。** 验证 A/B/C/D 全绿,E 延至 Session 1(理由见报告 §5)。
> 关键结论:**验证 C 的手段 a 可行** —— IPC 送取消 + 子进程内 `agent.cancel()`
> 真的截断输出(40 个增量只收到 4 个),**红线 3 保得住**。
> 冷启动 **~115 ms**、常驻 **~58 MB**(11 插件全集,Windows 开发机)。
> 验证落成常驻契约测试 `adapters/dsh-0.1.0/test/cross-process.test.ts`(10 条断言)。
>
> **带进后续 Session 的三条结论:**
>
> 1. **Session 1** —— 进程上限是必需项(58 MB/进程,100 principal ≈ 5.8 GB);
>    空闲回收默认值要保守;补测验证 E(node-pty 两层嵌套,Linux + Windows)。
> 2. **Session 2** —— 取消走三级降级「IPC cancel 为正路 → SIGTERM 兜底 →
>    SIGKILL 最后手段」;**seq 的权威留在父进程会话簿**,子进程 seq 只作进程内序
>    (否则多进程混流会撞号,`Last-Event-ID` 续传就废了)。
> 3. **Session 4** —— 报告 §6 的数字须在 Linux 上重测后才写进部署文档。

> ⚠️ **与前四个版本的 Session 0 同级。** 本版本压在一条未验证的假设上:
> **网关能在子进程里驱动 agent,并把流式事件完整拿回来。**
>
> V0.2.0 Session 0 验证的是**进程内**驱动。跨进程是另一回事:上游只提供
> stdio JSON-RPC 的 SDK 协议,而那条协议**没有 cancel 与 session-close**
> (`ARCHITECTURE.md` §2.4)。若事件回传或取消做不到,进程隔离就只能靠
> 「杀进程」这一种粗暴手段,而那会丢掉正在进行的一轮的全部输出。

```
读取 CLAUDE.md 与 ARCHITECTURE.md §2.4。

本次任务:验证跨进程驱动可行。不写产品代码，产出验证报告。

1. 验证 A —— 子进程能不能起来并装配
   - 从父进程 spawn 一个 Node 子进程，在里面装配 gateway/src/runtime.ts 的插件集
   - 确认 principal 能通过启动参数/IPC 传进去，且子进程只认那一个 principal
   - 记录冷启动耗时（这是进程隔离的主要代价，要有数）

2. 验证 B —— 流式事件能不能完整回传
   - 子进程里发起一轮，事件经 IPC 回到父进程
   - 断言：事件序列与进程内驱动**完全一致**（对照 V0.2.0 的事件词表）
   - 断言：seq 单调，不丢事件

3. 验证 C —— 取消 ★ 本版本的代价
   - 父进程要求取消 → 子进程真的截断输出
   - 三种手段各测一遍，记录哪种可用：
     a. IPC 发取消消息，子进程内部调 agent.cancel()
     b. SIGTERM
     c. SIGKILL
   - 关键问题：a 可行吗？可行则取消语义不退化；只有 b/c 可行则要评估
     「杀进程」对正在进行的一轮意味着什么

4. 验证 D —— 崩溃可观测
   - 子进程异常退出时，父进程能否区分「正常结束」与「崩溃」
   - 退出码与 stderr 是否足以定位

5. 验证 E —— node-pty 在子进程里仍可用
   - V0.1.0 验证 D 验过「外部拉起的子进程」，这里确认**两层嵌套**仍成立
   - Linux 与 Windows 各跑一次（Windows 上游 ProcessInspector 不支持，记录退化行为）

== 产出 ==
- docs/FEASIBILITY-REPORT-V45.md，逐条断言 + 实际输出 + 冷启动耗时
- 若验证 C 的 a 不可行：在报告里给出取消语义的替代方案，并更新任务书
```

验证:

- 止损判据:**若事件无法完整回传**,进程隔离改为「只隔离文件系统与凭据,
  仍在父进程驱动」的弱化形态,或整版推迟
- `/publish chore: {v} session 0 cross-process feasibility`

---

### ✅ Session 1: `@dshwar/supervisor` 契约与进程池

> **交付**:`@dshwar/supervisor`(37 条测试)。核心设计三条 ——
>
> 1. **租约模型**。`acquire(principal)` 返回 `Lease` 而非进程本身:同一 principal
>    的多个并发会话共用一个进程、各持一个 lease,IPC 消息打 `leaseId` 标签。
>    **取消因此只作用于本路会话**,不波及同进程的兄弟会话 —— 否则「隔离」
>    反而制造了新的越界。
> 2. **满了就拒绝,不排队**(任务书要求选一个并说明)。排队会让「进程不够」
>    这个局部问题升级成「网关被挂起的请求拖垮」的全局问题。`AtCapacityError`
>    由网关映射成 `503` + `Retry-After`,沿用 `policy` 的判定与执行分离。
> 3. **健康检查两种都做**。`isAlive`(没退出)与 `ping`(事件循环没卡死)是两回事;
>    只查存活会把死循环的进程一直留在池子里占着 58 MB。
>
> **一处实测更正,写下来免得后人误信测试**:「父进程退出时子进程不残留」这条
> 在本机与 CI 上**会白过** —— 绕开守卫直接 fork 的子进程同样随父进程消失,
> 连不带 IPC 的也一样。那不是 Windows 语义(Windows 根本没有父子生命周期绑定),
> 是**测试沙箱把整棵进程树放进了会连坐清理的作用域**。守卫本身改由两条
> 平台无关的机制测试钉住(登记则杀、未登记则不杀)。
>
> 验证 E 切开处理:「子进程还能否再拉起孙进程」是 supervisor 的风险,已测;
> 「node-pty 原生绑定在深度 2」是 node-pty 的风险,supervisor 碰不到,留给 Session 3。

```
读取 CLAUDE.md。本次任务:进程池编排。

1. 契约
   - Supervisor.acquire(principal) → ProcessHandle
   - ProcessHandle: 送消息 / 收事件 / 取消 / 释放
   - 一 principal 一进程；同一 principal 的并发会话复用同一进程
     （不是一会话一进程——那是数量级的差别）

2. 生命周期（R2）
   - spawn：冷启动，参数里带 principal 与 profile
   - 健康检查：进程还活着吗、还能响应吗（两者不同）
   - 空闲回收：多久没请求就回收，可配
   - 上限：单机最多多少进程，超了怎么办（排队还是拒绝——选一个并说明）

3. 与隔离级别的关系
   - 本包只实现「进程」这一档
   - 「逻辑」档不经过本包；「容器」档留接口，实现交给部署方

== 测试 ==
- 同一 principal 的两个会话复用同一进程
- 不同 principal 落在不同进程（正反各测）
- 空闲回收真的回收，且回收后再 acquire 能重新起来
- 进程上限触发时的行为与声明一致
- 父进程退出时子进程不残留（僵尸进程是运维噩梦）
```

验证:

- `/publish feat: {v} session 1 supervisor process pool`

---

### ✅ Session 2: 跨进程会话驱动

> **交付**:`gateway/src/worker.ts`(子进程入口)+ `gateway/src/sessions/remote.ts`
> (跨进程句柄)+ 13 条测试。
>
> **红线 2 的实现方式**:不在路由里到处写 `if (isolation === 'process')`,而是让
> 跨进程句柄**满足与进程内句柄完全相同的 `AgentHandleLike` 契约**。于是会话簿、
> SSE 路由、计量采集、`DELETE /v1/sessions/{id}` 全部一行不改,分派只发生在
> 创建句柄的那一处。为此把 `AgentHandleLike.agent.ctx` 从完整的 `CordisContext`
> 收窄成只含 `on('session/event')` 的 `SessionEventSource`。
>
> **红线 3 保住**:`agent.cancel()` 走 IPC 送指令,不杀进程。有测试断言取消后
> **再等 300 ms 也没有迟到的事件**(只断言截断时的计数会漏掉「其实没停,只是慢」),
> 另有一条断言取消一路不波及同进程的另一路。
>
> **seq 不重编号**。Session 0 的报告曾建议把 seq 权威收归父进程,那是没实测时的
> 保守取向。本 Session 实测:上游 seq 是**每 agent 各自从 0 起算**的,不是进程内
> 全局递增 —— 所以「哪些会话挤在同一个进程里」根本不影响 seq。重编号只会凭空
> 制造一个进程内与跨进程不一致的风险面。**对照测试逐条相同,含 seq。**
>
> **R5 不静默丢失**:`GatewaySessionStore.fail()` 终结会话、推 `error` 事件、
> SSE 冲完待发事件后收流(不再无限发心跳)。合成事件借 `lastSeq + 1` 是安全的,
> 前提正是「终结之后不会再有上游事件进来」—— 没有后来者就没有撞号的对象。
>
> **两处顺带发现,已开独立任务**(都不是 V0.4.5 引入的):
>
> 1. 契约的映射表写着 `agent/error` → `error`,但那是 cordis **Context** 上的事件,
>    不是 `SessionEventMap` 成员,`translateEvent` 永远看不到它 —— agent 报错时
>    客户端的流只是静默停住。
> 2. `assembleRuntime()` 装了 `dsh-llm` 却**从未注册任何 provider**,全仓唯一的
>    `registerAdapter` 在测试 harness 里。真实网关起得来但发不出一轮对话。

```
读取 CLAUDE.md。本次任务:把会话驱动搬到子进程,语义不退化。

1. 事件回传（R3）
   - 子进程的 session/event → IPC → 父进程的会话簿
   - ★ SSE 语义必须不变：同样的事件词表、同样的 seq 单调、
     同样的 Last-Event-ID 续传
   - 对照测试：同一段输入，进程内驱动与跨进程驱动的事件序列逐条相同

2. 可靠取消（R4）★ 红线 3
   - 按 Session 0 验证 C 的结论实现
   - DELETE /v1/sessions/{id} 在进程隔离下必须**仍然**立刻截断输出
   - 有测试断言「取消后不再有事件到达」，而不只是「接口返回了 200」

3. 崩溃恢复（R5）
   - 子进程死亡 → 该进程上的全部会话标记为失败，SSE 发 error 事件后关闭
   - **不静默丢失**：客户端必须知道会话没了，而不是流突然停住
   - 崩溃进审计

== 测试 ==
- 进程内 vs 跨进程的事件序列逐条对照
- 取消后不再有事件到达（不是只看接口返回码）
- 杀掉子进程 → 相关会话收到 error 事件而非静默挂起
- 崩溃记录进审计
```

验证:

- 红线 3:取消语义不退化
- `/publish feat: {v} session 2 cross-process session driving`

---

### ✅ Session 3: 隔离级别与网关接线

> **交付**:`gateway/src/isolation.ts` + 12 条测试。四条红线全部有断言。
>
> - **红线 1**:`DEFAULT_ISOLATION_LEVEL === 'logical'`,且 `parseIsolationLevel`
>   对认不出的值**直接抛**而不是静默回退 —— 配置写错一个字母就跑在逻辑隔离上,
>   而部署方以为开了进程隔离,这个差别是安全等级的差别。
> - **红线 2**:分派只在 `isolation.ts` 一处。`process` 档复用 V0.2.0 那套
>   「仅凭 HTTP 完成一次会话」的验收路径**一字不改**跑通,两档的事件类型序列相同。
>   为此给 `AgentFactoryFn` 加了 `principal`(进程按主体分配),这是内部接口,
>   `/v1` 契约零变更,`check:contract` 绿。
> - **红线 4**:`container` 档只是配置位,构造时抛错并指出正路(自定义
>   `ProcessLauncher` 喂给 `Supervisor`)。
> - **R7**:计量归属跨进程后仍正确;配额判定仍在父进程;
>   spawn / 回收 / 崩溃经 `auditSupervisorEvents` 进同一条审计管道,不另起一套。
>
> **一处被红线逼出来的折中**:进程池满时返回 `rate_limited`(429)而非语义更贴切的
> 503。契约的 `ErrorCode` 是闭集,加新码会被冻结检查判为破坏性变更,而红线 2 要求
> `/v1` 零变更。闭集里唯一「退避后重试」的就是它,客户端与负载均衡器的处置恰好对。
> 契约下次开口时(V0.5.0)应补 `unavailable`。
>
> **一个已知缺口,已开独立任务并用测试钉住现状**:配额挂在 `/turns` 上,而进程在
> **建会话**时就起来了 —— 配额耗尽的租户仍能不断建会话、占满进程槽位,把付费租户
> 挤出去。逻辑隔离下这几乎没有成本,是进程隔离把它放大成了问题。

```
读取 CLAUDE.md 第七节。本次任务:三档隔离由 profile 选,治理照旧。

1. 隔离级别（R6）
   - logical | process | container 三档
   - ★ 红线 1：默认仍是 logical。进程隔离要显式开
   - container 档本版本只留配置位与文档，不实现（红线 4）

2. 网关接线
   - createAgent 的实现按隔离级别分派
   - ★ 红线 2：/v1 契约零变更，check:contract 必须绿
   - 客户端不该知道自己跑在哪种隔离下

3. 治理联动（R7）
   - 计量:子进程的用量事件回传后，归属逻辑不变
   - 配额:判定仍在父进程（policy 不进子进程）
   - 审计:进程 spawn / 回收 / 崩溃进审计

== 测试 ==
- 三档都能起来，且默认是 logical
- 切到 process 档后，端到端会话仍跑通（复用 V0.2.0 的验收测试）
- 计量归属在跨进程下仍正确
- check:contract 绿
```

验证:

- `/publish feat: {v} session 3 isolation levels and gateway wiring`

---

### ✅ Session 4: 文档与发布准备

> **交付**:README 隔离矩阵加「状态」列并新增「进程隔离**仍然不是**什么」一节;
> `CLAUDE.md` 第七节与 `ARCHITECTURE.md` §2.4 同步并**更正了「进程隔离顺带解决
> cancel」这句反向的表述**;`docs/DEPLOYMENT.md` 新增 §2.5(选型指引 + 实测的
> 冷启动/内存数字 + 容量规划算法);`CHANGELOG.md` 加 0.4.5 节;
> 发布清单标题从「V0.1.0」改为「首发清单(目标版本 0.4.5)」并加了 8 条确认项。
>
> **一处本来会变成装饰品的东西**:隔离配置最初写进了 `profiles/*.yml`,
> 但那些文件是顶层 YAML **序列**(dsh loader 的插件清单格式),加 mapping 键
> 会让文件解析失败 —— 而漂移测试只比对插件名,没抓到。隔离级别是网关的部署决策
> 而非 cordis 插件,已挪到 `gateway.config.json`,**并接进 `server.ts` 且有测试
> 断言配错级别时拒绝启动**。一个「文档写了、示例配了、代码不读」的配置键
> 比没有更糟:部署方以为开了进程隔离,实际跑在逻辑隔离上。
>
> **两处留给发布前的实测**(已进发布清单):Linux 上重测冷启动与内存;
> 补测 node-pty 在两层嵌套下是否可用。

```
读取 CLAUDE.md 第三节与第四节。本次任务:改写对外承诺。

★ 本 Session 的重点是**文档的准确性**，因为隔离级别是安全承诺，
写错的代价是采用者基于错误信息做部署决策。

1. 隔离矩阵改写
   - README 的隔离模型警告：进程档从「V0.4.5」变成「可用」
   - 明确写出进程隔离**仍不是**什么：它不是容器，不防内核提权
   - CLAUDE.md 第七节、ARCHITECTURE.md §2.4 同步

2. 部署文档
   - docs/DEPLOYMENT.md 加隔离级别一节：怎么选、代价是什么
   - 冷启动耗时、内存开销要有实测数字（Session 0 的报告里有）

3. profiles/
   - enterprise.yml 切到 process 档
   - team.yml 保持 logical（红线 1）

4. 十道门禁 + 发布准备检查
```

验证:

- `/publish docs: {v} session 4 isolation docs and release readiness`

---

---

## 用途

`SESSION_TASKS.md` 必须始终保持在 **Claude Code 单文件读取上限(150,000 字符)** 以内。超限时 Claude Code 读不全任务书,会基于残缺上下文开发,**且不会主动告知哪部分被截断**。

因此版本**开发完成后**,该版本的任务块会被压缩:

| 文件                               | 内容                                | 谁读                         |
| ---------------------------------- | ----------------------------------- | ---------------------------- |
| `SESSION_TASKS.md`                 | 开发中版本完整详情 + 已完成版本摘要 | **Claude Code 每次开发都读** |
| `SESSION_TASKS_HISTORY.md`(本文件) | 已完成版本的完整实现细节            | 仅追溯历史实现时人工查阅     |

**一句话标准:主文件记录「改了什么」,本文件记录「怎么改的」。**

---

## 查阅方式

- 按版本号从新到旧排列,**最新发布的版本在最上方**
- 每个版本块内按 Session 编号顺序排列
- 内容为发布时从主文件原样迁出,**不做任何删减或改写**
- 想知道某个 Session 具体怎么实现的 → 搜版本号 → 找 Session 编号

---

## 维护规则(由 `CLAUDE.md` 第三节强制)

**触发时机**:每次版本**开发完成后**立即执行。

> ⚠️ **2026-08-16 判据修正。** 原文写的是「版本发布后」,且约束里有一条
> 「未发布版本永不归档」。但那条约束自己写明了理由是**「供开发使用」**——
> 对开发已完成的版本,这个理由不成立:它的 Session prompt 不再被任何人执行。
>
> 按原文字面执行的后果是:四个版本全部开发完成却一个都不能压缩,
> 主文件一路涨到读取上限,而上限一旦突破,Claude Code 会基于残缺上下文开发
> **且不会告知哪部分被截断** —— 那正是本机制要防的事故。
>
> 因此判据改为**开发完成**。发布与否不影响归档:发布是对外动作,
> 归档是为了保住主文件的可读性。

**迁入内容**(从主文件删除并原样追加到本文件开头):

- Session 的完整 prompt 代码块
- 实现步骤、接口规格、契约细节
- 验证动作与测试清单
- git 命令

**留在主文件的内容**(不迁入):

- 版本标题、简介引用段
- 交付内容表(需求清单)
- 包含的 Session 标题列表
- 核心改进要点

**约束**:

- 归档**不做任何删减**,保留全部实现细节
- 本文件**不受体积限制**
- **开发中的版本永不归档**——其任务详情必须完整留在主文件供开发使用。
  已完成但未发布的版本**可以**归档(见上方判据修正)
- 迁入位置是**文件开头**(本节之后),保持从新到旧的顺序
- Session 编号连续性:主文件摘要 + 本文件归档 应覆盖全部 Session,无遗漏

---

## 归档内容

<!-- 新版本的归档内容插入到这一行下方,保持从新到旧 -->

## M0.4.0

> 迁自 `SESSION_TASKS.md` 的 M0.4.0 · 计量与治理(Session 0-5) [未上线]
> 摘要(改了什么)仍在主文件;本节是实现细节(怎么改的),原样迁出未做删减。

---

### ✅ Session 0: 可行性证伪:用量可观测(1 天,止损点)

> 本版本压在一条未验证的假设上:**上游会把 token 用量报出来,且能归属到
> principal**。metering 的全部设计都建立在这上面 —— 若上游根本不报用量,
> 或报了但拿不到归属,计量就只能做请求计数,billing 的粒度承诺全要改。

```
读取 CLAUDE.md。

本次任务:验证 token 用量在上游的暴露路径。不写产品代码,产出验证报告。

1. 验证 A —— 上游类型面
   - 逐个检查 dsh-llm 的 StreamChunk / GenerateOptions / finish 事件类型:
     有没有 usage / tokens / cost 字段
   - 检查 dsh-session 的 SessionEventMap:assistant 消息落库时带不带用量
   - 检查 dsh-agent 的 AgentHandle:轮次结束时有没有用量汇总

2. 验证 B —— 实际信道
   - 用 FakeLlmAdapter 发含用量的 chunk,确认它能穿过 agent-loop 到达
     session/event 监听器(V0.2.0 的事件信封路径)
   - 确认用量事件带 turn 序号,能与网关的会话记录对上

3. 验证 C —— 归属
   - 会话 → principal 的映射在网关的 GatewaySessionStore 里已有;
     确认事件里的 session id 足以完成归属,不需要额外信道

== 产出 ==
- docs/FEASIBILITY-REPORT-V4.md,逐条断言 + 实际输出
- 若上游不报用量:metering 降级为「请求/轮次计数」,任务书相应修订,
  并在 README 写明 token 级计费要等上游补齐
```

验证:

- 止损判据:若用量完全不可观测**且**无法从消息内容估算,V0.4.0 改为只做 audit + policy(按轮次限额),metering 推迟
- `/publish chore: {v} session 0 usage observability feasibility`

---

### ✅ Session 1: `@dshwar/audit` —— 仅追加审计

```
本次任务:把网关里的 AuditSink 接口升级成真正的审计包。

1. 契约
   - AuditRecord:at / actor / tenantId / action / target / before? / after? / requestId
   - AuditStore:append(record) 与 query(filter) —— **没有 update,没有 delete**
   - 查询按租户过滤是强制参数,不是可选项:审计端点是 Admin API,
     一把 Key 只能看自己租户的记录

2. 实现
   - 内存实现 + 上游 storage 契约实现(与 subject 包同款双实现)
   - 记录键含单调序号,保证追加顺序可重放

3. 网关接线
   - gateway 的 ConsoleAuditSink / NullAuditSink 保留(它们是 sink,不是 store);
     新增 StoreAuditSink 把记录落进 AuditStore
   - /v1/admin/audit 由 501 转实现:按租户过滤 + 游标分页,契约一个字段不改

== 测试 ==
- append 后 query 可见,顺序稳定
- 不存在 update/delete 入口(结构断言)
- 跨租户查询拿不到别家的记录
- check:contract 绿(转正不是契约变更)
```

验证:

- `/publish feat: {v} session 1 append-only audit`

---

### ✅ Session 2: `@dshwar/metering` —— 用量归属

```
本次任务:把上游报的用量按 principal 归属并可查询。

1. 契约
   - UsageRecord 对齐 api-contract 里冻结的形状(subjectId / model /
     inputTokens / outputTokens / at 等,以冻结契约为准)
   - MeteringStore:record(usage) / query(filter) / aggregate(filter)

2. 采集
   - 挂在网关的会话事件流上(Session 0 验证的信道)
   - ★ 红线 1:观测不阻断。采集回调里任何异常都吞掉并落审计,
     不能让会话因为计量挂了而断

3. 端点转正
   - GET /v1/admin/usage(聚合)与 GET /v1/admin/subjects/{id}/usage(明细)
   - 按租户过滤;跨租户 403

== 测试 ==
- 一轮会话产生的用量记录归属到正确的 principal 与 turn
- 计量 store 抛错时会话照常完成,错误进审计
- 聚合口径与明细逐条相加一致(会计恒等式)
- check:contract 绿
```

验证:

- `/publish feat: {v} session 2 usage metering`

---

### ✅ Session 3: `@dshwar/policy` —— 配额与限流

```
本次任务:配额判定与网关执行。

1. 契约
   - Quota 对齐 api-contract 冻结形状(tokenLimit nullable / tokenUsed /
     periodStart / periodEnd)
   - PolicyService.check(principal, requested) → allow | deny(reason)
   - ★ 红线 2:判定与执行分离,包里没有任何 HTTP 概念

2. 判定
   - tokenUsed 来自 metering 的聚合;tokenLimit null = 不限
   - 周期滚动:周期结束后 tokenUsed 归零重新累计
   - ★ 缺 metering 数据时 fail closed 还是 fail open?——
     **fail open**:计量挂了不该把所有人锁在外面(它是账目组件不是安全组件),
     但要落审计。与硬规则 6 的 fail closed 不冲突:那是身份,这是账。

3. 网关执行
   - POST /v1/sessions/{id}/turns 前置检查:超限 → 429 rate_limited
   - quota GET/PATCH 转正;PATCH 记 before/after 进审计

== 测试 ==
- 烧完配额后下一轮 429,错误形状与契约一致
- PATCH 提额后立即恢复
- 周期滚动归零
- metering 不可用时放行 + 审计(显式测 fail open)
- check:contract 绿
```

验证:

- `/publish feat: {v} session 3 quota policy`

---

### ✅ Session 4: `@dshwar/model-router` —— 准入与降级

```
本次任务:模型治理,只在 createAgent 入口裁决。

1. 契约
   - Policy 对齐 api-contract 冻结形状
   - resolveModel(principal, requested) → { model, provider, downgraded? }
   - ★ 一句话边界:不碰请求路由、不碰 LLM 调用 —— 裁决完交回上游

2. 准入
   - 按租户/角色配置允许的模型清单;请求不在清单 → 拒绝(403,不是静默换)
   - 未配置清单的租户默认放行(准入是 opt-in 的治理,不是默认封锁)

3. 预算降级
   - ★ 红线 3:降级是显式配置(如「预算用到 80% 后 chat→cheaper」),
     不是超限时的隐式行为;降级发生时响应头 x-dshwar-model-downgraded 告知,
     并落审计 —— 用户有权知道自己被换了模型

4. /v1/admin/policies 转正(只读列表,写入口留给控制平面 V0.5.0)

== 测试 ==
- 清单外模型 403;清单内放行
- 预算阈值触发降级,响应头与审计都有痕迹
- 降级配置缺失时超预算不降级(走 policy 的 429)
- check:contract 绿
```

验证:

- `/publish feat: {v} session 4 model router`

---

### ✅ Session 5: 治理链路串联与发布

```
本次任务:端到端验收与收尾。

1. 端到端(R9)
   - 一个 principal 连续发轮直到烧完配额 → 下一轮 429
   - 预算过半后发轮 → 用了降级模型,响应头可见,审计有记录
   - 全程:每一轮的用量都能在 /v1/admin/usage 查到,
     每次 Admin 变更都能在 /v1/admin/audit 查到

2. server.ts 接线
   - 配置文件加 metering / quota / modelPolicy 段
   - 真跑冒烟:起进程,烧配额,看 429

3. 文档
   - README 治理一节 + 包表转 ✅ + planned 表更新
   - docs/GOVERNANCE.md:配额、降级、审计的部署配置
   - 兼容矩阵更新

== 测试 ==
- 九道门禁全绿
- 契约里不再有 PLANNED_V4 的 planned 端点(全部转正)
```

验证:

- `/publish chore: {v} session 5 governance release`

---

## M0.3.0

> 迁自 `SESSION_TASKS.md` 的 M0.3.0 · 身份互操作(Session 0-7) [未上线]
> 摘要(改了什么)仍在主文件;本节是实现细节(怎么改的),原样迁出未做删减。

---

### ✅ Session 0: 可行性证伪:SCIM 供给链(2 天,止损点)

> ⚠️ **与 V0.1.0 / V0.2.0 的 Session 0 同级。** 本版本的验收标准写着
> 「用 Keycloak 作为身份源,通过 SCIM 把两个用户推进 DSHWAR……全程不写一行定制代码」
> (`IDENTITY-INTEROP.md` §8)。这句话压在一条**未验证的假设**上:
> 供给方真的能主动把用户 push 过来。
>
> 已知风险:**Keycloak 本体不自带 SCIM 客户端**(SCIM 供给是社区扩展)。
> 若属实,这条验收标准按原文无法达成,必须先换供给方或换验收方式 ——
> 而不是写到 Session 7 才发现。

```
读取 CLAUDE.md 与 IDENTITY-INTEROP.md 全文。

本次任务:验证 SCIM 供给链路真的能走通。不写产品代码，产出验证报告。

1. 供给方调研
   - Keycloak 是否自带 SCIM 客户端？若无，可选扩展是什么、成熟度如何
   - Okta / Azure AD(Entra) / Authentik 各自的 SCIM 客户端行为
   - 结论：本版本的验收标准用哪一个供给方，为什么

2. 验证 A —— PATCH 的停用语义
   - 抓取真实供给方发出的 "停用用户" 请求体
   - 确认它是 PATCH 还是 PUT、active 字段的实际形状
   - 若各家不一致，记录差异矩阵

3. 验证 B —— Group 到租户的实际形状
   - SCIM Group 的 members 是引用还是内联
   - 一个用户属于多个 Group 时，租户映射如何裁决(必须确定，否则 R2 无从实现)

4. 验证 C —— JWKS 轮换
   - 起一个真实 IdP，取 discovery 与 jwks_uri
   - 确认 kid 轮换时的行为，以及缓存该怎么失效

5. 验证 D —— 令牌分离的可行性
   - 供给方能否为 SCIM 单独配一个 bearer token(而非复用 admin)

== 产出 ==
- docs/FEASIBILITY-REPORT-V3.md，逐条断言 + 实际输出
- 若验收标准无法按原文达成，在报告里给出替代方案并更新任务书
```

验证:

- 止损判据:**若没有任何供给方能零定制代码推送用户**,本版本改为「只做 Subject 契约 + Admin 端点」,SCIM 推迟
- `/publish chore: {v} session 0 scim provisioning feasibility`

---

### ✅ Session 1: `@dshwar/subject` —— Subject Mirror

```
本次任务:身份镜像的契约与实现。

1. 契约
   - Subject：externalId / userName / active / tenantId / emails / groups / meta
   - **不含密码字段**(硬规则 4)，契约层就不留位置
   - 来源标记 source：哪个身份源推来的，用于多 IdP 并存时的归属

2. SubjectStore 契约
   - upsert(subject) / get(id) / getByExternalId(source, externalId)
   - list(filter) / deactivate(id)
   - **不提供 create 之外的"新建用户"入口** —— DSHWAR 不是身份提供者

3. storage 实现
   - 走上游 dsh-storage 契约 + @dshwar/storage-scoped 的租户前缀
   - 记录键设计要能支撑 getByExternalId 的查询

4. 停用态
   - active:false 的用户必须能被 auth 层看到并拒绝
   - 停用不删除记录(审计需要)

== 测试 ==
- 停用后 get 仍返回记录，但 active 为 false
- 跨租户的 externalId 相同不冲突
- 契约里不存在任何可放密码的字段(结构断言，与 CredentialDescriptor 同款)
```

验证:

- `/publish feat: {v} session 1 subject mirror`

---

### ✅ Session 2: `@dshwar/tenant-map` —— 租户映射

```
本次任务:把 IDENTITY-INTEROP.md §5 的映射规则变成代码。

1. 四种策略
   - claim：从 OIDC claim 取，如 org_id
   - group：从 SCIM Group 名按前缀解析，如 tenant:acme
   - issuer：一个身份源一个租户
   - fixed：全部归入一个租户(单租户部署)

2. fallback
   - 默认 reject —— 映射不出租户宁可拒登(硬规则 7)
   - fixed:<tenant> 需显式配置

3. 多值裁决
   - 一个用户命中多个 Group 时怎么办(Session 0 验证 B 的结论)
   - 歧义必须**拒绝**而不是取第一个 —— 取第一个意味着顺序变了归属就变了

== 测试 ==
- 每种策略各一组正向用例
- 映射不出租户时默认 reject，且错误信息说明是哪一步失败
- 多 Group 歧义被拒绝
- 配置 fixed fallback 需要显式写出租户名，空字符串被拒
```

验证:

- `/publish feat: {v} session 2 tenant mapping`

---

### ✅ Session 3: `@dshwar/auth-jwt` —— JWKS 验签

```
本次任务:替掉 auth-static 的明文令牌表。

1. 验签
   - 实现 @dshwar/auth 契约的 verify(token) → Principal
   - 支持 RS256 / ES256；拒绝 alg:none 与对称算法(HS*)混用
   - iss / aud / exp / nbf 全部校验，不给"宽松模式"开关

2. JWKS
   - 从 jwks_uri 拉取并缓存
   - kid 未命中时刷新一次；刷新仍未命中即拒绝(不无限刷新，那是放大器)
   - 缓存 TTL 与并发去重

3. 与 subject / tenant-map 接合
   - 验签通过后查 Subject Mirror：不存在或 active:false → 拒绝
   - 租户由 tenant-map 决定，不直接信 token 里的 tenant 字段

== 测试 ==
- 过期 / 未生效 / 错误 aud / 错误 iss 各一条负向用例
- alg:none 与 HS256 伪造被拒
- kid 轮换后能自动恢复
- 用户在 Subject Mirror 里被停用后，同一个仍然有效的 token 也被拒 ★ 本版本的核心验收
```

验证:

- `/publish feat: {v} session 3 jwt authentication`

---

### ✅ Session 4: `@dshwar/auth-oidc` —— OIDC 接入

```
本次任务:让部署方只填一个 issuer URL 就能接上。

1. discovery
   - 拉 /.well-known/openid-configuration
   - 取 jwks_uri / issuer，交给 auth-jwt 复用

2. claim 映射
   - sub → subject 的 externalId
   - preferred_username / email → userName(可配)
   - 租户 claim 交给 tenant-map

3. 与 auth-jwt 的关系
   - auth-oidc 是 auth-jwt 的配置来源，不重复实现验签

== 测试 ==
- discovery 文档缺字段时给出可读错误，而不是运行时才炸
- issuer 与 token 里的 iss 不一致时拒绝
- 契约测试对着 Session 0 录下来的真实 discovery 文档回放
```

验证:

- `/publish feat: {v} session 4 oidc integration`

---

### ✅ Session 5: `@dshwar/scim-server` —— SCIM 2.0 子集

```
本次任务:SCIM 2.0 服务端，User + Group + PATCH。

1. User 资源
   - POST / GET / PUT / PATCH / DELETE /Users
   - ★ PUT 与 PATCH **两条路径都必须能把 active:false 落到停用**
     (Session 0 §4:Entra/Okta 发 PATCH，authentik 发 PUT)
   - ★ DELETE **不得**被当作停用信号(Entra 硬删除延迟 30 天才发)
   - filter 至少支持 userName eq 与 externalId eq(供给方最常用的两条)
   - 分页 startIndex / count

2. Group 资源
   - 同上；members 的增删走 PATCH

3. PATCH
   - RFC 7644 §3.5.2 的 add / remove / replace
   - **active:false 必须落到 Subject Mirror 的停用**(本版本验收的关键路径)

4. 错误与 schema
   - SCIM 的错误响应格式与 DSHWAR 的 ErrorResponse 不同 —— 走 SCIM 自己的格式
   - /ServiceProviderConfig 与 /Schemas 端点 ★ **第一优先级，且必须如实声明能力**
     authentik 读它来决定用 PATCH 还是 PUT，并**缓存一小时** ——
     虚报一次，供给方接下来一小时都会用错方法(Session 0 §5)

== 测试 ==
- 用 Session 0 录下来的真实供给方请求体回放
- PATCH active:false 后，该用户经 auth 的请求被拒
- 未知 filter 返回 501 而不是静默返回全量 ★ 静默返回全量是数据泄漏
```

验证:

- `/publish feat: {v} session 5 scim server`

---

### ✅ Session 6: 网关接入与令牌分离

```
本次任务:把 SCIM 挂上网关，并把三类令牌彻底分开。

1. 三类令牌
   - 运行时 token：Authorization: Bearer，终端用户
   - Admin Key：x-dshwar-admin-key，按租户
   - SCIM token：Authorization: Bearer，**按身份源**，只能写身份镜像
   - 中间件层分道，与 V0.2.0 的分道鉴权同款

2. SCIM 挂载
   - /scim/v2/* 前缀，不占用 /v1/
   - SCIM token 不得访问 /v1/ 的任何端点，反之亦然 ★ 必须有负向测试

3. Admin subjects 端点转实现
   - /v1/admin/subjects 与 /v1/admin/subjects/{id} 由 501 转为实现
   - **契约一个字段都不许改** —— 契约冻结检查会拦

4. 审计
   - 所有 SCIM 写操作进 audit，记录来源身份源与变更前后

== 测试 ==
- SCIM token 打 /v1/sessions → 401
- 运行时 token 打 /scim/v2/Users → 401
- Admin Key 打 /scim/v2/Users → 401
- pnpm check:contract 必须绿(planned 转实现不是契约变更)
```

验证:

- `/publish feat: {v} session 6 scim mount and token separation`

---

### ✅ Session 7: `@dshwar/webhooks` 与发布

```
本次任务:出站事件投递，端到端验收，收尾。

1. webhooks
   - 事件：subject.created / subject.updated / subject.deactivated
   - 投递：HMAC 签名头、重试退避、失败落审计
   - **不做投递保证**(那需要持久队列，属于控制平面)，明确写在文档里

2. 端到端验收 ★ 本版本的存在理由
   - **authentik 以容器起在 CI 里**，不依赖任何 SaaS 账号
     (Session 0 裁决:Keycloak 没有出站 SCIM 客户端，原验收标准点名它是错的)
   - 推两个用户进来，其中一个在 authentik 侧停用，该用户下次请求被拒，全程零定制代码
   - ⚠️ 顺带实测 Session 0 标 ⚠️ 的三条:authentik 解绑用户的确切请求形状、
     多 Group 命中时的样本、JWKS kid 轮换行为

3. 文档
   - README 加身份互操作一节与集成矩阵
   - docs/IDENTITY-SETUP.md：接 IdP 的实操步骤
   - 兼容矩阵更新
   - profiles/enterprise.yml：OIDC + SCIM 的部署组合

== 测试 ==
- webhook 签名可被第三方按文档独立验证(不能只有我们自己算得对)
- 投递失败重试后仍失败 → 落审计，不静默丢弃
- 端到端验收脚本进 CI(供给方不可用时跳过并说明，不静默变绿)
```

验证:

- M2.5 验收:**authentik**(容器)停用用户后,该用户下次请求被拒,全程零定制代码
- `/publish chore: {v} session 7 webhooks and identity release`

---

## M0.2.0

> 迁自 `SESSION_TASKS.md` 的 M0.2.0 · API 平面(Session 0-6) [未上线]
> 摘要(改了什么)仍在主文件;本节是实现细节(怎么改的),原样迁出未做删减。

---

### ✅ Session 0: 可行性证伪(3 天,止损点)

> ⚠️ **与 V0.1.0 的 Session 0 同级。** 本版本压在一条未验证的上游行为上:
> 网关要在**进程内**驱动 dsh 的 agent,而上游只提供 stdio JSON-RPC 的 SDK 协议,
> 且该协议**没有 cancel 与 session-close 方法**(`ARCHITECTURE.md` §2.4)。
> 不先验证,后面四周都是赌。

```
读取 CLAUDE.md 与 ARCHITECTURE.md §1.1、§2.4。

本次任务:验证网关能否在进程内驱动 dsh agent。不写产品代码，产出验证报告。

1. 环境准备
   - 用 V0.1.0 的 team.yml 组合起一个进程内 cordis 运行时
   - 确认 ctx.agent / ctx.session 的公开 API 形状

2. 验证 A —— 进程内发起一次完整会话
   - 不经 stdio JSON-RPC，直接用 cordis 服务发起一轮对话
   - 断言：能拿到完整回复
   - 若必须经 SDK 协议才能驱动 → 记录，架构需引入 supervisor 提前

3. 验证 B —— 流式输出
   - 确认 agent 的增量输出以何种形式暴露（事件 / AsyncIterable / 回调）
   - 断言：可转成 SSE 而不需要缓冲整个回复

4. 验证 C —— 取消
   - 上游 SDK 协议无 cancel。确认进程内是否有别的途径
     （AbortSignal / fiber dispose / ctx 作用域释放）
   - 断言：取消后不再产生输出，且不泄漏 fiber
   - 若无法取消 → supervisor 从 V0.4.0 提前，因为「终止进程即是取消」

5. 验证 D —— 并发会话隔离
   - 同一进程内并发两个 principal 的会话
   - 断言：输出不串号，凭据不串号（复现 V0.1.0 验证 C 到 agent 层）

== 产出 ==
docs/FEASIBILITY-REPORT-V2.md，包含：
- 四项验证的通过/失败结论与复现步骤
- agent / session 的实际 API 形状
- 若失败：失败点的最小复现与架构影响

不要写产品代码。不要建 gateway/。
```

验证:

- 四项全过 → 进入 Session 1,架构不变
- **验证 A 失败** → 进程内驱动不可行 → `supervisor` 从 V0.4.0 提前到本版本
- **验证 C 失败** → 无法取消 → 同上,且 SSE 断连会泄漏 fiber,必须先解决
- `/publish chore: {v} session 0 gateway feasibility`

---

### ✅ Session 1: OpenAPI v1 契约 ★ 护城河本体

```
读取 CLAUDE.md 与 IDENTITY-INTEROP.md §3.3。

本次任务:定义 v1 全部契约。这是本版本最重要的产出——
运行时插件可替换、控制面是标准 SaaS，只有这份契约是客户接进来之后换不掉的。

1. packages/api-contract
   - Zod schema 为单一事实源，OpenAPI 3.1 由其生成
   - 禁止手写 OpenAPI yaml；禁止 schema 与文档两处维护

2. 运行时 API
   - POST /v1/sessions              创建会话
   - GET  /v1/sessions/{id}         会话状态
   - POST /v1/sessions/{id}/turns   发起一轮
   - GET  /v1/sessions/{id}/stream  SSE 流式
   - DELETE /v1/sessions/{id}       取消并释放

3. Admin API（契约完整定下，实现分期）
   - /v1/admin/subjects                    [planned]
   - /v1/admin/subjects/{id}/quota         [planned]
   - /v1/admin/subjects/{id}/usage         [planned]
   - /v1/admin/subjects/{id}/credentials   ← V0.2.0 实现，describe 语义
   - /v1/admin/usage                       [planned]
   - /v1/admin/policies                    [planned]
   - /v1/admin/audit                       [planned]
   - planned 端点在 OpenAPI 标注 x-dshwar-status: planned

4. 横切约定（R2 —— 决定第三方后台能不能自动生成）
   - 统一错误形状：{ error: { code, message, requestId } }
     错误 code 是**闭集**，SDK 可穷举
   - 列表端点统一 ?limit&cursor&sort，游标分页不用 offset
   - 所有响应带 requestId，与审计对得上

5. 凭据端点的形状（硬规则 5）
   - 只返回 configured / source / writable
   - 契约层就不给「值」留位置——schema 里没有那个字段，
     实现方即便想返回也没地方放

6. info.version 纳入 check-version

== 测试 ==
- Zod → OpenAPI 生成结果快照测试
- 凭据端点的 schema 里不存在任何可放值的字段
- 错误 code 闭集与 SDK 的穷举一致
```

验证:

- OpenAPI 3.1 可被 `@redocly/cli lint` 通过
- `check-version` 覆盖 `info.version`
- `/publish feat: {v} session 1 openapi v1 contract`

---

### ✅ Session 2: Gateway 骨架与会话路由

```
读取 CLAUDE.md（第七节 安全与隔离)。

本次任务:Hono 服务、认证、会话路由。

1. gateway/
   - Hono，Web 标准，可跑 Node 与边缘
   - 契约来自 packages/api-contract，路由由 schema 校验

2. 会话路由 —— 本 Session 的核心
   - Bearer token → ctx.auth.verify() → Principal
   - runWithPrincipal 派生会话作用域（**不是 withPrincipal**——
     长命进程按请求派生会累积隔离槽位，V0.1.0 已实测）
   - 此下所有插件按 principal 解析，消费方零改动

3. 令牌分离（R4，第七节强制）
   - 运行时 token 与 Admin API Key 分离签发
   - Admin API Key 按租户签发，一把钥匙不得横跨租户
   - 中间件层就分开，不在 handler 里判断

4. 错误处理
   - 统一错误形状，requestId 贯穿
   - AuthError 原样传递「不携带原因」的语义——网关不得把它翻译成
     「token 不存在」之类的具体消息

5. 明确不做
   - TLS 终结交给反向代理，网关不自己管证书
   - 限流只留接口，实现在 V0.4.0 的 policy

== 测试 ==
- 无 token / 错 token / 过期 token 的响应形状完全一致
- Admin Key 访问运行时端点被拒，反之亦然
- 跨租户 Admin Key 被拒
- 并发请求不串号（复现 V0.1.0 验证 C 到 HTTP 层）
```

验证:

- `/publish feat: {v} session 2 gateway skeleton and session routing`

---

### ✅ Session 3: 运行时 API 与 SSE

```
本次任务:让第三方仅凭 HTTP 就能完成一次完整会话。

1. 会话生命周期
   - 创建 / 查询 / 发起一轮 / 取消
   - 会话归属 principal，跨 principal 访问一律 404（不是 403——
     403 会泄漏「这个 id 存在」）

2. SSE 流式
   - 增量输出转 SSE，不缓冲整个回复
   - 断连处理：客户端掉线必须释放 fiber（Session 0 验证 C 的落点）
   - 心跳，穿透代理

3. 取消
   - DELETE 立即停止产出并释放
   - 按 Session 0 验证 C 的结论实现

== 测试 ==
- 一次完整会话：创建 → 发起 → 流式收完 → 释放
- 断连后 fiber 被释放（度量，不靠肉眼）
- 跨 principal 访问会话返回 404
- 并发两个 principal 的会话输出不串号
```

验证:

- `/publish feat: {v} session 3 runtime api and sse`

---

### ✅ Session 4: Admin API

```
读取 CLAUDE.md（硬规则 5)与 IDENTITY-INTEROP.md §3.3。

本次任务:实现有后端可依托的 Admin 端点，其余按契约返回 501。

1. /v1/admin/subjects/{id}/credentials
   - 调 credentials.describe()，只返回 configured / source / writable
   - **永不返回值**。PR 自查的 grep 会盯这一条

2. planned 端点
   - 返回 501，body 用统一错误形状，code 为 not_implemented
   - 响应头带 x-dshwar-planned-version 指出哪个版本会实现
   - 不返回 404——404 会让第三方以为路径写错了

3. 列表端点的分页与排序
   - 游标分页，让 Refine / Appsmith 直接吃

4. 审计埋点
   - 所有 Admin 调用记录调用者 / 目标 / 变更前后
   - @dshwar/audit 在 V0.3.0，本版本先留接口并落日志

== 测试 ==
- credentials 端点的响应体不含任何 key 值（正则扫描，不靠人看）
- planned 端点返回 501 而非 404
- 跨租户 Admin Key 读不到别的租户的 subject
```

验证:

- `/publish feat: {v} session 4 admin api`

---

### ✅ Session 5: TS SDK

```
本次任务:由 OpenAPI 生成 TS SDK，不手写。

1. sdk/typescript
   - 由 packages/api-contract 的 OpenAPI 生成
   - 生成脚本进 CI：契约改了 SDK 没重生成即失败

2. SSE 客户端
   - 生成器通常不管流式，这部分手写但**只写传输**，类型仍来自契约

3. 错误
   - 错误 code 闭集映射为可穷举的 TS 联合类型

== 测试 ==
- examples/sdk-session：仅凭 SDK 完成一次完整会话，不接触 dsh
- 契约改一个字段，SDK 未重生成时 CI 必须红
```

验证:

- M2 验收:第三方仅凭 SDK 完成一次完整会话
- `/publish feat: {v} session 5 typescript sdk`

---

### ✅ Session 6: 契约冻结与发布

```
本次任务:把「契约不能随便改」变成机制。

1. 契约冻结检查
   - OpenAPI 快照进仓库
   - 变更时 CI 比对：破坏性变更必须在 PR 描述显式声明并升大版
   - 非破坏性变更（加字段、加端点）放行

2. profiles/gateway.yml
   - 网关部署用的组合

3. 文档
   - README 加 API 平面一节与 SDK 快速上手
   - 兼容矩阵更新
   - 部署文档：TLS 由反向代理终结，网关不自己管证书

== 测试 ==
- 人为做一次破坏性契约变更，CI 必须红
- 加一个可选字段，CI 必须绿
```

验证:

- `/publish chore: {v} session 6 contract freeze and release`

---

## M0.1.0

> 迁自 `SESSION_TASKS.md` 的 M0.1.0 · 运行时平面 MVP + 开源首发(Session 0-8) [未上线]
> 摘要(改了什么)仍在主文件;本节是实现细节(怎么改的),原样迁出未做删减。

---

### 在开始 Session 0 之前

```bash
git clone git@github.com:<org>/dshwar.git && cd dshwar
git checkout -b feature/v0.1.0
# 版本号即时同步：CLAUDE.md 顶部、本文件头部、root package.json 均写 0.1.0
```

---

### ✅ Session 0: 可行性证伪(3 天,止损点)

> ⚠️ **本 Session 的目的是证伪,不是交付。** 整套架构压在两条上游行为上,不先验证,
> 后面五个月都是赌。**结论为否时,立即停止并按下方止损路径调整架构,不要绕过。**

```
读取 CLAUDE.md 与 ARCHITECTURE.md §2.2。

本次任务:验证两条上游行为，不写任何产品代码，产出一份验证报告。

1. 环境准备
   - 按上游 examples/jsonrpc-demo 的 cordis.yml 在本机跑通 dsh
   - 记录：监听端口、协议形态（stdio / HTTP / SSE / WS）、认证方式

2. 验证 A —— ctx.isolate 作用域传播
   - 用 ctx.isolate('principal') 派生两个兄弟子上下文，各绑一个 principal
   - 断言：子上下文 a 读不到子上下文 b 的 principal
   - 断言：父上下文不受子上下文影响

3. 验证 B —— 凭据不跨操作缓存
   - 在同一运行时内先后用两个 principal 解析同一个 credential ref
   - 断言：第二次解析返回第二个 principal 的值，无需重启任何插件
   - 断言：换绑后的新值在「下一次」操作即生效，不是下一个会话

4. 验证 C —— 并发无串号
   - 并发发起两个 principal 的解析各 100 次
   - 断言：无一次串号

5. 验证 D —— node-pty 在外部拉起的子进程中行为正常
   - 确认 dsh-subprocess-local 的 PTY 能力在非交互式父进程下可用

== 产出 ==
docs/FEASIBILITY-REPORT.md，包含：
- 四项验证的通过/失败结论与复现步骤
- dsh 实际暴露的通道形态（端口、协议、认证）
- 若失败：失败点的具体表现与最小复现

不要写产品代码。不要建 packages/。本 Session 只产出验证脚本与报告。
```

验证:

- 四项全过 → 进入 Session 1,架构不变
- **验证 A 或 C 失败** → cordis 作用域机制与文档不符 → 架构改为**进程级隔离优先**,`supervisor` 从 V0.4.0 提前到本版本,`ARCHITECTURE.md §2.4` 与路线图同步修订
- **验证 B 失败** → 凭据换绑需要重启插件 → 会话级 principal 绑定不可行,需改为每 principal 一个运行时
- `/publish chore: {v} session 0 feasibility report`

---

### ✅ Session 1: 工程骨架与 adapters 边界纪律

```
读取 CLAUDE.md（8 条硬规则与 PR 自查清单）。

本次任务:建立仓库骨架与工程纪律。纪律必须在写第一个包之前就位——
adapters 边界规则写进 CI 只要半小时，不写的话三个月后满仓库都是直连上游内部实现。

1. pnpm workspace
   - packages/* 与 examples/*
   - tsconfig.base.json：strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess
   - tsc project references，不引入 bundler

2. 版本策略
   - changesets init，改为 fixed 模式：全部 @dshwar/* 统一版本号
   - 校验脚本 scripts/check-version：比对 root package.json / CLAUDE.md 顶部 /
     SESSION_TASKS.md 头部 / README 兼容矩阵，不一致则退出码非 0

3. adapters 边界 lint（R2，本 Session 最重要的产出）
   - ESLint no-restricted-imports 规则：
     packages/** 与 gateway/** 禁止匹配 @deepseek-ai/dsh-*/(lib|src|dist)/**
     仅 adapters/** 豁免
   - 同时提供 grep 版本写入 CI，双保险

4. 上游依赖锁版守卫
   - 脚本扫描全部 package.json，@deepseek-ai/* 出现 ^ 或 ~ 即失败

5. CI（GitHub Actions）
   - 矩阵：Node 22 / Node 24
   - 步骤：install → typecheck → lint → 边界检查 → 锁版检查 → test
   - Renovate 配置：盯 @deepseek-ai/dsh-*，自动开 PR

6. profiles/single-user.yml 骨架
   - 组合上游原生插件 + 匿名 principal，作为后续所有对照测试的基线

== 测试 ==
- 故意写一行深链 import，CI 必须失败
- 故意把某个上游依赖改成 ^，CI 必须失败
- 故意改乱一处版本号，check-version 必须失败
```

验证:

- 三条负向测试全部正确拦截
- `/publish chore: {v} session 1 workspace scaffold and adapter boundary`

---

### ✅ Session 2: `@dshwar/principal`

```
读取 CLAUDE.md。本次任务:实现 principal 传播——DSHWAR 引入的唯一新概念。
其余所有包都是上游已有契约的替代实现，只有这个是新的。

1. 类型
   - Principal：id / tenantId / roles[] / claims，全部 readonly
   - ANONYMOUS 常量，Object.freeze
   - id 必须是稳定不可轮换的标识，禁止用邮箱

2. PrincipalService extends Service
   - 通过 declare module 增强 Context，挂 ctx.principal
   - current(): Principal，永不返回 undefined
   - isAnonymous(): boolean

3. withPrincipal(ctx, principal): Context
   - 内部用 ctx.isolate('principal') 派生子作用域
   - 返回的 context 是服务端交给「一个会话」的东西
   - 拥有该 fiber 的作用域释放时自动解绑

4. TSDoc
   - 每个公开导出必须有文档，写「为什么」而非重述签名
   - 特别说明：为什么 principal 必须每次操作解析、不跨操作缓存

== 测试 ==
- 兄弟作用域互不可见（复现 Session 0 验证 A）
- 父作用域不受子作用域影响
- 默认构造返回 ANONYMOUS
- 并发 100 组 principal 无串号
```

验证:

- 单测覆盖作用域隔离与并发
- `/publish feat: {v} session 2 principal propagation`

---

### ✅ Session 3: `@dshwar/auth` 契约 + `auth-static` 实现

```
读取 CLAUDE.md（硬规则 4：不做 IdP）。
本次任务:定义认证契约并提供零配置的开发实现。

1. @dshwar/auth
   - AuthError：不携带失败原因细节，调用方不得分支处理
   - abstract class Auth extends Service，挂 ctx.auth
   - abstract verify(token: string): Promise<Principal>
   - 文档必须写明契约边界：只验证与映射，永不存密码、永不签发令牌、
     永不实现注册流程。这条边界决定 DSHWAR 与 Keycloak/Casdoor 是集成关系
     而非竞争关系。

2. @dshwar/auth-static
   - 配置声明的 token → principal 映射
   - 构造时输出显式警告：token 是明文配置，禁止部署
   - quiet 选项仅供测试使用
   - 存在意义：让 git clone && pnpm dev 零外部依赖即可跑通，
     这是新贡献者的第一印象，也是所有契约测试的 fixture

3. 明确不在本 Session 做
   - auth-jwt 与 auth-oidc 放到 V0.3.0，本版本不碰

== 测试 ==
- 未知 token 抛 AuthError
- AuthError 不泄漏失败原因
- grep 校验：包内不存在 bcrypt / argon2 / password 字样
```

验证:

- 契约测试可用 auth-static 作为 fixture
- `/publish feat: {v} session 3 auth contract and static provider`

---

### ✅ Session 4: `@dshwar/credentials-multiuser`

```
读取 CLAUDE.md（硬规则 5、6）与上游 dsh-credentials 的 README 与类型定义。

本次任务:实现 per-principal 凭据解析。这是整个论点最直接的证明——
换掉一个实现，所有 LLM 适配器、工具、插件自动变成多用户，消费方零改动。

1. 继承上游 CredentialProvider 抽象类（类名如此，服务名才是 ctx.credentials），
   实现四个抽象方法
   - resolve(ref) / describe(ref) / set(ref, value) / unset(ref)
   - 严格遵守上游语义：空值等同缺失；set 时若被只读来源遮蔽必须拒绝

2. PrincipalCredentialStore 接口
   - get / put / remove，三个方法，实现者可用 Postgres / Vault / KMS
   - 本 Session 只提供内存实现供测试，不做持久化

3. shadow 遮蔽机制（网关短时效 token 的落点）
   - 运营方持一把上游 key，按 principal 换发 scoped token
   - 被遮蔽的 ref 只读，set/unset 必须抛错
   - 这是「用户永不持有 provider key」的架构实现

4. fail closed（硬规则 6）
   - 匿名 principal 解析不到任何凭据，返回 undefined
   - 不得回退到默认值、共享 key 或环境变量
   - 文档写明理由：组合配错时宁可跑不起来

5. notifyUpdated
   - set/unset 后通知上游，确保变更即刻生效

== 测试 ==
- 两个 principal 解析同一 ref 得到各自的值
- 匿名 principal 解析返回 undefined
- 被遮蔽的 ref：resolve 返回网关值、describe 报 writable=false、set 抛错
- 换绑 principal 后下一次 resolve 立即生效（复现 Session 0 验证 B）
```

验证:

- examples/minimal-server 跑通:两用户两 key,零消费方改动
- `/publish feat: {v} session 4 per-principal credentials`

---

### ✅ Session 5: `@dshwar/fs-tenant` ★ 隔离的真实边界

```
读取 CLAUDE.md（第七节 安全与隔离）与上游 dsh-fs、fs-sandbox 的契约。

本次任务:把工作区根按租户钉死。

⚠️ credentials 解决的是「用谁的钱」，fs 解决的才是「能看谁的数据」。
本 Session 是整个版本安全性的重心，测试要求高于其它 Session。

1. 路径钉死
   - 工作区根 = {root}/{tenantId}/{userId}
   - tenantId 与 userId 必须经过白名单字符校验后才参与路径拼接
   - 所有路径操作先 resolve 再校验是否仍在根内

2. 逃逸拦截（逐项写测试）
   - ../ 与多级 ../../
   - 绝对路径
   - 符号链接指向根外
   - Windows 8.3 短名与 UNC 路径
   - URL 编码与 Unicode 规范化绕过
   - 空 tenantId / userId

3. 与上游沙箱的关系
   - 本包只做路径钉死，不重做沙箱
   - 策略计算结果喂给上游 sandbox-policy / fs-sandbox，不另起炉灶

4. 文档必须写明隔离模型的边界
   - 逻辑隔离仅适用于互相信任的用户
   - agent 能执行 shell，路径钉死抬高成本但不构成强边界
   - 跨信任边界必须用进程隔离 + 容器

== 测试 ==
- 上述每一条逃逸手法都有对应的拒绝测试
- 两租户互相不可见（正向与反向各测）
- 单租户单用户场景下行为与上游 fs-local 一致（对照 single-user.yml）
```

验证:

- 逃逸测试全绿,单用户对照基线行为一致
- `/publish feat: {v} session 5 tenant-pinned filesystem`

---

### ✅ Session 6: `@dshwar/storage-scoped`

```
读取 CLAUDE.md 与上游 dsh-storage 家族（storage / storage-domain / storage-sqlite / storage-json）。

本次任务:租户维度的存储作用域。

1. 先评估，再决定是否新建包（R7 待确认项）
   - 详读上游 storage-domain 的语义：它的 domain 概念能否直接承载 tenantId
   - 若可以：本包退化为一层薄配置 + 文档，不重复造轮子
   - 若不行：说明差异，再实现 storage-scoped
   - 评估结论写入 docs/DECISIONS/storage-scoping.md

2. 若需实现
   - 所有 key 加租户前缀，前缀由 principal 派生而非调用方传入
   - 跨租户读写在本层拒绝，不依赖上层自觉
   - 前缀分隔符须是 key 白名单之外的字符，避免伪造前缀

3. 一并处理 session 归属
   - 上游 session-persistence 按目录存储，接入 fs-tenant 后自动隔离
   - 确认 session-query 的查询是否会跨租户，若会则加过滤

== 测试 ==
- 租户 A 无法通过构造 key 读到租户 B 的数据
- 伪造前缀的 key 被拒绝
- 单租户场景行为与上游一致
```

验证:

- 决策文档已写,跨租户读写被拒
- `/publish feat: {v} session 6 tenant-scoped storage`

---

### ✅ Session 7: `adapters/dsh-0.1.0` 与上游契约测试

```
读取 CLAUDE.md（硬规则 2、3 与第五节 上游跟版）。

本次任务:把所有上游接触面收敛到一个目录，并建立跟版机制。
这决定了未来每次上游破坏性变更的修复成本是「改一个目录」还是「翻遍全仓」。

1. adapters/dsh-0.1.0/
   - 把 packages/** 中所有对上游内部实现的依赖搬进来，对外只暴露稳定的内部接口
   - 目录顶部文档说明：这里是唯一允许感知上游内部的地方
   - 运行时校验上游实际版本，不匹配拒绝启动并给出可读提示
     （注意：以 npm registry 版本为准，上游 monorepo 根版本号与之不一致）

2. 契约测试（录制/回放）
   - 为每一个上游接触点写测试：credentials 四方法、fs 路径语义、storage 键语义
   - 参考上游自身的快照测试基建模式
   - 目标：上游改接口，pnpm test:contract 立刻跑红，且红点直指 adapters

3. profiles/single-user.yml 对照基线（R9）
   - 全部契约测试同时跑 single-user.yml 与 team.yml
   - 单用户场景下两者行为必须完全一致
   - 这是「只加隔离、不改语义」的证明，也是别人敢用的理由

4. 兼容矩阵
   - README 建立 DSHWAR × dsh 版本对照表
   - 双轨说明：stable 跟已验证版本，edge 跟上游最新

== 测试 ==
- 人为改一个 adapters 内的假设，契约测试必须红
- 双 profile 对照测试全绿
- 边界 lint 在全仓通过（Session 1 的规则此时才真正被验证）
```

验证:

- 对照基线全绿,契约测试可拦截上游变更
- `/publish feat: {v} session 7 upstream adapter and contract tests`

---

### 🟠 Session 8: 开源首发

```
读取 CLAUDE.md（第八节 开源与商业边界、第九节 商标与声明）。

本次任务:完成开源发布。不要等完美——先发优势建立在「第一个能用的」上，
不是「最好的」上。

1. README.md
   - 首屏必须回答：和已有的 Electron 封装有什么不同
     （那个做的是打包，DSHWAR 做的是平台）
   - 契约表：上游已有哪些契约、只有单用户实现、DSHWAR 补齐哪一列
   - 三十行 minimal-server 示例直接放首屏
   - 隔离模型警告：显著位置，不可折叠
   - 兼容矩阵
   - 开源/闭源边界公开写明：闭源仅 billing-hosted 与托管服务

2. 法务与声明
   - LICENSE：MIT
   - 商标声明：非官方、无隶属关系、指名性使用
   - 项目名法务复核结论记录在 docs/DECISIONS/naming.md

3. 贡献者路径
   - CONTRIBUTING.md：从契约测试开始，先做插件不碰核心
   - 每个 [planned] 包对应一个 good-first-issue，附带契约签名

4. 发布
   - changesets 打 0.1.0，npm publish 全部 @dshwar/* 包
   - GitHub Release，附 FEASIBILITY-REPORT 摘要
   - 上游仓库开一个 issue 介绍本项目（生态位声明，也是第一批用户来源）

== 测试 ==
- npm 包可从空目录安装并跑通 minimal-server
- README 中的每一段代码都可直接执行
- 版本号一致性检查通过（check-version）
```

验证:

- 从空目录 `pnpm add @dshwar/principal` 可跑通示例
- `/publish chore: {v} session 8 open source release`

---

### 版本发布后必做

```
V0.1.0 已发布。执行文档瘦身(见第三部分「二、文档瘦身与归档」):

1. 将本文件中 M0.1.0 的块:
   - 标题红色标记去掉,改为【已发布】
   - 按压缩规则压缩:保留 标题/简介/交付内容表/Session 标题列表/核心改进,
     删除所有 prompt 代码块与实现细节
   - 末尾加 `> 实现细节见 SESSION_TASKS_HISTORY.md`
2. 被删内容**完整**追加到 SESSION_TASKS_HISTORY.md 开头(保持从新到旧)
3. 更新文件头「当前版本(正在开发)」为 V0.2.0
4. 更新第一部分版本路线表中 V0.1.0 状态为「已发布」
5. 报告:主文件字符数是否仍 < 150,000

完成后提交:/publish docs: {v} compress released version tasks
```
