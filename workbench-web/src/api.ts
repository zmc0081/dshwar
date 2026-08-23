/**
 * **唯一的请求出口** —— D7 约束 3 的落点。
 *
 * ## 规则
 *
 * 整个 `workbench-web` 里**只有这个文件**可以碰网络。屏幕不 `fetch`、
 * 不 `EventSource`、不 `axios` —— 它们从这里拿一个 {@link WorkbenchApi}。
 * 守卫在 `scripts/check-guards.mjs` 的「前端三条约束」里,一个包只许一个出口。
 *
 * ## 与 `console-web/src/api.ts` 的两处差别
 *
 * | | console-web | 这里 |
 * | --- | --- | --- |
 * | 凭据 | Admin API Key(`X-DSHWAR-Admin-Key`) | **运行时 Bearer** |
 * | 客户端 | `DshwarAdminClient` | `DshwarClient` |
 *
 * ⚠️ **绝不能同时送两者。** 网关的 `runtimeAuth` 在看 bearer **之前**先判
 * admin 头存不存在,存在就直接 401 —— 哪怕 bearer 是对的。
 * 这不是 bug:一个既是管理员又是终端用户的请求,身份是歧义的。
 *
 * ## 为什么走 SDK 而不是裸 fetch
 *
 * 「一个包一个网络出口」与「用 SDK」不冲突 —— 守卫禁的是 `fetch(` /
 * `EventSource(` 这些**传输原语**出现在 api.ts 之外,调 SDK 到处都合法。
 * 裸 fetch 会把三件已经做对的事重做一遍:认证头、错误映射
 * (`DshwarApiError` 带 code / status / requestId / **plannedVersion**)、
 * 以及 **SSE 读取循环**。最后一件尤其:工作台是最需要 SSE 的那一面,
 * 而本仓再多一份手写 SSE 解析器是所有选项里最坏的一个。
 *
 * ## baseUrl 从哪来
 *
 * 从 {@link createWorkbenchApi} 的参数注入,**不从 `window.location` 推断**。
 * 推断在远端能用、在 Tauri 里会指到 `tauri://localhost/v1/...`。
 * 三个宿主各传各的值,屏幕代码一行不用改 —— 这就是 D7 说的「现在写零成本」。
 *
 * @module @dshwar/workbench-web/api
 */
import {
  DshwarApiError,
  DshwarClient,
  type Deliverable,
  type Session,
  type StreamEvent,
  type Workspace,
  type WorkspacePolicy,
} from '@dshwar/sdk'

export type { Deliverable, Session, StreamEvent, Workspace, WorkspacePolicy }

/**
 * 一个端点**在契约里有、在这一版没实现**时的样子。
 *
 * ## 为什么它是一等公民,而不是 catch 里的一个分支
 *
 * 工作台有三处今天必然拿到 501:工作区策略读、策略写、以及作业三条。
 * 那不是故障,是**已裁决的现状** —— 策略执行层零接线,接上会让策略被保存、
 * 被显示、却从不被查询。
 *
 * 如果把 501 混进「出错了」,界面会显示一个红色的失败态,而用户会去重试。
 * 所以它单独成一类:**没实现 ≠ 失败**,前者要如实说「计划在哪个版本」。
 */
export interface NotImplemented {
  readonly kind: 'not-implemented'
  /** 网关 `x-dshwar-planned-version` 头带回来的计划版本;缺失时为 `null`。 */
  readonly plannedVersion: string | null
  /** 支持工单用的关联 id。每个响应都有。 */
  readonly requestId: string | null
}

/** 取到了值,或者这个端点这一版没实现。 */
export type MaybeImplemented<T> = { readonly kind: 'ok'; readonly value: T } | NotImplemented

/** 工作台需要的那部分 API。刻意收窄 —— 屏幕拿不到它不该用的东西。 */
export interface WorkbenchApi {
  listWorkspaces(): Promise<Workspace[]>
  getWorkspace(id: string): Promise<Workspace>
  listDeliverables(workspaceId: string): Promise<Deliverable[]>
  listSessions(): Promise<Session[]>
  getSession(id: string): Promise<Session>
  createSession(input: { workspaceId?: string; model?: string }): Promise<Session>
  createTurn(sessionId: string, input: string): Promise<{ turn: number }>
  cancelSession(id: string): Promise<void>
  stream(sessionId: string, options?: { lastEventId?: string }): AsyncIterable<StreamEvent>
  /** ⚠️ 今天必然返回 `not-implemented` —— 策略执行层零接线,这是已裁决的现状。 */
  getWorkspacePolicy(workspaceId: string): Promise<MaybeImplemented<WorkspacePolicy>>
  /** ⚠️ 同上。写入端点存在,但出厂网关不接执行层。 */
  updateWorkspacePolicy(
    workspaceId: string,
    patch: Partial<WorkspacePolicy>,
  ): Promise<MaybeImplemented<WorkspacePolicy>>
  /** ⚠️ `/v1/jobs` 在契约里是 `planned`,SDK 刻意不包 —— 这里直接如实呈现。 */
  listJobs(): Promise<MaybeImplemented<never[]>>
}

/**
 * 把「501」从异常里挑出来,变成一个值。
 *
 * ⚠️ 只认 **501**。把 5xx 一律当「没实现」是错的:500 是网关炸了,
 * 503 是暂时不可用,两者都该重试,而 501 重试一万次也一样。
 */
async function asMaybeImplemented<T>(run: () => Promise<T>): Promise<MaybeImplemented<T>> {
  try {
    return { kind: 'ok', value: await run() }
  } catch (error) {
    if (error instanceof DshwarApiError && error.status === 501) {
      return {
        kind: 'not-implemented',
        plannedVersion: error.plannedVersion ?? null,
        requestId: error.requestId ?? null,
      }
    }
    throw error
  }
}

/**
 * 建一个工作台 API 客户端。
 *
 * @param options.baseUrl **必须显式传**。没有默认值是刻意的:一个「默认同源」
 *   的默认值会让 Tauri 里的失败推迟到运行时,而那时错误信息是一句无关的网络错误。
 * @param options.token 运行时 Bearer。由部署方的 IdP 签发 ——
 *   DSHWAR 不签发身份令牌(硬规则 4)。
 * @param options.fetch 自定义 fetch。测试用 —— 也让这一层能被单测覆盖,
 *   而不是只能靠端到端。
 */
export function createWorkbenchApi(options: {
  baseUrl: string
  token: string
  fetch?: typeof globalThis.fetch
}): WorkbenchApi {
  const client = new DshwarClient({
    baseUrl: options.baseUrl,
    token: options.token,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })

  return {
    listWorkspaces: async () => (await client.listWorkspaces()).data,
    getWorkspace: (id) => client.getWorkspace(id),
    listDeliverables: async (workspaceId) => (await client.listDeliverables(workspaceId)).data,
    listSessions: async () => (await client.listSessions()).data,
    getSession: (id) => client.getSession(id),
    createSession: (input) => client.createSession(input),
    createTurn: async (sessionId, input) => {
      const { turn } = await client.createTurn(sessionId, input)
      return { turn }
    },
    cancelSession: async (id) => {
      await client.deleteSession(id)
    },
    stream: (sessionId, streamOptions) =>
      client.stream(sessionId, streamOptions?.lastEventId === undefined ? {} : streamOptions),
    getWorkspacePolicy: (workspaceId) =>
      asMaybeImplemented(() => client.getWorkspacePolicy(workspaceId)),
    updateWorkspacePolicy: (workspaceId, patch) =>
      asMaybeImplemented(() => client.updateWorkspacePolicy(workspaceId, patch)),
    // `/v1/jobs` 是 planned,SDK 刻意不包。这里也不去拼路径 ——
    // 拼了就等于绕过「SDK 是唯一传输层」这条,而收益只是提前显示一个 501。
    listJobs: () =>
      Promise.resolve<NotImplemented>({
        kind: 'not-implemented',
        plannedVersion: '0.9.0',
        requestId: null,
      }),
  }
}
