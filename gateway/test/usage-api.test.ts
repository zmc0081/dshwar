/**
 * V0.4.0 Session 2:计量接线 + usage 两端点转正。
 *
 * 核心链路对真实 harness 跑:一轮会话 → 上游报用量 → 会话簿的 onUsage 采集
 * → metering 归属 → /v1/admin/usage 能查到。中间不 mock 任何一环。
 */
import {
  aggregateDaily,
  InMemoryMeteringStore,
  safeRecord,
  type PriceTable,
} from '@dshwar/metering'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  NullAuditSink,
  registerAdminRoutes,
  registerRuntimeRoutes,
} from '../src/index.ts'
import { AUTH_ENTRIES, createTestHarness, readSSE } from './harness.ts'

const prices: PriceTable = {
  currency: 'CNY',
  prices: { 'fake/fake-1': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 } },
}

let metering: InMemoryMeteringStore
let app: ReturnType<typeof createGateway>
let meteringErrors: string[]

const ALICE = { authorization: 'Bearer dev-alice' }
const ADMIN = { 'x-dshwar-admin-key': 'admin-acme' }

/** 起一个完整网关。`breakMetering` 为 true 时换成必炸的 store —— 红线 1 的测试。 */
async function boot(breakMetering = false): Promise<void> {
  metering = new InMemoryMeteringStore()
  meteringErrors = []
  const target = breakMetering
    ? {
        record: async () => {
          throw new Error('metering down')
        },
        query: async () => [],
      }
    : metering

  const harness = await createTestHarness({ fake: { tokens: ['计', '量'] } })

  const store = new GatewaySessionStore({
    onUsage: (obs) => {
      void safeRecord(
        target,
        {
          subjectId: obs.session.subjectId,
          tenantId: obs.session.tenantId,
          sessionId: obs.session.id,
          turn: obs.turn,
          step: obs.step,
          provider: obs.session.provider ?? 'fake',
          model: obs.session.model ?? 'fake-1',
          usage: obs.usage ?? { inputTokens: 0, outputTokens: 0 },
          unreported: obs.usage === undefined,
          at: new Date().toISOString(),
        },
        (d) => meteringErrors.push(d),
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
    }),
    adminRoutes: registerAdminRoutes({
      ctx: harness.ctx,
      audit: new NullAuditSink(),
      credentialRefs: [],
      subjects: { find: async () => undefined },
      usageReader: {
        daily: async (filter) => aggregateDaily(await metering.query(filter), prices),
      },
    }),
  })
}

/** 跑完整的一轮:建会话 → 发轮 → 等 turn.completed。 */
async function runTurn(): Promise<string> {
  const created = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(created.status).toBe(201)
  const { session } = (await created.json()) as { session: { id: string } }

  const turn = await app.request(`/v1/sessions/${session.id}/turns`, {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({ input: '来一轮' }),
  })
  expect(turn.status).toBe(202)

  const stream = await app.request(`/v1/sessions/${session.id}/stream`, { headers: ALICE })
  await readSSE(stream, { until: (e) => e.type === 'turn.completed', maxMs: 5000 })
  return session.id
}

beforeEach(async () => {
  await boot()
})

describe('采集链路:上游用量 → metering', () => {
  it('一轮会话的用量归属到正确的 principal', async () => {
    const sessionId = await runTurn()

    const records = await metering.query({ tenantId: 'acme' })
    expect(records.length).toBeGreaterThan(0)
    expect(records[0]).toMatchObject({
      subjectId: AUTH_ENTRIES[0]!.id,
      tenantId: 'acme',
      sessionId,
      turn: 1,
    })
  })

  // 测试 harness 的 FakeLlmAdapter 不发 usage 块 —— 正好覆盖「缺席容忍」:
  // 计 0 标 unreported,不崩不估算
  it('适配器没报用量时计 0 并标 unreported', async () => {
    await runTurn()
    const records = await metering.query({ tenantId: 'acme' })
    expect(records[0]!.unreported).toBe(true)
    expect(records[0]!.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 })
  })
})

describe('红线 1:计量挂了,会话照常', () => {
  it('metering store 必炸时一轮照样跑完,错误进回调', async () => {
    await boot(true)
    await expect(runTurn()).resolves.toBeDefined()
    expect(meteringErrors.length).toBeGreaterThan(0)
    expect(meteringErrors[0]).toMatch(/metering down/)
  })
})

describe('/v1/admin/usage 转正', () => {
  it('聚合行是契约 UsageRecord 的九个字段,不多不少', async () => {
    await runTurn()

    const res = await app.request('/v1/admin/usage', { headers: ADMIN })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>[] }
    expect(body.data.length).toBeGreaterThan(0)
    expect(Object.keys(body.data[0]!).sort()).toEqual([
      'costMinorUnits',
      'currency',
      'date',
      'inputTokens',
      'model',
      'outputTokens',
      'provider',
      'subjectId',
      'tenantId',
    ])
  })

  it('跨租户的 Admin Key 看不到 acme 的用量', async () => {
    await runTurn()
    const res = await app.request('/v1/admin/usage', {
      headers: { 'x-dshwar-admin-key': 'admin-globex' },
    })
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
  })

  it('单主体明细端点按 subject 过滤', async () => {
    await runTurn()
    const res = await app.request(`/v1/admin/subjects/${AUTH_ENTRIES[0]!.id}/usage`, {
      headers: ADMIN,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { subjectId: string }[] }
    expect(body.data.every((r) => r.subjectId === AUTH_ENTRIES[0]!.id)).toBe(true)
  })

  it('未配置计量的部署回落 501', async () => {
    const harness = await createTestHarness()
    const bare = createGateway({
      ctx: harness.ctx,
      adminKeys: new InMemoryAdminKeyResolver([
        { key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' },
      ]),
      adminRoutes: registerAdminRoutes({
        ctx: harness.ctx,
        audit: new NullAuditSink(),
        credentialRefs: [],
        subjects: { find: async () => undefined },
      }),
    })
    expect((await bare.request('/v1/admin/usage', { headers: ADMIN })).status).toBe(501)
  })
})
