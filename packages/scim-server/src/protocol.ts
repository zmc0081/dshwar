/**
 * SCIM 2.0 的协议件:错误格式、列表信封、filter 解析、PATCH 应用。
 *
 * 纯逻辑,不碰 HTTP 与存储 —— 协议解析必须能独立穷尽测试。
 *
 * @module @dshwar/scim-server/protocol
 */

/** SCIM 的错误响应(RFC 7644 §3.12)。与 DSHWAR 的 ErrorResponse **刻意不同**:
 * 供给方(Entra / Okta / authentik)只认这个格式,给它们看 DSHWAR 的错误形状,
 * 它们会把每次失败都记成「未知错误」,排障时两边都看不懂。 */
export interface ScimErrorBody {
  readonly schemas: readonly ['urn:ietf:params:scim:api:messages:2.0:Error']
  readonly status: string
  readonly scimType?: string
  readonly detail: string
}

export function scimError(status: number, detail: string, scimType?: string): ScimErrorBody {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    ...(scimType === undefined ? {} : { scimType }),
    detail,
  }
}

/** 列表信封(RFC 7644 §3.4.2)。`startIndex` 是 **1-based** —— SCIM 的规定,不是我们的选择。 */
export interface ListResponse<T> {
  readonly schemas: readonly ['urn:ietf:params:scim:api:messages:2.0:ListResponse']
  readonly totalResults: number
  readonly startIndex: number
  readonly itemsPerPage: number
  readonly Resources: readonly T[]
}

export function listResponse<T>(
  all: readonly T[],
  startIndex: number,
  count: number,
): ListResponse<T> {
  const start = Math.max(1, startIndex)
  const page = all.slice(start - 1, start - 1 + Math.max(0, count))
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: all.length,
    startIndex: start,
    itemsPerPage: page.length,
    Resources: page,
  }
}

/** 解析出的 filter:只支持 `attr eq "value"`。 */
export interface EqFilter {
  readonly attribute: string
  readonly value: string
}

/** filter 语法能解析但我们不支持 —— 对应 HTTP 501。 */
export class UnsupportedFilterError extends Error {
  override readonly name = 'UnsupportedFilterError'
  constructor(filter: string) {
    super(
      `scim: 不支持的 filter:${JSON.stringify(filter)}。` +
        '本实现只支持 `attr eq "value"`。返回 501 而不是静默返回全量 —— ' +
        '静默返回全量是数据泄漏:供给方以为在查一个人,实际拿到了整个目录。',
    )
  }
}

/**
 * 解析 filter。只认 `attr eq "value"` —— 供给方增量同步用的就是这一条
 * (Entra / Okta / authentik 都拿它查「这个用户存在吗」)。
 *
 * @throws {UnsupportedFilterError} 其它任何写法
 */
export function parseFilter(filter: string): EqFilter {
  const match = /^\s*([A-Za-z][\w.]*)\s+eq\s+"([^"]*)"\s*$/i.exec(filter)
  if (match === null) throw new UnsupportedFilterError(filter)
  return { attribute: match[1]!, value: match[2]! }
}

/** 一条 PATCH 操作(RFC 7644 §3.5.2)。 */
export interface PatchOp {
  readonly op: 'add' | 'remove' | 'replace'
  readonly path?: string
  readonly value?: unknown
}

/** PATCH 请求体不合法 —— 对应 HTTP 400 + scimType。 */
export class PatchError extends Error {
  override readonly name = 'PatchError'
  readonly scimType: 'invalidSyntax' | 'invalidPath' | 'invalidValue'
  constructor(scimType: 'invalidSyntax' | 'invalidPath' | 'invalidValue', message: string) {
    super(message)
    this.scimType = scimType
  }
}

/** 解析 PATCH 请求体。大小写不敏感的 `op` —— Entra 发 `Replace`,Okta 发 `replace`。 */
export function parsePatchBody(body: unknown): PatchOp[] {
  const doc = body as { schemas?: unknown; Operations?: unknown }
  if (!Array.isArray(doc?.Operations) || doc.Operations.length === 0) {
    throw new PatchError('invalidSyntax', 'scim: PATCH 请求体缺少 Operations')
  }

  return doc.Operations.map((raw) => {
    const item = raw as { op?: unknown; path?: unknown; value?: unknown }
    const op = typeof item.op === 'string' ? item.op.toLowerCase() : ''
    if (op !== 'add' && op !== 'remove' && op !== 'replace') {
      throw new PatchError('invalidSyntax', `scim: 未知的 op:${JSON.stringify(item.op)}`)
    }
    return {
      op,
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      ...(item.value === undefined ? {} : { value: item.value }),
    }
  })
}

/**
 * 把 `active` 的各种写法解析成布尔。
 *
 * ⚠️ **Entra 会把布尔发成字符串**(`"False"` / `"True"`)—— 这是实测过多次的
 * 行为,不是防御性编程。按严格布尔解析会让 Entra 的停用**静默失效**,
 * 而那正是本版本最不能失效的一条链路。
 *
 * @throws {PatchError} 既不是布尔也不是布尔字符串
 */
export function parseActiveValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
  }
  throw new PatchError('invalidValue', `scim: active 的值无法解析:${JSON.stringify(value)}`)
}

/** `members[value eq "id"]` 形式的 path —— Entra 移除组成员用它。 */
const MEMBERS_FILTER_PATH = /^members\[value\s+eq\s+"([^"]*)"\]$/i

/**
 * 对「用户属性」应用 PATCH,返回被改动的字段。
 *
 * 只认我们镜像里存在的字段。未知 path **报错**而不是忽略 ——
 * 供给方以为改成功了而实际没改,是最难排查的一类失配。
 */
export function applyUserPatch(ops: readonly PatchOp[]): {
  active?: boolean
  userName?: string
  displayName?: string | null
} {
  const changes: { active?: boolean; userName?: string; displayName?: string | null } = {}

  for (const op of ops) {
    if (op.op === 'remove') {
      if (op.path?.toLowerCase() === 'displayname') {
        changes.displayName = null
        continue
      }
      throw new PatchError('invalidPath', `scim: 不支持 remove ${JSON.stringify(op.path)}`)
    }

    // add 与 replace 对单值属性同义(RFC 7644 §3.5.2.1:add 到已存在的属性即替换)
    const path = op.path?.toLowerCase()

    if (path === undefined) {
      // Entra 风格:无 path,value 是一个对象,逐键应用
      const value = op.value as Record<string, unknown> | undefined
      if (value === null || typeof value !== 'object') {
        throw new PatchError('invalidValue', 'scim: 无 path 的操作需要对象 value')
      }
      for (const [key, v] of Object.entries(value)) {
        applySingle(changes, key.toLowerCase(), v)
      }
      continue
    }

    applySingle(changes, path, op.value)
  }

  return changes
}

function applySingle(
  changes: { active?: boolean; userName?: string; displayName?: string | null },
  path: string,
  value: unknown,
): void {
  switch (path) {
    case 'active':
      changes.active = parseActiveValue(value)
      return
    case 'username':
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new PatchError('invalidValue', 'scim: userName 需要非空字符串')
      }
      changes.userName = value.trim()
      return
    case 'displayname':
      changes.displayName = typeof value === 'string' ? value : null
      return
    default:
      throw new PatchError('invalidPath', `scim: 不支持的 path:${JSON.stringify(path)}`)
  }
}

/** 组成员 PATCH 的语义化结果。 */
export interface GroupPatchResult {
  readonly addMembers: readonly string[]
  readonly removeMembers: readonly string[]
  /** replace members:整体换成这批(与 add/remove 互斥出现)。 */
  readonly replaceMembers?: readonly string[]
  readonly displayName?: string
}

/** 从 `[{value: id}]` 形式的成员数组里抽出 id。 */
function memberIds(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    throw new PatchError('invalidValue', `scim: ${where} 需要成员数组`)
  }
  return value.map((m) => {
    const id = (m as { value?: unknown })?.value
    if (typeof id !== 'string' || id.length === 0) {
      throw new PatchError('invalidValue', `scim: ${where} 的成员缺少 value`)
    }
    return id
  })
}

/** 对「组」应用 PATCH。 */
export function applyGroupPatch(ops: readonly PatchOp[]): GroupPatchResult {
  const add: string[] = []
  const remove: string[] = []
  let replace: string[] | undefined
  let displayName: string | undefined

  for (const op of ops) {
    const path = op.path?.toLowerCase()

    // Entra 风格:remove 带成员过滤 path
    const filtered = op.path === undefined ? null : MEMBERS_FILTER_PATH.exec(op.path)
    if (op.op === 'remove' && filtered !== null) {
      remove.push(filtered[1]!)
      continue
    }

    if (path === 'members' || (path === undefined && op.op !== 'remove')) {
      if (op.op === 'add') add.push(...memberIds(op.value, 'add members'))
      else if (op.op === 'replace') replace = memberIds(op.value, 'replace members')
      else remove.push(...memberIds(op.value, 'remove members'))
      continue
    }

    if (path === 'displayname' && op.op !== 'remove') {
      if (typeof op.value !== 'string' || op.value.trim().length === 0) {
        throw new PatchError('invalidValue', 'scim: displayName 需要非空字符串')
      }
      displayName = op.value.trim()
      continue
    }

    throw new PatchError('invalidPath', `scim: 组不支持的操作:${op.op} ${JSON.stringify(op.path)}`)
  }

  return {
    addMembers: add,
    removeMembers: remove,
    ...(replace === undefined ? {} : { replaceMembers: replace }),
    ...(displayName === undefined ? {} : { displayName }),
  }
}
