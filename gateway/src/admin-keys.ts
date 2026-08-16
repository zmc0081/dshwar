/**
 * Admin API Key 的解析契约。
 *
 * ⚠️ **Admin Key 按租户签发,一把钥匙不得横跨租户**(CLAUDE.md 第七节)。
 * 这不是配置偏好:一把横跨租户的运维钥匙泄漏,爆炸半径就是全部客户;
 * 按租户签发时,半径是一个客户。
 *
 * 本模块只定义**解析**契约与内存实现。真正的签发、轮换、吊销属于控制平面
 * (V0.5.0),网关只负责「拿一把 key 换出它能操作哪个租户」。
 *
 * @module @dshwar/gateway/admin-keys
 */

/** 一把 Admin Key 代表的权限。 */
export interface AdminIdentity {
  /** 这把钥匙能操作的租户。**单个** —— 不是数组,横跨租户在类型层就写不出来。 */
  readonly tenantId: string
  /** 便于审计的标签(签发给谁、用途)。 */
  readonly label: string
}

/**
 * Admin Key 解析器。
 *
 * 实现者可接控制平面的数据库、Vault、KMS。网关不关心 key 怎么存,
 * 只关心「这把 key 属于哪个租户」。
 */
export interface AdminKeyResolver {
  /**
   * 解析一把 Admin Key。
   *
   * @param key 请求头里的原始 key
   * @returns 该 key 的身份;无效则 `undefined`
   */
  resolve(key: string): Promise<AdminIdentity | undefined>
}

/**
 * 内存实现,**仅供开发与测试**。
 *
 * key 是明文配置,与 `@dshwar/auth-static` 同理:让 `pnpm dev` 零外部依赖跑起来,
 * 并作为契约测试的 fixture。**禁止部署。**
 */
export class InMemoryAdminKeyResolver implements AdminKeyResolver {
  private readonly byKey: ReadonlyMap<string, AdminIdentity>

  constructor(entries: readonly { key: string; tenantId: string; label: string }[]) {
    const map = new Map<string, AdminIdentity>()
    for (const entry of entries) {
      if (entry.key.length === 0) throw new Error('gateway: admin key 不得为空')
      if (map.has(entry.key)) {
        // 静默覆盖会让「这把 key 怎么操作到了别的租户」变成查半天的谜
        throw new Error(`gateway: admin key 重复声明(${JSON.stringify(entry.label)})`)
      }
      map.set(entry.key, { tenantId: entry.tenantId, label: entry.label })
    }
    this.byKey = map
  }

  async resolve(key: string): Promise<AdminIdentity | undefined> {
    return this.byKey.get(key)
  }
}
