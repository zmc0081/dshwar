/**
 * V0.4.6 Session 4 —— `agent/error` 送达客户端。
 *
 * 契约的事件映射表从 V0.2.0 起就写着 `agent/error → error`,但在此之前
 * **没人接这条线**:agent 报错时客户端的流只是静默停住,它无从区分
 * 「模型在想」与「已经炸了」,只能等到超时。
 *
 * 之所以漏了三个版本,是因为 `agent/error` 挂在 cordis **Context** 上
 * (`dsh-agent` 的 `runtime-types.d.ts`),不是 `SessionEventMap` 的成员 ——
 * `translateEvent` 永远看不到它,而没人去核对那张表是不是真的实现了。
 */
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
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

/** 一开口就炸的假模型。 */
class ExplodingAdapter extends LlmAdapter {
  // eslint-disable-next-line require-yield
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('模型炸了')
  }
}

let app: Hono<GatewayEnv>
let store: GatewaySessionStore
let harness: TestHarness

beforeEach(async () => {
  harness = await createTestHarness()
  harness.ctx.llm.registerAdapter(['boom'], new ExplodingAdapter())
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

const auth = { authorization: 'Bearer dev-alice' }

async function newSession(provider?: string): Promise<string> {
  const res = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(provider === undefined ? {} : { provider, model: 'm' }),
  })
  return ((await res.json()) as { session: { id: string } }).session.id
}

describe('agent 报错 → 客户端收到 error 事件', () => {
  it('★ 流里出现 error,而不是静默停住', async () => {
    const id = await newSession('boom')
    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ input: '会炸' }),
    })

    const events = await readSSE(stream, { until: (e) => e.type === 'error', maxMs: 5000 })
    const error = events.find((e) => e.type === 'error')

    expect(error, 'agent 炸了,客户端却什么都没收到 —— 这就是静默停住').toBeDefined()
    expect(error!.data).toMatchObject({ type: 'error', code: 'internal' })
  }, 15_000)

  it('error 事件不泄漏上游的错误细节', async () => {
    // 上游的错误对象可能带着请求 URL、甚至凭据片段,而 message 会原样进响应体。
    // 细节走日志,凭 requestId 对上。
    const id = await newSession('boom')
    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ input: '会炸' }),
    })

    const events = await readSSE(stream, { until: (e) => e.type === 'error', maxMs: 5000 })
    const error = events.find((e) => e.type === 'error')!

    expect(JSON.stringify(error.data)).not.toContain('模型炸了')
  }, 15_000)
})

describe('网关自持序号 —— 合成事件不再需要「借号」', () => {
  it('SSE id 单调递增,且合成的 error 也在同一条序列上', async () => {
    const id = await newSession('boom')
    const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth })
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ input: '会炸' }),
    })

    const events = await readSSE(stream, { until: (e) => e.type === 'error', maxMs: 5000 })
    const ids = events.filter((e) => e.id !== undefined).map((e) => Number(e.id))

    expect(ids.length).toBeGreaterThan(1)
    expect(
      ids.every((v, i) => i === 0 || v > ids[i - 1]!),
      `id 序列回退:${ids}`,
    ).toBe(true)
    // 密集而非稀疏 —— 自持序号的副产物。上游 seq 是稀疏的(翻译会丢掉一半)
    expect(ids[0]).toBe(0)
  }, 15_000)

  it('Last-Event-ID 在 error 事件前后都不丢不重', async () => {
    const id = await newSession('boom')
    await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ input: '会炸' }),
    })
    await new Promise((r) => setTimeout(r, 200))

    const session = store.get(id, { id: 'alice-e6f1' } as never)!
    const all = session.buffer.since(undefined)
    expect(all.length).toBeGreaterThan(1)

    // 从中间某个号续传,拿到的必须**恰好**是它之后的那些,不多不少
    const mid = all[0]!.seq
    const resumed = session.buffer.since(mid)
    expect(resumed.map((x) => x.seq)).toEqual(all.slice(1).map((x) => x.seq))

    // 号不重复 —— 借号方案最怕的就是这个
    const seqs = all.map((x) => x.seq)
    expect(new Set(seqs).size, `序号有重复:${seqs}`).toBe(seqs.length)
  }, 15_000)
})
