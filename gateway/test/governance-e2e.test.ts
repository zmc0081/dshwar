/**
 * V0.4.0 的端到端验收(R9)—— 四个治理包一次接全,单一叙事跑完:
 *
 * ```
 * 运维设配额(入审计) → 连续发轮烧钱(计量归属) → 预算过半建会话被降级
 * (三处可见) → 烧完配额下一轮 429 → 全程:用量可查、审计可查
 * ```
 *
 * 与分包测试的关系:quota-api / model-gate / usage-api 各验一环;
 * 这里验的是**环环相扣** —— 降级的水位来自计量,429 的判定来自计量,
 * 审计串起全部变更。只测环不测链,是治理最容易假绿的地方。
 */
import { InMemoryAuditStore } from '@dshwar/audit'
import {
  aggregateDaily,
  costToWire,
  InMemoryMeteringStore,
  safeRecord,
  type PriceTable,
} from '@dshwar/metering'
import { InMemoryPolicyStore, ModelRouter } from '@dshwar/model-router'
import { InMemoryQuotaStore, PolicyService } from '@dshwar/policy'
import { beforeAll, describe, expect, it } from 'vitest'
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

const prices: PriceTable = {
  currency: 'CNY',
  currencyExponent: 2,
  prices: {
    'fake/fake-1': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 },
    'cheap/cheap-1': { inputPerMTokenMinor: 20, outputPerMTokenMinor: 80 },
  },
}

let app: ReturnType<typeof createGateway>
let audits: InMemoryAuditStore
let metering: InMemoryMeteringStore

beforeAll(async () => {
  audits = new InMemoryAuditStore()
  metering = new InMemoryMeteringStore()
  const quotas = new InMemoryQuotaStore()

  const policyService = new PolicyService({
    quotas,
    metering,
    tenantOf: async (id) => (id === aliceId ? 'acme' : undefined),
    onMeteringUnavailable: () => undefined,
  })

  const policies = new InMemoryPolicyStore([
    {
      id: 'p-acme',
      tenantId: 'acme',
      allowedModels: ['fake/fake-1', 'cheap/cheap-1'],
      fallbackModel: 'cheap/cheap-1',
      updatedAt: new Date().toISOString(),
    },
  ])
  const modelRouter = new ModelRouter({ policies })

  const harness = await createTestHarness({ fake: {}, cheap: {} })
  const store = new GatewaySessionStore({
    // 每条 assistant/message 记 100 token(假适配器不报用量)—— 叙事按它算账
    onUsage: (obs) => {
      void safeRecord(
        metering,
        {
          subjectId: obs.session.subjectId,
          tenantId: obs.session.tenantId,
          sessionId: obs.session.id,
          turn: obs.turn,
          step: obs.step,
          provider: obs.session.provider ?? 'fake',
          model: obs.session.model ?? 'fake-1',
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
    ]),
    runtimeRoutes: registerRuntimeRoutes({
      store,
      createAgent: harness.createAgent,
      userMessage: harness.userMessage,
      heartbeatMs: 500,
      quota: policyService,
      models: {
        resolve: async (input) => {
          const requested = `${input.provider ?? 'fake'}/${input.model ?? 'fake-1'}`
          // ★ 环环相扣的那一环:降级的水位来自 policy 的实时配额,而配额来自计量
          const quota = await policyService.quotaOf(input.subjectId)
          const ratio =
            quota === undefined || quota.tokenLimit === null || quota.tokenLimit === 0
              ? undefined
              : quota.tokenUsed / quota.tokenLimit

          const decision = await modelRouter.resolve({
            tenantId: input.tenantId,
            requested,
            ...(ratio === undefined ? {} : { budgetUsedRatio: ratio }),
          })
          if (decision.kind === 'deny') return { kind: 'deny' }
          if (decision.downgraded) {
            void audits.append({
              at: new Date().toISOString(),
              actor: 'model-router',
              tenantId: input.tenantId,
              action: 'model.downgraded',
              target: input.subjectId,
              before: { model: requested },
              after: { model: decision.model },
              requestId: '-',
            })
          }
          const [provider, model] = decision.model.split('/') as [string, string]
          return { kind: 'allow', provider, model, downgraded: decision.downgraded }
        },
      },
    }),
    adminRoutes: registerAdminRoutes({
      ctx: harness.ctx,
      audit: new StoreAuditSink(audits),
      credentialRefs: [],
      subjects: { find: async () => undefined },
      usageReader: {
        daily: async (filter) =>
          aggregateDaily(await metering.query(filter), prices).map((row) => ({
            ...row,
            cost: costToWire(row.cost),
          })),
      },
      quotaAdmin: {
        quotaOf: (id) => policyService.quotaOf(id),
        setLimit: (id, limit) => quotas.setLimit(id, limit),
      },
      auditStore: audits,
      modelPolicies: policies,
    }),
  })
})

async function newSession(): Promise<{ id: string; downgradedHeader: string | null }> {
  const res = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'fake', model: 'fake-1' }),
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { session: { id: string } }
  return { id: body.session.id, downgradedHeader: res.headers.get('x-dshwar-model-downgraded') }
}

async function burnTurn(sessionId: string): Promise<number> {
  const res = await app.request(`/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify({ input: '烧' }),
  })
  if (res.status === 202) {
    const stream = await app.request(`/v1/sessions/${sessionId}/stream`, { headers: ALICE })
    await readSSE(stream, { until: (e) => e.type === 'turn.completed', maxMs: 5000 })
  }
  return res.status
}

describe('R9 · 治理链路单一叙事', () => {
  it('① 运维设配额 250,变更入审计', async () => {
    const res = await app.request(`/v1/admin/subjects/${aliceId}/quota`, {
      method: 'PATCH',
      headers: { ...ADMIN, 'content-type': 'application/json' },
      body: JSON.stringify({ tokenLimit: 250 }),
    })
    expect(res.status).toBe(200)
  })

  it('② 预算未过半时建会话不降级,两轮烧到 200/250', async () => {
    const first = await newSession()
    expect(first.downgradedHeader).toBeNull()

    expect(await burnTurn(first.id)).toBe(202)
    expect(await burnTurn(first.id)).toBe(202)

    const quota = await app.request(`/v1/admin/subjects/${aliceId}/quota`, { headers: ADMIN })
    const body = (await quota.json()) as { quota: { tokenUsed: number } }
    expect(body.quota.tokenUsed).toBe(200)
  })

  it('③ 水位 0.8 → 新会话被降级,三处可见', async () => {
    // 200/250 = 0.8,正好到阈值
    const downgraded = await newSession()
    expect(downgraded.downgradedHeader, '响应头必须告知降级').toBe('cheap/cheap-1')

    await new Promise((r) => setTimeout(r, 10))
    const { data } = await audits.query({ tenantId: 'acme', action: 'model.downgraded' })
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]!.after).toEqual({ model: 'cheap/cheap-1' })
  })

  it('④ 降级会话再烧一轮 → 烧穿 250,下一轮 429', async () => {
    const session = await newSession()
    expect(await burnTurn(session.id)).toBe(202) // 判定时 200 < 250;烧完 300

    const denied = await burnTurn(session.id)
    expect(denied).toBe(429)
  })

  it('⑤ 用量可查:三轮都在,降级那轮记的是 cheap 模型', async () => {
    const res = await app.request('/v1/admin/usage', { headers: ADMIN })
    const { data } = (await res.json()) as {
      data: { model: string; inputTokens: number; outputTokens: number }[]
    }

    const total = data.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)
    expect(total, '会计恒等式:三轮 × 100').toBe(300)
    // 降级后的轮记在 cheap 名下 —— 会话记录用的是裁决后的模型
    expect(data.some((r) => r.model === 'cheap-1')).toBe(true)
  })

  it('⑥ 审计可查:配额变更与降级都有 before/after', async () => {
    const quotaChanges = await audits.query({
      tenantId: 'acme',
      action: 'admin.updateSubjectQuota',
    })
    expect(quotaChanges.data).toHaveLength(1)
    expect(quotaChanges.data[0]!.after).toEqual({ tokenLimit: 250 })

    const downgrades = await audits.query({ tenantId: 'acme', action: 'model.downgraded' })
    expect(downgrades.data.length).toBeGreaterThan(0)
    expect(downgrades.data[0]!.before).toEqual({ model: 'fake/fake-1' })
  })
})
