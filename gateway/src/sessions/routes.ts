/**
 * 运行时 API 的端点实现 —— `/v1/sessions/*`。
 *
 * 验收标准:**第三方仅凭 HTTP 就能完成一次完整会话,不接触 dsh。**
 *
 * @module @dshwar/gateway/sessions/routes
 */
import { CreateSessionRequest, CreateTurnRequest, PaginationQuery } from '@dshwar/api-contract'
import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { ApiError, notFound } from '../errors.ts'
import type { GatewayEnv } from '../middleware.ts'
import type { AgentHandleLike, GatewaySession, GatewaySessionStore } from './store.ts'

/** 网关如何向上游要一个 agent。由部署方注入 —— 网关不组装 harness。 */
export interface AgentFactoryFn {
  (input: {
    sessionId: string
    model: string | undefined
    provider: string | undefined
  }): Promise<AgentHandleLike>
}

/** 把用户输入变成上游的 UserMessage。由部署方注入,避免网关依赖 dsh-llm。 */
export type UserMessageFactory = (text: string) => unknown

export interface RuntimeRouteOptions {
  readonly store: GatewaySessionStore
  readonly createAgent: AgentFactoryFn
  readonly userMessage: UserMessageFactory
  /** SSE 心跳间隔(毫秒)。穿透代理用。 */
  readonly heartbeatMs?: number
  /**
   * 配额判定(V0.4.0)。红线 2:判定与执行分离 —— policy 包只回答能不能,
   * 429 由这里发。缺席 = 不限流(配额是 opt-in 的治理)。
   */
  readonly quota?: QuotaCheckLike
  /**
   * 模型裁决(V0.4.0)。挂在 createAgent 入口 —— 裁决完交回上游,
   * 不碰请求路由。缺席 = 不治理。
   */
  readonly models?: ModelGateLike
}

/** `@dshwar/policy` 判定入口的结构性子集。 */
export interface QuotaCheckLike {
  check(subjectId: string): Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string }>
}

/**
 * `@dshwar/model-router` 裁决入口的结构性子集。
 * 部署方在闭包里自行接默认模型与预算水位 —— 网关不知道也不该知道价格表。
 */
export interface ModelGateLike {
  resolve(input: {
    subjectId: string
    tenantId: string
    provider: string | undefined
    model: string | undefined
  }): Promise<
    | {
        kind: 'allow'
        provider: string | undefined
        model: string | undefined
        downgraded: boolean
      }
    | { kind: 'deny' }
  >
}

function toWire(session: GatewaySession) {
  return {
    id: session.id,
    subjectId: session.subjectId,
    status: session.handle.agent.status,
    model: session.model,
    provider: session.provider,
    includeReasoning: session.includeReasoning,
    turns: session.turns,
    createdAt: session.createdAt,
    metadata: session.metadata,
  }
}

/** 注册运行时端点。 */
export function registerRuntimeRoutes(options: RuntimeRouteOptions) {
  const heartbeatMs = options.heartbeatMs ?? 15_000

  return (app: Hono<GatewayEnv>): void => {
    // ---- 创建会话 ----
    app.post('/v1/sessions', async (c) => {
      const parsed = CreateSessionRequest.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid body')
      }
      const principal = c.get('principal')!
      const body = parsed.data

      // ---- 模型裁决(V0.4.0)----
      // 挂在 createAgent 入口:准入答「许不许用」,降级答「用哪个」。
      // 清单外 → 403(不是静默换);降级 → 响应头可见,用户有权知道被换了模型。
      let provider = body.provider
      let model = body.model
      if (options.models !== undefined) {
        const decision = await options.models.resolve({
          subjectId: principal.id,
          tenantId: principal.tenantId,
          provider,
          model,
        })
        if (decision.kind === 'deny') {
          throw new ApiError('forbidden', 'model not allowed by tenant policy')
        }
        if (decision.downgraded) {
          c.header('x-dshwar-model-downgraded', `${decision.provider}/${decision.model}`)
        }
        provider = decision.provider
        model = decision.model
      }

      const sessionId = crypto.randomUUID()
      const handle = await options.createAgent({
        sessionId,
        model,
        provider,
      })

      const session = options.store.register({
        id: sessionId,
        principal,
        handle,
        includeReasoning: body.includeReasoning,
        // 记裁决后的,不是请求的 —— 计量与审计要对上真正在跑的模型
        model: model ?? null,
        provider: provider ?? null,
        metadata: body.metadata ?? {},
      })

      return c.json({ session: toWire(session), requestId: c.get('requestId') }, 201)
    })

    // ---- 列出会话 ----
    app.get('/v1/sessions', (c) => {
      const parsed = PaginationQuery.safeParse(c.req.query())
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid query')
      }
      const principal = c.get('principal')!
      const all = options.store.list(principal)

      // 游标就是上一页最后一条的 id。简单、稳定、不受插入影响。
      const cursor = parsed.data.cursor
      const start = cursor === undefined ? 0 : all.findIndex((s) => s.id === cursor) + 1
      const page = all.slice(start, start + parsed.data.limit)
      const nextCursor = start + parsed.data.limit < all.length ? (page.at(-1)?.id ?? null) : null

      return c.json({ data: page.map(toWire), nextCursor, requestId: c.get('requestId') })
    })

    // ---- 会话状态 ----
    app.get('/v1/sessions/:id', (c) => {
      const session = options.store.get(c.req.param('id'), c.get('principal')!)
      // 不属于本主体与不存在,走同一条路径 —— 调用方无法区分
      if (session === undefined) throw notFound('session')
      return c.json({ session: toWire(session), requestId: c.get('requestId') })
    })

    // ---- 发起一轮 ----
    app.post('/v1/sessions/:id/turns', async (c) => {
      const session = options.store.get(c.req.param('id'), c.get('principal')!)
      if (session === undefined) throw notFound('session')

      const parsed = CreateTurnRequest.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid body')
      }

      if (session.handle.agent.status === 'running') {
        throw new ApiError('conflict', 'session is already processing a turn')
      }

      // ---- 配额闸(V0.4.0)----
      // 挂在发轮而不是建会话:烧钱的是轮,不是会话对象。
      // 超限就是 429,不静默换便宜模型(红线 3)—— 降级是 model-router 的
      // 显式配置,发生在准入裁决处,不发生在这里。
      if (options.quota !== undefined) {
        const decision = await options.quota.check(session.subjectId)
        if (decision.kind === 'deny') {
          throw new ApiError('rate_limited', `quota exhausted (${decision.reason})`)
        }
      }

      session.turns += 1
      // 不等待本轮跑完 —— 输出走 SSE。一轮可能几分钟,而中间的反向代理
      // 通常在 60 秒左右掐断连接。
      session.handle.agent.followup(options.userMessage(parsed.data.input))

      return c.json(
        { turn: session.turns, status: session.handle.agent.status, requestId: c.get('requestId') },
        202,
      )
    })

    // ---- SSE 流式 ----
    app.get('/v1/sessions/:id/stream', (c) => {
      const session = options.store.get(c.req.param('id'), c.get('principal')!)
      if (session === undefined) throw notFound('session')

      const lastEventId = c.req.header('last-event-id')
      const afterSeq = lastEventId === undefined ? undefined : Number(lastEventId)

      return streamSSE(c, async (stream) => {
        // 断连时必须解除订阅并释放 —— 否则每个掉线的客户端都留下一个
        // 还在收事件的闭包(Session 0 验证 C 的落点)
        let closed = false
        const pending: { seq: number; event: unknown }[] = []
        let wake: (() => void) | undefined

        const notify = (seq: number, event: unknown) => {
          pending.push({ seq, event })
          wake?.()
        }

        session.subscribers.add(notify)
        stream.onAbort(() => {
          closed = true
          session.subscribers.delete(notify)
          wake?.()
        })

        // 先补发缓冲里的历史事件(Last-Event-ID 续传)
        for (const item of session.buffer.since(Number.isFinite(afterSeq) ? afterSeq : undefined)) {
          await stream.writeSSE({
            id: String(item.seq),
            event: item.event.type,
            data: JSON.stringify(item.event),
          })
        }

        while (!closed) {
          while (pending.length > 0) {
            const item = pending.shift()!
            const event = item.event as { type: string }
            await stream.writeSSE({
              id: String(item.seq),
              event: event.type,
              data: JSON.stringify(event),
            })
          }
          if (closed) break

          // 等新事件,或到点发心跳
          await new Promise<void>((resolve) => {
            wake = resolve
            setTimeout(resolve, heartbeatMs)
          })
          wake = undefined

          if (!closed && pending.length === 0) {
            await stream.writeSSE({ event: 'ping', data: JSON.stringify({ type: 'ping' }) })
          }
        }

        session.subscribers.delete(notify)
      })
    })

    // ---- 取消并释放 ----
    app.delete('/v1/sessions/:id', async (c) => {
      const session = options.store.get(c.req.param('id'), c.get('principal')!)
      if (session === undefined) throw notFound('session')

      const wasRunning = session.handle.agent.status === 'running'
      const cancelledTurn = wasRunning ? session.turns : null

      // 两条路径:先截断正在跑的一轮,再彻底释放会话。
      // Session 0 验证 C 实测两者都真的停住输出。
      if (wasRunning) session.handle.agent.cancel({ kind: 'user' })
      await options.store.release(session)

      return c.json({ id: session.id, cancelledTurn, requestId: c.get('requestId') })
    })
  }
}
