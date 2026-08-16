/**
 * 运行时 API 的端到端测试 —— 对着**真实上游 harness**跑。
 *
 * 验收标准:第三方仅凭 HTTP 就能完成一次完整会话,不接触 dsh。
 * mock 掉 agent 就证明不了这句话,所以这里用真的。
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

async function boot(providers?: Parameters<typeof createTestHarness>[0]): Promise<void> {
  harness = await createTestHarness(providers)
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
}

beforeEach(async () => {
  await boot()
})

afterEach(async () => {
  await store.releaseAll().catch(() => undefined)
})

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

async function createSession(token: string, body: Record<string, unknown> = {}) {
  const res = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...auth(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { res, body: (await res.json()) as Record<string, never> }
}

describe('一次完整会话 —— 仅凭 HTTP', () => {
  it('创建 → 发起 → 流式收完 → 释放', async () => {
    // 1. 创建
    const created = await createSession('dev-alice')
    expect(created.res.status).toBe(201)
    const sessionId = (created.body['session'] as unknown as { id: string }).id
    expect(sessionId).toBeTruthy()

    // 2. 先建 SSE（契约说明的用法：先连流再发起，避免漏掉开头）
    const streamRes = await app.request(`/v1/sessions/${sessionId}/stream`, {
      headers: auth('dev-alice'),
    })
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream')

    // 3. 发起一轮
    const turnRes = await app.request(`/v1/sessions/${sessionId}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: '你好' }),
    })
    expect(turnRes.status).toBe(202)
    expect(((await turnRes.json()) as { turn: number }).turn).toBe(1)

    // 4. 收流直到本轮结束
    const events = await readSSE(streamRes, { until: (e) => e.type === 'turn.completed' })
    const types = events.map((e) => e.type)

    expect(types).toContain('turn.started')
    expect(types).toContain('message.delta')
    expect(types).toContain('message.completed')
    expect(types).toContain('turn.completed')

    const text = events
      .filter((e) => e.type === 'message.delta')
      .map((e) => e.data['text'] as string)
      .join('')
    expect(text).toBe('你好,世界')

    // 5. 释放
    const del = await app.request(`/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: auth('dev-alice'),
    })
    expect(del.status).toBe(200)
    expect(store.size).toBe(0)
  })

  it('SSE 事件带单调 id,可作 Last-Event-ID', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const streamRes = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })

    const events = await readSSE(streamRes, { until: (e) => e.type === 'turn.completed' })
    const ids = events.filter((e) => e.id !== undefined).map((e) => Number(e.id))

    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((v, i) => i === 0 || v > ids[i - 1]!)).toBe(true)
  })

  it('Last-Event-ID 只补发该序号之后的事件', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    // 先跑完一轮，事件进缓冲
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })
    const session = store.get(id, { id: 'alice-e6f1' } as never)!
    await session.handle.agent.whenIdle()

    const all = session.buffer.since(undefined)
    expect(all.length).toBeGreaterThan(2)
    const midSeq = all[1]!.seq

    const streamRes = await app.request(`/v1/sessions/${id}/stream`, {
      headers: { ...auth('dev-alice'), 'last-event-id': String(midSeq) },
    })
    const replayed = await readSSE(streamRes, { until: (e) => e.type === 'turn.completed' })
    const replayedIds = replayed.filter((e) => e.id !== undefined).map((e) => Number(e.id))

    expect(
      replayedIds.every((s) => s > midSeq),
      '补发了不该补的旧事件',
    ).toBe(true)
  })

  it('推理增量默认不透传', async () => {
    await boot({ fake: { reasoning: ['先想一下'], tokens: ['答案'] } })
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const streamRes = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })
    const events = await readSSE(streamRes, { until: (e) => e.type === 'turn.completed' })

    expect(events.map((e) => e.type)).not.toContain('reasoning.delta')
  })

  it('includeReasoning: true 时透传推理增量', async () => {
    await boot({ fake: { reasoning: ['先想一下'], tokens: ['答案'] } })
    const { body } = await createSession('dev-alice', { includeReasoning: true })
    const id = (body['session'] as unknown as { id: string }).id

    const streamRes = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })
    const events = await readSSE(streamRes, { until: (e) => e.type === 'turn.completed' })

    expect(events.map((e) => e.type)).toContain('reasoning.delta')
  })
})

describe('会话归属 —— 跨 principal 一律 404', () => {
  // 403 会泄漏「这个 id 存在」，而会话 id 的存在性本身就是信息
  it('bob 读不到 alice 的会话,返回 404 而非 403', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const res = await app.request(`/v1/sessions/${id}`, { headers: auth('dev-bob') })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found')
  })

  it('不存在的会话与他人的会话响应完全一致', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const others = await app.request(`/v1/sessions/${id}`, { headers: auth('dev-bob') })
    const missing = await app.request('/v1/sessions/00000000-0000-0000-0000-000000000000', {
      headers: auth('dev-bob'),
    })

    const a = (await others.json()) as { error: { code: string; message: string } }
    const b = (await missing.json()) as { error: { code: string; message: string } }

    expect(others.status).toBe(missing.status)
    expect(a.error.code).toBe(b.error.code)
    expect(a.error.message).toBe(b.error.message)
  })

  it('跨 principal 发起一轮被拒', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const res = await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-bob'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: '偷偷发一轮' }),
    })
    expect(res.status).toBe(404)
  })

  it('跨 principal 删除被拒,且原会话仍在', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    expect(
      (await app.request(`/v1/sessions/${id}`, { method: 'DELETE', headers: auth('dev-bob') }))
        .status,
    ).toBe(404)
    expect(store.size).toBe(1)
  })

  it('跨 principal 订阅流被拒', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const res = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-bob') })
    expect(res.status).toBe(404)
  })

  it('列表只返回自己的会话', async () => {
    await createSession('dev-alice')
    await createSession('dev-alice')
    await createSession('dev-bob')

    const res = await app.request('/v1/sessions', { headers: auth('dev-alice') })
    const body = (await res.json()) as { data: { subjectId: string }[] }

    expect(body.data).toHaveLength(2)
    expect(body.data.every((s) => s.subjectId === 'alice-e6f1')).toBe(true)
  })
})

describe('并发 —— 两个 principal 的输出不串号', () => {
  it('并发会话各自收到自己的 token', async () => {
    await boot({
      'fake-a': { tokens: ['A1', 'A2', 'A3'], delayMs: 10 },
      'fake-b': { tokens: ['B1', 'B2', 'B3'], delayMs: 10 },
    })

    const a = await createSession('dev-alice', { provider: 'fake-a' })
    const b = await createSession('dev-bob', { provider: 'fake-b' })
    const aId = (a.body['session'] as unknown as { id: string }).id
    const bId = (b.body['session'] as unknown as { id: string }).id

    const aStream = await app.request(`/v1/sessions/${aId}/stream`, { headers: auth('dev-alice') })
    const bStream = await app.request(`/v1/sessions/${bId}/stream`, { headers: auth('dev-bob') })

    await Promise.all([
      app.request(`/v1/sessions/${aId}/turns`, {
        method: 'POST',
        headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'go' }),
      }),
      app.request(`/v1/sessions/${bId}/turns`, {
        method: 'POST',
        headers: { ...auth('dev-bob'), 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'go' }),
      }),
    ])

    const [aEvents, bEvents] = await Promise.all([
      readSSE(aStream, { until: (e) => e.type === 'turn.completed' }),
      readSSE(bStream, { until: (e) => e.type === 'turn.completed' }),
    ])

    const aText = aEvents.filter((e) => e.type === 'message.delta').map((e) => e.data['text'])
    const bText = bEvents.filter((e) => e.type === 'message.delta').map((e) => e.data['text'])

    expect(aText).toEqual(['A1', 'A2', 'A3'])
    expect(bText).toEqual(['B1', 'B2', 'B3'])
  })
})

describe('取消与释放', () => {
  it('DELETE 截断正在跑的一轮并报告被取消的轮次', async () => {
    await boot({ fake: { tokens: Array.from({ length: 30 }, (_, i) => `t${i}`), delayMs: 20 } })
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: '长回复' }),
    })
    await new Promise((r) => setTimeout(r, 100))

    const del = await app.request(`/v1/sessions/${id}`, {
      method: 'DELETE',
      headers: auth('dev-alice'),
    })
    expect(del.status).toBe(200)
    expect(((await del.json()) as { cancelledTurn: number | null }).cancelledTurn).toBe(1)
    expect(store.size).toBe(0)
  })

  it('空闲时删除,cancelledTurn 为 null', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const del = await app.request(`/v1/sessions/${id}`, {
      method: 'DELETE',
      headers: auth('dev-alice'),
    })
    expect(((await del.json()) as { cancelledTurn: number | null }).cancelledTurn).toBeNull()
  })

  it('删除后再删返回 404 —— 与不存在不可区分', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    await app.request(`/v1/sessions/${id}`, { method: 'DELETE', headers: auth('dev-alice') })
    const again = await app.request(`/v1/sessions/${id}`, {
      method: 'DELETE',
      headers: auth('dev-alice'),
    })
    expect(again.status).toBe(404)
  })

  // Session 0 验证 C 的落点：客户端掉线必须释放订阅，
  // 否则每个断开的连接都留下一个还在收事件的闭包
  it('SSE 断连后订阅者被移除(度量,不靠肉眼)', async () => {
    await boot({ fake: { tokens: ['a', 'b', 'c'], delayMs: 30 } })
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const streamRes = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    const session = store.get(id, { id: 'alice-e6f1' } as never)!

    // 读一点然后主动断开
    const reader = streamRes.body!.getReader()
    await reader.read()
    expect(session.subscribers.size).toBe(1)

    await reader.cancel()
    await new Promise((r) => setTimeout(r, 120))

    expect(session.subscribers.size, '断连后订阅者未被移除').toBe(0)
  })

  it('会话释放后事件监听解除,store 不再持有', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id
    const session = store.get(id, { id: 'alice-e6f1' } as never)!

    await store.release(session)

    expect(store.size).toBe(0)
    expect(session.subscribers.size).toBe(0)
  })
})

describe('请求校验', () => {
  it('turns 缺 input 返回 400', async () => {
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const res = await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_request')
  })

  it('正在跑一轮时再发起返回 409', async () => {
    await boot({ fake: { tokens: Array.from({ length: 30 }, (_, i) => `t${i}`), delayMs: 20 } })
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: '第一轮' }),
    })
    await new Promise((r) => setTimeout(r, 60))

    const second = await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: '第二轮' }),
    })
    expect(second.status).toBe(409)
  })
})

/**
 * V0.4.6 Session 3 —— 断言有效性探针找出来的两个缺口。
 *
 * 两条断言都不是新需求,而是**契约早就承诺、却从没人验证**的东西。
 * 它们的共同点:被测对象(网关)没坏,坏的是**喂给它的假模型**,
 * 而现有测试全都照不到那一类。
 */
describe('假模型忠实于上游 —— 否则整套契约测试都是空的', () => {
  beforeEach(async () => {
    await boot({ fake: { tokens: ['一', '二', '三'], delayMs: 20 } })
  })

  it('正常跑完的一轮,turn.completed 的 reason 是 completed', async () => {
    // 契约(`@dshwar/api-contract` 的 TurnCompletedEvent)写着:reason 区分
    // 正常结束与被取消,客户端据此决定 UI 显示「完成」还是「已停止」。
    // 而在 V0.4.6 之前,**全仓没有任何测试断言过这个字段** ——
    // 于是假模型把 finish reason 写成字符串(应为 { kind: 'stop' })时,
    // 所有测试照样全绿。那正是 V0.4.5 真实发生过的事。
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })

    const events = await readSSE(stream, { until: (e) => e.type === 'turn.completed' })
    const completed = events.find((e) => e.type === 'turn.completed')

    expect(completed?.data['reason'], 'turn.completed 没带 reason,或值不对').toBe('completed')
  }, 15_000)

  it('取消之后输出真的截断 —— 不是只看接口返回 200', async () => {
    // 同一类问题的另一面:假模型若不遵守 `signal`,取消就是摆设,
    // 而只断言「DELETE 返回 200」的测试对此一无所知。
    const { body } = await createSession('dev-alice')
    const id = (body['session'] as unknown as { id: string }).id

    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth('dev-alice') })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth('dev-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })

    // 让它先吐一点,再取消 —— 这样「截断」才是可观测的。
    // ⚠️ **不睡固定时长**:第一版睡 25 ms,在负载下偶发地一个增量都还没到
    //(3 个 token × 20 ms,机器忙的时候整轮起步就晚),于是
    // `deltas.length > 0` 抽风。改成**等第一个增量真的进了缓冲**再取消 ——
    // 断言依赖的是事实,不是时钟。
    const session = store.get(id, { id: 'alice-e6f1' } as never)!
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const buffered = session.buffer
        .since(undefined)
        .filter((x) => (x.event as { type: string }).type === 'message.delta')
      if (buffered.length > 0) break
      await new Promise((r) => setTimeout(r, 5))
    }
    session.handle.agent.cancel({ kind: 'user' })

    const events = await readSSE(stream, { until: (e) => e.type === 'turn.completed', maxMs: 3000 })
    const deltas = events.filter((e) => e.type === 'message.delta')

    // 三个 token、每个 20ms:取消发生在第一个之后、最后一个之前
    expect(deltas.length, '一个增量都没有,测不出截断').toBeGreaterThan(0)
    expect(deltas.length, `收到 ${deltas.length}/3 个增量 —— 假模型没有响应取消`).toBeLessThan(3)
  }, 15_000)
})
