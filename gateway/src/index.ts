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
  AgentFactoryInput,
  ModelGateLike,
  QuotaCheckLike,
  RuntimeRouteOptions,
  UserMessageFactory,
} from './sessions/routes.ts'

export { GatewaySessionStore } from './sessions/store.ts'
export type {
  AgentHandleLike,
  GatewaySession,
  SessionEventSource,
  UsageObservation,
} from './sessions/store.ts'

// ---- 进程隔离(V0.4.5)----
// 跨进程句柄戴的是与进程内句柄完全相同的面孔,所以路由、SSE、计量一行不改。
// 三档隔离的分派**只在 isolation.ts 一处**发生。
export {
  auditSupervisorEvents,
  createIsolatedRuntime,
  DEFAULT_ISOLATION_LEVEL,
  ISOLATION_LEVELS,
  parseIsolationLevel,
} from './isolation.ts'
export type {
  InProcessRuntime,
  IsolatedRuntime,
  IsolationConfig,
  IsolationLevel,
} from './isolation.ts'
export { createRemoteAgent, remoteUserMessage } from './sessions/remote.ts'
export type { RemoteAgentInput } from './sessions/remote.ts'
export { parseWorkerArgs, runWorker } from './worker.ts'
export type { WorkerBootstrap, WorkerOptions } from './worker.ts'

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
