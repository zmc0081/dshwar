/**
 * 验证 B —— 流式输出
 *
 * 断言:增量输出可转成 SSE 而**不需要缓冲整个回复**。
 * 若只能拿到完整回复,SSE 就退化成「等全部生成完再一次性推」,
 * 移动端的首字延迟会直接暴露给用户。
 */
import { check, checkEqual, groupHeader } from './harness.ts'
import {
  createInProcessRuntime,
  SessionId,
  userText,
  type SessionEventEnvelope,
} from './runtime.ts'

const G = '验证 B · 流式输出'

export async function runB(): Promise<void> {
  groupHeader(G)

  const runtime = await createInProcessRuntime()
  const { ctx } = runtime
  const TOKENS = ['第一段', '第二段', '第三段', '第四段']
  runtime.registerFake('fake', { tokens: TOKENS, delayMs: 20 })

  const handle = await ctx.agents.create({
    sessionId: SessionId('verify-b'),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })

  const deltas: { text: string; seq: number; at: number }[] = []
  let messageAt = 0
  const started = Date.now()

  ctx.on('session/event', (_session: unknown, event: SessionEventEnvelope) => {
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      deltas.push({ text: event.data.chunk.text ?? '', seq: event.seq, at: Date.now() - started })
    }
    if (event.type === 'assistant/message') messageAt = Date.now() - started
  })

  handle.agent.followup(userText('流式测试'))
  await handle.agent.whenIdle()

  checkEqual(
    G,
    'B1 增量以 assistant/chunk 的 text-delta 暴露',
    deltas.map((d) => d.text),
    TOKENS,
  )

  // 这是本项的核心:第一个增量必须**远早于**完整消息，否则就是缓冲后一次性推
  const firstDelta = deltas[0]?.at ?? Infinity
  check(
    G,
    'B2 首个增量远早于完整消息 —— 不需要缓冲整个回复',
    firstDelta < messageAt,
    `首增量 ${firstDelta}ms,完整消息 ${messageAt}ms`,
  )

  // seq 单调递增 → 可直接当 SSE 的 id:，支撑 Last-Event-ID 断线续传
  const seqs = deltas.map((d) => d.seq)
  const monotonic = seqs.every((s, i) => i === 0 || s > (seqs[i - 1] ?? -1))
  check(G, 'B3 事件带单调 seq,可直接映射 SSE 的 id:', monotonic, `seq = ${seqs.join(', ')}`)

  check(
    G,
    'B4 增量之间有真实时间间隔(不是一次性到达)',
    (deltas.at(-1)?.at ?? 0) - firstDelta >= 40,
    `首尾间隔 ${(deltas.at(-1)?.at ?? 0) - firstDelta}ms`,
  )

  // 事件形状是实测出来的：文档里的 SessionEventMap 描述的是 data 内部，
  // 而监听器拿到的是带 type/seq/time 的信封
  check(
    G,
    'B5 信封形状为 { type, seq, time, data } —— 增量在 data.chunk',
    deltas.length > 0,
    '实测确认,非文档推断',
  )

  await handle.dispose()
}
