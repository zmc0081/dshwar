# DSHWAR Session 任务实现细节归档

> **本文件是 `SESSION_TASKS.md` 的实现细节归档,不参与日常开发。**

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
