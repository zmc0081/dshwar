/**
 * `@dshwar/auth-jwt` —— 用 JWKS 验签的 {@link Auth} 实现。
 *
 * ## 验签通过 ≠ 放行
 *
 * 这是本包最重要的一句话。一个签名有效、尚未过期的 token,仍然可能属于一个
 * **已经被停用**的用户 —— IdP 侧停用不会让已签发的 token 失效,它只是不再签发新的。
 *
 * 所以每次 `verify()` 都要走完三步,缺一不可:
 *
 * ```
 * ① 验签与标准声明(iss / aud / exp / nbf)
 * ② 查 Subject Mirror：不存在或 active:false → 拒绝   ★ V0.3.0 的验收标准
 * ③ 由 tenant-map 裁决租户，不直接信 token 里的租户字段
 * ```
 *
 * 第 ② 步就是「在身份源侧停用后,该用户下一次请求被拒绝」这条验收标准的落点。
 *
 * 第 ③ 步的理由:token 里的 `tenant` 字段是**签发方**说了算的。多 IdP 并存时,
 * B 家的 IdP 可以往自己签的 token 里写 `tenant: acme` —— 租户归属必须由
 * DSHWAR 的映射配置裁决,而不是由 token 自称。
 *
 * ## 为什么用 `jose` 而不是自己写
 *
 * JWT 验签是**不该手写**的那类代码。alg 混淆(把 RS256 换成 HS256,用公钥当
 * HMAC 密钥)、`alg: none`、`crit` 头处理、时钟偏移 —— 每一条都出过真实 CVE。
 * `jose` 是这个生态里被审计得最多的实现。
 *
 * 但用了库**不等于安全**:必须显式把允许的算法钉死(见 {@link JwtAuthConfig.algorithms}),
 * 否则 alg 混淆照样成立。
 *
 * @module @dshwar/auth-jwt
 */
import type { Context } from '@deepseek-ai/cordis'
import { Auth, AuthError } from '@dshwar/auth'
import { createPrincipal, type Principal } from '@dshwar/principal'
import type { SubjectStore } from '@dshwar/subject'
import { resolveTenant, validateConfig, type TenantMapConfig } from '@dshwar/tenant-map'
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'

/**
 * 允许的签名算法。
 *
 * **只允许非对称算法。** HS256 之流用同一把密钥签与验 —— 而 JWKS 分发的是公钥,
 * 一旦允许 HMAC,攻击者就能拿公钥当 HMAC 密钥伪造 token(经典的 alg 混淆)。
 * `alg: none` 同理,jose 本身就不接受,这里再钉一道。
 */
export const ALLOWED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'] as const

export type AllowedAlgorithm = (typeof ALLOWED_ALGORITHMS)[number]

export interface JwtAuthConfig {
  /** 期望的签发方。与 token 的 `iss` 严格相等,不做前缀匹配。 */
  readonly issuer: string
  /** 期望的受众。与 token 的 `aud` 比对。 */
  readonly audience: string
  /** JWKS 端点。 */
  readonly jwksUri: string
  /**
   * 允许的算法。默认 {@link ALLOWED_ALGORITHMS}。
   *
   * 传入对称算法会**直接抛错** —— 那不是配置偏好,是把门锁拆了。
   */
  readonly algorithms?: readonly AllowedAlgorithm[]
  /** 身份镜像。验签通过后在这里查停用态。 */
  readonly subjects: SubjectStore
  /** 租户映射配置。 */
  readonly tenantMap: TenantMapConfig
  /** 这个 IdP 在 Subject Mirror 里的 `source` 标识。 */
  readonly source: string
  /**
   * 时钟容差(秒)。默认 30。
   *
   * 不是「越大越宽容越好」:容差是攻击者可用的过期窗口。30 秒足够覆盖正常的
   * NTP 漂移,再大就该去修时钟同步而不是调这个值。
   */
  readonly clockToleranceSec?: number
  /** JWKS 缓存最长存活(毫秒)。默认 10 分钟。 */
  readonly jwksCacheMaxAgeMs?: number
  /**
   * 诊断回调。
   *
   * `AuthError` 刻意不携带原因(见 `@dshwar/auth` 的说明)—— 但运维需要知道
   * 「为什么失败」。详细原因走这条路:朝内、可详尽;错误对象朝外、必须沉默。
   */
  readonly onFailure?: (detail: string) => void
}

/** 从 payload 里安全取一个字符串 claim。非字符串一律当作不存在,不做隐式转换。 */
function stringClaim(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** 取组名数组。非数组或含非字符串项时只保留字符串项。 */
function stringArrayClaim(payload: JWTPayload, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

/**
 * JWKS 验签的认证实现。
 *
 * ```ts
 * await ctx.plugin(JwtAuth, {
 *   issuer: 'https://idp.acme.example',
 *   audience: 'dshwar',
 *   jwksUri: 'https://idp.acme.example/jwks',
 *   source: 'acme-idp',
 *   subjects: subjectStore,
 *   tenantMap: { strategy: 'claim', claim: 'org_id' },
 * })
 * ```
 */
export class JwtAuth extends Auth {
  private readonly config: JwtAuthConfig
  private readonly algorithms: readonly AllowedAlgorithm[]
  private readonly getKey: JWTVerifyGetKey

  constructor(ctx: Context, config: JwtAuthConfig) {
    super(ctx)
    this.config = config
    this.algorithms = config.algorithms ?? ALLOWED_ALGORITHMS

    // 配置错误在**启动时**炸,不要等第一个用户登录
    if (this.algorithms.length === 0) {
      throw new Error('auth-jwt: algorithms 不得为空 —— 空列表等于不校验算法')
    }
    for (const alg of this.algorithms) {
      if (!ALLOWED_ALGORITHMS.includes(alg)) {
        throw new Error(
          `auth-jwt: 不允许的算法 ${JSON.stringify(alg)}。` +
            '只接受非对称算法 —— JWKS 分发的是公钥,允许 HMAC 等于让攻击者拿公钥伪造 token。',
        )
      }
    }
    validateConfig(config.tenantMap)

    this.getKey = createRemoteJWKSet(new URL(config.jwksUri), {
      // kid 未命中时刷新一次;刷新仍未命中即拒绝。
      // 不设冷却的话,一串伪造 kid 的请求就是一台对着 IdP 的放大器。
      cooldownDuration: 30_000,
      cacheMaxAge: config.jwksCacheMaxAgeMs ?? 600_000,
    })
  }

  /** 记录详细原因后抛出不含原因的错误。两条路径必须分开。 */
  private fail(detail: string): never {
    this.config.onFailure?.(detail)
    throw new AuthError()
  }

  /**
   * 验证一个 JWT 并映射为主体。
   *
   * @param token 紧凑序列化的 JWT
   * @returns 该 token 对应的主体
   * @throws {AuthError} 任何一步失败。**不含原因** —— 认证接口是预言机
   */
  override async verify(token: string): Promise<Principal> {
    // ---- ① 验签与标准声明 ----
    let payload: JWTPayload
    try {
      const result = await jwtVerify(token, this.getKey, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: [...this.algorithms],
        clockTolerance: this.config.clockToleranceSec ?? 30,
      })
      payload = result.payload
    } catch (error) {
      return this.fail(`jwt 验签或标准声明校验失败:${(error as Error).message}`)
    }

    const externalId = stringClaim(payload, 'sub')
    if (externalId === undefined) {
      // 没有 sub 的 token 无法定位到任何人。这通常意味着 IdP 配错了。
      return this.fail('jwt 缺少 sub —— 无法定位主体')
    }

    // ---- ② Subject Mirror:停用的用户拿着有效 token 也进不来 ----
    const subject = await this.config.subjects.getByExternalId(this.config.source, externalId)
    if (subject === undefined) {
      // 签名有效但镜像里没有 —— 说明这个人从没被供给过来,或者供给失败了。
      // 放行会让一个 DSHWAR 完全不认识的人拿到工作区。
      return this.fail(
        `jwt sub=${externalId} 在 Subject Mirror 里不存在(source=${this.config.source})`,
      )
    }
    if (!subject.active) {
      // ★ 这就是 V0.3.0 的验收标准
      return this.fail(`jwt sub=${externalId} 已被停用`)
    }

    // ---- ③ 租户由映射裁决,不信 token 自称 ----
    let tenantId: string
    try {
      tenantId = resolveTenant(
        {
          claims: payload as Record<string, unknown>,
          groups: [...subject.groups, ...stringArrayClaim(payload, 'groups')],
          issuer: this.config.issuer,
        },
        this.config.tenantMap,
      )
    } catch (error) {
      return this.fail(`租户映射失败:${(error as Error).message}`)
    }

    // 镜像里的租户与本次裁决不一致,说明供给与认证两条路对同一个人给出了不同归属。
    // 放行任何一边都是猜 —— 而猜错的后果是跨租户可见。
    if (subject.tenantId !== tenantId) {
      return this.fail(
        `租户归属冲突:镜像=${subject.tenantId},本次裁决=${tenantId}。` +
          '两条路径对同一个人给出不同归属,拒绝而不是选一边。',
      )
    }

    return createPrincipal({
      id: subject.id,
      tenantId,
      roles: stringArrayClaim(payload, 'roles'),
      claims: { sub: externalId, userName: subject.userName },
    })
  }
}

export default JwtAuth
