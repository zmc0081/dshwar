/**
 * V0.4.0 Session 3:配额闸 + quota 两端点转正。
 *
 * 端到端对真实 harness:烧完配额 → 下一轮 429;PATCH 提额 → 立即恢复;
 * 变更进审计,before/after 都在。
 */
import { InMemoryAuditStore } from '@dshwar/audit'
import { InMemoryMeteringStore, safeRecord } from '@dshwar/metering'
import { InMemoryQuotaStore, PolicyService } from '@dshwar/policy'
import { InMemorySubjectStore } from '@dshwar/subject'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  registerAdminRoutes,
  registerRuntimeRoutes,
  StoreAuditSink,
} from '../src/index.ts'
import { AUTH_ENTRIES, createTestHarness, readSSE } from './harness.ts'

const ALICE = { authorization: 'Bearer dev-alice' }
const ADMIN = { 'x-dshwar-admin-key': 'admin-acme' }
const aliceId = AUTH_ENTRIES[0]!.id

let app: ReturnType<typeof createGateway>
let quotas: InMemoryQuotaStore
let audits: InMemoryAuditStore

beforeEach(async () => {
  const metering = new InMemoryMeteringStore()
  quotas = new InMemoryQuotaStore()
  audits = new InMemoryAuditStore()

  const subjects = new InMemorySubjectStore()
  await subjects.upsert({
    source: 'static',
    externalId: aliceId,
    userName: 'alice',
    tenantId: 'acme',
  })
  const mirror = await subjects.getByExternalId('static', aliceId)

  const policy = new PolicyService({
    quotas,
    metering,
    // 测试网关的主体 id 来自 auth-static(不是镜像 id),租户映射在此桥接
    tenantOf: async (id) => (id === aliceId ? 'acme' : undefined),
    onMeteringUnavailable: () => undefined,
  })

  const harness = await createTestHarness({ fake: { tokens: ['烧', '钱'] } })
  const store = new GatewaySessionStore({
    onUsage: (obs) => {
      void safeRecord(
        metering,
        {
          subjectId: obs.session.subjectId,
          tenantId: obs.session.tenantId,
          sessionId: obs.session.id,
          turn: obs.turn,
          step: obs.step,
          provider: 'fake',
          model: 'fake-1',
          // harness 的假适配器不报用量;为了让「烧配额」可测,这里把每条
          // assistant/message 记为固定 100 token —— 采集路径仍是真实的
          usage: obs.usage ?? { inputTokens: 60, outputTokens: 40 },
          unreported: obs.usage === undefined,
          at: new Date().toISOString(),
        },
        () => undefined,
      )
    },
  })

  app = createGateway({
    ctx: harness.ctx,
    adminKeys: new InMemoryAdminKeyResolver([
      { key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' },
      { key: 'admin-globex', label: 'globex 运维', tenantId: 'globex' },
    ]),
    runtimeRoutes: registerRuntimeRoutes({
      store,
      createAgent: harness.createAgent,
      userMessage: harness.userMessage,
      heartbeatMs: 500,
      quota: policy,
    }),
    adminRoutes: registerAdminRoutes({
      ctx: harness.ctx,
      audit: new StoreAuditSink(audits),
      credentialRefs: [],
      subjects: { find: async () => undefined },
      quotaAdmin: {
        quotaOf: (id) => policy.quotaOf(id),
        setLimit: (id, limit) => quotas.setLimit(id, limit),
      },
    }),
  })
  void mirror
})

async function createSession(): Promise<string> {
  const created = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  return ((await created.json()) as { session: { id: string } }).session.id
}

async function fireTurn(sessionId: string): Promise<number> {
  const res = await app.request(`/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({ input: '烧一轮' }),
  })
  if (res.status === 202) {
    const stream = await app.request(`/v1/sessions/${sessionId}/stream`, { headers: ALICE })
    await readSSE(stream, { until: (e) => e.type === 'turn.completed', maxMs: 5000 })
  }
  return res.status
}

describe('R9 端到端:烧完配额 → 下一轮 429', () => {
  it('限额内放行,烧完后 429,错误形状与契约一致', async () => {
    // 每轮记 100 token,上限 100:第一轮过(判定时 used=0),烧完后 used>=limit,第二轮被拒
    await quotas.setLimit(aliceId, 100)
    const sessionId = await createSession()

    expect(await fireTurn(sessionId)).toBe(202)

    const denied = await app.request(`/v1/sessions/${sessionId}/turns`, {
      method: 'POST',
      headers: { ...ALICE, 'content-type': 'application/json' },
      body: JSON.stringify({ input: '再来' }),
    })
    expect(denied.status).toBe(429)
    const body = (await denied.json()) as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('rate_limited')
    expect(body.error.requestId).toMatch(/\S/)
  })

  it('没设上限的主体不受影响', async () => {
    const sessionId = await createSession()
    expect(await fireTurn(sessionId)).toBe(202)
    expect(await fireTurn(sessionId)).toBe(202)
  })

  it('PATCH 提额后立即恢复 —— 余额不缓存', async () => {
    await quotas.setLimit(aliceId, 100)
    const sessionId = await createSession()
    await fireTurn(sessionId)

    // 烧完了
    expect(await fireTurn(sessionId)).toBe(429)

    // 运维提额
    const patched = await app.request(`/v1/admin/subjects/${aliceId}/quota`, {
      method: 'PATCH',
      headers: { ...ADMIN, 'content-type': 'application/json' },
      body: JSON.stringify({ tokenLimit: 10_000 }),
    })
    expect(patched.status).toBe(200)

    // 立即能用 —— 缓存的余额会让「提额」变成「提额并等缓存过期」
    expect(await fireTurn(sessionId)).toBe(202)
  })
})

describe('quota 两端点转正', () => {
  it('GET 返回契约 Quota 的五个字段,tokenUsed 是实时数', async () => {
    await quotas.setLimit(aliceId, 5000)
    const sessionId = await createSession()
    await fireTurn(sessionId)

    const res = await app.request(`/v1/admin/subjects/${aliceId}/quota`, { headers: ADMIN })
    expect(res.status).toBe(200)
    const { quota } = (await res.json()) as { quota: Record<string, unknown> }
    expect(Object.keys(quota).sort()).toEqual([
      'periodEnd',
      'periodStart',
      'subjectId',
      'tokenLimit',
      'tokenUsed',
    ])
    expect(quota['tokenUsed']).toBe(100)
  })

  it('PATCH 的变更进审计,before/after 都在', async () => {
    await quotas.setLimit(aliceId, 100)
    await app.request(`/v1/admin/subjects/${aliceId}/quota`, {
      method: 'PATCH',
      headers: { ...ADMIN, 'content-type': 'application/json' },
      body: JSON.stringify({ tokenLimit: 900 }),
    })
    await new Promise((r) => setTimeout(r, 10))

    const { data } = await audits.query({ tenantId: 'acme', action: 'admin.updateSubjectQuota' })
    expect(data).toHaveLength(1)
    // 「谁在什么时候把限额从多少改到多少」是账务纠纷时的第一个问题
    expect(data[0]!.before).toEqual({ tokenLimit: 100 })
    expect(data[0]!.after).toEqual({ tokenLimit: 900 })
  })

  it('tokenLimit 非法值 → 400;null 合法(改回不限)', async () => {
    for (const bad of [-1, 1.5, 'many']) {
      const res = await app.request(`/v1/admin/subjects/${aliceId}/quota`, {
        method: 'PATCH',
        headers: { ...ADMIN, 'content-type': 'application/json' },
        body: JSON.stringify({ tokenLimit: bad }),
      })
      expect(res.status, String(bad)).toBe(400)
    }

    const unset = await app.request(`/v1/admin/subjects/${aliceId}/quota`, {
      method: 'PATCH',
      headers: { ...ADMIN, 'content-type': 'application/json' },
      body: JSON.stringify({ tokenLimit: null }),
    })
    expect(unset.status).toBe(200)
  })

  it('租户未知的主体 → 404;未配置 quotaAdmin 的部署 → 501', async () => {
    const missing = await app.request('/v1/admin/subjects/stranger/quota', { headers: ADMIN })
    expect(missing.status).toBe(404)

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
    expect(
      (await bare.request(`/v1/admin/subjects/${aliceId}/quota`, { headers: ADMIN })).status,
    ).toBe(501)
  })
})
