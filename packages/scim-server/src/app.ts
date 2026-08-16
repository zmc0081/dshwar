/**
 * SCIM 2.0 服务端 —— HTTP 层。
 *
 * 一个实例服务**一个身份源**(`source`)。多 IdP 并存时各挂一个实例,
 * 各配各的 token(Session 6 的网关层负责 token → source 的绑定)。
 *
 * ## 停用是这里最重要的链路
 *
 * `PUT` 与 `PATCH` 两条路径都必须能把 `active:false` 落到 Subject Mirror ——
 * Entra / Okta 停用发 PATCH,authentik 发 PUT(`docs/FEASIBILITY-REPORT-V3.md` §4)。
 * 只做一条,就会「在 A 家能停用、在 B 家停不掉」,而停不掉意味着离职员工仍能调模型。
 *
 * `DELETE` 是删除,**不是**停用信号:Entra 的硬删除延迟 30 天才发。
 *
 * @module @dshwar/scim-server/app
 */
import {
  assertNoCredentialFields,
  SubjectError,
  type Subject,
  type SubjectStore,
} from '@dshwar/subject'
import { resolveTenant, TenantMappingError, type TenantMapConfig } from '@dshwar/tenant-map'
import { Hono } from 'hono'
import { InMemoryGroupStore, type GroupStore, type ScimGroup } from './groups.ts'
import {
  applyGroupPatch,
  applyUserPatch,
  listResponse,
  parseActiveValue,
  parseFilter,
  parsePatchBody,
  PatchError,
  scimError,
  UnsupportedFilterError,
} from './protocol.ts'

/** 一条审计记录。真正的落盘由挂载方(网关)接管。 */
export interface ScimAuditRecord {
  readonly action: string
  readonly target: string
  readonly detail: string
}

export interface ScimAppOptions {
  /** 这个实例服务的身份源。 */
  readonly source: string
  readonly subjects: SubjectStore
  /** 组存储。缺省用内存实现。 */
  readonly groups?: GroupStore
  readonly tenantMap: TenantMapConfig
  /** 每次列表最多返回多少条。声明进 /ServiceProviderConfig,必须与实现一致。 */
  readonly maxResults?: number
  readonly onAudit?: (record: ScimAuditRecord) => void
}

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'

interface RawUserPayload {
  readonly externalId?: unknown
  readonly userName?: unknown
  readonly active?: unknown
  readonly displayName?: unknown
  readonly emails?: unknown
  readonly [key: string]: unknown
}

/** Subject → SCIM User 表示。 */
function toScimUser(subject: Subject, memberships: readonly ScimGroup[]): Record<string, unknown> {
  return {
    schemas: [USER_SCHEMA],
    id: subject.id,
    externalId: subject.externalId,
    userName: subject.userName,
    active: subject.active,
    displayName: subject.displayName,
    emails: subject.emails.map((e) => ({ value: e.value, primary: e.primary })),
    groups: memberships.map((g) => ({ value: g.id, display: g.displayName })),
    meta: {
      resourceType: 'User',
      created: subject.createdAt,
      lastModified: subject.updatedAt,
    },
  }
}

function toScimGroup(group: ScimGroup): Record<string, unknown> {
  return {
    schemas: [GROUP_SCHEMA],
    id: group.id,
    externalId: group.externalId,
    displayName: group.displayName,
    members: group.members.map((id) => ({ value: id })),
    meta: {
      resourceType: 'Group',
      created: group.createdAt,
      lastModified: group.updatedAt,
    },
  }
}

function parseEmails(raw: unknown): { value: string; primary: boolean }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => {
      const item = e as { value?: unknown; primary?: unknown }
      return typeof item?.value === 'string'
        ? { value: item.value, primary: item.primary === true }
        : undefined
    })
    .filter((e): e is { value: string; primary: boolean } => e !== undefined)
}

/**
 * 建 SCIM 应用。挂载方决定路径前缀(约定 `/scim/v2`)与鉴权。
 */
export function createScimApp(options: ScimAppOptions): Hono {
  const app = new Hono()
  const source = options.source
  const subjects = options.subjects
  const groups = options.groups ?? new InMemoryGroupStore()
  const maxResults = options.maxResults ?? 200
  const audit = options.onAudit ?? (() => undefined)

  // ---- 错误边界:一律 SCIM 错误格式,供给方只认它 ----
  app.onError((error, c) => {
    if (error instanceof UnsupportedFilterError) {
      return c.json(scimError(501, error.message), 501)
    }
    if (error instanceof PatchError) {
      return c.json(scimError(400, error.message, error.scimType), 400)
    }
    if (error instanceof SubjectError) {
      return c.json(scimError(400, error.message, 'invalidValue'), 400)
    }
    if (error instanceof TenantMappingError) {
      return c.json(scimError(400, error.message, 'invalidValue'), 400)
    }
    return c.json(scimError(500, 'internal error'), 500)
  })

  /** 该 subject 当前的组成员关系。 */
  async function membershipsOf(subjectId: string): Promise<ScimGroup[]> {
    return (await groups.list(source)).filter((g) => g.members.includes(subjectId))
  }

  /** 由(可能来自组变更的)最新事实裁决租户。见各调用点关于「何时重裁」的说明。 */
  function decideTenant(payload: Record<string, unknown>, groupNames: readonly string[]): string {
    return resolveTenant({ claims: payload, groups: groupNames, issuer: source }, options.tenantMap)
  }

  // =====================================================================
  // 能力声明。★ 第一优先级且必须如实:authentik 读它决定用 PATCH 还是 PUT,
  // 并缓存一小时 —— 虚报一次,供给方接下来一小时都用错方法(REPORT-V3 §5)。
  // =====================================================================
  app.get('/ServiceProviderConfig', (c) =>
    c.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      // 真的实现了,才写 true
      patch: { supported: true },
      filter: { supported: true, maxResults },
      // 以下都没实现,如实写 false —— 虚报 bulk 会让 Entra 直接用 bulk 端点
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      sort: { supported: false },
      etag: { supported: false },
      // DSHWAR 不存密码(硬规则 4),这条永远是 false
      changePassword: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer Token',
          description: 'SCIM token,按身份源签发,只能写身份镜像',
        },
      ],
    }),
  )

  app.get('/Schemas', (c) =>
    c.json(
      listResponse(
        [
          { id: USER_SCHEMA, name: 'User', description: 'DSHWAR Subject Mirror 的 SCIM 表示' },
          { id: GROUP_SCHEMA, name: 'Group', description: '组;租户映射 strategy:group 的来源' },
        ],
        1,
        maxResults,
      ),
    ),
  )

  app.get('/ResourceTypes', (c) =>
    c.json(
      listResponse(
        [
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'User',
            name: 'User',
            endpoint: '/Users',
            schema: USER_SCHEMA,
          },
          {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
            id: 'Group',
            name: 'Group',
            endpoint: '/Groups',
            schema: GROUP_SCHEMA,
          },
        ],
        1,
        maxResults,
      ),
    ),
  )

  // =====================================================================
  // Users
  // =====================================================================
  app.post('/Users', async (c) => {
    const payload = (await c.req.json()) as RawUserPayload

    // 硬规则 4:见到密码字段报错,而不是静默丢弃 —— 静默丢弃会让部署方
    // 以为密码同步成功了。SCIM 的 User schema 里真的有 password。
    assertNoCredentialFields(payload)

    const userName = typeof payload.userName === 'string' ? payload.userName : ''
    // externalId 缺失时用 userName 顶 —— RFC 7643 里 externalId 是可选的,
    // 但我们需要一个稳定键。两者都没有就没法定位这个人,直接 400。
    const externalId =
      typeof payload.externalId === 'string' && payload.externalId.length > 0
        ? payload.externalId
        : userName

    const existing = await subjects.getByExternalId(source, externalId)
    if (existing !== undefined) {
      // 409 让供给方回退到「先查再改」;静默 upsert 会掩盖它那边的重复推送
      return c.json(scimError(409, `scim: externalId ${externalId} 已存在`, 'uniqueness'), 409)
    }

    const subject = await subjects.upsert({
      source,
      externalId,
      userName,
      // ★ 建用户时组还没到(authentik 先推 Users 再推 Groups),strategy:group
      // 在这里会 unmapped → 400。这是硬规则 7 的正确行为;对 SCIM 源推荐用
      // issuer 策略(IDENTITY-INTEROP §9),README 有说明。
      tenantId: decideTenant(payload as Record<string, unknown>, []),
      active: payload.active === undefined ? true : parseActiveValue(payload.active),
      emails: parseEmails(payload.emails),
      groups: [],
      displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
    })

    audit({
      action: 'scim.user.create',
      target: subject.id,
      detail: `userName=${subject.userName}`,
    })
    return c.json(toScimUser(subject, []), 201)
  })

  app.get('/Users', async (c) => {
    const filter = c.req.query('filter')
    const startIndex = Number(c.req.query('startIndex') ?? '1')
    const count = Math.min(Number(c.req.query('count') ?? String(maxResults)), maxResults)

    let matched: Subject[]
    if (filter === undefined) {
      matched = await subjects.list({ source })
    } else {
      const eq = parseFilter(filter)
      const attribute = eq.attribute.toLowerCase()
      if (attribute === 'username') {
        matched = await subjects.list({ source, userName: eq.value })
      } else if (attribute === 'externalid') {
        matched = await subjects.list({ source, externalId: eq.value })
      } else {
        // 未知属性的 filter 返回 501 而不是静默返回全量 —— 全量是数据泄漏
        throw new UnsupportedFilterError(filter)
      }
    }

    const withGroups = await Promise.all(
      matched.map(async (s) => toScimUser(s, await membershipsOf(s.id))),
    )
    return c.json(listResponse(withGroups, startIndex, count))
  })

  app.get('/Users/:id', async (c) => {
    const subject = await subjects.get(c.req.param('id'))
    if (subject === undefined || subject.source !== source) {
      return c.json(scimError(404, 'scim: 用户不存在'), 404)
    }
    return c.json(toScimUser(subject, await membershipsOf(subject.id)))
  })

  // PUT = 整体替换。★ authentik 的停用走这条路(REPORT-V3 §4)
  app.put('/Users/:id', async (c) => {
    const existing = await subjects.get(c.req.param('id'))
    if (existing === undefined || existing.source !== source) {
      return c.json(scimError(404, 'scim: 用户不存在'), 404)
    }

    const payload = (await c.req.json()) as RawUserPayload
    assertNoCredentialFields(payload)

    // 更新时租户重裁但失败不阻断:这个人已经有归属,而 PUT 可能正是停用 ——
    // 停用必须是最健壮的一条路径,不能被映射配置问题挡住。
    let tenantId = existing.tenantId
    try {
      tenantId = decideTenant(
        payload as Record<string, unknown>,
        (await membershipsOf(existing.id)).map((g) => g.displayName),
      )
    } catch {
      audit({
        action: 'scim.user.replace.tenant-fallback',
        target: existing.id,
        detail: `租户重裁失败,沿用 ${existing.tenantId}`,
      })
    }

    const subject = await subjects.upsert({
      source,
      externalId: existing.externalId,
      userName: typeof payload.userName === 'string' ? payload.userName : existing.userName,
      tenantId,
      // RFC 7643:active 缺省即启用。PUT 是整体替换,不继承旧值。
      active: payload.active === undefined ? true : parseActiveValue(payload.active),
      emails: parseEmails(payload.emails),
      groups: existing.groups,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
    })

    audit({ action: 'scim.user.replace', target: subject.id, detail: `active=${subject.active}` })
    return c.json(toScimUser(subject, await membershipsOf(subject.id)))
  })

  // PATCH:Entra / Okta 的停用走这条路
  app.patch('/Users/:id', async (c) => {
    const existing = await subjects.get(c.req.param('id'))
    if (existing === undefined || existing.source !== source) {
      return c.json(scimError(404, 'scim: 用户不存在'), 404)
    }

    const changes = applyUserPatch(parsePatchBody(await c.req.json()))

    // PATCH 不重裁租户:它只带增量,拿不到完整事实;而且 PATCH 常常就是停用本身,
    // 停用不能被映射问题挡住。
    const subject = await subjects.upsert({
      source,
      externalId: existing.externalId,
      userName: changes.userName ?? existing.userName,
      tenantId: existing.tenantId,
      active: changes.active ?? existing.active,
      emails: existing.emails,
      groups: existing.groups,
      displayName: changes.displayName === undefined ? existing.displayName : changes.displayName,
    })

    audit({ action: 'scim.user.patch', target: subject.id, detail: `active=${subject.active}` })
    return c.json(toScimUser(subject, await membershipsOf(subject.id)))
  })

  // DELETE 是删除,不是停用。Entra 的硬删除延迟 30 天才发 —— 把它当停用信号,
  // 离职员工还能再用一个月。停用走 active:false。
  app.delete('/Users/:id', async (c) => {
    const existing = await subjects.get(c.req.param('id'))
    if (existing === undefined || existing.source !== source) {
      return c.json(scimError(404, 'scim: 用户不存在'), 404)
    }
    await subjects.remove(existing.id)
    audit({
      action: 'scim.user.delete',
      target: existing.id,
      detail: `userName=${existing.userName}`,
    })
    return c.body(null, 204)
  })

  // =====================================================================
  // Groups
  // =====================================================================

  /** 组变更后,把成员的 Subject.groups 同步成最新,并按需重裁租户。 */
  async function syncMembers(affected: ReadonlySet<string>): Promise<void> {
    for (const subjectId of affected) {
      const subject = await subjects.get(subjectId)
      if (subject === undefined) continue

      const names = (await membershipsOf(subjectId)).map((g) => g.displayName)

      // 只有 strategy:group 需要重裁 —— 组就是它的事实来源。歧义(两个租户组)
      // 会在这里抛出并让整个组操作 400,这是刻意的:静默选一个等于把归属交给
      // 组到达的顺序。其它策略沿用既有租户,组变更影响不到归属。
      const tenantId =
        options.tenantMap.strategy === 'group' ? decideTenant({}, names) : subject.tenantId

      await subjects.upsert({
        source,
        externalId: subject.externalId,
        userName: subject.userName,
        tenantId,
        active: subject.active,
        emails: subject.emails,
        groups: names,
        displayName: subject.displayName,
      })
    }
  }

  app.post('/Groups', async (c) => {
    const payload = (await c.req.json()) as {
      displayName?: unknown
      externalId?: unknown
      members?: unknown
    }
    if (typeof payload.displayName !== 'string' || payload.displayName.trim().length === 0) {
      return c.json(scimError(400, 'scim: 组需要 displayName', 'invalidValue'), 400)
    }

    const duplicate = await groups.getByDisplayName(source, payload.displayName)
    if (duplicate !== undefined) {
      return c.json(scimError(409, `scim: 组 ${payload.displayName} 已存在`, 'uniqueness'), 409)
    }

    const memberIds = Array.isArray(payload.members)
      ? payload.members
          .map((m) => (m as { value?: unknown })?.value)
          .filter((v): v is string => typeof v === 'string')
      : []

    const group = await groups.create({
      source,
      externalId: typeof payload.externalId === 'string' ? payload.externalId : null,
      displayName: payload.displayName,
      members: memberIds,
    })
    await syncMembers(new Set(memberIds))

    audit({ action: 'scim.group.create', target: group.id, detail: group.displayName })
    return c.json(toScimGroup(group), 201)
  })

  app.get('/Groups', async (c) => {
    const filter = c.req.query('filter')
    const startIndex = Number(c.req.query('startIndex') ?? '1')
    const count = Math.min(Number(c.req.query('count') ?? String(maxResults)), maxResults)

    let matched: ScimGroup[]
    if (filter === undefined) {
      matched = await groups.list(source)
    } else {
      const eq = parseFilter(filter)
      if (eq.attribute.toLowerCase() === 'displayname') {
        const found = await groups.getByDisplayName(source, eq.value)
        matched = found === undefined ? [] : [found]
      } else {
        throw new UnsupportedFilterError(filter)
      }
    }

    return c.json(listResponse(matched.map(toScimGroup), startIndex, count))
  })

  app.get('/Groups/:id', async (c) => {
    const group = await groups.get(c.req.param('id'))
    if (group === undefined || group.source !== source) {
      return c.json(scimError(404, 'scim: 组不存在'), 404)
    }
    return c.json(toScimGroup(group))
  })

  app.put('/Groups/:id', async (c) => {
    const existing = await groups.get(c.req.param('id'))
    if (existing === undefined || existing.source !== source) {
      return c.json(scimError(404, 'scim: 组不存在'), 404)
    }
    const payload = (await c.req.json()) as { displayName?: unknown; members?: unknown }
    const memberIds = Array.isArray(payload.members)
      ? payload.members
          .map((m) => (m as { value?: unknown })?.value)
          .filter((v): v is string => typeof v === 'string')
      : []

    const before = new Set(existing.members)
    const updated = await groups.update(existing.id, {
      ...(typeof payload.displayName === 'string' ? { displayName: payload.displayName } : {}),
      members: memberIds,
    })
    await syncMembers(new Set([...before, ...memberIds]))

    audit({
      action: 'scim.group.replace',
      target: existing.id,
      detail: `members=${memberIds.length}`,
    })
    return c.json(toScimGroup(updated!))
  })

  app.patch('/Groups/:id', async (c) => {
    const existing = await groups.get(c.req.param('id'))
    if (existing === undefined || existing.source !== source) {
      return c.json(scimError(404, 'scim: 组不存在'), 404)
    }

    const result = applyGroupPatch(parsePatchBody(await c.req.json()))

    const next = new Set(result.replaceMembers ?? existing.members)
    for (const id of result.addMembers) next.add(id)
    for (const id of result.removeMembers) next.delete(id)

    const updated = await groups.update(existing.id, {
      members: [...next],
      ...(result.displayName === undefined ? {} : { displayName: result.displayName }),
    })
    // 被移除的成员也要同步 —— 他们的 groups 列表刚失去了一项
    await syncMembers(new Set([...existing.members, ...next]))

    audit({ action: 'scim.group.patch', target: existing.id, detail: `members=${next.size}` })
    return c.json(toScimGroup(updated!))
  })

  app.delete('/Groups/:id', async (c) => {
    const existing = await groups.get(c.req.param('id'))
    if (existing === undefined || existing.source !== source) {
      return c.json(scimError(404, 'scim: 组不存在'), 404)
    }
    await groups.remove(existing.id)
    await syncMembers(new Set(existing.members))
    audit({ action: 'scim.group.delete', target: existing.id, detail: existing.displayName })
    return c.body(null, 204)
  })

  return app
}
