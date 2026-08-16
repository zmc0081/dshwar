/**
 * 网关装配。
 *
 * 本模块只负责**把中间件栈搭对**:requestId → 错误边界 → 分道鉴权。
 * 具体端点由 Session 3(运行时)与 Session 4(Admin)通过 `routes` 选项挂进来 ——
 * 这样鉴权栈只有一处,新增端点不可能"忘了加鉴权"。
 *
 * @module @dshwar/gateway/app
 */
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Hono } from 'hono'
import type { AdminKeyResolver } from './admin-keys.ts'
import { notFound } from './errors.ts'
import {
  adminAuth,
  errorHandler,
  requestIdMiddleware,
  runtimeAuth,
  type GatewayEnv,
} from './middleware.ts'

/** 端点注册器。Session 3 / 4 各提供一个。 */
export type RouteRegistrar = (app: Hono<GatewayEnv>) => void

export interface GatewayOptions {
  /**
   * 根上下文 —— 已装好 `auth` 与运行时插件的 cordis context。
   *
   * 网关**不负责组装 harness**。进程内要拼哪七个插件见
   * `docs/FEASIBILITY-REPORT-V2.md` §4.2;那是部署方 profile 的事,
   * 网关只消费一个装好的 `ctx`。
   */
  readonly ctx: CordisContext
  /** Admin Key 解析器。 */
  readonly adminKeys: AdminKeyResolver
  /** 运行时端点(`/v1/sessions/*`)。Session 3 提供。 */
  readonly runtimeRoutes?: RouteRegistrar
  /** Admin 端点(`/v1/admin/*`)。Session 4 提供。 */
  readonly adminRoutes?: RouteRegistrar
}

/**
 * 装配网关。
 *
 * ## 明确不做的两件事
 *
 * **不管 TLS。** 证书由反向代理终结。网关自己管证书意味着每个部署都要处理
 * 续期、SNI、OCSP —— 那是反向代理已经做得很好的事,重做一遍只会做得更差。
 *
 * **不做限流实现。** 契约里有 `rate_limited` 错误码与 429 响应,但判定逻辑
 * 属于 `@dshwar/policy`(V0.4.0)。这里只留位置。
 */
export function createGateway(options: GatewayOptions): Hono<GatewayEnv> {
  const app = new Hono<GatewayEnv>()

  app.use('*', requestIdMiddleware())

  // 错误边界挂 onError 而非中间件 —— 见 middleware.ts errorHandler 的说明
  app.onError(errorHandler())

  // ---- 分道鉴权:两种令牌在中间件层就分开 ----
  // 顺序要紧:更具体的路径先注册。/v1/admin/* 必须在 /v1/* 之前,
  // 否则 Admin 请求会先撞上运行时鉴权而被当成缺 Bearer token。
  app.use('/v1/admin/*', adminAuth(options.adminKeys))
  app.use('/v1/sessions', runtimeAuth(options.ctx))
  app.use('/v1/sessions/*', runtimeAuth(options.ctx))

  options.runtimeRoutes?.(app)
  options.adminRoutes?.(app)

  // 未匹配到任何路由 —— 用契约里的错误形状,而不是 Hono 的默认 404 文本
  app.notFound((c) => {
    throw notFound('endpoint')
  })

  return app
}
