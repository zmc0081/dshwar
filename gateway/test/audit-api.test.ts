/**
 * V0.4.0 Session 1:/v1/admin/audit 由 501 转实现 + StoreAuditSink 接线。
 *
 * 关键性质:Admin 操作产生的审计,能从审计端点自己查回来 —— 审计链闭环。
 */
import { InMemoryAuditStore } from '@dshwar/audit'
import { InMemorySubjectStore } from '@dshwar/subject'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  InMemoryAdminKeyResolver,
  registerAdminRoutes,
  StoreAuditSink,
} from '../src/index.ts'
import { createTestHarness } from './harness.ts'

let audits: InMemoryAuditStore
let app: ReturnType<typeof createGateway>

const ADMIN = { 'x-dshwar-admin-key': 'admin-acme' }
const OTHER = { 'x-dshwar-admin-key': 'admin-globex' }

beforeEach(async () => {
  audits = new InMemoryAuditStore()
  const subjects = new InMemorySubjectStore()
  await subjects.upsert({
    source: 'static',
    externalId: 'alice',
    userName: 'alice',
    tenantId: 'acme',
  })

  const harness = await createTestHarness()
  app = createGateway({
    ctx: harness.ctx,
    adminKeys: new InMemoryAdminKeyResolver([
      { key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' },
      { key: 'admin-globex', label: 'globex 运维', tenantId: 'globex' },
    ]),
    adminRoutes: registerAdminRoutes({
      ctx: harness.ctx,
      audit: new StoreAuditSink(audits),
      credentialRefs: [],
      subjects: { find: async () => undefined },
      subjectStore: subjects,
      auditStore: audits,
    }),
  })
})

/** StoreAuditSink 是 fire-and-forget,给它一拍落盘时间。 */
const settle = () => new Promise((r) => setTimeout(r, 10))

describe('/v1/admin/audit 转正', () => {
  it('Admin 操作产生的审计能从端点查回来 —— 审计链闭环', async () => {
    await app.request('/v1/admin/subjects', { headers: ADMIN })
    await settle()

    const res = await app.request('/v1/admin/audit', { headers: ADMIN })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { data: Record<string, unknown>[] }
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0]!['action']).toBe('admin.listSubjects')

    // 契约 AuditEntry 的八个字段,不多不少 —— tenantId 是过滤键,不在线上形状里
    expect(Object.keys(body.data[0]!).sort()).toEqual([
      'action',
      'actor',
      'after',
      'at',
      'before',
      'id',
      'requestId',
      'target',
    ])
  })

  it('跨租户看不到别家的审计', async () => {
    await app.request('/v1/admin/subjects', { headers: ADMIN })
    await settle()

    const res = await app.request('/v1/admin/audit', { headers: OTHER })
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toEqual([])
  })

  it('游标分页可用', async () => {
    for (let i = 0; i < 3; i += 1) await app.request('/v1/admin/subjects', { headers: ADMIN })
    await settle()

    const page1 = await app.request('/v1/admin/audit?limit=2', { headers: ADMIN })
    const body1 = (await page1.json()) as { data: unknown[]; nextCursor: string | null }
    expect(body1.data).toHaveLength(2)
    expect(body1.nextCursor).not.toBeNull()

    const page2 = await app.request(
      `/v1/admin/audit?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      { headers: ADMIN },
    )
    const body2 = (await page2.json()) as { data: { id: string }[] }
    expect(body2.data).toHaveLength(1)
  })

  it('未配置审计存储的部署回落 501', async () => {
    const harness = await createTestHarness()
    const bare = createGateway({
      ctx: harness.ctx,
      adminKeys: new InMemoryAdminKeyResolver([
        { key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' },
      ]),
      adminRoutes: registerAdminRoutes({
        ctx: harness.ctx,
        audit: new StoreAuditSink(audits),
        credentialRefs: [],
        subjects: { find: async () => undefined },
      }),
    })
    const res = await bare.request('/v1/admin/audit', { headers: ADMIN })
    expect(res.status).toBe(501)
  })
})

describe('StoreAuditSink', () => {
  it('store 抛错时不拖挂 Admin 操作(fire-and-forget + console 兜底)', async () => {
    const exploding = {
      append: async () => {
        throw new Error('disk full')
      },
    }
    const sink = new StoreAuditSink(exploding)
    // record 是同步入口,内部异步失败必须被吞掉
    expect(() =>
      sink.record({
        at: new Date().toISOString(),
        actor: 'x',
        tenantId: 'acme',
        action: 'a',
        target: 't',
        requestId: 'r',
      }),
    ).not.toThrow()
    await settle()
  })
})
