/**
 * `@dshwar/principal` —— principal 传播。
 *
 * DSHWAR 引入的**唯一**新概念。其余所有包(`auth` / `credentials-multiuser` /
 * `fs-tenant` / `storage-scoped`)都是上游已有契约的替代实现;只有「这次操作是谁
 * 发起的」这个问题在单用户的上游运行时里不存在,因而必须由 DSHWAR 定义。
 *
 * ## 用法
 *
 * ```ts
 * import { Context } from '@deepseek-ai/cordis'
 * import { PrincipalService, createPrincipal, withPrincipal } from '@dshwar/principal'
 *
 * const ctx = new Context()
 * await ctx.plugin(PrincipalService)          // 根上下文加载一次
 *
 * ctx.principal.current()                      // → ANONYMOUS
 *
 * const alice = createPrincipal({ id: 'e6f1…', tenantId: 'acme' })
 * const sessionCtx = withPrincipal(ctx, alice)
 * sessionCtx.principal.current()               // → alice
 * ```
 *
 * ## 边界
 *
 * 本包**只做传播**,不做认证。「token 换 principal」属于 `@dshwar/auth`
 * (Session 3);DSHWAR 是身份消费者,不存密码、不签发身份令牌、不实现注册流程
 * (CLAUDE.md 硬规则 4)。
 *
 * @module @dshwar/principal
 */

export {
  ANONYMOUS,
  createPrincipal,
  InvalidPrincipalError,
  isAnonymousPrincipal,
  type Principal,
  type PrincipalInit,
} from './principal.ts'

export { PRINCIPAL_BINDING, PrincipalService, runWithPrincipal, withPrincipal } from './service.ts'
