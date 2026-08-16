/**
 * `@dshwar/audit` —— 仅追加的操作审计。
 *
 * ## 「仅追加」是接口层的事实,不是文档里的许诺
 *
 * {@link AuditStore} 没有 `update`,没有 `delete` —— 类型层就写不出修改。
 * 改得掉的审计等于没有审计:出事之后第一个想改记录的人,恰恰是有权限改的那个。
 * 存储介质层面的防篡改(WORM 存储、外部归档)是部署方的事,本包保证的是
 * **代码路径上不存在修改入口**。
 *
 * ## 租户过滤是强制参数
 *
 * `query()` 的 `tenantId` 不是可选项。审计端点走 Admin API,一把 Key 只该看到
 * 自己租户的记录 —— 把过滤做成可选,总有一天有人会忘了传,而那次查询返回的
 * 就是全部客户的操作史。
 *
 * @module @dshwar/audit
 */

/** 一条审计记录。与 `api-contract` 冻结的 `AuditEntry` 对齐(多一个 tenantId 作过滤键)。 */
export interface AuditRecord {
  /** 追加时由 store 生成:单调序号,顺序可重放。 */
  readonly id: string
  readonly at: string
  /** 调用者。Admin Key 的标签或 SCIM 身份源,**不是**凭证本身。 */
  readonly actor: string
  /** 过滤键。查询强制按它圈定。 */
  readonly tenantId: string
  readonly action: string
  readonly target: string
  /**
   * 变更前后。
   *
   * ⚠️ 凭据类操作只记录 `describe` 层面的事实,**绝不记录值** ——
   * 审计的保留期比凭据的轮换周期长得多,把值写进去等于造一个长期留存的密钥副本。
   */
  readonly before: unknown
  readonly after: unknown
  readonly requestId: string
}

/** 追加入参。`id` 由 store 生成,调用方给不了 —— 可指定的 id 就是可伪造的顺序。 */
export type AuditInput = Omit<AuditRecord, 'id'>

export interface AuditQuery {
  /** 强制。见模块说明。 */
  readonly tenantId: string
  readonly action?: string
  readonly target?: string
  /** 游标:上一页最后一条的 id。 */
  readonly cursor?: string
  readonly limit?: number
}

/**
 * 审计存储。**没有 update,没有 delete。**
 *
 * 若某次需求看起来需要「修正一条审计」,正确做法是追加一条修正记录
 * (`action: 'audit.correction'`,`target` 指向原记录)—— 历史不改,只追加。
 */
export interface AuditStore {
  append(input: AuditInput): Promise<AuditRecord>
  query(filter: AuditQuery): Promise<{ data: AuditRecord[]; nextCursor: string | null }>
}

/** 单调 id:固定宽度十进制序号,字典序 = 追加序,游标分页因此稳定。 */
function sequenceId(seq: number): string {
  return `a-${String(seq).padStart(12, '0')}`
}

function matches(record: AuditRecord, filter: AuditQuery): boolean {
  if (record.tenantId !== filter.tenantId) return false
  if (filter.action !== undefined && record.action !== filter.action) return false
  if (filter.target !== undefined && record.target !== filter.target) return false
  return true
}

function paginate(
  all: readonly AuditRecord[],
  filter: AuditQuery,
): { data: AuditRecord[]; nextCursor: string | null } {
  const matched = all.filter((r) => matches(r, filter))
  const limit = filter.limit ?? 50
  const start =
    filter.cursor === undefined ? 0 : matched.findIndex((r) => r.id === filter.cursor) + 1
  const page = matched.slice(start, start + limit)
  const nextCursor = start + limit < matched.length ? (page.at(-1)?.id ?? null) : null
  return { data: page, nextCursor }
}

/** 内存实现。测试与单进程部署用。 */
export class InMemoryAuditStore implements AuditStore {
  private readonly records: AuditRecord[] = []
  private seq = 0

  async append(input: AuditInput): Promise<AuditRecord> {
    this.seq += 1
    const record: AuditRecord = { id: sequenceId(this.seq), ...input }
    this.records.push(record)
    return record
  }

  async query(filter: AuditQuery): Promise<{ data: AuditRecord[]; nextCursor: string | null }> {
    return paginate(this.records, filter)
  }
}

/** 上游 `KvUnit` 的最小形状。与 `@dshwar/subject` 的 KvUnitLike 同款做法:
 * 结构性子集,不强迫消费方拉进存储插件。 */
export interface KvUnitLike {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
}

export const AUDIT_TABLE = 'audit'

/**
 * 走上游 `storage` 契约的实现。
 *
 * ⚠️ 注意 {@link KvUnitLike} 里**没有 deleteRecord** —— 这不是省事,是把
 * 「仅追加」延伸到存储接口:本包连删除后端记录的能力都不声明。
 *
 * 与 subject 包同样的已知限制:上游 KvUnit 只有 loadAll,每次查询整表进内存。
 * 审计量大的部署应换 Postgres 实现(V0.5.0 控制平面),而不是在这里加缓存。
 */
export class KvAuditStore implements AuditStore {
  private readonly unit: KvUnitLike
  private seq: number | undefined

  constructor(unit: KvUnitLike) {
    this.unit = unit
  }

  private async loadAll(): Promise<AuditRecord[]> {
    const snapshot = await this.unit.loadAll()
    const table = snapshot.tables[AUDIT_TABLE] ?? {}
    // id 是零填充序号,字典序即追加序
    return Object.keys(table)
      .sort()
      .map((k) => table[k] as AuditRecord)
  }

  async append(input: AuditInput): Promise<AuditRecord> {
    if (this.seq === undefined) {
      // 重启后从已有记录续号 —— 序号断裂会破坏游标分页的稳定性
      const existing = await this.loadAll()
      const last = existing.at(-1)?.id
      this.seq = last === undefined ? 0 : Number(last.slice(2))
    }
    this.seq += 1
    const record: AuditRecord = { id: sequenceId(this.seq), ...input }
    await this.unit.putRecord(AUDIT_TABLE, record.id, record)
    return record
  }

  async query(filter: AuditQuery): Promise<{ data: AuditRecord[]; nextCursor: string | null }> {
    return paginate(await this.loadAll(), filter)
  }
}
