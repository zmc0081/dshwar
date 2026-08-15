/**
 * `@dshwar/storage-scoped` —— 租户维度的存储作用域。
 *
 * 上游 `storage-domain` 的 `domain` **不能**承载 tenantId(它是 schema 的命名空间,
 * 单名单开、静态路由)。作用域必须落在**记录键**这一层。
 * 完整评估见 `docs/DECISIONS/storage-scoping.md`。
 *
 * @module @dshwar/storage-scoped
 */
import type { Context } from '@deepseek-ai/cordis'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import type { Principal } from '@dshwar/principal'
import { assertInScope, decodeKey, encodeKey, ScopeViolationError, tenantScope } from './key.ts'

export { assertInScope, decodeKey, encodeKey, ScopeViolationError, tenantScope } from './key.ts'

/**
 * 按租户作用域包装的 KV 单元。作用域在 **open 时固定**,此后不可变。
 *
 * 上层看到的是一个**只有自己数据**的普通 KV —— 跨租户读不是「上层自觉不去读」,
 * 而是根本拿不到。
 *
 * ## 为什么是 open 时固定,而不是每次操作现场解析
 *
 * `credentials` 那边是每次操作重新解析当前 principal,因为上游 `dsh-credentials`
 * 的契约明确要求「consumers re-resolve at each operation」。
 *
 * **存储不是这个模型。** 上游的句柄按契约就是长命的:`DomainFacility.open()`
 * 返回的 handle 由调用方持有并 `close()`,生命周期挂在 fiber 上,一个 domain
 * 名同时只能开一次。`KvUnit` 的方法也不接受任何上下文参数 ——
 * 没有任何位置能让「当前是谁」在调用时传进来。
 *
 * 硬要每次操作去读,只能让闭包捕获一个 ctx 对象;而普通闭包**不会**像 cordis
 * Service 的 `this.ctx` 那样按访问方重绑,于是在根上下文注册一次的后端会
 * 永远读到匿名。这是个会静默失效的设计,不是可以「小心使用」的设计。
 *
 * 所以:**在会话作用域内 open,unit 从此绑定该租户**。
 */
class ScopedKvUnit implements KvUnit {
  constructor(
    private readonly inner: KvUnit,
    private readonly scope: string,
  ) {}

  private readScope(): string {
    return this.scope
  }

  /**
   * 读全量快照并**按前缀过滤 + 剥掉前缀**。
   *
   * ⚠️ 内层 `loadAll()` 仍然会把整个 unit 读进内存 —— 这是上游契约的形状
   * (`loadAll` 就是全量快照),本包改不了。它意味着:**逻辑隔离下,
   * 一个租户的数据量会影响所有租户的内存占用**。跨信任边界的部署应当
   * 一租户一后端(`storage` hub 支持多后端并存),而不是靠本包。
   */
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    const scope = this.readScope()
    const snapshot = await this.inner.loadAll()

    const tables: Record<string, Record<string, unknown>> = {}
    for (const [table, records] of Object.entries(snapshot.tables)) {
      const mine: Record<string, unknown> = {}
      for (const [encoded, value] of Object.entries(records)) {
        const key = decodeKey(scope, encoded)
        if (key !== undefined) mine[key] = value
      }
      tables[table] = mine
    }

    // global 是 unit 级的单例槽位,没有键可以加前缀 —— 见类文档的说明。
    return { tables, global: snapshot.global }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    const scope = this.readScope()
    const encoded = encodeKey(scope, key)
    // 复查:隔离不该依赖单一调用点的正确性
    assertInScope(scope, encoded)
    return this.inner.putRecord(table, encoded, value)
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    const scope = this.readScope()
    const encoded = encodeKey(scope, key)
    assertInScope(scope, encoded)
    return this.inner.deleteRecord(table, encoded)
  }

  /**
   * ⚠️ **全局单例槽位无法按租户作用域化。**
   *
   * `KvUnit` 的 global 是 unit 级的**单个**槽位,没有键可以加前缀。
   * 允许多租户写它等于让最后一个写的人覆盖所有人。
   *
   * 因此本包**直接拒绝**。需要 per-tenant 的单例值,请用一张只有一个固定键的表 ——
   * 那条记录会正常走前缀。
   */
  async setGlobal(): Promise<void> {
    throw new ScopeViolationError(
      'storage-scoped: 全局单例槽位无法按租户作用域化(它是 unit 级的单个槽位,没有键可加前缀)。' +
        '请改用一张只含固定键的表,那条记录会正常带上租户前缀。',
    )
  }

  async close(): Promise<void> {
    return this.inner.close()
  }
}

/** 按租户作用域包装的 KV facet。open 的那一刻决定这个 unit 属于谁。 */
class ScopedKvFacet implements KvFacet {
  constructor(
    private readonly inner: KvFacet,
    private readonly ctx: Context,
  ) {}

  async open(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    // 作用域在这里定格。ctx 必须是**会话作用域**的上下文 —— 见 scopedBackend 的文档。
    const principal: Principal = this.ctx.principal.current()
    const scope = tenantScope(principal)

    // unit 名不加前缀:它会变成文件名 / SQL 标识符(受 UNIT_NAME_RE 约束),
    // 且所有租户共享同一套 schema。作用域落在记录键上,不在 unit 上。
    const unit = await this.inner.open(descriptor)
    return new ScopedKvUnit(unit, scope)
  }
}

/**
 * 把一个上游存储后端包装成租户作用域版本。
 *
 * ⚠️ **必须在会话作用域内调用 `open()`。**
 *
 * ```ts
 * await runWithPrincipal(ctx, principal, async (sessionCtx) => {
 *   const backend = scopedBackend(sessionCtx, innerBackend)
 *   const unit = await backend.kv.open(descriptor) // ← 作用域在这一刻定格
 *   await unit.putRecord('records', 'k', v)        // 此后该 unit 永远属于这个租户
 * })
 * ```
 *
 * 在**根上下文** open 会得到匿名作用域 —— 那不是 bug,是 fail closed:
 * 匿名的数据落在 `anonymous` 前缀下,与任何真实租户都不重叠。
 *
 * 作用域为什么在 open 时定格而不是每次操作现场解析,见 {@link ScopedKvUnit} 的说明。
 *
 * @param ctx 会话作用域上下文;`open()` 时从它读取当前 principal
 * @param inner 内层后端(`storage-sqlite` / `storage-json` …)
 * @returns 包装后的后端
 */
export function scopedBackend(ctx: Context, inner: StorageBackend): StorageBackend {
  return {
    ...(inner.kv === undefined ? {} : { kv: new ScopedKvFacet(inner.kv, ctx) }),
    close: () => inner.close(),
  }
}
