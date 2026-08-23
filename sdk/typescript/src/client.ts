/**
 * DSHWAR API 客户端。
 *
 * **类型全部来自生成的 schema,不手写。** 这里只写「怎么发请求」——
 * 路径、方法、请求体与响应的形状都由 `src/generated/schema.ts` 提供,
 * 而它由 `packages/api-contract/openapi.json` 生成。
 *
 * @module @dshwar/sdk/client
 */
import { DshwarApiError, DshwarTransportError, type DshwarErrorBody } from './errors.ts'
import type { components } from './generated/schema.ts'

type Schemas = components['schemas']

/**
 * 分页参数拼成 query 串。没有参数时返回空串 —— **不是 `'?'`**。
 *
 * ⚠️ 一个裸的 `?` 在多数服务端能用,但它会让日志里的路径与实际调用不一致,
 * 也会让「同一个端点」在指标里裂成两条。省一个字符不值这个。
 */
function pageQuery(options: { limit?: number; cursor?: string }): string {
  const query = new URLSearchParams()
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  if (options.cursor !== undefined) query.set('cursor', options.cursor)
  return query.size === 0 ? '' : `?${query.toString()}`
}

export type Session = Schemas['Session']
export type StreamEvent = Schemas['StreamEvent']
export type CredentialDescriptor = Schemas['CredentialDescriptor']
export type Workspace = Schemas['Workspace']
export type Deliverable = Schemas['Deliverable']
export type WorkspacePolicy = Schemas['WorkspacePolicy']

export interface CreateSessionInput {
  model?: string
  provider?: string
  /**
   * 会话所属的工作区。
   *
   * ⚠️ **V0.9.0 补**。此前这个字段在生成的 `CreateSessionRequest` 与
   * `Session` 里都有,唯独手写的 `CreateSessionInput` 漏了 ——
   * 于是从 TypeScript **建不出一个属于某个工作区的会话**。
   *
   * 这正是「手写一层类型 = 第二个事实源」的代价:生成的那层是对的,
   * 而手写的这层与它分家了,**没有任何东西会红**
   * (同步断言只比对 `src/generated/`,看不见 `client.ts`)。
   */
  workspaceId?: string
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
    // ⚠️ **必须 bind。** `globalThis.fetch` 是 `Window` 上的方法,存进实例字段
    //   之后再 `this.fetchImpl(...)` 调,`this` 就成了这个 client ——
    //   浏览器抛 `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`。
    //
    //   **Node 的 fetch 不在乎 `this`,所以 SDK 的全部测试都是绿的**,
    //   而这个 SDK 在浏览器里从来没能工作过。V0.9.0 Session 2 接工作台时撞到:
    //   症状是 `DshwarTransportError: request failed before a response was received`
    //   —— 与「网络断了」「网关没起来」一模一样,查了好几步才落到这里。
    //
    //   ⇒ 这一条是「测试环境与运行环境不同」的典型:**Node 里的绿证明不了浏览器**。
    //      谁盯着它:`test/browser-fetch.test.ts` 里那条模拟 unbound 方法的断言。
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
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

  /**
   * 只关心「成功了没有」的请求 —— **不解析正文**。
   *
   * ## 为什么必须单开一条,而不是让 `request()` 去判
   *
   * `DELETE /v1/workspaces/{id}` 返回 **204 No Content**。走 `request()`
   * 会无条件调 `response.json()`,对一个空正文抛出裸 `SyntaxError` ——
   * 连 `DshwarTransportError` 都不是。调用方看到的是
   * `Unexpected end of JSON input`,与「网络断了」「网关挂了」完全无法区分,
   * 而实际上**请求成功了**。
   *
   * 让 `request()` 自己判 204 也可以,但那会让它的返回类型变成
   * `T | undefined` —— 每个调用点都要多一次判空,而其中只有一个真的需要。
   * 单开一条把这件事留在类型上:**要正文用 `request`,不要正文用这条。**
   */
  private async requestNoContent(path: string, init: RequestInit = {}): Promise<void> {
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

  // ------------------------------------------------------------------
  // 工作区 —— V0.9.0 Session 2 补齐。
  //
  // ## 为什么现在补
  //
  // 工作台的每一个会话都属于一个工作区,而在此之前 SDK 一个工作区方法都没有:
  // 七条 `/v1/workspaces*` 从 V0.5.5 起就实现了(V0.8.0 的出厂装配断言把
  // 「实现了但没挂上」那次也修了),却只能靠自己拼 fetch 去调。
  //
  // **一个第一方 UI 需要用而第三方拿不到的端点,本身就是气味。**
  //
  // ## 为什么**不**补 `/v1/jobs`
  //
  // 那三条在契约里是 `planned`,运行时返回 501。包一层方法出去,等于向
  // 第三方承诺一个只会抛 501 的 API —— `plannedVersion` 虽然能如实透出,
  // 但**方法存在本身就是承诺**。作业屏改为直接呈现 501(它本来就该那样),
  // 等 handler 落地再补方法。
  //
  // ⚠️ 类型一律从 `Schemas[...]` 取,不写内联对象字面量。
  //   `capacity()` 是反面教材:它重新声明了一份 `Capacity` 已经有的形状,
  //   还漏掉了 `requestId` —— 而契约冻结检查看不见手写的那一层。
  // ------------------------------------------------------------------

  /**
   * 列出当前 principal 可见的工作区。
   *
   * ⚠️ 返回**契约的响应类型原样**(含 `nextCursor` 与 `requestId`),不做投影。
   * 见本组方法上方那段关于 `capacity()` 的反面教材。
   */
  async listWorkspaces(
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Schemas['ListWorkspacesResponse']> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.cursor !== undefined) query.set('cursor', options.cursor)
    const suffix = query.size === 0 ? '' : `?${query.toString()}`
    return this.request(`/v1/workspaces${suffix}`)
  }

  /**
   * 建一个工作区。
   *
   * ⚠️ 请求体只有 `name` —— 契约里的 `CreateWorkspaceRequest` 就这一个字段。
   * 参数类型直接取它,所以契约将来加字段时这里会**编译不过**而不是悄悄少传。
   */
  async createWorkspace(input: Schemas['CreateWorkspaceRequest']): Promise<Workspace> {
    const body = await this.request<Schemas['GetWorkspaceResponse']>('/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return body.workspace
  }

  /** 取单个工作区。 */
  async getWorkspace(id: string): Promise<Workspace> {
    const body = await this.request<Schemas['GetWorkspaceResponse']>(
      `/v1/workspaces/${encodeURIComponent(id)}`,
    )
    return body.workspace
  }

  /**
   * 删一个工作区。
   *
   * ⚠️ 服务端返回 **204 无正文**。在 V0.9.0 之前 `request()` 无条件调
   * `response.json()`,于是这里会抛一个裸 `SyntaxError` ——
   * 连 `DshwarTransportError` 都不是,调用方根本无从判断发生了什么。
   * 见 {@link DshwarClient.requestNoContent}。
   */
  async deleteWorkspace(id: string): Promise<void> {
    await this.requestNoContent(`/v1/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  /** 列出工作区的产物(文件与目录)。 */
  async listDeliverables(
    id: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Schemas['ListDeliverablesResponse']> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.cursor !== undefined) query.set('cursor', options.cursor)
    const suffix = query.size === 0 ? '' : `?${query.toString()}`
    return this.request(`/v1/workspaces/${encodeURIComponent(id)}/deliverables${suffix}`)
  }

  /**
   * 取工作区策略。
   *
   * ⚠️ **出厂网关刻意不接策略执行层**,所以这条今天返回 **501**
   * (`DshwarApiError.status === 501`,`plannedVersion` 带着计划版本)。
   * 那不是缺陷:接上会让策略被保存、被显示、却从不被查询 ——
   * 比 501 危险得多。调用方要**如实呈现**这个 501,不要兜底成空策略。
   */
  async getWorkspacePolicy(id: string): Promise<WorkspacePolicy> {
    const body = await this.request<Schemas['GetWorkspacePolicyResponse']>(
      `/v1/workspaces/${encodeURIComponent(id)}/policy`,
    )
    return body.policy
  }

  /** 改工作区策略。⚠️ 与 {@link DshwarClient.getWorkspacePolicy} 同,今天返回 501。 */
  async updateWorkspacePolicy(
    id: string,
    patch: Schemas['UpdateWorkspacePolicyRequest'],
  ): Promise<WorkspacePolicy> {
    const body = await this.request<Schemas['GetWorkspacePolicyResponse']>(
      `/v1/workspaces/${encodeURIComponent(id)}/policy`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
    return body.policy
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
    // ⚠️ **必须 bind。** `globalThis.fetch` 是 `Window` 上的方法,存进实例字段
    //   之后再 `this.fetchImpl(...)` 调,`this` 就成了这个 client ——
    //   浏览器抛 `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`。
    //
    //   **Node 的 fetch 不在乎 `this`,所以 SDK 的全部测试都是绿的**,
    //   而这个 SDK 在浏览器里从来没能工作过。V0.9.0 Session 2 接工作台时撞到:
    //   症状是 `DshwarTransportError: request failed before a response was received`
    //   —— 与「网络断了」「网关没起来」一模一样,查了好几步才落到这里。
    //
    //   ⇒ 这一条是「测试环境与运行环境不同」的典型:**Node 里的绿证明不了浏览器**。
    //      谁盯着它:`test/browser-fetch.test.ts` 里那条模拟 unbound 方法的断言。
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
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

  /**
   * Admin 面的共用请求。
   *
   * ⚠️ **V0.9.0 Session 3 抽出来的。** 在此之前两个方法各自内联了一份
   * fetch + 错误映射 —— 而 Session 3 要再加八个方法,那就是十份复制。
   *
   * 复制的代价不是行数:`plannedVersion` 是 V0.5.5 才补进错误映射的,
   * 补的时候要**逐处**改。漏掉任何一处,那个端点的 501 就不带计划版本 ——
   * 而调用方拿到的是一个「没实现,但不知道什么时候实现」的错误,
   * 与「这个端点根本不存在」无法区分。
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'x-dshwar-admin-key': this.key,
          'content-type': 'application/json',
          ...init.headers,
        },
      })
    } catch (cause) {
      throw new DshwarTransportError('request failed before a response was received', cause)
    }
    if (!response.ok) {
      let body: DshwarErrorBody
      try {
        body = (await response.json()) as DshwarErrorBody
      } catch (cause) {
        // 网关之外的东西(反向代理、负载均衡)也可能返回非 JSON 的错误
        throw new DshwarTransportError(
          `unexpected non-JSON error response (${response.status})`,
          cause,
        )
      }
      throw new DshwarApiError({
        code: body.error.code,
        message: body.error.message,
        status: response.status,
        requestId: body.error.requestId,
        plannedVersion: response.headers.get('x-dshwar-planned-version') ?? undefined,
      })
    }
    return (await response.json()) as T
  }

  /**
   * 部署容量:隔离档、进程上限、成员上限(V0.5.0)。
   *
   * 控制台首页那三个数从这里来。**它与服务端的开户闸门是同一个来源** ——
   * 两处各算各的话,界面会显示一个管理员照着加人、加到一半被拒的数。
   *
   * ⚠️ **V0.9.0 Session 3 把返回类型从手写的内联对象改成 `Schemas['Capacity']`。**
   * 原先那份手写的漏掉了 `requestId` —— 而每个响应都带它,那是支持工单的抓手。
   * 更要紧的是:手写的那一层**契约冻结检查看不见**,契约改了它不会红。
   * 本类的其余方法一律直接用 `Schemas[...]`,不再重新声明形状。
   */
  async capacity(): Promise<Schemas['Capacity']> {
    return this.request('/v1/admin/capacity')
  }

  // ------------------------------------------------------------------
  // 运营后台需要的那部分 —— V0.9.0 Session 3 补齐。
  //
  // 补之前这个类只有两个方法(`listCredentials` / `capacity`),而 Admin 面有九条。
  // 与工作区那次同一个理由:**一个第一方 UI 需要用而第三方拿不到的端点,
  // 本身就是气味。**
  //
  // ⚠️ 返回**契约的响应类型原样**,不做投影。`capacity()` 是本类里的反面教材:
  //   它重新声明了一份 `Capacity` 已经有的形状,还漏掉了 `requestId` ——
  //   而契约冻结检查看不见手写的那一层。新方法一律 `Schemas[...]`。
  // ------------------------------------------------------------------

  /** 列出本租户的成员。 */
  async listSubjects(
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Schemas['ListSubjectsResponse']> {
    return this.request(`/v1/admin/subjects${pageQuery(options)}`)
  }

  /** 取单个成员。 */
  async getSubject(id: string): Promise<Schemas['GetSubjectResponse']> {
    return this.request(`/v1/admin/subjects/${encodeURIComponent(id)}`)
  }

  /** 取成员配额。 */
  async getQuota(subjectId: string): Promise<Schemas['GetQuotaResponse']> {
    return this.request(`/v1/admin/subjects/${encodeURIComponent(subjectId)}/quota`)
  }

  /**
   * 改成员配额。
   *
   * ⚠️ `tokenLimit: null` 是**「不限」**,不是「没配」—— 契约里它是
   * `number | null` 而不是可选字段,两种状态在类型层就是分开的。
   * 调用方不要用 `?? 0` 之类的写法把它兜掉。
   */
  async updateQuota(
    subjectId: string,
    patch: Schemas['UpdateQuotaRequest'],
  ): Promise<Schemas['GetQuotaResponse']> {
    return this.request(`/v1/admin/subjects/${encodeURIComponent(subjectId)}/quota`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  /** 单个成员的用量明细。 */
  async subjectUsage(
    subjectId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Schemas['ListUsageResponse']> {
    return this.request(
      `/v1/admin/subjects/${encodeURIComponent(subjectId)}/usage${pageQuery(options)}`,
    )
  }

  /** 全租户用量。 */
  async usage(
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Schemas['ListUsageResponse']> {
    return this.request(`/v1/admin/usage${pageQuery(options)}`)
  }

  /** 模型策略(允许的模型 + 回落模型)。 */
  async policies(
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Schemas['ListPoliciesResponse']> {
    return this.request(`/v1/admin/policies${pageQuery(options)}`)
  }

  /** 审计流水。 */
  async audit(
    options: { limit?: number; cursor?: string } = {},
  ): Promise<Schemas['ListAuditResponse']> {
    return this.request(`/v1/admin/audit${pageQuery(options)}`)
  }
}
