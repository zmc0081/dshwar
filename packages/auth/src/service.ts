import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Principal } from '@dshwar/principal'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 认证服务:token → Principal。见 {@link Auth}。 */
    auth: Auth
  }
}

/**
 * 认证契约,注册为 `ctx.auth`。
 *
 * ## 契约边界 —— 本包**只做验证与映射**
 *
 * `Auth` 的职责恰好是一句话:**拿一个已经存在的凭证,换出一个 {@link Principal}**。
 *
 * 它**永不**做以下三件事(CLAUDE.md 硬规则 4):
 *
 * | 不做 | 谁做 |
 * |---|---|
 * | 存储密码 | 身份提供方(Keycloak / Casdoor / Authentik / Entra …) |
 * | 签发身份令牌 | 同上 |
 * | 实现注册与找回流程 | 同上 |
 *
 * **这条边界决定了 DSHWAR 与 Keycloak 之流是集成关系而非竞争关系。**
 *
 * 这不是为了少写代码。身份提供方是一个需要长期投入安全响应的品类:密码哈希
 * 参数要跟着算力演进、MFA 要跟标准、账号恢复流程是社会工程学的主战场、
 * 合规认证(SOC2 / 等保)要按年过。一个做租户治理的产品顺手做 IdP,等于给自己
 * 领了一份永久的安全责任,而客户的安全团队会立刻问「你们的密码策略过审了吗」——
 * 那时唯一正确的答案是「我们不存密码」。
 *
 * 采购方那边这条边界也是加分项:企业已经有 IdP,他们要的是**接进去**,
 * 不是再来一套用户名密码。
 *
 * ## 实现方
 *
 * | 包 | 场景 | 版本 |
 * |---|---|---|
 * | `@dshwar/auth-static` | 开发与测试,零外部依赖 | V0.1.0 |
 * | `@dshwar/auth-jwt` | 自签 JWT / JWKS | V0.3.0 |
 * | `@dshwar/auth-oidc` | Keycloak / Authentik / Logto / Auth0 | V0.3.0 |
 */
export abstract class Auth extends Service {
  constructor(ctx: Context) {
    super(ctx, 'auth')
  }

  /**
   * 验证一个凭证并映射为主体。
   *
   * ⚠️ **失败一律抛 `AuthError`,且该错误不携带任何原因。** 实现方不得抛出
   * 区分「不存在」/「已过期」/「租户不匹配」的错误 —— 认证接口是预言机,
   * 区分失败原因等于给攻击者一支探针。详细原因写日志与审计,不进错误对象。
   *
   * ⚠️ **实现方必须自己保证不返回匿名主体。** 「认证成功」与「匿名」是互斥的:
   * 前者意味着确认了身份,后者意味着没有身份。若某个 token 映射到匿名,
   * 那是配置错误,应当抛错而不是返回一个会被下游 fail closed 掉的主体 ——
   * 后者的症状是「登录成功但什么都读不到」,排查成本极高。
   *
   * ⚠️ **不要缓存返回的 principal 并跨操作复用。** 主体的有效性会变化
   * (IdP 侧停用、角色调整、租户迁移),而上游 `dsh-credentials` 的契约明文要求
   * 凭据每次操作重新解析;principal 是那次解析的输入。缓存它等于把一个
   * 已被停用的用户继续放行。
   *
   * @param token 凭证。形状由实现方决定(静态 token / JWT / opaque token),
   *   本契约不做任何格式假设
   * @returns 该凭证对应的主体
   * @throws {AuthError} 验证失败。不含原因,调用方不得分支处理
   */
  abstract verify(token: string): Promise<Principal>
}
