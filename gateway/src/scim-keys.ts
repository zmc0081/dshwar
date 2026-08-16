/**
 * SCIM token 的解析契约。
 *
 * ⚠️ **SCIM 令牌与 Admin 令牌分离签发**(CLAUDE.md 第七节):供给系统只能写
 * 身份镜像,不能读用量与凭据配置。这不是过度设计 —— SCIM token 配在**外部**
 * 供给系统里(authentik / Entra 的界面上),它的暴露面比 Admin Key 大得多:
 * 泄漏一把 SCIM token 的爆炸半径必须止步于「身份镜像被改」,不能波及凭据与账单。
 *
 * 一把 token 绑**一个身份源**:B 家的 token 不得写 A 家推来的记录。
 *
 * @module @dshwar/gateway/scim-keys
 */

/** 一把 SCIM token 代表的身份。 */
export interface ScimIdentity {
  /** 这把 token 能写哪个身份源的镜像。**单个** —— 跨源在类型层就写不出来。 */
  readonly source: string
  /** 便于审计的标签。 */
  readonly label: string
}

/** SCIM token 解析器。与 AdminKeyResolver 同构,但**刻意不复用同一个接口**:
 * 复用意味着一把钥匙可以同时出现在两张表里,而分离签发正是要杜绝这件事。 */
export interface ScimTokenResolver {
  /**
   * @param token 请求头里的 Bearer token
   * @returns 该 token 的身份;无效则 `undefined`
   */
  resolve(token: string): Promise<ScimIdentity | undefined>
}

/** 内存实现,仅供开发与测试。与 InMemoryAdminKeyResolver 同款定位。 */
export class InMemoryScimTokenResolver implements ScimTokenResolver {
  private readonly byToken: ReadonlyMap<string, ScimIdentity>

  constructor(entries: readonly { token: string; source: string; label: string }[]) {
    const map = new Map<string, ScimIdentity>()
    for (const entry of entries) {
      if (entry.token.length === 0) throw new Error('gateway: scim token 不得为空')
      if (map.has(entry.token)) {
        throw new Error(`gateway: scim token 重复声明(${JSON.stringify(entry.label)})`)
      }
      map.set(entry.token, { source: entry.source, label: entry.label })
    }
    this.byToken = map
  }

  async resolve(token: string): Promise<ScimIdentity | undefined> {
    return this.byToken.get(token)
  }
}
