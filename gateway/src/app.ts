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
import { stripeWebhookFailClosed } from './billing/webhook.ts'
import type { ScimTokenResolver } from './scim-keys.ts'
import { notFound } from './errors.ts'
import {
  adminAuth,
  errorHandler,
  requestIdMiddleware,
  runtimeAuth,
  scimAuth,
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
  /**
   * 工作台端点(`/v1/workspaces/*` `/v1/jobs/*`)。V0.5.5 提供。
   *
   * 与 runtimeRoutes 分开是因为它们的**依赖**不同:会话流要 agent 运行时,
   * 工作台只要工作区簿与文件系统。分开之后,一个只用工作台的部署
   * 不必装配整套 agent 插件。
   */
  readonly workbenchRoutes?: RouteRegistrar
  /**
   * 支付端点(V0.6.0):Stripe webhook。用 `registerStripeWebhook()` 造。
   *
   * **不配也挂路由**:契约宣告了 `/v1/billing/webhooks/stripe`,未配置时
   * 该路径一律 401(fail closed)而不是 404 —— 404 会告诉探测者
   * 「这个部署没接支付」,而配没配不该从外面看得出来。
   */
  readonly billingRoutes?: RouteRegistrar
  /**
   * SCIM 挂载(V0.3.0 Session 6)。挂在 `/scim/v2`,**不占用 `/v1/`** ——
   * SCIM 有自己的错误格式与版本节奏,混进 `/v1/` 会把两套契约绑在一起。
   *
   * 一个挂载点服务一个身份源。多 IdP 并存的 SCIM 挂载留给 V0.5.0 ——
   * 那需要按 source 划分基址,而基址是配在供给方界面里的对外契约,不能反复改。
   */
  readonly scim?: {
    /** 本挂载点服务的身份源。token 属于别的源一样 401。 */
    readonly source: string
    /** `createScimApp()` 的产物。 */
    readonly app: Hono
    readonly tokens: ScimTokenResolver
  }
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
  // ★ V0.5.5:工作台端点同样是运行时端点,**必须挂同一道认证**。
  //
  // ⚠️ 这两行差点被漏掉 —— 新增路由时只写了 handler,而认证中间件是按
  // 路径前缀单独注册的,不会自动覆盖。漏掉的后果是 `c.get('principal')`
  // 为 undefined,而归属判定全建立在它之上:**等于所有人共用一个匿名身份**。
  //
  // 由 `gateway/test/auth-coverage.test.ts` 钉住:契约里每个非 admin 的
  // `/v1` 路径,无令牌时必须 401。那条断言遍历 ROUTES,新增路由自动纳入 ——
  // 不靠人记得来这里加一行。
  app.use('/v1/workspaces', runtimeAuth(options.ctx))
  app.use('/v1/workspaces/*', runtimeAuth(options.ctx))
  app.use('/v1/jobs', runtimeAuth(options.ctx))
  app.use('/v1/jobs/*', runtimeAuth(options.ctx))
  app.use('/v1/attachments', runtimeAuth(options.ctx))
  app.use('/v1/attachments/*', runtimeAuth(options.ctx))

  // SCIM 是第三类令牌,自己的前缀、自己的鉴权、自己的错误格式。
  // 三类令牌的互斥由各自的中间件保证:SCIM token 进 /v1/* 过不了
  // runtimeAuth/adminAuth,运行时 token 与 Admin Key 进 /scim/* 过不了 scimAuth。
  if (options.scim !== undefined) {
    app.use('/scim/v2/*', scimAuth(options.scim.tokens, options.scim.source))
    app.route('/scim/v2', options.scim.app)
  }

  options.runtimeRoutes?.(app)
  options.adminRoutes?.(app)
  options.workbenchRoutes?.(app)
  // 支付:配了走真实验签,没配走同路径的 fail closed(见 billingRoutes 的说明)
  ;(options.billingRoutes ?? stripeWebhookFailClosed())(app)

  // 未匹配到任何路由 —— 用契约里的错误形状,而不是 Hono 的默认 404 文本。
  // 这里 throw 而非直接返回,是为了让它和其它错误走同一个 onError 出口。
  app.notFound(() => {
    throw notFound('endpoint')
  })

  return app
}
