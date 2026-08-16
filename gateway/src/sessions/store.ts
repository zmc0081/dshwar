/**
 * 网关侧的会话簿。
 *
 * 上游 `ctx.agents` 是全局注册表,不认识 principal;归属判定必须在这一层做。
 *
 * @module @dshwar/gateway/sessions/store
 */
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { Principal } from '@dshwar/principal'
import { EventBuffer, translateEvent, type UpstreamSessionEvent } from './events.ts'

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
export class GatewaySessionStore {
  private readonly sessions = new Map<string, GatewaySession>()

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

    const dispose = input.handle.agent.ctx.on(
      'session/event',
      (_session: unknown, upstream: UpstreamSessionEvent) => {
        const translated = translateEvent(upstream, {
          includeReasoning: input.includeReasoning,
        })
        if (translated === undefined) return

        buffer.push({ seq: upstream.seq, event: translated })
        for (const notify of subscribers) notify(upstream.seq, translated)
      },
    )

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
