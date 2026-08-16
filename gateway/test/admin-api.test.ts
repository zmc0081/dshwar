import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { StaticAuth } from '@dshwar/auth-static'
import {
  InMemoryPrincipalCredentialStore,
  MultiuserCredentials,
} from '@dshwar/credentials-multiuser'
import { createPrincipal, PrincipalService, type Principal } from '@dshwar/principal'
import type { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ADMIN_KEY_HEADER,
  createGateway,
  InMemoryAdminKeyResolver,
  NullAuditSink,
  registerAdminRoutes,
  type GatewayEnv,
} from '../src/index.ts'
import { AUTH_ENTRIES } from './harness.ts'

const REF = credentialRef('DEEPSEEK_API_KEY')
const OTHER_REF = credentialRef('OPENAI_API_KEY')

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })

let app: Hono<GatewayEnv>
let audit: NullAuditSink
let store: InMemoryPrincipalCredentialStore

beforeEach(async () => {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, { entries: AUTH_ENTRIES, quiet: true })

  store = new InMemoryPrincipalCredentialStore()
  // alice 配了 key，bob 没配 —— 用来验 configured 的两种取值
  await store.put(alice, REF, 'sk-alice-SUPER-SECRET-VALUE')
  await ctx.plugin(MultiuserCredentials, { store })

  audit = new NullAuditSink()

  const subjects = new Map<string, Principal>([
    [alice.id, alice],
    [bob.id, bob],
  ])

  app = createGateway({
    ctx,
    adminKeys: new InMemoryAdminKeyResolver([
      { key: 'admin-acme', tenantId: 'acme', label: 'acme 运维' },
      { key: 'admin-globex', tenantId: 'globex', label: 'globex 运维' },
    ]),
    adminRoutes: registerAdminRoutes({
      ctx,
      subjects: { find: async (id) => subjects.get(id) },
      audit,
      credentialRefs: [REF, OTHER_REF],
    }),
  })
})

const asAdmin = (key: string, path: string) =>
  app.request(path, { headers: { [ADMIN_KEY_HEADER]: key } })

describe('凭据端点:永不返回值(硬规则 5)', () => {
  it('返回 configured / source / writable,别无他物', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as { data: Record<string, unknown>[] }
    expect(body.data.length).toBe(2)
    for (const item of body.data) {
      expect(Object.keys(item).sort()).toEqual(['configured', 'ref', 'source', 'writable'])
    }
  })

  // 正则扫描，不靠人看
  it('响应体不含任何 key 值', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)
    const text = JSON.stringify(await res.json())

    expect(text).not.toContain('sk-alice')
    expect(text).not.toContain('SUPER-SECRET')
    // 连片段也不行
    expect(/sk-[A-Za-z0-9-]{4,}/.test(text), '响应体里出现了疑似密钥的串').toBe(false)
  })

  it('已配置的 ref 报 configured=true 且 source 指向 principal', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)
    const body = (await res.json()) as {
      data: { ref: string; configured: boolean; source: string | null }[]
    }

    const configured = body.data.find((d) => d.ref === REF)!
    expect(configured.configured).toBe(true)
    expect(configured.source).toBe(`principal:${alice.id}`)
  })

  it('未配置的 ref 报 configured=false 且 source 为 null', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)
    const body = (await res.json()) as {
      data: { ref: string; configured: boolean; source: string | null }[]
    }

    const missing = body.data.find((d) => d.ref === OTHER_REF)!
    expect(missing.configured).toBe(false)
    expect(missing.source).toBeNull()
  })

  // 不在目标主体作用域内调用的话，credentials 会读到匿名 → 永远 unconfigured
  it('在目标主体的作用域内查询,而不是匿名', async () => {
    const res = await asAdmin('admin-globex', `/v1/admin/subjects/${bob.id}/credentials`)
    const body = (await res.json()) as { data: { configured: boolean }[] }

    // bob 没配任何 key，全部 unconfigured —— 但这必须是"查了 bob"的结果，
    // 上一条测试证明了查 alice 时能查到，两条合起来说明作用域是对的
    expect(body.data.every((d) => !d.configured)).toBe(true)
  })
})

describe('跨租户 Admin Key', () => {
  it('acme 的 key 读不到 globex 的主体', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${bob.id}/credentials`)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden')
  })

  it('反向同样被拒', async () => {
    const res = await asAdmin('admin-globex', `/v1/admin/subjects/${alice.id}/credentials`)
    expect(res.status).toBe(403)
  })

  it('被拒时不泄漏目标主体的任何凭据信息', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${bob.id}/credentials`)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('configured')
    expect(text).not.toContain(REF)
  })

  it('不存在的主体返回 404', async () => {
    const res = await asAdmin('admin-acme', '/v1/admin/subjects/nobody/credentials')
    expect(res.status).toBe(404)
  })
})

describe('planned 端点', () => {
  const PLANNED = [
    '/v1/admin/subjects',
    `/v1/admin/subjects/${alice.id}`,
    `/v1/admin/subjects/${alice.id}/quota`,
    `/v1/admin/subjects/${alice.id}/usage`,
    '/v1/admin/usage',
    '/v1/admin/policies',
    '/v1/admin/audit',
  ]

  // 404 会让第三方以为路径写错了，从而去猜别的路径
  it('全部返回 501 而非 404', async () => {
    for (const path of PLANNED) {
      const res = await asAdmin('admin-acme', path)
      expect(res.status, `${path} 应返回 501`).toBe(501)
    }
  })

  it('响应体用统一错误形状,code 为 not_implemented', async () => {
    const res = await asAdmin('admin-acme', '/v1/admin/usage')
    const body = (await res.json()) as { error: Record<string, unknown> }

    expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId'])
    expect(body.error['code']).toBe('not_implemented')
  })

  it('响应头带 x-dshwar-planned-version', async () => {
    const res = await asAdmin('admin-acme', '/v1/admin/usage')
    expect(res.headers.get('x-dshwar-planned-version')).toBe('V0.4.0')
  })

  it('subjects 计划在 V0.3.0,usage 计划在 V0.4.0', async () => {
    const subjects = await asAdmin('admin-acme', '/v1/admin/subjects')
    const usage = await asAdmin('admin-acme', '/v1/admin/usage')

    expect(subjects.headers.get('x-dshwar-planned-version')).toBe('V0.3.0')
    expect(usage.headers.get('x-dshwar-planned-version')).toBe('V0.4.0')
  })

  // planned 清单从契约里读而非手写 —— 手写会漂移，
  // 契约加了端点而这里忘了，第三方就撞 404 而不是 501
  it('契约里的每个 planned 端点都已挂载', async () => {
    const { ROUTES } = await import('@dshwar/api-contract')
    const planned = ROUTES.filter((r) => r.status === 'planned')
    expect(planned.length).toBe(8)

    for (const route of planned) {
      const path = route.path.replace('{id}', alice.id)
      const res = await app.request(path, {
        method: route.method.toUpperCase(),
        headers: { [ADMIN_KEY_HEADER]: 'admin-acme', 'content-type': 'application/json' },
        ...(route.method === 'patch' ? { body: '{}' } : {}),
      })
      expect(res.status, `${route.operationId} 未挂载`).toBe(501)
    }
  })
})

describe('审计埋点', () => {
  it('凭据查询被记录', async () => {
    await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)

    expect(audit.entries).toHaveLength(1)
    const entry = audit.entries[0]!
    expect(entry.action).toBe('admin.credentials.describe')
    expect(entry.target).toBe(alice.id)
    expect(entry.actor).toBe('acme 运维')
    expect(entry.tenantId).toBe('acme')
    expect(entry.requestId).toBeTruthy()
  })

  // 审计日志的保留期比凭据轮换周期长得多 ——
  // 把值写进去等于造了一个长期留存的密钥副本
  it('审计记录里不含凭据值', async () => {
    await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)
    const text = JSON.stringify(audit.entries)

    expect(text).not.toContain('sk-alice')
    expect(/sk-[A-Za-z0-9-]{4,}/.test(text)).toBe(false)
  })

  it('审计记录不含 Admin Key 本身,只有标签', async () => {
    await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)
    expect(JSON.stringify(audit.entries)).not.toContain('admin-acme')
  })

  it('planned 端点的调用也被记录', async () => {
    await asAdmin('admin-acme', '/v1/admin/usage')
    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0]!.action).toBe('admin.listUsage')
  })

  it('被拒的跨租户调用不产生成功记录', async () => {
    await asAdmin('admin-acme', `/v1/admin/subjects/${bob.id}/credentials`)
    expect(audit.entries.filter((e) => e.action === 'admin.credentials.describe')).toHaveLength(0)
  })
})

describe('分页', () => {
  it('游标分页,limit 生效', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials?limit=1`)
    const body = (await res.json()) as { data: unknown[]; nextCursor: string | null }

    expect(body.data).toHaveLength(1)
    expect(body.nextCursor).toBeTruthy()
  })

  it('用游标取下一页', async () => {
    const first = (await (
      await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials?limit=1`)
    ).json()) as { data: { ref: string }[]; nextCursor: string }

    const second = (await (
      await asAdmin(
        'admin-acme',
        `/v1/admin/subjects/${alice.id}/credentials?limit=1&cursor=${first.nextCursor}`,
      )
    ).json()) as { data: { ref: string }[]; nextCursor: string | null }

    expect(second.data[0]!.ref).not.toBe(first.data[0]!.ref)
    expect(second.nextCursor).toBeNull()
  })

  it('所有响应带 requestId', async () => {
    const res = await asAdmin('admin-acme', `/v1/admin/subjects/${alice.id}/credentials`)
    const body = (await res.json()) as { requestId: string }
    expect(body.requestId).toBeTruthy()
  })
})
