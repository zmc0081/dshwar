/**
 * `@dshwar/tenant-map` —— 从身份源的字段裁决「这个用户属于哪个租户」。
 *
 * ## 为什么这是必须先解决的坑
 *
 * 外部系统的用户模型通常是**扁平单租户**的:WordPress 没有租户概念,若依有部门
 * 但没有租户,SCIM 的 `Group` 语义是组不是租户。把这些映射到 DSHWAR 的租户,
 * 必须有**显式规则**,不能靠猜(`IDENTITY-INTEROP.md` §5)。
 *
 * ## 这里的每一次「拒绝」都是安全行为
 *
 * CLAUDE.md 硬规则 7:**fallback 默认 `reject`**。一个映射不出租户的用户,
 * 宁可拒绝登录,也不能落进默认租户 —— 那会让 A 公司的人看到 B 公司的工作区。
 *
 * 同理,歧义(比如用户命中两个 `tenant:` 组)一律**拒绝**,而不是取第一个:
 * 取第一个意味着组的顺序变了归属就变了,而组的顺序没有任何人在维护。
 *
 * @module @dshwar/tenant-map
 */

/** 映射策略。 */
export type TenantStrategy = 'claim' | 'group' | 'issuer' | 'fixed'

/** 映射不出租户时怎么办。 */
export type TenantFallback =
  { readonly kind: 'reject' } | { readonly kind: 'fixed'; readonly tenantId: string }

/** 供裁决用的身份材料。由 auth-oidc / scim-server 各自填。 */
export interface TenantSubjectFacts {
  /** OIDC token 的 claims,或 SCIM 载荷的顶层字段。 */
  readonly claims?: Readonly<Record<string, unknown>>
  /** 用户所属的组名。 */
  readonly groups?: readonly string[]
  /** 身份源标识(OIDC 的 `iss`,或 SCIM token 绑定的 source)。 */
  readonly issuer?: string
}

export interface TenantMapConfig {
  readonly strategy: TenantStrategy
  /** `strategy: 'claim'` 用:取哪个 claim。 */
  readonly claim?: string
  /** `strategy: 'group'` 用:组名前缀,如 `tenant:`。 */
  readonly groupPrefix?: string
  /** `strategy: 'issuer'` 用:issuer → 租户。一个身份源一个租户。 */
  readonly issuers?: Readonly<Record<string, string>>
  /** `strategy: 'fixed'` 用:全部归入这个租户(单租户部署)。 */
  readonly tenantId?: string
  /** 默认 `reject`(硬规则 7)。 */
  readonly fallback?: TenantFallback
}

/** 裁决失败。**不含**任何可能是凭据的内容 —— 错误信息会进日志。 */
export class TenantMappingError extends Error {
  override readonly name = 'TenantMappingError'
  /** 机器可读的失败原因,便于上层区分「配错了」与「这个用户确实不该进来」。 */
  readonly reason: TenantMappingFailure

  constructor(reason: TenantMappingFailure, message: string) {
    super(message)
    this.reason = reason
  }
}

export type TenantMappingFailure =
  /** 配置本身不合法 —— 部署方的问题,不是这个用户的问题。 */
  | 'misconfigured'
  /** 材料里没有能定位租户的东西。 */
  | 'unmapped'
  /** 材料指向多个租户,无法裁决。 */
  | 'ambiguous'

/** 与 principal / subject 一致的禁用字符:租户 id 会变成文件路径与存储前缀。 */
function invalidTenantId(value: string): boolean {
  if (value.trim().length === 0) return true
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    if (code < 0x20 || code === 0x7f) return true
    if (ch === '/' || ch === '\\') return true
  }
  return false
}

function requireTenantId(value: string, where: string): string {
  const trimmed = value.trim()
  if (invalidTenantId(trimmed)) {
    throw new TenantMappingError(
      'misconfigured',
      `tenant-map: ${where} 给出的租户 id 不合法:${JSON.stringify(value)}`,
    )
  }
  return trimmed
}

/**
 * 校验配置。**在启动时调用**,不要等到第一个用户登录才发现配错了。
 *
 * @throws {TenantMappingError} 配置缺少该策略必需的字段
 */
export function validateConfig(config: TenantMapConfig): void {
  const need = (field: keyof TenantMapConfig, hint: string) => {
    if (config[field] === undefined) {
      throw new TenantMappingError(
        'misconfigured',
        `tenant-map: strategy=${config.strategy} 需要配置 ${String(field)} —— ${hint}`,
      )
    }
  }

  switch (config.strategy) {
    case 'claim':
      need('claim', '从哪个 claim 取租户,如 org_id')
      if (config.claim!.trim().length === 0) {
        throw new TenantMappingError('misconfigured', 'tenant-map: claim 名不得为空')
      }
      break
    case 'group':
      need('groupPrefix', '组名前缀,如 tenant:')
      if (config.groupPrefix!.length === 0) {
        // 空前缀会让**每一个**组都被当成租户 —— 用户加进 engineering 组就多一个租户
        throw new TenantMappingError(
          'misconfigured',
          'tenant-map: groupPrefix 不得为空 —— 空前缀会把用户的每个组都当成租户',
        )
      }
      break
    case 'issuer':
      need('issuers', 'issuer → 租户的映射表')
      if (Object.keys(config.issuers!).length === 0) {
        throw new TenantMappingError('misconfigured', 'tenant-map: issuers 映射表不得为空')
      }
      for (const [iss, tenant] of Object.entries(config.issuers!)) {
        requireTenantId(tenant, `issuers[${iss}]`)
      }
      break
    case 'fixed':
      need('tenantId', '单租户部署要归入的那个租户')
      requireTenantId(config.tenantId!, 'tenantId')
      break
  }

  if (config.fallback?.kind === 'fixed') {
    // 这条是安全默认值的显式豁免,必须写出租户名。空字符串等于"落进无名租户"。
    requireTenantId(config.fallback.tenantId, 'fallback.tenantId')
  }
}

/** 从组名里抽租户。返回**去重后**的候选集 —— 同一个租户配在两个组里不算歧义。 */
function tenantsFromGroups(groups: readonly string[], prefix: string): string[] {
  const found = new Set<string>()
  for (const group of groups) {
    if (!group.startsWith(prefix)) continue
    const candidate = group.slice(prefix.length).trim()
    if (candidate.length > 0) found.add(candidate)
  }
  return [...found]
}

/**
 * 裁决一个用户属于哪个租户。
 *
 * @param facts 身份材料
 * @param config 映射配置
 * @returns 租户 id
 * @throws {TenantMappingError} 映射不出、有歧义,或配置不合法
 */
export function resolveTenant(facts: TenantSubjectFacts, config: TenantMapConfig): string {
  validateConfig(config)

  const direct = resolveDirect(facts, config)
  if (direct !== undefined) return direct

  // ---- 走到这里说明没映射出来 ----
  const fallback = config.fallback ?? { kind: 'reject' }
  if (fallback.kind === 'fixed') return requireTenantId(fallback.tenantId, 'fallback.tenantId')

  throw new TenantMappingError(
    'unmapped',
    `tenant-map: 按 strategy=${config.strategy} 无法确定租户,且 fallback=reject。` +
      '拒绝登录是刻意的 —— 落进默认租户意味着 A 公司的人能看到 B 公司的工作区(硬规则 7)。',
  )
}

/** 按策略取租户;取不到返回 `undefined`(交给 fallback),歧义则直接抛。 */
function resolveDirect(facts: TenantSubjectFacts, config: TenantMapConfig): string | undefined {
  switch (config.strategy) {
    case 'fixed':
      return requireTenantId(config.tenantId!, 'tenantId')

    case 'issuer': {
      if (facts.issuer === undefined) return undefined
      const mapped = config.issuers![facts.issuer]
      return mapped === undefined ? undefined : requireTenantId(mapped, 'issuers')
    }

    case 'claim': {
      const raw = facts.claims?.[config.claim!]
      if (raw === undefined || raw === null) return undefined

      // claim 可能是数组(有些 IdP 把单值也发成数组)。多个不同值是歧义。
      const values = (Array.isArray(raw) ? raw : [raw]).filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )
      const unique = [...new Set(values.map((v) => v.trim()))]

      if (unique.length === 0) return undefined
      if (unique.length > 1) {
        throw new TenantMappingError(
          'ambiguous',
          `tenant-map: claim ${JSON.stringify(config.claim)} 给出了多个租户(${unique.length} 个),无法裁决。` +
            '取第一个意味着 claim 的顺序变了归属就变了。',
        )
      }
      return requireTenantId(unique[0]!, `claim ${config.claim}`)
    }

    case 'group': {
      const candidates = tenantsFromGroups(facts.groups ?? [], config.groupPrefix!)
      if (candidates.length === 0) return undefined
      if (candidates.length > 1) {
        throw new TenantMappingError(
          'ambiguous',
          `tenant-map: 用户命中了 ${candidates.length} 个租户组(${candidates.join(', ')}),无法裁决。` +
            '取第一个意味着组的顺序变了归属就变了,而组的顺序没有任何人在维护。',
        )
      }
      return requireTenantId(candidates[0]!, `group ${config.groupPrefix}*`)
    }
  }
}
