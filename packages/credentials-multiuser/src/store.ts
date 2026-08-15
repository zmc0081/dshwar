import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { Principal } from '@dshwar/principal'

/**
 * per-principal 凭据的持久化接口。
 *
 * 刻意只有三个方法。实现者可以是 Postgres、Vault、KMS、云厂商的 Secret Manager ——
 * 本包不假设任何一种,因为「凭据存哪儿」是采用者的合规决定,不是我们的技术选型。
 * 企业客户往往已经有一套密钥托管,再塞一套是负担而不是功能。
 *
 * ## 实现者须知
 *
 * - **键是 `(principal.id, ref)` 两元组**,不是单独的 ref。用单键实现会让所有人
 *   共用一份凭据 —— 那正是本包要消灭的东西。
 * - **`get` 返回空字符串等同于不存在**(上游 seam 规则),实现方不必自己处理,
 *   {@link MultiuserCredentials} 会统一归一化。
 * - **不要在实现里做租户判定**。principal 已经带着 tenantId 传进来,
 *   越权检查在上层做;存储层再做一遍不会更安全,只会让两处逻辑不一致时
 *   谁也不知道该信哪个。
 */
export interface PrincipalCredentialStore {
  /**
   * 读取某个主体的某个凭据。
   *
   * @param principal 主体。实现方应当用 `principal.id` 作为主键的一部分
   * @param ref 凭据引用(POSIX 环境变量名形状)
   * @returns 值;不存在时 `undefined`
   */
  get(principal: Principal, ref: CredentialRef): Promise<string | undefined>

  /**
   * 写入某个主体的某个凭据。
   *
   * @param principal 主体
   * @param ref 凭据引用
   * @param value 非空值。空值的语义是删除,调用方会改走 {@link remove}
   */
  put(principal: Principal, ref: CredentialRef, value: string): Promise<void>

  /**
   * 删除某个主体的某个凭据。删除不存在的凭据是 no-op,不得抛错。
   *
   * @param principal 主体
   * @param ref 凭据引用
   */
  remove(principal: Principal, ref: CredentialRef): Promise<void>
}

/**
 * 内存实现,**仅供测试与本地开发**。
 *
 * 进程重启即全部丢失。生产请实现 {@link PrincipalCredentialStore} 接到
 * 真正的密钥托管上 —— 本 Session(V0.1.0)刻意不做持久化实现,
 * 因为选错一个会比不选更糟:采用者会被迫迁移。
 */
export class InMemoryPrincipalCredentialStore implements PrincipalCredentialStore {
  /**
   * `principalId` → (`ref` → 值)。
   *
   * 用普通属性而非 `#private`:cordis 的 Proxy 包装会让 `#private` 抛 TypeError,
   * 而本类虽然自己不是 Service,却会被 Service 持有并在其方法里访问。
   * 统一避开,省得将来有人把它挪进服务类里再踩一遍。
   */
  private readonly byPrincipal = new Map<string, Map<string, string>>()

  async get(principal: Principal, ref: CredentialRef): Promise<string | undefined> {
    return this.byPrincipal.get(principal.id)?.get(ref)
  }

  async put(principal: Principal, ref: CredentialRef, value: string): Promise<void> {
    let bucket = this.byPrincipal.get(principal.id)
    if (bucket === undefined) {
      bucket = new Map()
      this.byPrincipal.set(principal.id, bucket)
    }
    bucket.set(ref, value)
  }

  async remove(principal: Principal, ref: CredentialRef): Promise<void> {
    this.byPrincipal.get(principal.id)?.delete(ref)
  }

  /** 测试辅助:清空全部数据。 */
  clear(): void {
    this.byPrincipal.clear()
  }
}
