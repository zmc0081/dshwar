/**
 * 验证 C —— 取消
 *
 * ⚠️ **这是本 Session 最要紧的一项。**
 *
 * `ARCHITECTURE.md` §2.4 写:「上游 SDK 协议没有 cancel 与 session-close 方法 ——
 * 终止进程即是取消。这是 Supervisor 存在的第二个理由。」
 *
 * 但那说的是 **stdio JSON-RPC 协议**。进程内的 `Agent` 接口是另一回事:
 * 类型定义里有 `cancel(cause, options)`。本项要验的就是它**真的停住输出**,
 * 而不只是把状态标成 idle。
 *
 * 失败的后果很具体:SSE 断连时没法停掉正在跑的 turn,每个断开的客户端
 * 都会留下一个继续烧 token 的 fiber。那时 supervisor 必须提前 —— 因为
 * 「终止进程」会变成唯一可靠的取消手段。
 */
import { check, checkEqual, groupHeader } from './harness.ts'
import {
  createInProcessRuntime,
  SessionId,
  userText,
  type SessionEventEnvelope,
} from './runtime.ts'

const G = '验证 C · 取消'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runC(): Promise<void> {
  groupHeader(`${G}(止损点)`)

  const runtime = await createInProcessRuntime()
  const { ctx } = runtime
  // 20 个 token,每个间隔 25ms → 约 500ms 的窗口,足够在中途取消
  const TOKENS = Array.from({ length: 20 }, (_, i) => `t${i}`)
  runtime.registerFake('fake', { tokens: TOKENS, delayMs: 25 })

  const handle = await ctx.agents.create({
    sessionId: SessionId('verify-c'),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })

  const deltas: string[] = []
  let sawTurnEnd = false
  ctx.on('session/event', (_session: unknown, event: SessionEventEnvelope) => {
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      deltas.push(event.data.chunk.text ?? '')
    }
    if (event.type === 'turn/end') sawTurnEnd = true
  })

  handle.agent.followup(userText('长回复'))

  // 等到确实开始产出，再取消 —— 取消一个还没开始的 turn 什么也证明不了
  await sleep(120)
  const beforeCancel = deltas.length
  check(G, 'C1 取消前确实已在产出', beforeCancel > 0, `已收到 ${beforeCancel} 个增量`)

  handle.agent.cancel({ kind: 'user' })

  await handle.agent.whenIdle()
  const atIdle = deltas.length

  // 再等一段，确认取消之后没有"迟到"的输出继续冒出来
  await sleep(200)
  const afterSettle = deltas.length

  check(
    G,
    'C2 cancel() 之后不再产生任何输出',
    afterSettle === atIdle,
    `idle 时 ${atIdle} 个,再等 200ms 后 ${afterSettle} 个`,
  )
  check(
    G,
    'C3 取消真的截断了输出(没有跑完全部 token)',
    afterSettle < TOKENS.length,
    `收到 ${afterSettle}/${TOKENS.length} 个 —— 若等于总数则取消无效`,
  )
  checkEqual(G, 'C4 取消后 agent 回到 idle', handle.agent.status, 'idle')
  check(G, 'C5 被取消的 turn 仍然正常闭合(不留悬挂 turn)', sawTurnEnd, 'turn/end 已发出')

  // 取消之后 agent 必须还能用 —— 否则网关每次取消都得重建会话
  const resumed: string[] = []
  ctx.on('session/event', (_session: unknown, event: SessionEventEnvelope) => {
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      resumed.push(event.data.chunk.text ?? '')
    }
  })
  const beforeSecond = deltas.length
  handle.agent.followup(userText('取消后再来一轮'))
  await handle.agent.whenIdle()
  check(
    G,
    'C6 取消后 agent 仍可用,可继续下一轮',
    deltas.length > beforeSecond,
    `第二轮又收到 ${deltas.length - beforeSecond} 个增量`,
  )

  await handle.dispose()

  // dispose 是另一条取消路径：SSE 断连时网关会直接销毁会话
  groupHeader(`${G} · dispose 路径`)
  const runtime2 = await createInProcessRuntime()
  runtime2.registerFake('fake', { tokens: TOKENS, delayMs: 25 })
  const h2 = await runtime2.ctx.agents.create({
    sessionId: SessionId('verify-c-dispose'),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })

  const d2: string[] = []
  runtime2.ctx.on('session/event', (_s: unknown, event: SessionEventEnvelope) => {
    if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      d2.push(event.data.chunk.text ?? '')
    }
  })

  h2.agent.followup(userText('跑到一半就 dispose'))
  await sleep(120)
  const beforeDispose = d2.length
  check(G, 'C7 dispose 前确实已在产出', beforeDispose > 0, `已收到 ${beforeDispose} 个增量`)

  await h2.dispose()
  const atDispose = d2.length
  await sleep(200)

  check(
    G,
    'C8 dispose() 之后不再产生任何输出',
    d2.length === atDispose,
    `dispose 时 ${atDispose} 个,再等 200ms 后 ${d2.length} 个`,
  )
  check(
    G,
    'C9 dispose 截断了输出(未跑完全部 token)',
    d2.length < TOKENS.length,
    `收到 ${d2.length}/${TOKENS.length} 个`,
  )
  check(
    G,
    'C10 dispose 后 agent 离开注册表',
    runtime2.ctx.agents.get(SessionId('verify-c-dispose')) === undefined,
    'SSE 断连时网关可用这条路径彻底释放',
  )
}
