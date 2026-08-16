/**
 * DSHWAR API 客户端。
 *
 * **类型全部来自生成的 schema,不手写。** 这里只写「怎么发请求」——
 * 路径、方法、请求体与响应的形状都由 `src/generated/schema.d.ts` 提供,
 * 而它由 `packages/api-contract/openapi.json` 生成。
 *
 * @module @dshwar/sdk/client
 */
import { DshwarApiError, DshwarTransportError, type DshwarErrorBody } from './errors.ts'
import type { components } from './generated/schema.d.ts'

type Schemas = components['schemas']

export type Session = Schemas['Session']
export type StreamEvent = Schemas['StreamEvent']
export type CredentialDescriptor = Schemas['CredentialDescriptor']

export interface CreateSessionInput {
  model?: string
  provider?: string
  /** 是否在流中包含推理增量(思维链)。**默认关闭。** */
  includeReasoning?: boolean
  metadata?: Record<string, string>
}

export interface DshwarClientOptions {
  /** 网关基址,如 `https://api.example.com`。 */
  readonly baseUrl: string
  /** 终端用户令牌。由部署方的 IdP 签发。 */
  readonly token: string
  /** 自定义 fetch。测试或边缘运行时用。 */
  readonly fetch?: typeof globalThis.fetch
}

/**
 * 运行时 API 客户端。
 *
 * ```ts
 * const client = new DshwarClient({ baseUrl, token })
 * const session = await client.createSession()
 * for await (const event of client.stream(session.id)) {
 *   if (event.type === 'message.delta') process.stdout.write(event.text)
 *   if (event.type === 'turn.completed') break
 * }
 * ```
 */
export class DshwarClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: DshwarClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.token = options.token
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      })
    } catch (cause) {
      throw new DshwarTransportError('request failed before a response was received', cause)
    }

    if (!response.ok) throw await this.toApiError(response)
    return (await response.json()) as T
  }

  private async toApiError(response: Response): Promise<Error> {
    let body: DshwarErrorBody
    try {
      body = (await response.json()) as DshwarErrorBody
    } catch (cause) {
      // 网关之外的东西(反向代理、负载均衡)也可能返回非 JSON 的错误
      return new DshwarTransportError(
        `unexpected non-JSON error response (${response.status})`,
        cause,
      )
    }
    return new DshwarApiError({
      code: body.error.code,
      message: body.error.message,
      status: response.status,
      requestId: body.error.requestId,
      plannedVersion: response.headers.get('x-dshwar-planned-version') ?? undefined,
    })
  }

  /** 创建会话。 */
  async createSession(input: CreateSessionInput = {}): Promise<Session> {
    const body = await this.request<{ session: Session }>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return body.session
  }

  /** 列出当前主体的会话。 */
  async listSessions(options: { limit?: number; cursor?: string } = {}): Promise<{
    data: Session[]
    nextCursor: string | null
  }> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.cursor !== undefined) query.set('cursor', options.cursor)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return this.request(`/v1/sessions${suffix}`)
  }

  /** 会话状态。 */
  async getSession(id: string): Promise<Session> {
    const body = await this.request<{ session: Session }>(`/v1/sessions/${encodeURIComponent(id)}`)
    return body.session
  }

  /**
   * 发起一轮。
   *
   * ⚠️ **不等待本轮跑完就返回**,只确认已受理。输出走 {@link stream}。
   * 建议先建流再发起,避免漏掉开头的事件。
   */
  async createTurn(
    id: string,
    input: string,
  ): Promise<{ turn: number; status: Session['status'] }> {
    return this.request(`/v1/sessions/${encodeURIComponent(id)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    })
  }

  /** 取消并释放会话。 */
  async deleteSession(id: string): Promise<{ id: string; cancelledTurn: number | null }> {
    return this.request(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  /**
   * 订阅 SSE 事件流。
   *
   * 生成器不管流式,所以**传输是手写的** —— 但事件类型仍来自契约
   * (`StreamEvent` 是生成的类型),所以 `switch (event.type)` 依然能被
   * 编译器查漏。
   *
   * @param id 会话 id
   * @param options `lastEventId` 用于断线续传;`signal` 用于主动断开
   */
  async *stream(
    id: string,
    options: { lastEventId?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<StreamEvent> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: 'text/event-stream',
    }
    if (options.lastEventId !== undefined) headers['last-event-id'] = options.lastEventId

    let response: Response
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/v1/sessions/${encodeURIComponent(id)}/stream`,
        {
          headers,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      )
    } catch (cause) {
      throw new DshwarTransportError('stream request failed', cause)
    }

    if (!response.ok) throw await this.toApiError(response)
    if (response.body === null) throw new DshwarTransportError('stream response has no body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)

          let data: string | undefined
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) data = line.slice(5).trim()
          }
          if (data !== undefined && data.length > 0) {
            yield JSON.parse(data) as StreamEvent
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
    } finally {
      // 主动断开时必须释放 —— 服务端据此移除订阅
      await reader.cancel().catch(() => undefined)
    }
  }
}

/**
 * Admin API 客户端。
 *
 * 与运行时客户端**分开**,因为令牌不同:Admin Key 按租户签发,
 * 不能冒充用户发起会话。分成两个类是为了让「拿错令牌」在类型层就写不出来。
 */
export class DshwarAdminClient {
  private readonly baseUrl: string
  private readonly key: string
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: { baseUrl: string; adminKey: string; fetch?: typeof globalThis.fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.key = options.adminKey
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  /**
   * 读取某主体的凭据配置状态。
   *
   * ⚠️ **永不返回值。** 返回类型 `CredentialDescriptor` 里没有值字段 ——
   * 契约层就不给它留位置。
   */
  async listCredentials(
    subjectId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{ data: CredentialDescriptor[]; nextCursor: string | null }> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.cursor !== undefined) query.set('cursor', options.cursor)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''

    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/admin/subjects/${encodeURIComponent(subjectId)}/credentials${suffix}`,
      { headers: { 'x-dshwar-admin-key': this.key } },
    )

    if (!response.ok) {
      const body = (await response.json()) as DshwarErrorBody
      throw new DshwarApiError({
        code: body.error.code,
        message: body.error.message,
        status: response.status,
        requestId: body.error.requestId,
        plannedVersion: response.headers.get('x-dshwar-planned-version') ?? undefined,
      })
    }
    return (await response.json()) as { data: CredentialDescriptor[]; nextCursor: string | null }
  }
}
