/**
 * 中间件:requestId、错误边界、两种鉴权。
 *
 * ⚠️ **两种鉴权在中间件层就分开,不在 handler 里判断**(任务书 R4)。
 * 理由:handler 里判断意味着每个 handler 都要记得判断,而漏掉一个的后果是
 * 运维的 Admin Key 能冒充用户发起会话 —— 这种漏洞在评审里极难看出来,
 * 因为它表现为「少写了一行」而不是「多写了一行错的」。
 *
 * @module @dshwar/gateway/middleware
 */
import { AuthError } from '@dshwar/auth'
import type { Principal } from '@dshwar/principal'
import { runWithPrincipal } from '@dshwar/principal'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { Context as HonoContext, MiddlewareHandler } from 'hono'
import type { AdminIdentity, AdminKeyResolver } from './admin-keys.ts'
import type { ScimIdentity, ScimTokenResolver } from './scim-keys.ts'
import { ApiError, renderError, unauthorized } from './errors.ts'

/** Admin Key 的请求头名。与契约里的 securityScheme 一致。 */
export const ADMIN_KEY_HEADER = 'x-dshwar-admin-key'

/** Hono 上下文里挂的东西。 */
export interface GatewayVariables {
  requestId: string
  /** 运行时端点:已认证的主体。 */
  principal?: Principal
  /** 运行时端点:绑定了该主体的会话作用域上下文。 */
  scopedCtx?: CordisContext
  /** Admin 端点:这把 key 的身份。 */
  admin?: AdminIdentity
  /** SCIM 端点:这把 token 绑定的身份源。 */
  scim?: ScimIdentity
}

export type GatewayEnv = { Variables: GatewayVariables }

/** 每个请求一个 id,贯穿响应体、日志、审计。 */
export function requestIdMiddleware(): MiddlewareHandler<GatewayEnv> {
  return async (c, next) => {
    const requestId = crypto.randomUUID()
    c.set('requestId', requestId)
    c.header('x-request-id', requestId)
    await next()
  }
}

/**
 * 错误边界 —— 任何 handler 抛出的东西都在这里变成契约里的 `ErrorResponse`。
 *
 * ⚠️ **必须挂在 `app.onError()`,不能写成中间件。** Hono 的 `compose` 内部
 * 自己 try/catch 并把异常路由到 `onError`,异常**不会**传回中间件的
 * `await next()` —— 写成中间件的话 catch 永远不触发,所有错误都退化成
 * Hono 默认的 500 纯文本,而契约里的统一错误形状就此失效。
 *
 * 这一条是实测出来的:第一版写成中间件,11 条测试全红且症状是
 * 「响应体不是 JSON」。
 */
export function errorHandler(): (error: Error, c: HonoContext<GatewayEnv>) => Response {
  return (error, c) => renderError(c, error, c.get('requestId'))
}

function bearerToken(c: HonoContext): string | undefined {
  const header = c.req.header('authorization')
  if (header === undefined) return undefined
  const match = /^Bearer (.+)$/i.exec(header.trim())
  return match?.[1]
}

/**
 * 运行时鉴权 + 会话路由 —— **本 Session 的核心**。
 *
 * ```
 * Bearer token → ctx.auth.verify() → Principal → runWithPrincipal → handler
 * ```
 *
 * 此下所有插件按 principal 解析,消费方零改动。
 *
 * ⚠️ **用 `runWithPrincipal` 而不是 `withPrincipal`。** V0.1.0 实测:
 * `withPrincipal` 每次调用在 `ctx.reflect.store` 留下一个隔离槽位,200 次调用
 * 积累 200 个。网关是长命进程、按请求派生 —— 用错这个函数,内存会随请求数
 * 线性增长,而且不会报任何错。
 *
 * ⚠️ **`AuthError` 原样传递「不携带原因」的语义。** 认证失败一律 401 +
 * 固定消息,不区分 token 不存在 / 已过期 / 租户不匹配。
 */
export function runtimeAuth(rootCtx: CordisContext): MiddlewareHandler<GatewayEnv> {
  return async (c, next) => {
    // Admin Key 不能走运行时端点。中间件层就挡住,不留给 handler。
    if (c.req.header(ADMIN_KEY_HEADER) !== undefined) {
      throw unauthorized()
    }

    const token = bearerToken(c)
    if (token === undefined) throw unauthorized()

    let principal: Principal
    try {
      principal = await rootCtx.auth.verify(token)
    } catch (error) {
      // AuthError 与任何其它验证失败一视同仁 —— 区分它们等于给攻击者探针
      if (error instanceof AuthError) throw unauthorized()
      throw error
    }

    c.set('principal', principal)

    // 会话作用域只在本次请求内存活,回调结束即释放
    await runWithPrincipal(rootCtx, principal, async (scopedCtx) => {
      c.set('scopedCtx', scopedCtx)
      await next()
    })
    return undefined
  }
}

/**
 * Admin 鉴权。
 *
 * ⚠️ **Bearer token 不能走 Admin 端点**,反向亦然。两种令牌的用途不同:
 * 供给系统只能写身份镜像,不能读用量与凭据配置;运维的 Admin Key 不能冒充用户
 * 发起会话。混用会让「一把钥匙的爆炸半径」变得不可预测。
 */
export function adminAuth(resolver: AdminKeyResolver): MiddlewareHandler<GatewayEnv> {
  return async (c, next) => {
    // 运行时 token 不能走 Admin 端点
    if (bearerToken(c) !== undefined) throw unauthorized()

    const key = c.req.header(ADMIN_KEY_HEADER)
    if (key === undefined) throw unauthorized()

    const admin = await resolver.resolve(key)
    if (admin === undefined) throw unauthorized()

    c.set('admin', admin)
    await next()
    return undefined
  }
}

/**
 * SCIM 鉴权 —— 三类令牌里的第三类。
 *
 * ⚠️ **SCIM token 只能进 `/scim/` 前缀,且只对它绑定的那个身份源有效。**
 * 它配在**外部**供给系统里(authentik / Entra 的界面上),暴露面比 Admin Key
 * 大得多 —— 泄漏一把 SCIM token 的爆炸半径必须止步于「一个身份源的镜像被改」。
 *
 * 认证失败返回 **SCIM 自己的错误格式**而不是契约的 ErrorResponse:
 * 读这个响应的是 Entra / Okta / authentik 的同步引擎,它们只认 RFC 7644 §3.12。
 *
 * @param resolver token → 身份源
 * @param mountedSource 本挂载点服务的身份源;token 属于别的源一样 401
 */
export function scimAuth(
  resolver: ScimTokenResolver,
  mountedSource: string,
): MiddlewareHandler<GatewayEnv> {
  const scim401 = (c: HonoContext<GatewayEnv>): Response =>
    c.json(
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '401',
        detail: 'authentication failed',
      },
      401,
    )

  return async (c, next) => {
    // Admin Key 不能写身份镜像 —— 分离签发的意义就在这里
    if (c.req.header(ADMIN_KEY_HEADER) !== undefined) return scim401(c)

    const token = bearerToken(c)
    if (token === undefined) return scim401(c)

    const identity = await resolver.resolve(token)
    // token 无效,或属于另一个身份源 —— 两者同一个响应,不区分(预言机防护同款理由)
    if (identity === undefined || identity.source !== mountedSource) return scim401(c)

    c.set('scim', identity)
    await next()
    return undefined
  }
}

/**
 * 断言当前 Admin Key 能操作某个租户。
 *
 * 一把钥匙不得横跨租户 —— 这是那条规则在 handler 里的落点。
 * 返回 403 而非 404:调用方是运维,知道「有这么个租户但你无权」比
 * 「查无此物」更有助于排查配置错误,且运维不是攻击面的主要来源。
 *
 * @throws {ApiError} 该 key 不属于目标租户
 */
export function assertTenant(admin: AdminIdentity, tenantId: string): void {
  if (admin.tenantId !== tenantId) {
    throw new ApiError('forbidden', 'admin key does not cover the target tenant')
  }
}
