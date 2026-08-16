/**
 * V0.4.0 Session 4:模型裁决接入网关 + /v1/admin/policies 转正。
 *
 * 端到端:清单外 403、预算过半自动降级(响应头可见 + 审计有痕 + 会话记录
 * 用的是裁决后的模型)。
 */
import { InMemoryAuditStore } from '@dshwar/audit'
import { InMemoryPolicyStore, ModelRouter } from '@dshwar/model-router'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  registerAdminRoutes,
  registerRuntimeRoutes,
  StoreAuditSink,
} from '../src/index.ts'
import { AUTH_ENTRIES, createTestHarness } from './harness.ts'

const ALICE = { authorization: 'Bearer dev-alice' }
const ADMIN = { 'x-dshwar-admin-key': 'admin-acme' }

let app: ReturnType<typeof createGateway>
let audits: InMemoryAuditStore
/** 测试可调的预算水位。 */
let budgetRatio: number | undefined

beforeEach(async () => {
  audits = new InMemoryAuditStore()
  budgetRatio = undefined

  const policies = new InMemoryPolicyStore([
    {
      id: 'p-acme',
      tenantId: 'acme',
      // harness 注册的两个 provider:fake 与 cheap
      allowedModels: ['fake/fake-1', 'cheap/cheap-1'],
      fallbackModel: 'cheap/cheap-1',
      updatedAt: '2026-08-16T00:00:00.000Z',
    },
  ])
  const modelRouter = new ModelRouter({ policies })

  const harness = await createTestHarness({ fake: {}, cheap: {} })
  const store = new GatewaySessionStore()

  app = createGateway({
    ctx: harness.ctx,
    adminKeys: new InMemoryAdminKeyResolver([
      { key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' },
    ]),
    runtimeRoutes: registerRuntimeRoutes({
      store,
      createAgent: harness.createAgent,
      userMessage: harness.userMessage,
      models: {
        // 部署方闭包:接默认模型、预算水位与降级审计
        resolve: async (input) => {
          const requested = `${input.provider ?? 'fake'}/${input.model ?? 'fake-1'}`
          const decision = await modelRouter.resolve({
            tenantId: input.tenantId,
            requested,
            ...(budgetRatio === undefined ? {} : { budgetUsedRatio: budgetRatio }),
          })
          if (decision.kind === 'deny') return { kind: 'deny' }

          if (decision.downgraded) {
            // 降级必须落审计 —— 用户问「为什么答案变笨了」时,这是唯一的答案
            void audits.append({
              at: new Date().toISOString(),
              actor: `model-router`,
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
      modelPolicies: policies,
    }),
  })
})

async function createSession(body: Record<string, unknown> = {}) {
  return app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('准入', () => {
  it('清单内的模型正常建会话', async () => {
    const res = await createSession({ provider: 'fake', model: 'fake-1' })
    expect(res.status).toBe(201)
  })

  it('清单外的模型 403 —— 不静默换', async () => {
    const res = await createSession({ provider: 'openai', model: 'o3-pro' })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('forbidden')
  })
})

describe('R9 端到端:预算过半 → 自动降级,三处都有痕迹', () => {
  it('响应头、会话记录、审计', async () => {
    budgetRatio = 0.9

    const res = await createSession({ provider: 'fake', model: 'fake-1' })
    expect(res.status).toBe(201)

    // ① 响应头可见 —— 用户有权知道自己被换了模型
    expect(res.headers.get('x-dshwar-model-downgraded')).toBe('cheap/cheap-1')

    // ② 会话记录用裁决后的模型 —— 计量与审计要对上真正在跑的模型
    const { session } = (await res.json()) as {
      session: { id: string; provider: string; model: string }
    }
    expect(session.provider).toBe('cheap')
    expect(session.model).toBe('cheap-1')

    // ③ 审计有痕,before/after 都在
    await new Promise((r) => setTimeout(r, 10))
    const { data } = await audits.query({ tenantId: 'acme', action: 'model.downgraded' })
    expect(data).toHaveLength(1)
    expect(data[0]!.before).toEqual({ model: 'fake/fake-1' })
    expect(data[0]!.after).toEqual({ model: 'cheap/cheap-1' })
    expect(data[0]!.target).toBe(AUTH_ENTRIES[0]!.id)
  })

  it('预算正常时不降级,响应头不出现', async () => {
    budgetRatio = 0.2
    const res = await createSession({ provider: 'fake', model: 'fake-1' })
    expect(res.status).toBe(201)
    expect(res.headers.get('x-dshwar-model-downgraded')).toBeNull()
  })
})

describe('/v1/admin/policies 转正', () => {
  it('返回契约 Policy 的五个字段,只见本租户', async () => {
    const res = await app.request('/v1/admin/policies', { headers: ADMIN })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { data: Record<string, unknown>[] }
    expect(body.data).toHaveLength(1)
    expect(Object.keys(body.data[0]!).sort()).toEqual([
      'allowedModels',
      'fallbackModel',
      'id',
      'tenantId',
      'updatedAt',
    ])
  })

  it('未配置策略存储的部署回落 501', async () => {
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
    expect((await bare.request('/v1/admin/policies', { headers: ADMIN })).status).toBe(501)
  })
})
