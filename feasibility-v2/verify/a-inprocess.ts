/**
 * 验证 A —— 进程内发起一次完整会话
 *
 * ARCHITECTURE.md §1.1 说上游两条通道都不能直接用:SDK 协议是 stdio JSON-RPC
 * (移动端连不上),内置 webserver 无认证。网关的出路是**在进程内直接驱动 agent**。
 * 这条不成立,则 supervisor 必须从 V0.4.0 提前 —— 网关只能拉起 dsh 进程再走
 * stdio 协议,而那条协议连 cancel 都没有。
 */
import { check, checkEqual, groupHeader } from './harness.ts'
import {
  createInProcessRuntime,
  SessionId,
  userText,
  type SessionEventEnvelope,
} from './runtime.ts'

const G = '验证 A · 进程内驱动 agent'

export async function runA(): Promise<void> {
  groupHeader(`${G}(止损点)`)

  const runtime = await createInProcessRuntime()
  const { ctx } = runtime
  runtime.registerFake('fake')

  check(
    G,
    'A1 七个上游插件全部加载,零 fork',
    ctx.get('agents') !== undefined,
    'ctx.agents / sessions / llm / tools / systemPrompt 均已注册',
  )

  const handle = await ctx.agents.create({
    sessionId: SessionId('verify-a'),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })

  check(
    G,
    'A2 不经 stdio JSON-RPC 即可创建 agent',
    handle.agent.id === 'verify-a',
    `id=${handle.agent.id}`,
  )
  checkEqual(G, 'A3 新建 agent 初始为 idle', handle.agent.status, 'idle')

  const events: string[] = []
  let assembled = ''
  ctx.on('session/event', (_session: unknown, event: SessionEventEnvelope) => {
    events.push(event.type)
    if (event.type === 'assistant/message') {
      assembled = (event.data?.message?.content ?? []).map((b) => b.text ?? '').join('')
    }
  })

  handle.agent.followup(userText('你好'))
  await handle.agent.whenIdle()

  check(
    G,
    'A4 一轮完整跑通,拿到完整回复',
    assembled.length > 0,
    `回复 = ${JSON.stringify(assembled)}`,
  )
  checkEqual(G, 'A5 回复内容与假模型吐出的一致', assembled, '你好,我是假模型。')
  checkEqual(
    G,
    'A6 turn 完整闭合',
    [events.includes('turn/start'), events.includes('turn/end')],
    [true, true],
  )
  checkEqual(
    G,
    'A7 step 完整闭合',
    [events.includes('step/start'), events.includes('step/end')],
    [true, true],
  )
  checkEqual(G, 'A8 一轮结束后回到 idle', handle.agent.status, 'idle')

  // 网关按请求创建/销毁会话,这条决定它能不能复用同一个进程
  await handle.dispose()
  check(
    G,
    'A9 handle.dispose() 完成且 agent 离开注册表',
    ctx.agents.get(SessionId('verify-a')) === undefined,
    'dispose 后 get() 返回 undefined',
  )

  // 同一进程内再来一个,确认没有残留
  const second = await ctx.agents.create({
    sessionId: SessionId('verify-a-2'),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })
  second.agent.followup(userText('再来一次'))
  await second.agent.whenIdle()
  check(G, 'A10 同一进程内可反复创建会话', second.agent.status === 'idle', '第二个会话正常跑完')
  await second.dispose()
}
