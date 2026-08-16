/**
 * Subject Mirror 的存储契约与两个实现。
 *
 * @module @dshwar/subject/store
 */
import { encodeKey } from '@dshwar/storage-scoped'
import { normalizeInput, SubjectError, type Subject, type SubjectInput } from './subject.ts'

/** 列表查询条件。刻意只支持供给方真正会用的那几条。 */
export interface SubjectFilter {
  readonly tenantId?: string
  readonly source?: string
  readonly userName?: string
  readonly externalId?: string
  /** 只要启用的 / 只要停用的。不传则两者都要。 */
  readonly active?: boolean
}

/**
 * 身份镜像存储。
 *
 * ⚠️ **没有 `create`。** 只有 {@link upsert},且必须带 `source` ——
 * DSHWAR 不新建用户,只接受供给方推来的记录(见 `subject.ts` 的模块说明)。
 */
export interface SubjectStore {
  /**
   * 按 `(source, externalId)` 落一条记录:已存在则更新,不存在则建。
   *
   * @returns 落库后的完整记录
   */
  upsert(input: SubjectInput): Promise<Subject>

  /** 按 DSHWAR 内部 id 取。 */
  get(id: string): Promise<Subject | undefined>

  /** 按供给方的 id 取。多 IdP 并存时必须带 source 才能唯一定位。 */
  getByExternalId(source: string, externalId: string): Promise<Subject | undefined>

  list(filter?: SubjectFilter): Promise<Subject[]>

  /**
   * 停用。
   *
   * **不删除记录。** 审计要能回答「这个人什么时候被停的」,删了就答不了。
   *
   * @returns 停用后的记录;不存在则 `undefined`
   */
  deactivate(id: string): Promise<Subject | undefined>

  /**
   * 硬删除。
   *
   * ⚠️ 只应由供给方的显式 `DELETE` 触发,**绝不能**用来实现停用 ——
   * Entra 的硬删除延迟 30 天才发 DELETE,把它当停用信号意味着离职员工
   * 还能再用一个月(`docs/FEASIBILITY-REPORT-V3.md` §4)。
   */
  remove(id: string): Promise<boolean>
}

/**
 * 由 `(source, externalId)` 派生稳定的内部 id。
 *
 * 用长度前缀而非分隔符,理由与 `@dshwar/storage-scoped` 的 `encodeKey` 完全相同:
 * source 与 externalId 都是**外部完全可控**的字符串,任何分隔符都可能出现在里面,
 * `${source}:${externalId}` 能被构造碰撞 —— 而碰撞意味着 B 家的用户覆盖掉 A 家的。
 *
 * 直接复用那个函数,而不是另写一遍:两处对同一对输入必须得出同一个键,
 * 否则排障时人要在脑子里维护两套映射。
 */
export function subjectKey(source: string, externalId: string): string {
  return encodeKey(source, externalId)
}

function matches(subject: Subject, filter: SubjectFilter): boolean {
  if (filter.tenantId !== undefined && subject.tenantId !== filter.tenantId) return false
  if (filter.source !== undefined && subject.source !== filter.source) return false
  if (filter.userName !== undefined && subject.userName !== filter.userName) return false
  if (filter.externalId !== undefined && subject.externalId !== filter.externalId) return false
  if (filter.active !== undefined && subject.active !== filter.active) return false
  return true
}

/** 稳定排序:先租户后登录名。分页游标依赖顺序稳定,靠插入顺序会在重启后错乱。 */
function byTenantThenUserName(a: Subject, b: Subject): number {
  return a.tenantId === b.tenantId
    ? a.userName.localeCompare(b.userName)
    : a.tenantId.localeCompare(b.tenantId)
}

/** 落一条记录时共用的字段计算。 */
function materialize(input: SubjectInput, existing: Subject | undefined, now: string): Subject {
  const n = normalizeInput(input)

  if (existing !== undefined && existing.source !== n.source) {
    // 换 source 等于换归属方。允许它就意味着 B 家的供给系统能接管 A 家的用户记录。
    throw new SubjectError(
      `subject: 不允许更改 source(${existing.source} → ${n.source})—— 那会让另一个身份源接管这条记录`,
    )
  }

  return {
    id: existing?.id ?? subjectKey(n.source, n.externalId),
    source: n.source,
    externalId: n.externalId,
    userName: n.userName,
    active: n.active,
    tenantId: n.tenantId,
    emails: n.emails,
    groups: n.groups,
    displayName: n.displayName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** 内存实现。测试与单进程部署用。 */
export class InMemorySubjectStore implements SubjectStore {
  private readonly byId = new Map<string, Subject>()

  async upsert(input: SubjectInput): Promise<Subject> {
    const key = subjectKey(input.source.trim(), input.externalId.trim())
    const subject = materialize(input, this.byId.get(key), new Date().toISOString())
    this.byId.set(subject.id, subject)
    return subject
  }

  async get(id: string): Promise<Subject | undefined> {
    return this.byId.get(id)
  }

  async getByExternalId(source: string, externalId: string): Promise<Subject | undefined> {
    return this.byId.get(subjectKey(source, externalId))
  }

  async list(filter: SubjectFilter = {}): Promise<Subject[]> {
    return [...this.byId.values()].filter((s) => matches(s, filter)).sort(byTenantThenUserName)
  }

  async deactivate(id: string): Promise<Subject | undefined> {
    const existing = this.byId.get(id)
    if (existing === undefined) return undefined
    const updated: Subject = { ...existing, active: false, updatedAt: new Date().toISOString() }
    this.byId.set(id, updated)
    return updated
  }

  async remove(id: string): Promise<boolean> {
    return this.byId.delete(id)
  }
}

/**
 * 上游 `KvUnit` 的最小形状 —— 只声明本模块用得到的三个方法。
 *
 * 不 import 上游的 `KvUnit` 类型,是为了让本包在**没装存储插件**时也能被引用
 * (契约包不该强迫消费方拉进一个后端)。形状不匹配时 TS 会在装配处报错,
 * 而不是在这里。
 */
export interface KvUnitLike {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
  deleteRecord(table: string, key: string): Promise<void>
}

/** 本包用的表名。unit 的 descriptor 里必须声明它。 */
export const SUBJECTS_TABLE = 'subjects'

/**
 * 走上游 `storage` 契约的实现。
 *
 * ## 一个必须说清的限制
 *
 * 上游 `KvUnit` 只有 `loadAll()`,**没有按键读取** —— 所以每次 `get` 都会把整个
 * unit 读进内存。这是上游契约的形状,不是这里的选择;`@dshwar/storage-scoped`
 * 有同样的问题,README 的「已知限制」里也写了。
 *
 * 后果:一个租户的身份数据量会影响所有租户的内存占用。身份数据通常是几千到几万条,
 * 这个量级可接受;真到了需要按键读取的规模,应该换 Postgres 实现
 * (V0.5.0 控制平面落地时的事),而不是在这里加缓存 ——
 * 缓存会让「供给方刚停用的用户」在缓存过期前仍然能通过认证。
 */
export class KvSubjectStore implements SubjectStore {
  private readonly unit: KvUnitLike

  constructor(unit: KvUnitLike) {
    this.unit = unit
  }

  private async loadAll(): Promise<Map<string, Subject>> {
    const snapshot = await this.unit.loadAll()
    const table = snapshot.tables[SUBJECTS_TABLE] ?? {}
    return new Map(Object.entries(table).map(([key, value]) => [key, value as Subject]))
  }

  async upsert(input: SubjectInput): Promise<Subject> {
    const key = subjectKey(input.source.trim(), input.externalId.trim())
    const existing = (await this.loadAll()).get(key)
    const subject = materialize(input, existing, new Date().toISOString())
    await this.unit.putRecord(SUBJECTS_TABLE, subject.id, subject)
    return subject
  }

  async get(id: string): Promise<Subject | undefined> {
    return (await this.loadAll()).get(id)
  }

  async getByExternalId(source: string, externalId: string): Promise<Subject | undefined> {
    return this.get(subjectKey(source, externalId))
  }

  async list(filter: SubjectFilter = {}): Promise<Subject[]> {
    return [...(await this.loadAll()).values()]
      .filter((s) => matches(s, filter))
      .sort(byTenantThenUserName)
  }

  async deactivate(id: string): Promise<Subject | undefined> {
    const existing = (await this.loadAll()).get(id)
    if (existing === undefined) return undefined
    const updated: Subject = { ...existing, active: false, updatedAt: new Date().toISOString() }
    await this.unit.putRecord(SUBJECTS_TABLE, id, updated)
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const existed = (await this.loadAll()).has(id)
    await this.unit.deleteRecord(SUBJECTS_TABLE, id)
    return existed
  }
}
