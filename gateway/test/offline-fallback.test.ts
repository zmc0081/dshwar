/**
 * 离线降级的网关端到端(V0.6.5 Session 2)。
 *
 * 组合与 server.ts 的闭包同构:预算裁决(model-router)之后接可达性裁决
 * (OfflineFallback),降级目标再过一次准入,降级可见(响应头 + 审计)。
 *
 * 「本地」在本测试里由 harness 的 `cheap` provider 扮演 —— 降级目标必须是
 * 已注册的 provider,createAgent 才能真的建出会话;本地端点的活/死由
 * 进程内 http server 扮演。
 */
import { createServer, type Server } from 'node:http'
import { InMemoryAuditStore } from '@dshwar/audit'
import { OfflineFallback } from '@dshwar/llm-local'
import { InMemoryPolicyStore, ModelRouter } from '@dshwar/model-router'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGateway,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  registerRuntimeRoutes,
} from '../src/index.ts'
import { createTestHarness } from './harness.ts'

const ALICE = { authorization: 'Bearer dev-alice' }

let localEndpoint: { server: Server; baseUrl: string }

beforeAll(async () => {
  localEndpoint = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')
        return
      }
      res.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` })
    })
  })
})

afterAll(() => {
  localEndpoint.server.close()
})

let audits: InMemoryAuditStore
/** 测试可切换的云端可达性。 */
let cloudIsUp: boolean

async function buildApp(over: { allowLocal?: boolean; localAlive?: boolean } = {}) {
  audits = new InMemoryAuditStore()
  const policies = new InMemoryPolicyStore([
    {
      id: 'p-acme',
      tenantId: 'acme',
      allowedModels: (over.allowLocal ?? true) ? ['fake/fake-1', 'cheap/cheap-1'] : ['fake/fake-1'], // 降级目标刻意不在清单里
      fallbackModel: null,
      updatedAt: '2026-08-17T00:00:00.000Z',
    },
  ])
  const modelRouter = new ModelRouter({ policies })
  const offline = new OfflineFallback({
    cloudProbeUrl: 'https://cloud.example',
    localTarget: { provider: 'cheap', model: 'cheap-1' },
    localBaseUrl: (over.localAlive ?? true) ? localEndpoint.baseUrl : 'http://127.0.0.1:9/v1',
    probeTimeoutMs: 400,
    cacheTtlMs: 0, // 测试逐条切换可达性,不要缓存
    fetchImpl: vi.fn(async () => {
      if (cloudIsUp) return new Response(null, { status: 200 })
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch,
  })

  const harness = await createTestHarness({ fake: {}, cheap: {} })
  return createGateway({
    ctx: harness.ctx,
    adminKeys: new InMemoryAdminKeyResolver([]),
    runtimeRoutes: registerRuntimeRoutes({
      store: new GatewaySessionStore(),
      createAgent: harness.createAgent,
      userMessage: harness.userMessage,
      models: {
        // 与 server.ts 的闭包同构:准入 → 预算 → 可达性
        resolve: async (input) => {
          const requested = `${input.provider ?? 'fake'}/${input.model ?? 'fake-1'}`
          const decision = await modelRouter.resolve({ tenantId: input.tenantId, requested })
          if (decision.kind === 'deny') return { kind: 'deny' }
          const [provider, model] = decision.model.split('/') as [string, string]

          const od = await offline.decide(provider)
          if (od.kind === 'offline-unavailable') {
            return {
              kind: 'unavailable',
              message: 'cloud unreachable and no local model endpoint is running',
            }
          }
          if (od.kind === 'downgraded') {
            const admitted = await modelRouter.resolve({
              tenantId: input.tenantId,
              requested: `${od.provider}/${od.model}`,
            })
            if (admitted.kind === 'deny') return { kind: 'deny' }
            void audits.append({
              at: new Date().toISOString(),
              actor: 'offline-fallback',
              tenantId: input.tenantId,
              action: 'model.offline-downgraded',
              target: input.subjectId,
              before: { model: `${provider}/${model}` },
              after: { model: `${od.provider}/${od.model}` },
              requestId: '-',
            })
            return { kind: 'allow', provider: od.provider, model: od.model, downgraded: true }
          }
          return { kind: 'allow', provider, model, downgraded: decision.downgraded }
        },
      },
    }),
  })
}

function createSession(app: Awaited<ReturnType<typeof buildApp>>, body: Record<string, unknown>) {
  return app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  cloudIsUp = true
})

describe('离线降级端到端', () => {
  it('云端可达:原样建会话,无降级头', async () => {
    const app = await buildApp()
    const res = await createSession(app, { provider: 'fake', model: 'fake-1' })
    expect(res.status).toBe(201)
    expect(res.headers.get('x-dshwar-model-downgraded')).toBeNull()
  })

  it('★ 云端不可达 + 本地活着:换本地模型,头可见,审计有痕,会话记录裁决后的模型', async () => {
    const app = await buildApp()
    cloudIsUp = false

    const res = await createSession(app, { provider: 'fake', model: 'fake-1' })
    expect(res.status).toBe(201)
    // 红线:降级必须可见 —— 用户有权知道自己被换了模型
    expect(res.headers.get('x-dshwar-model-downgraded')).toBe('cheap/cheap-1')

    const session = (await res.json()) as { session: { provider: string; model: string } }
    expect(session.session.provider).toBe('cheap')
    expect(session.session.model).toBe('cheap-1')

    const { data: entries } = await audits.query({ tenantId: 'acme' })
    const entry = entries.find((e) => e.action === 'model.offline-downgraded')
    expect(entry, '离线降级没落审计 —— 静默换模型是红线').toBeDefined()
    expect(entry!.before).toEqual({ model: 'fake/fake-1' })
    expect(entry!.after).toEqual({ model: 'cheap/cheap-1' })
  })

  it('★ 云端不可达 + 本地也没起:503,信息可拿去行动', async () => {
    const app = await buildApp({ localAlive: false })
    cloudIsUp = false

    const res = await createSession(app, { provider: 'fake', model: 'fake-1' })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('unavailable')
    expect(body.error.message).toContain('local model')
  })

  it('降级目标不在准入清单 → 403,策略赢过可达性', async () => {
    const app = await buildApp({ allowLocal: false })
    cloudIsUp = false

    const res = await createSession(app, { provider: 'fake', model: 'fake-1' })
    expect(res.status).toBe(403)
  })

  it('直接请求本地 provider:云端死活无关,不降级不报错', async () => {
    const app = await buildApp()
    cloudIsUp = false

    const res = await createSession(app, { provider: 'cheap', model: 'cheap-1' })
    expect(res.status).toBe(201)
    expect(res.headers.get('x-dshwar-model-downgraded')).toBeNull()
  })
})
