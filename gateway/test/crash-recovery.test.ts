/**
 * V0.4.5 R5 —— 崩溃不静默丢失。
 *
 * 对着 HTTP 跑,因为要断言的是**客户端看到什么**。在会话簿层面断言
 * 「terminated 被置位了」证明不了 R5:客户端看不到那个字段,它只看得到流。
 */
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  registerRuntimeRoutes,
  type GatewayEnv,
} from '../src/index.ts'
import { createTestHarness, readSSE, type TestHarness } from './harness.ts'

let app: Hono<GatewayEnv>
let store: GatewaySessionStore
let harness: TestHarness

beforeEach(async () => {
  harness = await createTestHarness({ fake: { tokens: ['慢', '慢', '说'], delayMs: 30 } })
  store = new GatewaySessionStore()
  app = createGateway({
    ctx: harness.ctx,
    adminKeys: new InMemoryAdminKeyResolver([{ key: 'admin-acme', tenantId: 'acme', label: 'a' }]),
    runtimeRoutes: registerRuntimeRoutes({
      store,
      createAgent: harness.createAgent,
      userMessage: harness.userMessage,
      heartbeatMs: 50,
    }),
  })
})

afterEach(async () => {
  await store.releaseAll().catch(() => undefined)
})

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

async function newSession(): Promise<string> {
  const res = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  return ((await res.json()) as { session: { id: string } }).session.id
}

describe('承载进程死亡 → 客户端收到 error 并收流', () => {
  it('流里出现 error 事件,而不是停在那里发心跳', async () => {
    const id = await newSession()
    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })

    const session = store.get(id, { id: 'alice-e6f1' } as never)!
    // 模拟 supervisor 报上来的进程死亡
    setTimeout(() => {
      store.fail(session, { code: 'runtime_unavailable', message: '承载会话的隔离进程已退出' })
    }, 30)

    const events = await readSSE(stream, { until: (e) => e.type === 'error', maxMs: 3000 })
    const error = events.find((e) => e.type === 'error')

    expect(error, '客户端没收到 error —— 这就是静默丢失').toBeDefined()
    expect(error!.data).toMatchObject({
      type: 'error',
      code: 'runtime_unavailable',
      message: '承载会话的隔离进程已退出',
    })
  }, 15_000)

  it('已经终结的会话,新连上来的客户端也立刻拿到 error', async () => {
    const id = await newSession()
    const session = store.get(id, { id: 'alice-e6f1' } as never)!

    // 先终结,再连 —— 客户端在崩溃之后才连上来是常态(它正在重连)
    store.fail(session, { code: 'runtime_unavailable', message: '进程没了' })

    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    const events = await readSSE(stream, { until: (e) => e.type === 'error', maxMs: 3000 })

    expect(events.some((e) => e.type === 'error')).toBe(true)
  }, 15_000)

  it('error 事件带序号,且排在已有事件之后 —— 续传不乱', async () => {
    const id = await newSession()
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: '你好' }),
    })
    const session = store.get(id, { id: 'alice-e6f1' } as never)!
    await session.handle.agent.whenIdle()

    const lastBefore = session.buffer.lastSeq
    expect(lastBefore).toBeGreaterThanOrEqual(0)

    store.fail(session, { code: 'runtime_unavailable', message: '进程没了' })

    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    const events = await readSSE(stream, { until: (e) => e.type === 'error', maxMs: 3000 })
    const error = events.find((e) => e.type === 'error')!

    // 借下一个号是安全的,因为终结之后不会再有上游事件进来 —— 没有撞号的对象
    expect(Number(error.id)).toBe(lastBefore + 1)
  }, 15_000)

  it('fail 幂等 —— 重复上报不会发两条 error', async () => {
    const id = await newSession()
    const session = store.get(id, { id: 'alice-e6f1' } as never)!

    store.fail(session, { code: 'runtime_unavailable', message: '进程没了' })
    store.fail(session, { code: 'runtime_unavailable', message: '进程没了' })
    store.fail(session, { code: 'other', message: '又没了一次' })

    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    const events = await readSSE(stream, { until: (e) => e.type === 'error', maxMs: 3000 })

    expect(events.filter((e) => e.type === 'error')).toHaveLength(1)
  }, 15_000)

  it('终结之后流会关闭,不再无限发心跳', async () => {
    const id = await newSession()
    const session = store.get(id, { id: 'alice-e6f1' } as never)!
    store.fail(session, { code: 'runtime_unavailable', message: '进程没了' })

    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    // 不给 until —— 让它自然读到流末尾。若流不关,这里会一直读心跳读到超时。
    const events = await readSSE(stream, { maxMs: 2000 })

    expect(events.some((e) => e.type === 'error')).toBe(true)
    // 心跳周期 50 ms,2 秒能塞进几十条。收流之后一条都不该有。
    expect(events.filter((e) => e.type === 'ping').length).toBeLessThan(3)
  }, 15_000)
})
