/**
 * 验证 D —— 并发会话隔离
 *
 * 把 V0.1.0 验证 C(凭据层无串号)推进到 agent 层:同一进程内并发多个会话,
 * 输出不得串号。
 *
 * 上游文档承诺 `session/event` 是**按 agent 作用域过滤**的
 * (“agent-scoped listeners receive only events from sessions entered through
 * that agent's context”)。若这条不成立,网关就必须自己按 sessionId 过滤 ——
 * 能做,但那意味着每个 SSE 连接都要看到全部租户的事件流,一个过滤 bug
 * 就是跨租户泄漏。所以这条要单独验。
 */
import { check, checkEqual, groupHeader } from './harness.ts'
import {
  createInProcessRuntime,
  SessionId,
  userText,
  type SessionEventEnvelope,
} from './runtime.ts'

const G = '验证 D · 并发会话隔离'

export async function runD(): Promise<void> {
  groupHeader(`${G}(止损点)`)

  const runtime = await createInProcessRuntime()
  const { ctx } = runtime

  // 每个 provider 吐出带自己标记的 token —— 串号会立刻显形
  runtime.registerFake('fake-alice', { tokens: ['A1', 'A2', 'A3', 'A4'], delayMs: 15 })
  runtime.registerFake('fake-bob', { tokens: ['B1', 'B2', 'B3', 'B4'], delayMs: 15 })

  const alice = await ctx.agents.create({
    sessionId: SessionId('verify-d-alice'),
    agentOptions: { provider: 'fake-alice', model: 'm' },
  })
  const bob = await ctx.agents.create({
    sessionId: SessionId('verify-d-bob'),
    agentOptions: { provider: 'fake-bob', model: 'm' },
  })

  // 全局监听:按 session 分桶,验证输出不串
  const bySession = new Map<string, string[]>()
  ctx.on('session/event', (session: { id: string }, event: SessionEventEnvelope) => {
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      const bucket = bySession.get(session.id) ?? []
      bucket.push(event.data.chunk.text ?? '')
      bySession.set(session.id, bucket)
    }
  })

  // agent 作用域监听:验证上游承诺的作用域过滤
  const aliceScoped: string[] = []
  alice.agent.ctx.on('session/event', (_s: unknown, event: SessionEventEnvelope) => {
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      aliceScoped.push(event.data.chunk.text ?? '')
    }
  })

  await Promise.all([
    (async () => {
      alice.agent.followup(userText('alice 的问题'))
      await alice.agent.whenIdle()
    })(),
    (async () => {
      bob.agent.followup(userText('bob 的问题'))
      await bob.agent.whenIdle()
    })(),
  ])

  const aliceOut = bySession.get('verify-d-alice') ?? []
  const bobOut = bySession.get('verify-d-bob') ?? []

  checkEqual(G, 'D1 alice 的会话只收到 alice 的输出', aliceOut, ['A1', 'A2', 'A3', 'A4'])
  checkEqual(G, 'D2 bob 的会话只收到 bob 的输出', bobOut, ['B1', 'B2', 'B3', 'B4'])
  check(
    G,
    'D3 两路输出零交叉',
    aliceOut.every((t) => t.startsWith('A')) && bobOut.every((t) => t.startsWith('B')),
    '并发执行下没有一个 token 落错会话',
  )

  // 上游承诺的作用域过滤 —— 决定 SSE 连接要不要自己做过滤
  checkEqual(G, 'D4 agent 作用域监听器只收到自己的事件', aliceScoped, ['A1', 'A2', 'A3', 'A4'])
  check(
    G,
    'D5 作用域过滤成立 —— SSE 连接无需看到别的租户的事件流',
    aliceScoped.every((t) => t.startsWith('A')),
    '每个 SSE 连接可直接挂在自己 agent 的 ctx 上',
  )

  await Promise.all([alice.dispose(), bob.dispose()])

  // 加大规模：10 个并发会话
  groupHeader(`${G} · 规模`)
  const runtime2 = await createInProcessRuntime()
  const N = 10
  for (let i = 0; i < N; i += 1) {
    runtime2.registerFake(`fake-${i}`, { tokens: [`S${i}a`, `S${i}b`, `S${i}c`], delayMs: 10 })
  }

  const handles = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      runtime2.ctx.agents.create({
        sessionId: SessionId(`scale-${i}`),
        agentOptions: { provider: `fake-${i}`, model: 'm' },
      }),
    ),
  )

  const scaleBuckets = new Map<string, string[]>()
  runtime2.ctx.on('session/event', (session: { id: string }, event: SessionEventEnvelope) => {
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      const b = scaleBuckets.get(session.id) ?? []
      b.push(event.data.chunk.text ?? '')
      scaleBuckets.set(session.id, b)
    }
  })

  await Promise.all(
    handles.map(async (h, i) => {
      h.agent.followup(userText(`并发 ${i}`))
      await h.agent.whenIdle()
    }),
  )

  const wrong = handles.filter((_, i) => {
    const out = scaleBuckets.get(`scale-${i}`) ?? []
    return out.length !== 3 || !out.every((t) => t.startsWith(`S${i}`))
  })

  checkEqual(G, `D6 ${N} 个并发会话各自收齐输出`, scaleBuckets.size, N)
  check(
    G,
    `D7 ${N} 个并发会话零串号`,
    wrong.length === 0,
    wrong.length === 0 ? '0 次串号' : `${wrong.length} 个会话串号`,
  )

  await Promise.all(handles.map((h) => h.dispose()))
}
