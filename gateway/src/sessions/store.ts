/**
 * 网关侧的会话簿。
 *
 * 上游 `ctx.agents` 是全局注册表,不认识 principal;归属判定必须在这一层做。
 *
 * @module @dshwar/gateway/sessions/store
 */
// 仅为把上游对 cordis `Events` 的模块增强(`session/event`)带进来。
// 空的 `import type {}` 会被完全擦除,不产生运行时依赖 ——
// 网关不该为了一个事件名的类型就在运行时拉进 dsh-session。
//
// 不引这一行,`ctx.on('session/event', ...)` 编译不过;而 Vitest 不做类型检查,
// 测试会照样全绿。这正是根 tsconfig 必须登记每个项目的原因。
import type {} from '@deepseek-ai/dsh-session'
import type { Principal } from '@dshwar/principal'
import type { StreamEvent } from '@dshwar/api-contract'
import { asUpstreamEvent, EventBuffer, translateEvent } from './events.ts'

/**
 * 会话事件的来源。
 *
 * **只声明会话簿真正调用的那一个方法。** V0.4.5 把它从 `CordisContext` 收窄到
 * 这个接口:进程隔离下的句柄背后是一条 IPC 通道而不是一个 cordis Context,
 * 若这里要求完整的 Context,跨进程实现就得伪造一个几十个成员的对象 ——
 * 那些成员没有一个会被调用,伪造它们只是为了骗过类型检查。
 *
 * 真实的 `Context` 结构上满足本接口,所以进程内驱动一行不用改。
 */
export interface SessionEventSource {
  on(event: 'session/event', listener: (session: unknown, event: unknown) => void): () => unknown
  /**
   * agent 执行出错。
   *
   * ⚠️ **它与 `session/event` 是两条不同的通道。** 上游把它挂在 cordis
   * **Context** 上(`dsh-agent` 的 `runtime-types.d.ts`,签名带
   * `this: Scoped<Agent>`),而不是 `SessionEventMap` 的成员 —— 所以
   * `translateEvent` 永远看不到它,必须另开一条订阅。
   *
   * 契约的事件映射表从 V0.2.0 起就写着 `agent/error → error`,但在 V0.4.6
   * 之前没人接这条线:agent 报错时客户端的流只是**静默停住**,
   * 它无从区分「模型在想」与「已经炸了」。
   */
  on(
    event: 'agent/error',
    listener: (payload: { turn?: number; step?: number; error?: unknown }) => void,
  ): () => unknown
}

/** 上游 agent 句柄的最小形状。刻意只声明用得到的部分。 */
export interface AgentHandleLike {
  readonly agent: {
    readonly id: string
    readonly status: 'idle' | 'running'
    readonly ctx: SessionEventSource
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
  /**
   * 会话所属工作区(V0.4.1)。与 `subjectId` 同级 —— 它是归属信息的一部分,
   * 而不是一个可选的标签。`fs-tenant` 的 workspaceOf 从这里取值。
   */
  readonly workspaceId: string
  readonly handle: AgentHandleLike
  readonly includeReasoning: boolean
  readonly model: string | null
  readonly provider: string | null
  readonly createdAt: string
  readonly metadata: Readonly<Record<string, string>>
  /** 已发起的轮次数。 */
  turns: number
  /**
   * **网关自持**的事件序号,下一个要发的号。
   *
   * ## 为什么不直接用上游的 seq(V0.4.6 改)
   *
   * 网关要发的不只是上游事件的翻译:还有它**自己合成**的事件 ——
   * `agent/error` 翻出来的 `error`、进程死亡时的终结通知。这些没有上游 seq,
   * 而 `Last-Event-ID` 续传按 `seq >` 过滤,借一个号就可能与随后到来的真实
   * 上游事件撞号:客户端带着那个 id 重连时会漏掉一条。
   *
   * 自持一个计数器,这个问题就不存在了 —— 而不是被绕过去。代价是 SSE 的 id
   * 不再等于上游 seq,但契约从来只承诺**单调**,没承诺它等于任何东西。
   *
   * 顺带:上游 seq 是稀疏的(`translateEvent` 会丢掉一半事件),
   * 自持的是密集的,续传时更省事。
   */
  nextSeq: number
  /**
   * 会话已终结且不可再用(V0.4.5 R5)。
   *
   * 目前只有一个来源:**承载它的子进程死了**。置位之后 SSE 循环会在冲完
   * 待发事件后退出,而不是继续挂着发心跳 —— 对着一个不存在的会话发心跳,
   * 客户端会一直以为「还在算」。
   */
  terminated: boolean
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
    workspaceId: string
    metadata: Record<string, string>
  }): GatewaySession {
    const buffer = new EventBuffer()
    const subscribers = new Set<(seq: number, event: unknown) => void>()

    /**
     * 发一条对外事件 —— **网关自持序号的唯一出口**。
     *
     * 上游翻译过来的、网关自己合成的,全都走这里拿号。这就是自持序号
     * 相对「借上游的号」的全部好处:合成事件不再需要论证「借这个号安全吗」。
     */
    const emit = (event: StreamEvent): void => {
      const seq = session.nextSeq
      session.nextSeq += 1
      buffer.push({ seq, event })
      for (const notify of subscribers) notify(seq, event)
    }

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

      emit(translated)
    })

    // ---- agent/error → error(V0.4.6)----
    // 契约的映射表从 V0.2.0 起就写着这一条,但直到这里才有人接线。
    // 在此之前 agent 报错 = 客户端的流静默停住,而**静默是最糟的失败模式**:
    // 客户端无从区分「模型在想」与「已经炸了」,只能等到超时。
    const disposeError = input.handle.agent.ctx.on('agent/error', (payload) => {
      emit({
        type: 'error',
        ...(payload?.turn === undefined ? {} : { turn: payload.turn }),
        code: 'internal',
        // ⚠️ 不把 error 原样塞进 message —— 它会原样进响应体,而上游的错误
        // 对象可能带着请求 URL、甚至凭据片段。凭 requestId 查日志。
        message: 'agent 执行失败',
      })
    })

    const session: GatewaySession = {
      id: input.id,
      subjectId: input.principal.id,
      workspaceId: input.workspaceId,
      tenantId: input.principal.tenantId,
      handle: input.handle,
      includeReasoning: input.includeReasoning,
      model: input.model,
      provider: input.provider,
      createdAt: new Date().toISOString(),
      metadata: { ...input.metadata },
      turns: 0,
      nextSeq: 0,
      terminated: false,
      buffer,
      subscribers,
      unsubscribe: () => {
        dispose()
        disposeError()
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

  /**
   * 终结一个会话并把失败告诉客户端(V0.4.5 R5)。
   *
   * ## 为什么必须发事件,而不是直接关流
   *
   * **静默是最糟的失败模式。** 直接关掉 SSE,客户端看到的是一次普通断连,
   * 于是它会重连、带上 `Last-Event-ID`、然后拿到 404 —— 到这一步它才知道
   * 出事了,而且不知道出的是什么事。发一条 `error` 事件,客户端立刻拿到
   * 机器可读的原因,可以决定是重试还是报给用户。
   *
   * ## seq(V0.4.6 起不再需要「借号」的论证)
   *
   * 本方法曾借 `buffer.lastSeq + 1`,并靠「终结之后不会再有上游事件」来论证
   * 那样安全。自持序号落地之后这套论证不必要了:合成事件与翻译事件从**同一个
   * 计数器**取号,撞号在结构上就不存在。
   *
   * @param session 目标会话
   * @param failure 机器可读的失败原因
   */
  fail(session: GatewaySession, failure: { code: string; message: string }): void {
    if (session.terminated) return
    session.terminated = true
    session.unsubscribe()

    const event = { type: 'error' as const, code: failure.code, message: failure.message }
    const seq = session.nextSeq
    session.nextSeq += 1
    session.buffer.push({ seq, event })
    for (const notify of session.subscribers) notify(seq, event)
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
