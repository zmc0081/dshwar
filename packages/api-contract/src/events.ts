/**
 * SSE 事件词表 —— **DSHWAR 自有,不是上游事件的 1:1 透传**。
 *
 * ## 为什么不直接透传上游事件
 *
 * `ARCHITECTURE.md` §2.5 明写:「DSHWAR API v1 的稳定性承诺**不依赖** dsh 版本」。
 * 上游还在 rc 阶段,其 `SessionEventMap` 会变 —— V0.2.0 Session 0 实测到的词表是
 * `turn/start` · `step/start` · `assistant/chunk` · `request/header` · … 十三种,
 * 且 `assistant/chunk` 内部还有七种子类型。
 *
 * 1:1 透传等于把 v1 契约的稳定性外包给一个 rc 项目:上游改一个事件名,
 * 我们要么跟着升 v2(客户接进来之后换不掉的那层被迫破坏),要么在网关里
 * 长期维护一层翻译 —— 而后者正是这里做的事,区别只在**现在做还是被迫做**。
 *
 * ## 映射关系(上游 → DSHWAR)
 *
 * | 上游 | DSHWAR | 说明 |
 * | --- | --- | --- |
 * | `turn/start` | `turn.started` | |
 * | `turn/end` | `turn.completed` | |
 * | `assistant/chunk` (`text-delta`) | `message.delta` | 正文增量 |
 * | `assistant/chunk` (`reasoning-delta`) | `reasoning.delta` | **默认不发**,见下 |
 * | `assistant/message` | `message.completed` | |
 * | `tool/call` | `tool.started` | |
 * | `tool/result` | `tool.completed` | |
 * | `agent/error` | `error` | |
 * | `step/*` · `request/*` · `todo/*` | *(不透传)* | 内部实现细节 |
 *
 * 刻意**不**透传 `step/*` 与 `request/*`:它们是 agent loop 的内部结构,
 * 对 API 客户端没有意义,而暴露出去就变成了我们要维护的契约。
 *
 * @module @dshwar/api-contract/events
 */
import { z } from 'zod'

/**
 * SSE 事件类型 —— 闭集,与错误码同理:SDK 要能穷举。
 */
export const StreamEventType = z.enum([
  'turn.started',
  'message.delta',
  'reasoning.delta',
  'message.completed',
  'tool.started',
  'tool.completed',
  'turn.completed',
  'error',
  /** 心跳。穿透代理用,不携带内容。 */
  'ping',
])

export type StreamEventType = z.infer<typeof StreamEventType>

/** 正文增量。 */
export const MessageDeltaEvent = z.object({
  type: z.literal('message.delta'),
  turn: z.number().int(),
  text: z.string(),
})

/**
 * 推理增量(思维链)。
 *
 * ⚠️ **默认不发。** 只有会话创建时显式 `includeReasoning: true` 才会出现在流里。
 *
 * 默认关有两个理由,都不是技术上的:
 * 1. 思维链可能包含运营方不希望暴露给终端用户或第三方集成方的推理过程
 * 2. 它的 token 量对移动端是真实负担 —— 一次长推理的思维链可以数倍于正文
 *
 * 契约里保留这个类型而不是等以后再加,是因为「加事件类型」对已经写好
 * `switch` 穷举的客户端是破坏性的。现在留位置,零成本。
 */
export const ReasoningDeltaEvent = z.object({
  type: z.literal('reasoning.delta'),
  turn: z.number().int(),
  text: z.string(),
})

/** 一轮开始。 */
export const TurnStartedEvent = z.object({
  type: z.literal('turn.started'),
  turn: z.number().int(),
})

/** 完整的助手消息。`message.delta` 的拼接结果,便于不做增量拼接的客户端。 */
export const MessageCompletedEvent = z.object({
  type: z.literal('message.completed'),
  turn: z.number().int(),
  text: z.string(),
})

/** 工具开始执行。 */
export const ToolStartedEvent = z.object({
  type: z.literal('tool.started'),
  turn: z.number().int(),
  callId: z.string(),
  name: z.string(),
})

/** 工具执行结束。 */
export const ToolCompletedEvent = z.object({
  type: z.literal('tool.completed'),
  turn: z.number().int(),
  callId: z.string(),
  isError: z.boolean(),
})

/**
 * 一轮结束。
 *
 * `reason` 区分正常结束与被取消 —— 客户端需要据此决定 UI 是显示「完成」
 * 还是「已停止」。
 */
export const TurnCompletedEvent = z.object({
  type: z.literal('turn.completed'),
  turn: z.number().int(),
  reason: z.enum(['completed', 'cancelled', 'error']),
})

/** 流内错误。与 HTTP 错误同形状,便于客户端复用处理逻辑。 */
export const StreamErrorEvent = z.object({
  type: z.literal('error'),
  turn: z.number().int().optional(),
  code: z.string(),
  message: z.string(),
})

/** 心跳。 */
export const PingEvent = z.object({
  type: z.literal('ping'),
})

/**
 * 一条 SSE 事件的载荷。
 *
 * SSE 的 `id:` 字段单独携带序号(见 {@link StreamEventEnvelope} 的说明),
 * 不放进载荷 —— 那是传输层的事。
 */
export const StreamEvent = z
  .discriminatedUnion('type', [
    TurnStartedEvent,
    MessageDeltaEvent,
    ReasoningDeltaEvent,
    MessageCompletedEvent,
    ToolStartedEvent,
    ToolCompletedEvent,
    TurnCompletedEvent,
    StreamErrorEvent,
    PingEvent,
  ])
  .meta({
    id: 'StreamEvent',
    description: 'SSE `data:` 字段的 JSON 载荷。事件类型是闭集,SDK 可穷举',
  })

export type StreamEvent = z.infer<typeof StreamEvent>

/**
 * SSE 传输层约定(不是 JSON schema,是文档)。
 *
 * ```
 * id: 42
 * event: message.delta
 * data: {"type":"message.delta","turn":1,"text":"你好"}
 * ```
 *
 * - **`id:` 是单调递增的序号。** V0.2.0 Session 0 实测:上游 session 事件自带
 *   单调 `seq`,可直接映射到这里。
 * - **客户端断线重连时带 `Last-Event-ID` 请求头**,服务端从该序号之后重放。
 *   契约在 `GET /v1/sessions/{id}/stream` 里给这个头留了位置。
 * - `event:` 与载荷里的 `type` 相同,冗余是刻意的:浏览器的 `EventSource`
 *   可以按 `event:` 注册分类型监听器,而不必自己解析 JSON 再分发。
 */
export const SSE_TRANSPORT_NOTE = `id: <seq>\nevent: <type>\ndata: <StreamEvent JSON>`
