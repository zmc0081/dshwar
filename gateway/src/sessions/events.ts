/**
 * 上游 session 事件 → DSHWAR 契约事件的翻译层。
 *
 * **这一层就是「与上游解耦」的实体。** 契约里的事件词表由 DSHWAR 定义
 * (`ARCHITECTURE.md` §2.5);上游改事件名时,受影响的是这个文件,
 * 不是客户手里的 SDK。
 *
 * @module @dshwar/gateway/sessions/events
 */
import type { StreamEvent } from '@dshwar/api-contract'

/**
 * 上游 session 事件的信封形状。
 *
 * ⚠️ **实测得来,不是文档推断。** 上游 `SessionEventMap` 的类型定义描述的是
 * `data` 的**内部**,而监听器拿到的是带 `type` / `seq` / `time` 的完整信封。
 * 按类型定义直觉写 `event.chunk` 会静默拿到 `undefined` ——
 * V0.2.0 Session 0 的验证脚本第一版就是这么写的,事件序列完全正确却收到 0 个增量。
 * 见 `docs/FEASIBILITY-REPORT-V2.md` §4.3。
 */
export interface UpstreamSessionEvent {
  readonly type: string
  /** 单调递增。直接当 SSE 的 `id:`,支撑 `Last-Event-ID` 续传。 */
  readonly seq: number
  readonly time: number
  readonly data?: {
    readonly turn?: number
    readonly step?: number
    readonly chunk?: { readonly type: string; readonly text?: string }
    readonly message?: { readonly content?: readonly { type: string; text?: string }[] }
    readonly callId?: string
    readonly name?: string
    readonly isError?: boolean
    readonly cancelled?: unknown
    /** assistant/message 独有:上游把用量随消息一起发(REPORT-V4 §1)。 */
    readonly usage?: {
      readonly inputTokens: number
      readonly outputTokens: number
      readonly cacheReadTokens?: number
      readonly cacheWriteTokens?: number
      readonly reasoningTokens?: number
    }
  }
}

/**
 * 把上游监听器给的事件收窄成本模块认识的信封。
 *
 * 上游 `SessionEvent` 是个大联合,每个成员的 `data` 形状都不同;
 * `UpstreamSessionEvent` 只声明**我们真正读的那几个字段**。两者结构上不能
 * 互相赋值(TS 的弱类型检查会挡住全可选字段的对象),所以收窄集中在这一个
 * 函数里,而不是散在每个调用点。
 *
 * **这是唯一允许对上游事件做类型断言的地方。** 断言错了的后果是
 * {@link translateEvent} 返回 `undefined` 或某个字段落空,而不是抛错 ——
 * 事件词表是 DSHWAR 定义的,上游多一个事件类型不该让网关崩掉。
 */
export function asUpstreamEvent(event: unknown): UpstreamSessionEvent {
  return event as UpstreamSessionEvent
}

/** 一条待发送的 SSE 事件:载荷 + 它的序号。 */
export interface SequencedEvent {
  readonly seq: number
  readonly event: StreamEvent
}

export interface TranslateOptions {
  /** 是否透传推理增量。默认关 —— 见契约里 `ReasoningDeltaEvent` 的说明。 */
  readonly includeReasoning: boolean
}

/**
 * 把一条上游事件翻译成契约事件。
 *
 * 返回 `undefined` 表示**刻意不透传**:`step/*`、`request/*`、`todo/*` 是
 * agent loop 的内部结构,暴露出去就变成我们要维护的契约。
 *
 * @param upstream 上游事件信封
 * @param options 翻译选项
 * @returns 契约事件;不透传时 `undefined`
 */
export function translateEvent(
  upstream: UpstreamSessionEvent,
  options: TranslateOptions,
): StreamEvent | undefined {
  const turn = upstream.data?.turn ?? 0

  switch (upstream.type) {
    case 'turn/start':
      return { type: 'turn.started', turn }

    case 'turn/end':
      return {
        type: 'turn.completed',
        turn,
        // 上游把取消记在 turn/end 的 cancelled 字段上。客户端需要据此
        // 决定 UI 显示「完成」还是「已停止」。
        reason: upstream.data?.cancelled == null ? 'completed' : 'cancelled',
      }

    case 'assistant/chunk': {
      const chunk = upstream.data?.chunk
      if (chunk === undefined) return undefined
      if (chunk.type === 'text-delta') {
        return { type: 'message.delta', turn, text: chunk.text ?? '' }
      }
      if (chunk.type === 'reasoning-delta') {
        if (!options.includeReasoning) return undefined
        return { type: 'reasoning.delta', turn, text: chunk.text ?? '' }
      }
      // block-start / block-end / tool-call-delta / usage / finish 都是
      // 上游的分帧细节,契约层不暴露
      return undefined
    }

    case 'assistant/message': {
      const text = (upstream.data?.message?.content ?? [])
        .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
        .join('')
      return { type: 'message.completed', turn, text }
    }

    case 'tool/call':
      return {
        type: 'tool.started',
        turn,
        callId: upstream.data?.callId ?? '',
        name: upstream.data?.name ?? '',
      }

    case 'tool/result':
      return {
        type: 'tool.completed',
        turn,
        callId: upstream.data?.callId ?? '',
        isError: upstream.data?.isError ?? false,
      }

    default:
      // step/* · request/* · todo/* · user/message · session/* —— 刻意不透传
      return undefined
  }
}

/**
 * 有界事件缓冲,支撑 `Last-Event-ID` 断线续传。
 *
 * ⚠️ **有界是刻意的。** 无界缓冲意味着一个连着不断线的长会话会把整轮输出
 * 留在内存里,而 SSE 的使用场景恰恰是长连接。超出容量后丢弃最旧的,
 * 客户端若请求的序号已被丢弃,只能从当前位置续 —— 这是可接受的降级,
 * 比 OOM 好。
 */
export class EventBuffer {
  private readonly capacity: number
  private items: SequencedEvent[] = []

  constructor(capacity = 512) {
    this.capacity = capacity
  }

  push(item: SequencedEvent): void {
    this.items.push(item)
    if (this.items.length > this.capacity) {
      this.items = this.items.slice(this.items.length - this.capacity)
    }
  }

  /**
   * 取出序号大于 `afterSeq` 的全部事件。
   *
   * @param afterSeq 客户端最后收到的序号;`undefined` 表示全取
   */
  since(afterSeq: number | undefined): SequencedEvent[] {
    if (afterSeq === undefined) return [...this.items]
    return this.items.filter((item) => item.seq > afterSeq)
  }

  /** 缓冲里最早的序号。客户端请求的序号早于它,说明已经丢了。 */
  get earliestSeq(): number | undefined {
    return this.items[0]?.seq
  }

  get size(): number {
    return this.items.length
  }
}
