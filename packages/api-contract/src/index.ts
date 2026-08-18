/**
 * `@dshwar/api-contract` —— DSHWAR API v1 契约。★ **护城河本体。**
 *
 * 运行时插件可替换,控制面是标准 SaaS —— 只有这份契约是客户接进来之后**换不掉**的。
 *
 * ## 单一事实源
 *
 * Zod schema 是唯一的事实源。OpenAPI 3.1 由 `buildOpenApiDocument()` 生成,
 * SDK 由 OpenAPI 生成。**任何一处手写都会引入第二个事实源**,而两个事实源
 * 迟早会分叉 —— 分叉的表现是客户按文档写的客户端在生产上炸掉。
 *
 * ## 与上游解耦
 *
 * 事件词表、错误码、资源形状全部由 DSHWAR 定义(`ARCHITECTURE.md` §2.5)。
 * 上游 dsh 还在 rc 阶段,其事件词表会变;1:1 透传等于把 v1 的稳定性承诺
 * 外包给一个 rc 项目。见 `events.ts` 的映射表。
 *
 * @module @dshwar/api-contract
 */

export {
  ErrorCode,
  ErrorResponse,
  PaginationQuery,
  paginated,
  RequestIdField,
  SessionId,
  SubjectId,
} from './common.ts'

export {
  MessageCompletedEvent,
  MessageDeltaEvent,
  PingEvent,
  ReasoningDeltaEvent,
  SSE_TRANSPORT_NOTE,
  StreamErrorEvent,
  StreamEvent,
  StreamEventType,
  ToolCompletedEvent,
  ToolStartedEvent,
  TurnCompletedEvent,
  TurnStartedEvent,
} from './events.ts'

export {
  CreateSessionRequest,
  CreateSessionResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  DeleteSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
  Session,
  SessionStatus,
} from './runtime.ts'

export {
  AuditEntry,
  Capacity,
  CredentialDescriptor,
  GetQuotaResponse,
  GetSubjectResponse,
  ListAuditResponse,
  ListCredentialsResponse,
  ListPoliciesResponse,
  ListSubjectsResponse,
  ListUsageResponse,
  Policy,
  Quota,
  Subject,
  UpdateQuotaRequest,
  UsageRecord,
} from './admin.ts'

export { ROUTES } from './routes.ts'
export type { AuthScheme, ImplementationStatus, RouteDef, RouteResponse } from './routes.ts'

export { buildComponentSchemas, nameOf, SCHEMA_REGISTRY, schemaRef } from './registry.ts'

export { buildOpenApiDocument } from './openapi.ts'

// ---- 模型 IR(V0.8.0:三语言 SDK 生成的共同上游)----
export { extractModels, objectSchemaNames, UnsupportedSchemaError } from './model-ir.ts'
export type { IrField, IrModel, IrType } from './model-ir.ts'
export type { OpenApiDocument } from './openapi.ts'

export { breakingChanges, diffContract } from './freeze.ts'
export type { ContractChange, ContractChangeCode } from './freeze.ts'

// ---- 工作台契约(V0.5.5)----
export {
  Attachment,
  CreateAttachmentResponse,
  CreateJobRequest,
  CreateWorkspaceRequest,
  Deliverable,
  GetJobResponse,
  GetWorkspacePolicyResponse,
  GetWorkspaceResponse,
  Job,
  JobStatus,
  ListAttachmentsResponse,
  ListDeliverablesResponse,
  ListJobsResponse,
  ListWorkspacesResponse,
  UpdateWorkspacePolicyRequest,
  Workspace,
  WorkspacePolicy,
} from './workbench.ts'

// ---- 支付契约(V0.6.0)----
export { StripeWebhookEventBody, WebhookAck } from './billing.ts'
