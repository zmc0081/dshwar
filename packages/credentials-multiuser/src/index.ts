/**
 * `@dshwar/credentials-multiuser` —— per-principal 凭据解析。
 *
 * **这是整个项目论点最直接的证明:** 换掉一个实现,所有 LLM 适配器、工具、插件
 * 自动变成多用户,消费方零改动。它们仍然调 `ctx.credentials.resolve(ref)`,
 * 一行都不用改。
 *
 * @module @dshwar/credentials-multiuser
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import type { Principal } from '@dshwar/principal'
import { InMemoryPrincipalCredentialStore, type PrincipalCredentialStore } from './store.ts'

export { InMemoryPrincipalCredentialStore, type PrincipalCredentialStore } from './store.ts'

/** 遮蔽某个 ref 的短时效凭据。 */
export interface ShadowedCredential {
  /** 网关按 principal 换发的值。 */
  readonly value: string
  /**
   * 该值的来源标签,原样出现在 `resolve().source` 与 `describe().source` 里。
   * 默认 `'gateway-scoped-token'`。
   */
  readonly source?: string
}

/**
 * 遮蔽解析器:按 principal 与 ref 决定是否用网关短时效 token 顶替。
 *
 * 返回 `undefined` 表示不遮蔽,走 {@link PrincipalCredentialStore}。
 */
export type ShadowResolver = (
  principal: Principal,
  ref: CredentialRef,
) => Promise<ShadowedCredential | undefined> | ShadowedCredential | undefined

/** {@link MultiuserCredentials} 的配置。 */
export interface MultiuserCredentialsConfig {
  /** 凭据存储。省略则用内存实现(仅测试与本地开发)。 */
  readonly store?: PrincipalCredentialStore
  /**
   * 网关遮蔽解析器。省略即不遮蔽。
   *
   * 这是「用户永不持有 provider key」的架构落点:运营方持一把上游 key,
   * 按 principal 换发 scoped token,用户侧只看得到一个只读的引用。
   */
  readonly shadow?: ShadowResolver
}

/**
 * per-principal 凭据实现,注册为 `ctx.credentials`。
 *
 * ```ts
 * await ctx.plugin(MultiuserCredentials, { store })
 *
 * await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF)) // → alice 的 key
 * await runWithPrincipal(ctx, bob,   (c) => c.credentials.resolve(REF)) // → bob 的 key
 * ```
 *
 * ## 三条不可动摇的语义
 *
 * **1. 每次操作现场解析,绝不跨操作缓存。** 上游 `dsh-credentials` 的契约明文
 * 要求(`resolve` 的 TSDoc:"consumers re-resolve at each operation and must not
 * cache across operations")。本实现每次都重新读 `this.ctx.principal.current()`
 * 与 store —— 缓存任何一层,下一个用户就会拿到上一个用户的 key。
 *
 * **2. 空值等同缺失。** 上游 seam 规则:`resolve` 跳过它,`describe` 报
 * unconfigured。一个空白绝不能冒充已配置的密钥。
 *
 * **3. 匿名 fail closed。** 见 {@link resolve}。
 *
 * ⚠️ 本类**刻意不使用** ECMAScript `#private` 字段:cordis 通过 Proxy 包装服务
 * 以重绑 `this.ctx`,`#private` 在 wrapper 上必抛 `TypeError`。
 * 见 `docs/FEASIBILITY-REPORT.md` §4.1。
 */
export class MultiuserCredentials extends CredentialProvider {
  private readonly store: PrincipalCredentialStore
  private readonly shadow: ShadowResolver | undefined

  constructor(ctx: Context, config: MultiuserCredentialsConfig = {}) {
    super(ctx)
    this.store = config.store ?? new InMemoryPrincipalCredentialStore()
    this.shadow = config.shadow
  }

  /**
   * 读取**当前作用域**的主体。
   *
   * 每次调用都重新读,不缓存 —— 同一个运行时里相邻两次操作可能属于不同的人,
   * 这正是本包存在的理由。
   */
  private currentPrincipal(): Principal {
    return this.ctx.principal.current()
  }

  /** 判定当前主体是否匿名。匿名一律 fail closed,见 {@link resolve}。 */
  private isAnonymous(): boolean {
    return this.ctx.principal.isAnonymous()
  }

  private async resolveShadow(
    principal: Principal,
    ref: CredentialRef,
  ): Promise<ShadowedCredential | undefined> {
    if (this.shadow === undefined) return undefined
    const shadowed = await this.shadow(principal, ref)
    // 空值等同缺失,遮蔽也不例外 —— 否则一个配错的空 token 会把用户自己的 key
    // 遮蔽掉,症状是「我明明配了 key 却解析不到」。
    if (shadowed === undefined || shadowed.value === '') return undefined
    return shadowed
  }

  /**
   * 解析一个引用到当前主体的值。
   *
   * ⚠️ **匿名主体一律返回 `undefined`(CLAUDE.md 硬规则 6)。**
   * 不回退到默认值、不回退到共享 key、不读环境变量。
   *
   * 理由:组合配错时**宁可跑不起来**。若匿名能拿到运营方的 key,
   * 一个配错的 profile 会让所有匿名请求都用运营方的钱跑 —— 而这个事故的
   * 表现形式是「一切正常」,直到月底看到账单。让它当场解析不到,
   * 报错会指向配置,而不是指向财务。
   *
   * @param ref 凭据引用
   * @returns 值与来源;未配置或匿名时 `undefined`
   */
  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    if (this.isAnonymous()) return undefined
    const principal = this.currentPrincipal()

    const shadowed = await this.resolveShadow(principal, ref)
    if (shadowed !== undefined) {
      return { value: shadowed.value, source: shadowed.source ?? 'gateway-scoped-token' }
    }

    const value = await this.store.get(principal, ref)
    if (value === undefined || value === '') return undefined
    return { value, source: `principal:${principal.id}` }
  }

  /**
   * 描述一个引用,**永不返回值**(CLAUDE.md 硬规则 5)。
   *
   * 返回体只有 `configured` / `source` / `writable` 三个字段 —— 这是上游
   * `CredentialInfo` 的既有形状,DSHWAR 原样传递,不做任何扩展。
   * 配置界面据此渲染「已配置 / 来自何处 / 能否修改」,而看不到密钥本身。
   *
   * @param ref 凭据引用
   * @returns 配置状态、来源层、可写性
   */
  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    if (this.isAnonymous()) {
      // 匿名既读不到也写不了。writable=false 让配置界面直接置灰,
      // 而不是让用户点了保存才发现失败。
      return { configured: false, writable: false }
    }
    const principal = this.currentPrincipal()

    const shadowed = await this.resolveShadow(principal, ref)
    if (shadowed !== undefined) {
      return {
        configured: true,
        source: shadowed.source ?? 'gateway-scoped-token',
        writable: false,
      }
    }

    const value = await this.store.get(principal, ref)
    if (value === undefined || value === '') {
      return { configured: false, writable: true }
    }
    return { configured: true, source: `principal:${principal.id}`, writable: true }
  }

  /**
   * 为当前主体写入一个凭据。
   *
   * ⚠️ **被网关遮蔽时必须拒绝**(上游语义)。若允许写入,写操作会看起来成功,
   * 而 `resolve` 仍然返回遮蔽值 —— 用户会反复保存、反复"失败",却看不到任何错误。
   * 宁可当场抛错。
   *
   * @param ref 凭据引用
   * @param value 非空值。空值请用 {@link unset}
   * @throws 匿名主体、值为空、或该 ref 被只读来源遮蔽
   */
  async set(ref: CredentialRef, value: string): Promise<void> {
    if (this.isAnonymous()) {
      throw new Error(
        `credentials-multiuser: 作用域内没有已认证的主体,拒绝写入 ${ref}(fail closed)`,
      )
    }
    if (value === '') {
      throw new Error(`credentials-multiuser: ${ref} 的值不得为空,删除请用 unset()`)
    }
    const principal = this.currentPrincipal()

    const shadowed = await this.resolveShadow(principal, ref)
    if (shadowed !== undefined) {
      throw new Error(
        `credentials-multiuser: ${ref} 正被只读来源遮蔽(${shadowed.source ?? 'gateway-scoped-token'}),拒绝写入 —— ` +
          '写入会看起来成功,而解析仍返回遮蔽值。',
      )
    }

    await this.store.put(principal, ref, value)
    // 通知上游,确保变更在「下一次」操作即生效,而不是下一个会话
    this.notifyUpdated(ref)
  }

  /**
   * 删除当前主体的一个凭据。删除不存在的凭据是 no-op。
   *
   * @param ref 凭据引用
   * @throws 匿名主体,或该 ref 被只读来源遮蔽
   */
  async unset(ref: CredentialRef): Promise<void> {
    if (this.isAnonymous()) {
      throw new Error(
        `credentials-multiuser: 作用域内没有已认证的主体,拒绝删除 ${ref}(fail closed)`,
      )
    }
    const principal = this.currentPrincipal()

    const shadowed = await this.resolveShadow(principal, ref)
    if (shadowed !== undefined) {
      throw new Error(
        `credentials-multiuser: ${ref} 正被只读来源遮蔽(${shadowed.source ?? 'gateway-scoped-token'}),拒绝删除。`,
      )
    }

    await this.store.remove(principal, ref)
    this.notifyUpdated(ref)
  }
}

export default MultiuserCredentials
