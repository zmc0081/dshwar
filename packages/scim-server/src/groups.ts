/**
 * SCIM Group 的存储。
 *
 * 组存在的意义是**租户映射**:`strategy: group` 从用户所属组名里按前缀抽租户。
 * 所以组的成员变更必须同步回 `Subject.groups` —— 那才是 tenant-map 与 auth 读的地方。
 *
 * @module @dshwar/scim-server/groups
 */

export interface ScimGroup {
  readonly id: string
  readonly source: string
  readonly externalId: string | null
  readonly displayName: string
  /** 成员的 subject id。 */
  readonly members: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface GroupInput {
  readonly source: string
  readonly externalId?: string | null
  readonly displayName: string
  readonly members?: readonly string[]
}

export interface GroupStore {
  create(input: GroupInput): Promise<ScimGroup>
  get(id: string): Promise<ScimGroup | undefined>
  /** 按显示名查 —— 供给方的 `displayName eq` filter 用。 */
  getByDisplayName(source: string, displayName: string): Promise<ScimGroup | undefined>
  list(source: string): Promise<ScimGroup[]>
  update(
    id: string,
    patch: { displayName?: string; members?: readonly string[] },
  ): Promise<ScimGroup | undefined>
  remove(id: string): Promise<boolean>
}

/** 内存实现。与 InMemorySubjectStore 同款定位:测试与单进程部署。 */
export class InMemoryGroupStore implements GroupStore {
  private readonly byId = new Map<string, ScimGroup>()
  private seq = 0

  async create(input: GroupInput): Promise<ScimGroup> {
    const now = new Date().toISOString()
    this.seq += 1
    const group: ScimGroup = {
      // 组 id 不由外部派生:两个供给周期里同名组可能是先删后建的两个组
      id: `g-${this.seq.toString(36)}-${Date.now().toString(36)}`,
      source: input.source,
      externalId: input.externalId ?? null,
      displayName: input.displayName,
      members: [...new Set(input.members ?? [])],
      createdAt: now,
      updatedAt: now,
    }
    this.byId.set(group.id, group)
    return group
  }

  async get(id: string): Promise<ScimGroup | undefined> {
    return this.byId.get(id)
  }

  async getByDisplayName(source: string, displayName: string): Promise<ScimGroup | undefined> {
    for (const group of this.byId.values()) {
      if (group.source === source && group.displayName === displayName) return group
    }
    return undefined
  }

  async list(source: string): Promise<ScimGroup[]> {
    return [...this.byId.values()]
      .filter((g) => g.source === source)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  async update(
    id: string,
    patch: { displayName?: string; members?: readonly string[] },
  ): Promise<ScimGroup | undefined> {
    const existing = this.byId.get(id)
    if (existing === undefined) return undefined
    const updated: ScimGroup = {
      ...existing,
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.members === undefined ? {} : { members: [...new Set(patch.members)] }),
      updatedAt: new Date().toISOString(),
    }
    this.byId.set(id, updated)
    return updated
  }

  async remove(id: string): Promise<boolean> {
    return this.byId.delete(id)
  }
}
