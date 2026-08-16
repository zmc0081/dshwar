/**
 * `@dshwar/auth-oidc` —— 让部署方**只填一个 issuer URL** 就能接上。
 *
 * ## 它不重复实现验签
 *
 * 本包只做一件事:把 OIDC 的 discovery 文档解析成 `@dshwar/auth-jwt` 需要的配置,
 * 然后把验签整个交给它。
 *
 * 这条边界值得写下来,因为反过来做很诱人:在这里再写一遍验签,"顺便"支持一些
 * discovery 里没有的东西。那样会有**两处**验签逻辑,而其中一处迟早落后于另一处 ——
 * 落后的那一处就是漏洞。验签只允许有一个实现。
 *
 * ## discovery 缺字段时立刻报错
 *
 * 不做「先跑起来,用到时再说」。IdP 的 discovery 文档缺 `jwks_uri`,意味着这套
 * 配置永远无法验签 —— 在启动时说清楚,比在第一个用户登录时抛一个绕了三层的错误
 * 有用得多。
 *
 * @module @dshwar/auth-oidc
 */
import type { Context } from '@deepseek-ai/cordis'
import { JwtAuth, type AllowedAlgorithm, type JwtAuthConfig } from '@dshwar/auth-jwt'
import type { SubjectStore } from '@dshwar/subject'
import type { TenantMapConfig } from '@dshwar/tenant-map'

/** OIDC discovery 文档里我们真正用到的字段。 */
export interface OidcDiscovery {
  readonly issuer: string
  readonly jwks_uri: string
  readonly id_token_signing_alg_values_supported?: readonly string[]
}

/** discovery 拉取或解析失败。这是**配置问题**,不是某个用户的问题 —— 所以不是 AuthError。 */
export class OidcDiscoveryError extends Error {
  override readonly name = 'OidcDiscoveryError'
  constructor(message: string) {
    super(message)
  }
}

export interface OidcAuthConfig {
  /** IdP 的 issuer URL,例如 `https://idp.acme.example/realms/acme`。 */
  readonly issuer: string
  readonly audience: string
  readonly source: string
  readonly subjects: SubjectStore
  readonly tenantMap: TenantMapConfig
  /** 覆盖允许的算法。默认取 discovery 声明的与 auth-jwt 允许的**交集**。 */
  readonly algorithms?: readonly AllowedAlgorithm[]
  readonly clockToleranceSec?: number
  readonly onFailure?: (detail: string) => void
  /** 自定义 fetch。测试注入,生产不传。 */
  readonly fetch?: typeof globalThis.fetch
}

/** discovery 端点的标准路径(OpenID Connect Discovery 1.0 §4)。 */
export function discoveryUrl(issuer: string): string {
  // issuer 末尾有没有斜杠都要能用 —— 各家 IdP 的写法不一致,而这不该是部署方的负担
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

function requireString(doc: Record<string, unknown>, field: string, url: string): string {
  const value = doc[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OidcDiscoveryError(
      `auth-oidc: discovery 文档缺少 ${field}(${url})。` +
        '缺它意味着这套配置永远无法验签 —— 现在报错,比第一个用户登录时才炸有用。',
    )
  }
  return value.trim()
}

/**
 * 拉取并校验 discovery 文档。
 *
 * @param issuer IdP 的 issuer URL
 * @param fetchImpl 自定义 fetch
 * @throws {OidcDiscoveryError} 拉不到、不是 JSON、或缺必需字段
 */
export async function fetchDiscovery(
  issuer: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<OidcDiscovery> {
  const url = discoveryUrl(issuer)

  let response: Response
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' } })
  } catch (cause) {
    throw new OidcDiscoveryError(`auth-oidc: 拉取 discovery 失败(${url}):${String(cause)}`)
  }
  if (!response.ok) {
    throw new OidcDiscoveryError(`auth-oidc: discovery 返回 HTTP ${response.status}(${url})`)
  }

  let doc: Record<string, unknown>
  try {
    doc = (await response.json()) as Record<string, unknown>
  } catch (cause) {
    throw new OidcDiscoveryError(`auth-oidc: discovery 不是合法 JSON(${url}):${String(cause)}`)
  }

  const declaredIssuer = requireString(doc, 'issuer', url)
  const jwksUri = requireString(doc, 'jwks_uri', url)

  // OIDC Discovery 1.0 §4.3 要求 discovery 里的 issuer 必须与请求它的 issuer 完全一致。
  // 不一致意味着要么配错了 URL，要么中间有人换掉了文档 —— 两种都不该继续。
  if (declaredIssuer !== issuer.replace(/\/+$/, '') && declaredIssuer !== issuer) {
    throw new OidcDiscoveryError(
      `auth-oidc: discovery 声明的 issuer(${declaredIssuer})与配置的(${issuer})不一致。` +
        'OIDC Discovery 1.0 §4.3 要求两者完全相同。',
    )
  }

  const algs = doc['id_token_signing_alg_values_supported']
  return {
    issuer: declaredIssuer,
    jwks_uri: jwksUri,
    ...(Array.isArray(algs)
      ? {
          id_token_signing_alg_values_supported: algs.filter(
            (a): a is string => typeof a === 'string',
          ),
        }
      : {}),
  }
}

/** auth-jwt 认得的非对称算法。与它的 ALLOWED_ALGORITHMS 保持一致。 */
const ASYMMETRIC = new Set(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'])

/**
 * 由 discovery 文档推导出 `auth-jwt` 的配置。
 *
 * 算法取 **discovery 声明的 ∩ 我们允许的**。IdP 声明支持 HS256 是它的事,
 * 我们不会因此接受它 —— 交集只会变小,不会因为对方声明而变大。
 */
export function toJwtConfig(discovery: OidcDiscovery, config: OidcAuthConfig): JwtAuthConfig {
  const declared = discovery.id_token_signing_alg_values_supported
  const negotiated =
    config.algorithms ??
    (declared === undefined
      ? undefined
      : (declared.filter((a) => ASYMMETRIC.has(a)) as AllowedAlgorithm[]))

  if (negotiated !== undefined && negotiated.length === 0) {
    throw new OidcDiscoveryError(
      `auth-oidc: IdP 声明的签名算法(${declared?.join(', ') ?? '无'})里没有任何非对称算法。` +
        'DSHWAR 不接受对称算法 —— JWKS 分发的是公钥,允许 HMAC 等于让攻击者拿公钥伪造 token。',
    )
  }

  return {
    issuer: discovery.issuer,
    audience: config.audience,
    jwksUri: discovery.jwks_uri,
    source: config.source,
    subjects: config.subjects,
    tenantMap: config.tenantMap,
    ...(negotiated === undefined ? {} : { algorithms: negotiated }),
    ...(config.clockToleranceSec === undefined
      ? {}
      : { clockToleranceSec: config.clockToleranceSec }),
    ...(config.onFailure === undefined ? {} : { onFailure: config.onFailure }),
  }
}

/**
 * 从一个 issuer URL 建出可用的认证实现。
 *
 * discovery 在**这里**拉一次,而不是每次 verify 都拉 —— 它是配置,不是每请求数据。
 * IdP 换 jwks_uri 时需要重启进程,这是刻意的:静默跟随一个变化的 jwks_uri
 * 意味着攻击者只要能改 discovery 就能换掉验签密钥。
 *
 * @throws {OidcDiscoveryError} discovery 不可用或不合法
 */
export async function createOidcAuth(ctx: Context, config: OidcAuthConfig): Promise<JwtAuth> {
  const discovery = await fetchDiscovery(config.issuer, config.fetch ?? globalThis.fetch)
  return new JwtAuth(ctx, toJwtConfig(discovery, config))
}
