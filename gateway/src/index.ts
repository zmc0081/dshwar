/**
 * `@dshwar/gateway` —— API 平面服务。
 *
 * Hono,Web 标准,可跑 Node 与边缘。契约来自 `@dshwar/api-contract`。
 *
 * ## 会话路由
 *
 * ```
 * Bearer token → ctx.auth.verify() → Principal → runWithPrincipal → handler
 * ```
 *
 * 此下所有插件按 principal 解析,消费方零改动 —— 这正是 V0.1.0 证明的那件事
 * 在 HTTP 层的落点。
 *
 * @module @dshwar/gateway
 */

export { createGateway } from './app.ts'
export type { GatewayOptions, RouteRegistrar } from './app.ts'

export { InMemoryAdminKeyResolver } from './admin-keys.ts'
export type { AdminIdentity, AdminKeyResolver } from './admin-keys.ts'

export { ApiError, notFound, notImplemented, renderError, unauthorized } from './errors.ts'

export {
  ADMIN_KEY_HEADER,
  adminAuth,
  assertTenant,
  errorHandler,
  requestIdMiddleware,
  runtimeAuth,
} from './middleware.ts'
export type { GatewayEnv, GatewayVariables } from './middleware.ts'

export { registerRuntimeRoutes } from './sessions/routes.ts'
export type {
  AgentFactoryFn,
  ModelGateLike,
  QuotaCheckLike,
  RuntimeRouteOptions,
  UserMessageFactory,
} from './sessions/routes.ts'

export { GatewaySessionStore } from './sessions/store.ts'
export type { AgentHandleLike, GatewaySession, UsageObservation } from './sessions/store.ts'

export { EventBuffer, translateEvent } from './sessions/events.ts'
export type { SequencedEvent, TranslateOptions, UpstreamSessionEvent } from './sessions/events.ts'

export { registerAdminRoutes } from './admin/routes.ts'
export type {
  AdminRouteOptions,
  AuditReaderLike,
  MirrorSubject,
  StoredAuditRecord,
  SubjectLookup,
  SubjectMirrorReader,
  ModelPolicyLike,
  PolicyReaderLike,
  QuotaAdminLike,
  QuotaStateLike,
  UsageReaderLike,
  UsageRowLike,
} from './admin/routes.ts'

export { InMemoryScimTokenResolver } from './scim-keys.ts'
export type { ScimIdentity, ScimTokenResolver } from './scim-keys.ts'

export { ConsoleAuditSink, NullAuditSink, StoreAuditSink } from './admin/audit.ts'
export type { AuditRecord, AuditSink } from './admin/audit.ts'

export { assembleRuntime, DELIBERATELY_OMITTED, GATEWAY_PLUGINS } from './runtime.ts'
export type { AssembledRuntime, RuntimeOptions, StaticAuthEntry } from './runtime.ts'

export { parseArgs, startServer } from './server.ts'
export type { ServerConfig } from './server.ts'
