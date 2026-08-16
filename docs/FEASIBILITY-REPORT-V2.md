# DSHWAR V0.2.0 Session 0 · 网关可行性验证报告

> 产出于 V0.2.0 Session 0(止损点)。不写产品代码、不建 `gateway/`,
> 只产出验证脚本与本报告。
>
> 验证日期:2026-08-15
> 上游版本:`@deepseek-ai/dsh-*` **0.1.0-rc.6** · `@deepseek-ai/cordis` **4.0.1**
> 验证脚本:[`feasibility-v2/verify/`](../feasibility-v2/verify/)

---

## 一、结论摘要

**四项验证全部通过。网关可以在进程内驱动 dsh agent,架构不变,进入 Session 1。**

| #   | 验证项                   | Windows | Linux | 结论     |
| --- | ------------------------ | ------- | ----- | -------- |
| A   | 进程内驱动 agent(止损点) | 10/10   | 10/10 | **通过** |
| B   | 流式输出                 | 5/5     | 5/5   | **通过** |
| C   | 取消(止损点)             | 10/10   | 10/10 | **通过** |
| D   | 并发会话隔离(止损点)     | 7/7     | 7/7   | **通过** |

止损路径**未触发**:`supervisor` 保持在 V0.4.0,不需要提前。

> 📌 **最重要的一条**:`ARCHITECTURE.md` §2.4 说「上游 SDK 协议没有 cancel 与
> session-close 方法 —— 终止进程即是取消,这是 Supervisor 存在的第二个理由」。
> 实测表明:**那说的是 stdio JSON-RPC 协议层**;进程内的 `Agent` 接口
> **有显式的 `cancel()`,而且真的截断输出**。详见 §3 验证 C 与 §4.1。

---

## 二、验证环境

| 项   | Windows(开发机)      | Linux(容器,部署目标)       |
| ---- | -------------------- | -------------------------- |
| OS   | Windows 11 Pro 26200 | Linux 6.6.87.2 WSL2 x86_64 |
| Node | v24.14.0             | v24.19.0                   |

两平台跑同一套脚本,结论一致。

### 为什么用假 LLM 而不是真调 DeepSeek

本 Session 验的是**网关能否驱动 harness**,不是模型质量。真模型会引入三个与结论
无关的变量 —— 网络抖动、非确定输出、费用 —— 其中前两个会让「取消是否真的停住了
输出」这类断言**变得不可判定**。

上游 `LlmAdapter` 只有一个必需的抽象方法 `stream()`,替身成本极低:

```ts
class FakeLlmAdapter extends LlmAdapter {
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    for (const token of tokens) {
      if (request.signal?.aborted === true) return // ← 验证 C 靠这条
      await sleep(delayMs)
      yield { type: 'text-delta', index: 0, text: token }
    }
  }
}
```

确定性、可控节奏、零成本、离线。

### 复现步骤

```bash
cd feasibility-v2
pnpm install
node verify/run-all.ts

# Linux 复跑
docker run --rm -v "$PWD:/src:ro" -w / node:24 bash /src/verify-linux.sh
```

---

## 三、逐项结论

### 验证 A —— 进程内驱动 agent ✅ 10/10

**不经 stdio JSON-RPC,直接用 cordis 服务完整跑通一轮对话。**

实测的完整事件序列:

```
agent/inbox/spliced → turn/start → agent/inbox/spliced → step/start
→ user/message → request/header → request/context
→ assistant/chunk × 8 → assistant/message → step/end → turn/end
```

| 断言                                      | 结果 |
| ----------------------------------------- | ---- |
| A1 七个上游插件全部加载,零 fork           | 通过 |
| A2 不经 stdio JSON-RPC 即可创建 agent     | 通过 |
| A4/A5 一轮完整跑通,回复内容正确           | 通过 |
| A6/A7 turn 与 step 完整闭合               | 通过 |
| A9 `handle.dispose()` 后 agent 离开注册表 | 通过 |
| A10 同一进程内可反复创建会话              | 通过 |

**关键结构**:`ctx.agents`(`AgentRegistry`)只是注册表,agent 的**创建**委托给
`AgentFactory`,由 `@deepseek-ai/dsh-agent-loop` 提供。不加载 agent-loop 就
造不出 agent。

### 验证 B —— 流式输出 ✅ 5/5

**增量可转 SSE,不需要缓冲整个回复。**

| 断言                                             | 实测                               |
| ------------------------------------------------ | ---------------------------------- |
| B1 增量以 `assistant/chunk` 的 `text-delta` 暴露 | 通过                               |
| B2 **首个增量远早于完整消息**                    | 首增量 **22ms**,完整消息 **116ms** |
| B3 事件带单调 `seq`                              | `seq = 8, 9, 10, 11`               |
| B4 增量之间有真实时间间隔                        | 首尾 94ms                          |

### 验证 C —— 取消 ✅ 10/10 ★

**两条取消路径都成立,且都真的截断输出。**

| 路径                          | 断言                          | 实测                               |
| ----------------------------- | ----------------------------- | ---------------------------------- |
| `agent.cancel({kind:'user'})` | C2 取消后不再产生任何输出     | idle 时 4 个,再等 200ms 仍 4 个    |
|                               | C3 真的截断(未跑完全部 token) | **4/20**                           |
|                               | C5 被取消的 turn 仍正常闭合   | `turn/end` 已发出                  |
|                               | C6 取消后 agent 仍可用        | 第二轮又收到 20 个增量             |
| `handle.dispose()`            | C8 dispose 后不再产生输出     | dispose 时 4 个,再等 200ms 仍 4 个 |
|                               | C9 真的截断                   | **4/20**                           |
|                               | C10 agent 离开注册表          | 通过                               |

两条路径对网关的分工很清楚:

- **`cancel()`** —— 用户点了「停止」。turn 被截断,**会话还在**,可以继续下一轮。
- **`dispose()`** —— SSE 断连、会话超时。turn 被截断,**会话彻底释放**。

C6 是这一项里最容易被忽略但最要紧的一条:取消之后 agent 仍然可用。
否则网关每次取消都得重建会话,而重建意味着丢掉上下文。

### 验证 D —— 并发会话隔离 ✅ 7/7

| 断言                                         | 实测 |
| -------------------------------------------- | ---- |
| D1/D2/D3 两会话并发,输出零交叉               | 通过 |
| D4/D5 **agent 作用域监听器只收到自己的事件** | 通过 |
| D6/D7 **10 个并发会话零串号**                | 通过 |

D4/D5 直接决定 SSE 的实现形态:上游承诺 `session/event` 按 agent 作用域过滤,
实测成立。**每个 SSE 连接可以直接挂在自己 agent 的 `ctx` 上**,不必订阅全局事件流
再自己按 sessionId 过滤 —— 后者意味着每个连接都能看到全部租户的事件,
一个过滤 bug 就是跨租户泄漏。

---

## 四、对架构文档的修正与补充

### 4.1 ⚠️ `ARCHITECTURE.md` §2.4 的「Supervisor 第二个理由」不适用于进程内驱动

原文:

> 进程级隔离顺带解决上游 SDK 协议**没有 cancel 与 session-close 方法**的问题 ——
> 终止进程即是取消。这是 Supervisor 存在的第二个理由。

实测表明这句话需要限定范围:

| 层                          | 有没有 cancel                                                           |
| --------------------------- | ----------------------------------------------------------------------- |
| **stdio JSON-RPC SDK 协议** | 没有(原文属实)                                                          |
| **进程内 `Agent` 接口**     | **有** —— `cancel(cause, options)` 与 `handle.dispose()`,均实测截断输出 |

网关走的是**进程内**这条路,因此 Supervisor 的第二个理由**不成立**。

**Supervisor 的第一个理由(跨信任边界的安全隔离)完全不受影响**,它仍然要做,
仍然在 V0.4.0 —— 只是不该再把「取消」列为它的动机之一,否则会让人以为
V0.2.0 的网关做不了取消,从而在错误的时间提前一个五周的组件。

建议 §2.4 改为:「进程级隔离顺带解决 **stdio SDK 协议**没有 cancel 的问题。
进程内驱动的消费方(如 DSHWAR 网关)可用 `Agent.cancel()`,不受此限。」

### 4.2 进程内组装清单 —— 网关需要拼哪七个插件

```
@deepseek-ai/dsh-session        SessionStore   → ctx.sessions
@deepseek-ai/dsh-llm            LlmRuntime     → ctx.llm
@deepseek-ai/dsh-tools          ToolRuntime    → ctx.tools
@deepseek-ai/dsh-system-prompt  SystemPrompt   → ctx.systemPrompt
@deepseek-ai/dsh-agent          AgentRegistry  → ctx.agents
@deepseek-ai/dsh-agent-loop     AgentLoop      → 提供 AgentFactory
```

外加 `@deepseek-ai/dsh-invariants`、`@deepseek-ai/dsh-scope`、
`@deepseek-ai/dsh-session-persistence`、`@deepseek-ai/dsh-settings` 作为 peer。

**全部是上游公开包,零 fork、零深链。** `adapters/dsh-0.1.0` 的接触面在
V0.2.0 仍然可能保持为零。

### 4.3 session 事件的实际信封形状(实测)

上游 `SessionEventMap` 的类型定义描述的是 **`data` 的内部**,而监听器拿到的是
带信封的完整事件:

```json
{
  "type": "assistant/chunk",
  "seq": 8,
  "time": 1786843292700,
  "data": { "turn": 1, "step": 1, "chunk": { "type": "text-delta", "index": 0, "text": "你好" } }
}
```

按类型定义直觉写 `event.chunk` 会**静默拿到 undefined** —— 验证脚本第一版就是
这么写的,事件序列完全正确却收到 0 个增量。正确路径是 `event.data.chunk`。

### 4.4 `seq` 可直接映射 SSE 的 `id:`,支撑断线续传

事件带单调递增的 `seq`。SSE 的 `id:` 字段与 `Last-Event-ID` 请求头正好是这个
形状 —— 客户端断线重连时带上最后收到的 `seq`,网关从该点之后重放。

这条不在任务书的验证项里,但它决定 Session 1 的契约要不要给
`/v1/sessions/{id}/stream` 留 `Last-Event-ID` 的位置。**建议留**:
契约是换不掉的那一层,而这个能力零额外成本。

### 4.5 会话事件词表(供 Session 1 定契约用)

```
turn/start · turn/end · step/start · step/end
user/message · assistant/chunk · assistant/message
request/header · request/context
tool/call · tool/result · todo/write
session/end-seed
```

`assistant/chunk` 的 `chunk` 子类型:`block-start` / `text-delta` /
`reasoning-delta` / `tool-call-delta` / `block-end` / `usage` / `finish`。

**`reasoning-delta` 值得注意**:推理模型的思维链是独立的增量通道。
契约要决定它是否透传给客户端 —— 这是产品决策,不是技术决策。

---

## 五、对后续 Session 的行动项

| #   | 行动                                                                   | 落点          |
| --- | ---------------------------------------------------------------------- | ------------- |
| 1   | 修订 `ARCHITECTURE.md` §2.4 关于 Supervisor 第二个理由的表述           | 随时          |
| 2   | `/v1/sessions/{id}/stream` 契约留 `Last-Event-ID` 位置(`seq` 已就绪)   | Session 1     |
| 3   | 契约决定 `reasoning-delta` 是否透传客户端                              | Session 1     |
| 4   | SSE 断连 → `handle.dispose()`;用户停止 → `agent.cancel()`,两条路径分开 | Session 3     |
| 5   | 每个 SSE 连接挂在自己 agent 的 `ctx` 上,不订阅全局事件流               | Session 3     |
| 6   | 网关的进程内组装按 §4.2 清单,`profiles/gateway.yml` 照此写             | Session 2 / 6 |

---

## 六、遗留未验证项

- **真实模型下的行为** —— 本次全程用假适配器。真模型的 chunk 节奏、
  `usage` 事件、错误形状需要在有 API key 的环境验一次(Session 3 之前)
- **工具调用链路** —— 本次没有注册任何工具,`tool/call` / `tool/result`
  未实测。网关要暴露工具执行状态时需要补
- **会话持久化与 resume** —— `AgentRegistry.resume()` 未测;
  网关重启后能否接回会话,影响部署形态(Session 3)
- **长时间运行下的 fiber 累积** —— 本次单轮验证。V0.1.0 已实测
  `withPrincipal` 会累积隔离槽位,网关的 agent 生命周期需要类似的度量
