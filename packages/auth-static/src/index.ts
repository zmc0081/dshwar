/**
 * `@dshwar/auth-static` —— 配置声明的 token → principal 映射。
 *
 * ## 🚫 禁止部署
 *
 * token 是**明文配置**。它存在的意义只有两个:
 *
 * 1. 让 `git clone && pnpm dev` 零外部依赖就能跑通 —— 这是新贡献者的第一印象。
 *    要求别人先架一套 Keycloak 才能看到项目跑起来,大多数人会直接关掉标签页。
 * 2. 当全部契约测试的 fixture —— 测试需要一个行为完全确定、不依赖网络、
 *    不需要时钟的认证实现。
 *
 * 生产请用 `@dshwar/auth-jwt` 或 `@dshwar/auth-oidc`(V0.3.0)。
 *
 * @module @dshwar/auth-static
 */
import type { Context } from '@deepseek-ai/cordis'
import { Auth, AuthError } from '@dshwar/auth'
import { createPrincipal, isAnonymousPrincipal, type Principal } from '@dshwar/principal'

/** 一条静态映射:token 明文 → 该 token 代表的主体。 */
export interface StaticAuthEntry {
  /** 凭证明文。 */
  readonly token: string
  /** 该凭证映射到的主体标识(IdP 不可变主键的替身)。 */
  readonly id: string
  /** 该主体所属租户。 */
  readonly tenantId: string
  /** 角色标签,省略即空。 */
  readonly roles?: readonly string[]
  /** 附加断言,省略即空。 */
  readonly claims?: Readonly<Record<string, unknown>>
}

/** {@link StaticAuth} 的配置。 */
export interface StaticAuthConfig {
  /** token → principal 映射表。 */
  readonly entries: readonly StaticAuthEntry[]
  /**
   * 抑制构造时的「禁止部署」警告。
   *
   * **仅供测试使用。** 契约测试会构造成百上千次 `StaticAuth`,每次都打一行警告
   * 会把真正的测试失败淹掉。生产代码里出现这个选项即是事故 ——
   * 它的唯一作用就是让那行警告消失,而那行警告是这个包唯一的安全网。
   */
  readonly quiet?: boolean
}

/**
 * 静态认证实现。
 *
 * ```ts
 * await ctx.plugin(StaticAuth, {
 *   entries: [
 *     { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] },
 *     { token: 'dev-bob', id: 'bob-a2b3', tenantId: 'globex' },
 *   ],
 * })
 *
 * await ctx.auth.verify('dev-alice') // → alice
 * await ctx.auth.verify('nope')      // → 抛 AuthError
 * ```
 *
 * ⚠️ 本类**刻意不使用** ECMAScript `#private` 字段:cordis 通过 Proxy 包装服务
 * 以重绑 `this.ctx`,`#private` 在 wrapper 上必抛 `TypeError`。
 * 见 `docs/FEASIBILITY-REPORT.md` §4.1。
 */
export class StaticAuth extends Auth {
  /** token → 已构造并冻结的 principal。构造时一次性建好,verify 只做查表。 */
  private readonly byToken: ReadonlyMap<string, Principal>

  constructor(ctx: Context, config: StaticAuthConfig) {
    super(ctx)

    const byToken = new Map<string, Principal>()
    for (const entry of config.entries) {
      if (entry.token.length === 0) {
        throw new Error('auth-static: token 不得为空')
      }
      if (byToken.has(entry.token)) {
        // 静默覆盖会让「我明明配了 alice,怎么登进去是 bob」变成一个查半天的谜
        throw new Error(`auth-static: token 重复声明(${JSON.stringify(entry.token)})`)
      }

      // 走 createPrincipal 而非对象字面量:邮箱形状的 id、路径分隔符、首尾空白
      // 都会在这里被拒。配置里写错的东西,要在启动时炸,不要在半年后炸。
      const principal = createPrincipal({
        id: entry.id,
        tenantId: entry.tenantId,
        ...(entry.roles === undefined ? {} : { roles: entry.roles }),
        ...(entry.claims === undefined ? {} : { claims: entry.claims }),
      })

      // 「认证成功」与「匿名」互斥。若配置把某个 token 映射到匿名,
      // 症状会是「登录成功但什么都读不到」—— 下游 fail closed 了,
      // 但错误现场离根因隔了十万八千里。在这里炸掉。
      if (isAnonymousPrincipal(principal)) {
        throw new Error(
          `auth-static: token ${JSON.stringify(entry.token)} 映射到了匿名主体。` +
            '认证成功与匿名互斥 —— 匿名意味着没有身份,不能作为验证结果。',
        )
      }

      byToken.set(entry.token, principal)
    }

    this.byToken = byToken

    if (config.quiet !== true) {
      this.ctx.logger.warn(
        'auth-static: token 是明文配置,禁止部署到任何可被外部访问的环境。' +
          '它的用途只有两个:本地开发零依赖启动,以及作为契约测试的 fixture。' +
          '生产请用 @dshwar/auth-jwt 或 @dshwar/auth-oidc。',
      )
    }
  }

  /**
   * 查表验证。
   *
   * 未知 token 抛 {@link AuthError} —— 不区分「不存在」与任何其它原因,
   * 契约如此(见 `@dshwar/auth` 的 `AuthError` 文档)。
   *
   * @param token 凭证明文
   * @returns 该凭证映射到的主体
   * @throws {AuthError} token 未在配置中声明
   */
  async verify(token: string): Promise<Principal> {
    const principal = this.byToken.get(token)
    if (principal === undefined) {
      // 详细原因进日志,不进错误对象:运维需要知道,调用方不需要。
      this.ctx.logger.debug('auth-static: 未知 token,拒绝')
      throw new AuthError()
    }
    return principal
  }
}

export default StaticAuth
