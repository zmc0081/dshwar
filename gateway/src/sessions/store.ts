/**
 * 网关侧的会话簿。
 *
 * 上游 `ctx.agents` 是全局注册表,不认识 principal;归属判定必须在这一层做。
 *
 * @module @dshwar/gateway/sessions/store
 */
import type { Context as CordisContext } from '@deepseek-ai/cordis'
// 仅为把上游对 cordis `Events` 的模块增强(`session/event`)带进来。
// 空的 `import type {}` 会被完全擦除,不产生运行时依赖 ——
// 网关不该为了一个事件名的类型就在运行时拉进 dsh-session。
//
// 不引这一行,`ctx.on('session/event', ...)` 编译不过;而 Vitest 不做类型检查,
// 测试会照样全绿。这正是根 tsconfig 必须登记每个项目的原因。
import type {} from '@deepseek-ai/dsh-session'
import type { Principal } from '@dshwar/principal'
import { asUpstreamEvent, EventBuffer, translateEvent } from './events.ts'

/** 上游 agent 句柄的最小形状。刻意只声明用得到的部分。 */
export interface AgentHandleLike {
  readonly agent: {
    readonly id: string
    readonly status: 'idle' | 'running'
    readonly ctx: CordisContext
    cancel(cause: { kind: 'user' | 'disposed' }): void
    followup(message: unknown): void
    whenIdle(): Promise<void>
  }
  dispose(): Promise<void>
}

/** 一个网关会话。 */
export interface GatewaySession {
  readonly id: string
  /** 归属主体。跨主体访问一律 404。 */
  readonly subjectId: string
  readonly tenantId: string
  readonly handle: AgentHandleLike
  readonly includeReasoning: boolean
  readonly model: string | null
  readonly provider: string | null
  readonly createdAt: string
  readonly metadata: Readonly<Record<string, string>>
  /** 已发起的轮次数。 */
  turns: number
  /** 事件缓冲,支撑 Last-Event-ID。 */
  readonly buffer: EventBuffer
  /** 活跃的 SSE 订阅者。断连时从这里移除。 */
  readonly subscribers: Set<(seq: number, event: unknown) => void>
  /** 解除上游事件监听。会话释放时调用。 */
  readonly unsubscribe: () => void
}

/**
 * 会话簿。
 *
 * ⚠️ **`get` 必须传 principal。** 把归属判定做成参数而不是「取出来再判断」,
 * 是因为后者可以被忘记 —— 而忘记的后果是跨主体读到别人的会话。
 */
/** 一次可计量的用量观测。由会话簿在 `assistant/message` 事件上发出。 */
export interface UsageObservation {
  readonly session: GatewaySession
  readonly turn: number
  readonly step: number
  /** 上游报的用量;适配器没报时 `undefined`(计 0 并标 unreported,不估算)。 */
  readonly usage:
    | {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly cacheReadTokens?: number
        readonly cacheWriteTokens?: number
        readonly reasoningTokens?: number
      }
    | undefined
}

export class GatewaySessionStore {
  private readonly sessions = new Map<string, GatewaySession>()
  private readonly onUsage: ((observation: UsageObservation) => void) | undefined

  constructor(options: { onUsage?: (observation: UsageObservation) => void } = {}) {
    this.onUsage = options.onUsage
  }

  /**
   * 登记一个新会话,并开始把上游事件翻译进缓冲。
   *
   * 事件监听挂在 **agent 自己的 ctx** 上 —— V0.2.0 Session 0 验证 D 实测:
   * 上游按 agent 作用域过滤事件。挂全局的话每个会话都能看到别人的事件流,
   * 一个过滤 bug 就是跨租户泄漏。
   */
  register(input: {
    id: string
    principal: Principal
    handle: AgentHandleLike
    includeReasoning: boolean
    model: string | null
    provider: string | null
    metadata: Record<string, string>
  }): GatewaySession {
    const buffer = new EventBuffer()
    const subscribers = new Set<(seq: number, event: unknown) => void>()

    const dispose = input.handle.agent.ctx.on('session/event', (_session, event) => {
      const upstream = asUpstreamEvent(event)

      // ---- 计量采集(V0.4.0)----
      // 挂在翻译**之前**:assistant/message 不在对外事件词表里(translate 会丢掉它),
      // 但它正是上游携带用量的那个事件(REPORT-V4 §1:用量与消息同行,没有独立记录)。
      // try/catch 是红线 1:观测不阻断 —— 计量回调炸了,SSE 与会话照常。
      if (this.onUsage !== undefined && upstream.type === 'assistant/message') {
        try {
          this.onUsage({
            session,
            turn: upstream.data?.turn ?? 0,
            step: upstream.data?.step ?? 0,
            usage: upstream.data?.usage,
          })
        } catch {
          // 刻意吞掉:丢一条用量记录是账目问题,断一次会话是事故
        }
      }

      const translated = translateEvent(upstream, {
        includeReasoning: input.includeReasoning,
      })
      if (translated === undefined) return

      buffer.push({ seq: upstream.seq, event: translated })
      for (const notify of subscribers) notify(upstream.seq, translated)
    })

    const session: GatewaySession = {
      id: input.id,
      subjectId: input.principal.id,
      tenantId: input.principal.tenantId,
      handle: input.handle,
      includeReasoning: input.includeReasoning,
      model: input.model,
      provider: input.provider,
      createdAt: new Date().toISOString(),
      metadata: { ...input.metadata },
      turns: 0,
      buffer,
      subscribers,
      unsubscribe: () => {
        dispose()
      },
    }

    this.sessions.set(input.id, session)
    return session
  }

  /**
   * 按归属取会话。
   *
   * @returns 该主体拥有的会话;不存在**或不属于该主体**时 `undefined` ——
   *   两者刻意不可区分,调用方据此一律返回 404 而非 403。
   *   403 会泄漏「这个 id 存在」,而会话 id 的存在性本身就是信息。
   */
  get(id: string, principal: Principal): GatewaySession | undefined {
    const session = this.sessions.get(id)
    if (session === undefined) return undefined
    if (session.subjectId !== principal.id) return undefined
    return session
  }

  /** 列出某主体的全部会话,按创建时间倒序。 */
  list(principal: Principal): GatewaySession[] {
    return [...this.sessions.values()]
      .filter((s) => s.subjectId === principal.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * 释放一个会话。
   *
   * 顺序要紧:先解除事件监听,再 dispose 上游句柄。反过来的话,
   * dispose 期间上游可能还会发事件,而那时缓冲与订阅者都还活着。
   */
  async release(session: GatewaySession): Promise<void> {
    session.unsubscribe()
    session.subscribers.clear()
    this.sessions.delete(session.id)
    await session.handle.dispose()
  }

  /** 当前会话总数。测试与诊断用。 */
  get size(): number {
    return this.sessions.size
  }

  /** 释放全部会话。进程退出时用。 */
  async releaseAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.release(s)))
  }
}
