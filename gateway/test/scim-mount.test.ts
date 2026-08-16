/**
 * V0.3.0 Session 6:SCIM 挂载与三类令牌分离。
 *
 * 三类令牌:运行时 token(终端用户)· Admin Key(按租户)· SCIM token(按身份源)。
 * 任务书要求的三条负向测试都在「令牌互斥」一节 —— 分离签发的意义全靠它们证明:
 * 没有负向测试的令牌分离只是三个名字。
 */
import { InMemorySubjectStore, type SubjectStore } from '@dshwar/subject'
import { createScimApp } from '@dshwar/scim-server'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  InMemoryAdminKeyResolver,
  InMemoryScimTokenResolver,
  NullAuditSink,
  registerAdminRoutes,
} from '../src/index.ts'
import { AUTH_ENTRIES, createTestHarness } from './harness.ts'

let subjects: SubjectStore
let app: Awaited<ReturnType<typeof createGateway>>

const json = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const SCIM = { authorization: 'Bearer scim-authentik-token' }
const RUNTIME = { authorization: 'Bearer dev-alice' }
const ADMIN = { 'x-dshwar-admin-key': 'admin-acme' }

beforeEach(async () => {
  subjects = new InMemorySubjectStore()
  const harness = await createTestHarness()

  app = createGateway({
    ctx: harness.ctx,
    adminKeys: new InMemoryAdminKeyResolver([
      { key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' },
    ]),
    adminRoutes: registerAdminRoutes({
      ctx: harness.ctx,
      audit: new NullAuditSink(),
      credentialRefs: [],
      subjects: { find: async () => undefined },
      subjectStore: subjects,
    }),
    scim: {
      source: 'authentik',
      app: createScimApp({
        source: 'authentik',
        subjects,
        tenantMap: { strategy: 'issuer', issuers: { authentik: 'acme' } },
      }),
      tokens: new InMemoryScimTokenResolver([
        { token: 'scim-authentik-token', source: 'authentik', label: 'authentik 供给' },
        { token: 'scim-entra-token', source: 'entra', label: 'entra 供给' },
      ]),
    },
  })
})

const aliceCreate = {
  externalId: 'ak-0001',
  userName: 'alice',
  displayName: 'Alice Zhang',
  active: true,
}

describe('SCIM 经网关可用', () => {
  it('SCIM token 能推用户进来', async () => {
    const res = await json('POST', '/scim/v2/Users', SCIM, aliceCreate)
    expect(res.status).toBe(201)

    const stored = await subjects.getByExternalId('authentik', 'ak-0001')
    expect(stored).toMatchObject({ userName: 'alice', tenantId: 'acme' })
  })

  it('ServiceProviderConfig 可达 —— 供给方接入的第一步', async () => {
    const res = await json('GET', '/scim/v2/ServiceProviderConfig', SCIM)
    expect(res.status).toBe(200)
  })

  it('认证失败的响应是 SCIM 格式,不是契约的 ErrorResponse', async () => {
    const res = await json('GET', '/scim/v2/Users', {})
    expect(res.status).toBe(401)
    const body = (await res.json()) as { schemas: string[] }
    // 读这个响应的是供给方的同步引擎，它只认 RFC 7644 §3.12
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
  })
})

// ★ 任务书的三条负向测试
describe('三类令牌互斥', () => {
  it('SCIM token 打 /v1/sessions → 401', async () => {
    const res = await json('GET', '/v1/sessions', SCIM)
    expect(res.status).toBe(401)
  })

  it('运行时 token 打 /scim/v2/Users → 401', async () => {
    const res = await json('GET', '/scim/v2/Users', RUNTIME)
    expect(res.status).toBe(401)
  })

  it('Admin Key 打 /scim/v2/Users → 401', async () => {
    const res = await json('GET', '/scim/v2/Users', ADMIN)
    expect(res.status).toBe(401)
  })

  it('SCIM token 打 /v1/admin/* → 401', async () => {
    const res = await json('GET', '/v1/admin/subjects', {
      'x-dshwar-admin-key': 'scim-authentik-token',
    })
    expect(res.status).toBe(401)
  })

  it('别的身份源的 SCIM token 打本挂载点 → 401,且与无效 token 不可区分', async () => {
    const wrongSource = await json('GET', '/scim/v2/Users', {
      authorization: 'Bearer scim-entra-token',
    })
    const invalid = await json('GET', '/scim/v2/Users', {
      authorization: 'Bearer no-such-token',
    })
    expect(wrongSource.status).toBe(401)
    // 「源不对」与「token 无效」必须长得一样 —— 区分它们等于告诉拿到 token 的人
    // 这把钥匙在别处有效
    expect(await wrongSource.text()).toBe(await invalid.text())
  })
})

describe('/v1/admin/subjects 由 501 转实现,契约形状不变', () => {
  beforeEach(async () => {
    await json('POST', '/scim/v2/Users', SCIM, aliceCreate)
    await json('POST', '/scim/v2/Users', SCIM, {
      externalId: 'ak-0002',
      userName: 'bob',
      active: true,
    })
  })

  it('列表:形状与冻结的契约逐字段一致', async () => {
    const res = await json('GET', '/v1/admin/subjects', ADMIN)
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      data: Record<string, unknown>[]
      nextCursor: string | null
      requestId: string
    }
    expect(body.data).toHaveLength(2)
    expect(body.nextCursor).toBeNull()

    // 契约 Subject 的七个字段,不多不少 —— 多一个是契约外泄漏,少一个挂响应校验
    expect(Object.keys(body.data[0]!).sort()).toEqual([
      'active',
      'createdAt',
      'displayName',
      'id',
      'roles',
      'tenantId',
      'updatedAt',
    ])
  })

  it('单个:SCIM 停用后 active 立即反映为 false', async () => {
    const alice = await subjects.getByExternalId('authentik', 'ak-0001')

    await json('PATCH', `/scim/v2/Users/${alice!.id}`, SCIM, {
      Operations: [{ op: 'replace', path: 'active', value: false }],
    })

    const res = await json('GET', `/v1/admin/subjects/${encodeURIComponent(alice!.id)}`, ADMIN)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { subject: { active: boolean } }
    expect(body.subject.active, '运维必须能看到谁被停了').toBe(false)
  })

  it('跨租户的镜像对这把 Key 是 403', async () => {
    // 直接往镜像塞一个别的租户的人(绕过 SCIM,模拟另一个身份源的供给)
    const outsider = await subjects.upsert({
      source: 'entra',
      externalId: 'ms-0001',
      userName: 'mallory',
      tenantId: 'globex',
    })

    const res = await json('GET', `/v1/admin/subjects/${encodeURIComponent(outsider.id)}`, ADMIN)
    expect(res.status).toBe(403)
  })

  it('列表只含本租户 —— 列表端点没有 assertTenant 可挂,必须在查询层圈死', async () => {
    await subjects.upsert({
      source: 'entra',
      externalId: 'ms-0001',
      userName: 'mallory',
      tenantId: 'globex',
    })

    const res = await json('GET', '/v1/admin/subjects', ADMIN)
    const body = (await res.json()) as { data: { tenantId: string }[] }
    expect(body.data.every((s) => s.tenantId === 'acme')).toBe(true)
  })

  it('游标分页可用', async () => {
    const first = await json('GET', '/v1/admin/subjects?limit=1', ADMIN)
    const page1 = (await first.json()) as { data: { id: string }[]; nextCursor: string | null }
    expect(page1.data).toHaveLength(1)
    expect(page1.nextCursor).not.toBeNull()

    const second = await json(
      'GET',
      `/v1/admin/subjects?limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`,
      ADMIN,
    )
    const page2 = (await second.json()) as { data: { id: string }[]; nextCursor: string | null }
    expect(page2.data).toHaveLength(1)
    expect(page2.data[0]!.id).not.toBe(page1.data[0]!.id)
  })

  it('未配置 Subject Mirror 的部署回落到 501,而不是 404 或 500', async () => {
    const bare = createGateway({
      ctx: (await createTestHarness()).ctx,
      adminKeys: new InMemoryAdminKeyResolver([
        { key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' },
      ]),
      adminRoutes: registerAdminRoutes({
        ctx: (await createTestHarness()).ctx,
        audit: new NullAuditSink(),
        credentialRefs: [],
        subjects: { find: async () => undefined },
        // 没有 subjectStore
      }),
    })

    const res = await bare.request('/v1/admin/subjects', { headers: ADMIN })
    expect(res.status).toBe(501)
  })
})

describe('quota / usage / audit 仍是 501 —— 转正只转了 subjects 两个', () => {
  it.each(['/v1/admin/usage', '/v1/admin/audit'])('%s → 501', async (path) => {
    const res = await json('GET', path, ADMIN)
    expect(res.status).toBe(501)
  })
})

/** AUTH_ENTRIES 在 harness 里,引用它防止未用告警,并确认测试口径一致。 */
it('测试用的运行时令牌来自 harness 的静态表', () => {
  expect(AUTH_ENTRIES.some((e) => e.token === 'dev-alice')).toBe(true)
})
