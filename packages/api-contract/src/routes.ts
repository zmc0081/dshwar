/**
 * 路由表 —— 路径、方法、状态码、鉴权方式的**唯一**声明处。
 *
 * OpenAPI 文档由本表生成(见 `openapi.ts`)。手写 yaml 的问题不是费事,
 * 是两处维护:schema 改了 yaml 没改,而没人会发现 —— 直到某个客户
 * 按文档写的客户端在生产上炸掉。
 *
 * @module @dshwar/api-contract/routes
 */
import { z } from 'zod'
import {
  GetQuotaResponse,
  GetSubjectResponse,
  ListAuditResponse,
  ListCredentialsResponse,
  ListPoliciesResponse,
  ListSubjectsResponse,
  ListUsageResponse,
  UpdateQuotaRequest,
} from './admin.ts'
import { ErrorResponse, PaginationQuery, SessionId, SubjectId } from './common.ts'
import {
  CreateSessionRequest,
  CreateSessionResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  DeleteSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
} from './runtime.ts'

/**
 * 鉴权方式。
 *
 * **两种令牌分离签发**(CLAUDE.md 第七节):供给系统只能写身份镜像,
 * 不能读用量与凭据配置;运维的 Admin Key 不能冒充用户发起会话。
 * 分开是为了让一把泄漏的钥匙的爆炸半径可预测。
 */
export type AuthScheme =
  /** 终端用户的 Bearer token,经 `ctx.auth.verify()` 换出 principal。 */
  | 'runtime'
  /** 按租户签发的 Admin API Key。一把钥匙不得横跨租户。 */
  | 'admin'

/** 实现状态。`planned` 的端点契约完整但返回 501。 */
export type ImplementationStatus = 'implemented' | 'planned'

export interface RouteResponse {
  readonly description: string
  readonly schema?: z.ZodType
  /** SSE 端点用。此时 `schema` 描述的是单条事件的载荷。 */
  readonly contentType?: string
}

export interface RouteDef {
  readonly method: 'get' | 'post' | 'patch' | 'delete'
  readonly path: string
  readonly operationId: string
  readonly summary: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly auth: AuthScheme
  readonly status: ImplementationStatus
  /** `planned` 时指出哪个版本会实现,同时作为响应头 `x-dshwar-planned-version`。 */
  readonly plannedVersion?: string
  readonly pathParams?: z.ZodObject
  readonly query?: z.ZodObject
  readonly body?: z.ZodType
  readonly responses: Readonly<Record<number, RouteResponse>>
  /** 额外的请求头(如 SSE 的 `Last-Event-ID`)。 */
  readonly headers?: readonly { name: string; description: string; required: boolean }[]
}

/** 每个端点都可能返回的错误。写一次,生成时展开到所有路由。 */
const COMMON_ERRORS: Readonly<Record<number, RouteResponse>> = {
  400: { description: '请求体或参数不满足 schema', schema: ErrorResponse },
  401: { description: '凭证缺失、无效或已过期', schema: ErrorResponse },
  429: { description: '触发限流', schema: ErrorResponse },
  500: { description: '服务端内部错误', schema: ErrorResponse },
}

const NOT_FOUND: RouteResponse = {
  // 跨主体访问返回 404 而非 403 —— 403 会泄漏「这个 id 存在」
  description: '资源不存在,或存在但不属于该主体(两者刻意不可区分)',
  schema: ErrorResponse,
}

const NOT_IMPLEMENTED: RouteResponse = {
  description:
    '端点已在契约中定义,但本版本尚未实现。响应头 `x-dshwar-planned-version` 指出计划版本',
  schema: ErrorResponse,
}

const SessionIdParam = z.object({ id: SessionId })
const SubjectIdParam = z.object({ id: SubjectId })

// ---------------------------------------------------------------------------
// 运行时 API
// ---------------------------------------------------------------------------

const RUNTIME_ROUTES: readonly RouteDef[] = [
  {
    method: 'post',
    path: '/v1/sessions',
    operationId: 'createSession',
    summary: '创建会话',
    tags: ['sessions'],
    auth: 'runtime',
    status: 'implemented',
    body: CreateSessionRequest,
    responses: {
      201: { description: '会话已创建', schema: CreateSessionResponse },
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/sessions',
    operationId: 'listSessions',
    summary: '列出当前主体的会话',
    tags: ['sessions'],
    auth: 'runtime',
    status: 'implemented',
    query: PaginationQuery,
    responses: {
      200: { description: '会话列表', schema: ListSessionsResponse },
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/sessions/{id}',
    operationId: 'getSession',
    summary: '会话状态',
    tags: ['sessions'],
    auth: 'runtime',
    status: 'implemented',
    pathParams: SessionIdParam,
    responses: {
      200: { description: '会话', schema: GetSessionResponse },
      404: NOT_FOUND,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'post',
    path: '/v1/sessions/{id}/turns',
    operationId: 'createTurn',
    summary: '发起一轮',
    description:
      '**不等待本轮跑完就返回**,只确认已受理;输出走 SSE。一轮可能跑几分钟(工具调用、多步推理),而中间的反向代理通常在 60 秒左右掐断连接 —— 让发起与消费分开,客户端可以先建 SSE 再发起,断线重连也不丢内容。',
    tags: ['sessions'],
    auth: 'runtime',
    status: 'implemented',
    pathParams: SessionIdParam,
    body: CreateTurnRequest,
    responses: {
      202: { description: '本轮已受理,输出走 SSE', schema: CreateTurnResponse },
      404: NOT_FOUND,
      409: { description: '会话正忙或已结束', schema: ErrorResponse },
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/sessions/{id}/stream',
    operationId: 'streamSession',
    summary: 'SSE 流式输出',
    description:
      '每条事件形如 `id: <seq>` / `event: <type>` / `data: <StreamEvent JSON>`。`id` 单调递增;断线重连时带 `Last-Event-ID` 请求头,服务端从该序号之后重放。`reasoning.delta` 仅在会话创建时 `includeReasoning: true` 才会出现。',
    tags: ['sessions'],
    auth: 'runtime',
    status: 'implemented',
    pathParams: SessionIdParam,
    headers: [
      {
        name: 'Last-Event-ID',
        description: '上次收到的最后一个事件序号;服务端从该序号之后重放',
        required: false,
      },
    ],
    responses: {
      200: {
        description: 'SSE 事件流',
        contentType: 'text/event-stream',
      },
      404: NOT_FOUND,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'delete',
    path: '/v1/sessions/{id}',
    operationId: 'deleteSession',
    summary: '取消并释放会话',
    description: '先截断正在跑的一轮,再彻底释放会话。删除不存在或已删除的会话都返回 404,不区分。',
    tags: ['sessions'],
    auth: 'runtime',
    status: 'implemented',
    pathParams: SessionIdParam,
    responses: {
      200: { description: '已取消并释放', schema: DeleteSessionResponse },
      404: NOT_FOUND,
      ...COMMON_ERRORS,
    },
  },
]

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

const PLANNED_V4 = 'V0.4.0'

const ADMIN_ROUTES: readonly RouteDef[] = [
  // ---- V0.2.0 实现 ----
  {
    method: 'get',
    path: '/v1/admin/subjects/{id}/credentials',
    operationId: 'listSubjectCredentials',
    summary: '凭据配置状态',
    description:
      '**永不返回值。** 只暴露 configured / source / writable —— 本端点的 schema 里没有任何可以放值的字段(CLAUDE.md 硬规则 5)。',
    tags: ['admin', 'credentials'],
    auth: 'admin',
    status: 'implemented',
    pathParams: SubjectIdParam,
    query: PaginationQuery,
    responses: {
      200: { description: '凭据配置状态列表', schema: ListCredentialsResponse },
      403: { description: 'Admin Key 不属于该主体所在租户', schema: ErrorResponse },
      404: NOT_FOUND,
      ...COMMON_ERRORS,
    },
  },

  // ---- [planned] ----
  {
    method: 'get',
    path: '/v1/admin/subjects',
    operationId: 'listSubjects',
    summary: '列出用户镜像',
    tags: ['admin', 'subjects'],
    auth: 'admin',
    // V0.3.0 Session 6 转正。契约(schema / 参数 / 路径)一个字段没动 ——
    // 只有 x-dshwar-status 扩展消失,契约冻结检查对此不设防是正确的:
    // 「planned 转实现」正是契约先行策略承诺过会发生的事。
    status: 'implemented',
    query: PaginationQuery,
    responses: {
      200: { description: '用户镜像列表', schema: ListSubjectsResponse },
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/admin/subjects/{id}',
    operationId: 'getSubject',
    summary: '读取一个用户镜像',
    tags: ['admin', 'subjects'],
    auth: 'admin',
    status: 'implemented',
    pathParams: SubjectIdParam,
    responses: {
      200: { description: '用户镜像', schema: GetSubjectResponse },
      404: NOT_FOUND,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/admin/subjects/{id}/quota',
    operationId: 'getSubjectQuota',
    summary: '读取配额',
    tags: ['admin', 'quota'],
    auth: 'admin',
    status: 'planned',
    plannedVersion: PLANNED_V4,
    pathParams: SubjectIdParam,
    responses: {
      200: { description: '配额', schema: GetQuotaResponse },
      404: NOT_FOUND,
      501: NOT_IMPLEMENTED,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'patch',
    path: '/v1/admin/subjects/{id}/quota',
    operationId: 'updateSubjectQuota',
    summary: '修改配额',
    tags: ['admin', 'quota'],
    auth: 'admin',
    status: 'planned',
    plannedVersion: PLANNED_V4,
    pathParams: SubjectIdParam,
    body: UpdateQuotaRequest,
    responses: {
      200: { description: '配额已更新', schema: GetQuotaResponse },
      404: NOT_FOUND,
      501: NOT_IMPLEMENTED,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/admin/subjects/{id}/usage',
    operationId: 'listSubjectUsage',
    summary: '单个主体的用量明细',
    tags: ['admin', 'usage'],
    auth: 'admin',
    status: 'planned',
    plannedVersion: PLANNED_V4,
    pathParams: SubjectIdParam,
    query: PaginationQuery,
    responses: {
      200: { description: '用量明细', schema: ListUsageResponse },
      404: NOT_FOUND,
      501: NOT_IMPLEMENTED,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/admin/usage',
    operationId: 'listUsage',
    summary: '聚合用量',
    description: '支持按租户、时间、模型分组。',
    tags: ['admin', 'usage'],
    auth: 'admin',
    status: 'planned',
    plannedVersion: PLANNED_V4,
    query: PaginationQuery,
    responses: {
      200: { description: '聚合用量', schema: ListUsageResponse },
      501: NOT_IMPLEMENTED,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/admin/policies',
    operationId: 'listPolicies',
    summary: '模型准入与预算策略',
    tags: ['admin', 'policies'],
    auth: 'admin',
    status: 'planned',
    plannedVersion: PLANNED_V4,
    query: PaginationQuery,
    responses: {
      200: { description: '策略列表', schema: ListPoliciesResponse },
      501: NOT_IMPLEMENTED,
      ...COMMON_ERRORS,
    },
  },
  {
    method: 'get',
    path: '/v1/admin/audit',
    operationId: 'listAudit',
    summary: '审计查询',
    tags: ['admin', 'audit'],
    auth: 'admin',
    // V0.4.0 Session 1 转正(原计划 V0.3.0,当时未实现)。schema 未动。
    status: 'implemented',
    query: PaginationQuery,
    responses: {
      200: { description: '审计记录', schema: ListAuditResponse },
      ...COMMON_ERRORS,
    },
  },
]

/** v1 的全部路由。 */
export const ROUTES: readonly RouteDef[] = [...RUNTIME_ROUTES, ...ADMIN_ROUTES]
