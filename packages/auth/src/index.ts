/**
 * `@dshwar/auth` —— 认证契约。
 *
 * 一句话职责:**拿一个已经存在的凭证,换出一个 `Principal`**。
 *
 * DSHWAR 是身份**消费者**,不是提供者:不存密码、不签发身份令牌、不实现注册流程
 * (CLAUDE.md 硬规则 4)。这条边界决定了它与 Keycloak / Casdoor / Authentik
 * 是集成关系而非竞争关系。
 *
 * ```ts
 * const principal = await ctx.auth.verify(bearerToken)
 * const sessionCtx = withPrincipal(ctx, principal)
 * ```
 *
 * 实现方见 `@dshwar/auth-static`(V0.1.0,开发与测试)、
 * `@dshwar/auth-jwt` 与 `@dshwar/auth-oidc`(V0.3.0)。
 *
 * @module @dshwar/auth
 */

export { AuthError } from './error.ts'
export { Auth } from './service.ts'
