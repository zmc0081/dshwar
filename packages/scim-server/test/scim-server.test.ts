/**
 * SCIM 服务端。
 *
 * 请求体按**真实供给方的文档化形状**写(REPORT-V3 §4 的差异矩阵):
 * Entra 的 PATCH(含 active 是字符串的怪癖)、Okta 的 PATCH、authentik 的 PUT。
 * 核心断言只有一条:无论哪条路进来的 active:false,Subject Mirror 里都必须变成停用。
 */
import { InMemorySubjectStore, type SubjectStore } from '@dshwar/subject'
import { beforeEach, describe, expect, it } from 'vitest'
import { createScimApp, type ScimAuditRecord } from '../src/index.ts'

let subjects: SubjectStore
let audits: ScimAuditRecord[]
let app: ReturnType<typeof createScimApp>

/** 起一个 issuer 策略的实例 —— SCIM 源的推荐策略(IDENTITY-INTEROP §9)。 */
function makeApp(tenantMap?: Parameters<typeof createScimApp>[0]['tenantMap']): void {
  app = createScimApp({
    source: 'authentik',
    subjects,
    tenantMap: tenantMap ?? { strategy: 'issuer', issuers: { authentik: 'acme' } },
    onAudit: (r) => audits.push(r),
  })
}

const json = (method: string, path: string, body?: unknown): Request =>
  new Request(`http://scim.local${path}`, {
    method,
    headers: { 'content-type': 'application/scim+json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** authentik 风格的创建载荷。 */
const aliceCreate = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'ak-0001',
  userName: 'alice',
  displayName: 'Alice Zhang',
  emails: [{ value: 'alice@acme.example', primary: true }],
  active: true,
}

beforeEach(() => {
  subjects = new InMemorySubjectStore()
  audits = []
  makeApp()
})

async function createAlice(): Promise<string> {
  const res = await app.fetch(json('POST', '/Users', aliceCreate))
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

describe('User 生命周期', () => {
  it('创建 → 镜像里有了,租户由映射裁决', async () => {
    const id = await createAlice()
    const subject = await subjects.get(id)

    expect(subject).toMatchObject({ userName: 'alice', tenantId: 'acme', active: true })
    expect(audits.map((a) => a.action)).toContain('scim.user.create')
  })

  it('重复创建 → 409,让供给方回退到先查再改', async () => {
    await createAlice()
    const res = await app.fetch(json('POST', '/Users', aliceCreate))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { scimType: string }).scimType).toBe('uniqueness')
  })

  it('filter=userName eq 查得到,unknown filter 返回 501 而不是全量', async () => {
    await createAlice()

    const found = await app.fetch(json('GET', '/Users?filter=userName%20eq%20%22alice%22'))
    expect(((await found.json()) as { totalResults: number }).totalResults).toBe(1)

    // 静默返回全量是数据泄漏:供给方以为在查一个人,实际拿到了整个目录
    const unsupported = await app.fetch(json('GET', '/Users?filter=emails.value%20co%20%22acme%22'))
    expect(unsupported.status).toBe(501)
  })

  it('DELETE 是删除 —— 且它不是停用的实现方式', async () => {
    const id = await createAlice()
    const res = await app.fetch(json('DELETE', `/Users/${id}`))
    expect(res.status).toBe(204)
    expect(await subjects.get(id)).toBeUndefined()
  })
})

// ★ 本版本的核心链路:两条路都必须能停用
describe('停用:PUT 与 PATCH 两条路径', () => {
  it('authentik 路径 —— PUT 整体替换,active:false', async () => {
    const id = await createAlice()

    const res = await app.fetch(json('PUT', `/Users/${id}`, { ...aliceCreate, active: false }))
    expect(res.status).toBe(200)

    const subject = await subjects.get(id)
    expect(subject?.active, 'PUT active:false 必须落到停用').toBe(false)
  })

  it('Okta 路径 —— PATCH replace + path=active', async () => {
    const id = await createAlice()

    const res = await app.fetch(
      json('PATCH', `/Users/${id}`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }),
    )
    expect(res.status).toBe(200)
    expect((await subjects.get(id))?.active).toBe(false)
  })

  it('Entra 路径 —— PATCH 无 path、对象 value、大写 op、active 是字符串', async () => {
    const id = await createAlice()

    // 这个形状逐字来自 Entra 的实际行为:op 大写、无 path、active 发成 "False"
    const res = await app.fetch(
      json('PATCH', `/Users/${id}`, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'Replace', value: { active: 'False' } }],
      }),
    )
    expect(res.status).toBe(200)
    expect((await subjects.get(id))?.active, 'Entra 的字符串 active 必须能停用').toBe(false)
  })

  it('停用后再启用也走得通(误停恢复)', async () => {
    const id = await createAlice()
    await app.fetch(
      json('PATCH', `/Users/${id}`, {
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }),
    )
    await app.fetch(
      json('PATCH', `/Users/${id}`, {
        Operations: [{ op: 'replace', path: 'active', value: true }],
      }),
    )
    expect((await subjects.get(id))?.active).toBe(true)
  })

  it('PUT 缺 active 时按 RFC 7643 默认启用', async () => {
    const id = await createAlice()
    const noActive = { ...aliceCreate } as Record<string, unknown>
    delete noActive['active']

    await app.fetch(json('PUT', `/Users/${id}`, noActive))
    expect((await subjects.get(id))?.active).toBe(true)
  })
})

describe('硬规则 4:密码字段', () => {
  it('创建载荷带 password → 400 并说明去供给方关掉密码同步', async () => {
    const res = await app.fetch(json('POST', '/Users', { ...aliceCreate, password: 'hunter2' }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { detail: string }).detail).toMatch(/硬规则 4/)
  })

  it('ServiceProviderConfig 声明 changePassword 不支持', async () => {
    const res = await app.fetch(json('GET', '/ServiceProviderConfig'))
    const config = (await res.json()) as { changePassword: { supported: boolean } }
    expect(config.changePassword.supported).toBe(false)
  })
})

describe('ServiceProviderConfig 如实声明(REPORT-V3 §5)', () => {
  it('声明支持的都真的实现了,没实现的都写 false', async () => {
    const res = await app.fetch(json('GET', '/ServiceProviderConfig'))
    const config = (await res.json()) as Record<string, { supported: boolean }>

    // authentik 读 patch.supported 决定用 PATCH 还是 PUT,且缓存一小时 ——
    // 这里写 true 而 PATCH 返回 501 的话,供给方会持续一小时用错方法
    expect(config['patch']?.supported).toBe(true)
    expect(config['filter']?.supported).toBe(true)
    for (const missing of ['bulk', 'sort', 'etag']) {
      expect(config[missing]?.supported, `${missing} 没实现,必须声明 false`).toBe(false)
    }
  })

  it('/Schemas 与 /ResourceTypes 能访问 —— 供给方靠它们探测', async () => {
    expect((await app.fetch(json('GET', '/Schemas'))).status).toBe(200)
    expect((await app.fetch(json('GET', '/ResourceTypes'))).status).toBe(200)
  })
})

describe('Group 与租户映射', () => {
  it('组成员同步进 Subject.groups', async () => {
    const id = await createAlice()
    await app.fetch(
      json('POST', '/Groups', { displayName: 'engineering', members: [{ value: id }] }),
    )

    expect((await subjects.get(id))?.groups).toEqual(['engineering'])
  })

  it('PATCH 增删成员,包括 Entra 风格的过滤 path', async () => {
    const id = await createAlice()
    const created = await app.fetch(json('POST', '/Groups', { displayName: 'engineering' }))
    const groupId = ((await created.json()) as { id: string }).id

    await app.fetch(
      json('PATCH', `/Groups/${groupId}`, {
        Operations: [{ op: 'add', path: 'members', value: [{ value: id }] }],
      }),
    )
    expect((await subjects.get(id))?.groups).toEqual(['engineering'])

    // Entra 移除成员的写法:path 里带过滤表达式
    await app.fetch(
      json('PATCH', `/Groups/${groupId}`, {
        Operations: [{ op: 'remove', path: `members[value eq "${id}"]` }],
      }),
    )
    expect((await subjects.get(id))?.groups).toEqual([])
  })

  it('strategy:group 下,加进租户组决定归属;加进第二个租户组被拒', async () => {
    makeApp({
      strategy: 'group',
      groupPrefix: 'tenant:',
      fallback: { kind: 'fixed', tenantId: 'staging' },
    })
    const id = await createAlice()

    const g1 = await app.fetch(
      json('POST', '/Groups', { displayName: 'tenant:acme', members: [{ value: id }] }),
    )
    expect(g1.status).toBe(201)
    expect((await subjects.get(id))?.tenantId).toBe('acme')

    // 第二个租户组 → 歧义 → 整个组操作 400,而不是静默选一个
    const g2 = await app.fetch(
      json('POST', '/Groups', { displayName: 'tenant:globex', members: [{ value: id }] }),
    )
    expect(g2.status).toBe(400)
    expect(((await g2.json()) as { detail: string }).detail).toMatch(/无法裁决/)
  })

  it('删组把成员的 groups 清干净', async () => {
    const id = await createAlice()
    const created = await app.fetch(
      json('POST', '/Groups', { displayName: 'engineering', members: [{ value: id }] }),
    )
    const groupId = ((await created.json()) as { id: string }).id

    await app.fetch(json('DELETE', `/Groups/${groupId}`))
    expect((await subjects.get(id))?.groups).toEqual([])
  })
})

describe('PATCH 协议边界', () => {
  it('未知 path 报错而不是忽略 —— 供给方以为改成功了是最难排查的失配', async () => {
    const id = await createAlice()
    const res = await app.fetch(
      json('PATCH', `/Users/${id}`, {
        Operations: [{ op: 'replace', path: 'title', value: 'CEO' }],
      }),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { scimType: string }).scimType).toBe('invalidPath')
  })

  it('缺 Operations 的 PATCH 是 invalidSyntax', async () => {
    const id = await createAlice()
    const res = await app.fetch(json('PATCH', `/Users/${id}`, { schemas: [] }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { scimType: string }).scimType).toBe('invalidSyntax')
  })

  it('active 的值不是布尔也不是布尔字符串 → invalidValue', async () => {
    const id = await createAlice()
    const res = await app.fetch(
      json('PATCH', `/Users/${id}`, {
        Operations: [{ op: 'replace', path: 'active', value: 42 }],
      }),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { scimType: string }).scimType).toBe('invalidValue')
  })

  it('错误响应是 SCIM 格式,不是 DSHWAR 的 ErrorResponse', async () => {
    const res = await app.fetch(json('GET', '/Users/nobody'))
    const body = (await res.json()) as { schemas: string[]; error?: unknown }
    // 供给方只认 SCIM 的错误 schema;DSHWAR 形状会让它们把每次失败记成未知错误
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
    expect(body.error).toBeUndefined()
  })
})

describe('分页(RFC 7644 §3.4.2,startIndex 是 1-based)', () => {
  it('startIndex 与 count 生效', async () => {
    for (let i = 0; i < 5; i += 1) {
      await app.fetch(
        json('POST', '/Users', { ...aliceCreate, externalId: `ak-${i}`, userName: `user${i}` }),
      )
    }

    const page = await app.fetch(json('GET', '/Users?startIndex=2&count=2'))
    const body = (await page.json()) as {
      totalResults: number
      itemsPerPage: number
      startIndex: number
    }
    expect(body.totalResults).toBe(5)
    expect(body.itemsPerPage).toBe(2)
    expect(body.startIndex).toBe(2)
  })
})
