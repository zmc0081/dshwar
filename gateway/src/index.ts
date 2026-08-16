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
