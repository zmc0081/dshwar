/**
 * V0.4.5 Session 2 —— 跨进程会话驱动,语义不退化。
 *
 * 三条要求各有一组:
 *   R3 事件回传 ★ 与进程内**逐条对照**
 *   R4 可靠取消 ★ 红线 3:断言取消后不再有事件到达,不是只看接口返回码
 *   R5 崩溃恢复 ★ 不静默丢失
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPrincipal } from '@dshwar/principal'
import { forkLauncher, Supervisor, type SupervisorEvent } from '@dshwar/supervisor'
import { afterEach, describe, expect, it } from 'vitest'
import { createRemoteAgent, remoteUserMessage } from '../src/sessions/remote.ts'
import type { AgentHandleLike } from '../src/sessions/store.ts'
import { createTestHarness } from './harness.ts'

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'worker-entry.ts')
const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })

let supervisor: Supervisor | undefined
afterEach(() => {
  supervisor?.dispose()
  supervisor = undefined
})

function makeSupervisor(
  options: { tokens?: string[]; delayMs?: number; onEvent?: (e: SupervisorEvent) => void } = {},
): Supervisor {
  const root = mkdtempSync(join(tmpdir(), 'dshwar-xp-'))
  supervisor = new Supervisor({
    launcher: {
      launch: (spec) =>
        forkLauncher(WORKER, {
          // 假模型的节奏经启动参数传给 worker 入口。
          // ⚠️ 第一版漏了这一步 —— 于是 worker 用的是它自己的默认单 token,
          // 而取消测试的「收到的增量 < 40」在只有 1 个 token 时恒真,白过。
          args: [
            '--tokens',
            (options.tokens ?? ['你好', ',', '世界']).join('|'),
            '--delay',
            String(options.delayMs ?? 0),
          ],
          bootstrap: {
            workspaceRoot: root,
            sessionRoot: join(root, 'sessions'),
            authEntries: [{ token: 'tok', id: spec.principalId, tenantId: spec.tenantId }],
            defaultProvider: 'fake',
            defaultModel: 'fake-1',
            quiet: true,
          },
        }).launch(spec),
    },
    profile: 'gateway',
    maxProcesses: 4,
    idleTimeoutMs: 60_000,
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  })
  return supervisor
}

/** `--experimental-strip-types` 拉起 .ts worker;fork 默认不带这个标志。 */
process.env['NODE_OPTIONS'] = [process.env['NODE_OPTIONS'], '--experimental-strip-types']
  .filter(Boolean)
  .join(' ')

/** 收集一次完整轮次的上游事件(经跨进程句柄)。 */
async function driveRemote(
  handle: AgentHandleLike,
  text: string,
): Promise<{ type: string; seq: number }[]> {
  const seen: { type: string; seq: number }[] = []
  handle.agent.ctx.on('session/event', (_s, event) => {
    const e = event as { type: string; seq: number }
    seen.push({ type: e.type, seq: e.seq })
  })
  handle.agent.followup(remoteUserMessage(text))
  await handle.agent.whenIdle()
  return seen
}

/** 同一段输入,进程内驱动的事件序列。 */
async function driveInProcess(text: string): Promise<{ type: string; seq: number }[]> {
  const harness = await createTestHarness({ fake: { tokens: ['你好', ',', '世界'] } })
  const handle = await harness.createAgent({
    sessionId: 's-inproc',
    model: undefined,
    provider: undefined,
  })
  const seen: { type: string; seq: number }[] = []
  handle.agent.ctx.on('session/event', (_s, event) => {
    const e = event as { type: string; seq: number }
    seen.push({ type: e.type, seq: e.seq })
  })
  handle.agent.followup(harness.userMessage(text))
  await handle.agent.whenIdle()
  return seen
}

describe('R3 事件回传', () => {
  it('★ 同一段输入:跨进程与进程内的事件序列逐条相同', async () => {
    const remote = await createRemoteAgent(
      makeSupervisor().acquire(alice),
      { sessionId: 's-remote', model: undefined, provider: undefined },
      () => {},
    )

    const [crossProcess, inProcess] = await Promise.all([
      driveRemote(remote, '你好'),
      driveInProcess('你好'),
    ])

    // 逐条对照:事件名与 seq 都要一致。这是红线 2 的实证 ——
    // 客户端不该知道自己跑在哪种隔离下,而事件流是它唯一能看到的东西。
    expect(crossProcess).toEqual(inProcess)
    expect(crossProcess.length).toBeGreaterThan(5)
  }, 30_000)

  it('seq 单调不回退 —— Last-Event-ID 续传依赖这一条', async () => {
    const remote = await createRemoteAgent(
      makeSupervisor().acquire(alice),
      { sessionId: 's-seq', model: undefined, provider: undefined },
      () => {},
    )
    const seen = await driveRemote(remote, '你好')

    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!.seq, `seq 在第 ${i} 条上回退`).toBeGreaterThan(seen[i - 1]!.seq)
    }
  }, 30_000)

  it('同一进程的两路会话事件不串号', async () => {
    const pool = makeSupervisor()
    const [one, two] = await Promise.all([
      createRemoteAgent(
        pool.acquire(alice),
        { sessionId: 's-a', model: undefined, provider: undefined },
        () => {},
      ),
      createRemoteAgent(
        pool.acquire(alice),
        { sessionId: 's-b', model: undefined, provider: undefined },
        () => {},
      ),
    ])
    // 复用同一个进程 —— 这正是串号风险所在
    expect(pool.size).toBe(1)

    const toOne: string[] = []
    const toTwo: string[] = []
    one.agent.ctx.on('session/event', (_s, e) => toOne.push((e as { type: string }).type))
    two.agent.ctx.on('session/event', (_s, e) => toTwo.push((e as { type: string }).type))

    one.agent.followup(remoteUserMessage('只发给 one'))
    await one.agent.whenIdle()

    expect(toOne.length).toBeGreaterThan(0)
    expect(toTwo, 'two 收到了不属于它的事件').toEqual([])
  }, 30_000)
})

// ★ 红线 3:取消语义不退化。
describe('R4 可靠取消', () => {
  it('取消之后不再有事件到达(不是只看接口返回码)', async () => {
    const tokens = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const remote = await createRemoteAgent(
      makeSupervisor({ tokens, delayMs: 20 }).acquire(alice),
      { sessionId: 's-cancel', model: undefined, provider: undefined },
      () => {},
    )

    let deltas = 0
    remote.agent.ctx.on('session/event', (_s, event) => {
      const e = event as { type: string; data?: { chunk?: { type: string } } }
      if (e.type === 'assistant/chunk' && e.data?.chunk?.type === 'text-delta') deltas += 1
    })

    remote.agent.followup(remoteUserMessage('慢慢说'))
    await new Promise((r) => setTimeout(r, 150))
    remote.agent.cancel({ kind: 'user' })
    await remote.agent.whenIdle()

    const atCancel = deltas
    expect(atCancel, '一个增量都没有,测不出截断').toBeGreaterThan(0)
    expect(atCancel, `收到 ${atCancel}/${tokens.length} 个增量,取消没生效`).toBeLessThan(
      tokens.length,
    )

    // 取消之后**再等一段**,确认没有迟到的事件继续涌进来。
    // 只断言「截断时的计数」会漏掉一种失败:子进程其实没停,只是慢。
    await new Promise((r) => setTimeout(r, 300))
    expect(deltas, '取消后仍有事件到达').toBe(atCancel)
  }, 30_000)

  it('取消一路不波及同进程的另一路', async () => {
    const tokens = Array.from({ length: 30 }, (_, i) => `t${i}`)
    const pool = makeSupervisor({ tokens, delayMs: 20 })
    const [victim, bystander] = await Promise.all([
      createRemoteAgent(
        pool.acquire(alice),
        { sessionId: 's-victim', model: undefined, provider: undefined },
        () => {},
      ),
      createRemoteAgent(
        pool.acquire(alice),
        { sessionId: 's-bystander', model: undefined, provider: undefined },
        () => {},
      ),
    ])
    expect(pool.size).toBe(1)

    let bystanderTurns = 0
    bystander.agent.ctx.on('session/event', (_s, e) => {
      if ((e as { type: string }).type === 'turn/end') bystanderTurns += 1
    })

    victim.agent.followup(remoteUserMessage('会被取消'))
    bystander.agent.followup(remoteUserMessage('不该受影响'))
    await new Promise((r) => setTimeout(r, 100))
    victim.agent.cancel({ kind: 'user' })

    await bystander.agent.whenIdle()
    // 旁观者跑完了整轮 —— 若取消是靠杀进程实现的,这里会是 0
    expect(bystanderTurns).toBe(1)
  }, 30_000)
})

describe('R5 崩溃恢复', () => {
  it('子进程死亡时主动通知,而不是让调用方去轮询', async () => {
    const pool = makeSupervisor()
    let died = false
    await createRemoteAgent(
      pool.acquire(alice),
      { sessionId: 's-crash', model: undefined, provider: undefined },
      () => {
        died = true
      },
    )

    pool.reclaim(alice.id)
    await new Promise((r) => setTimeout(r, 50))

    expect(died, '进程没了却没人通知 —— 这就是静默丢失').toBe(true)
  }, 30_000)

  it('进程死亡时 whenIdle 被放掉,不留悬挂的 promise', async () => {
    const tokens = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const pool = makeSupervisor({ tokens, delayMs: 50 })
    const remote = await createRemoteAgent(
      pool.acquire(alice),
      { sessionId: 's-hang', model: undefined, provider: undefined },
      () => {},
    )

    remote.agent.followup(remoteUserMessage('会被打断'))
    const idle = remote.agent.whenIdle()
    pool.reclaim(alice.id)

    // 一个永远不 settle 的 promise 不会报错、不会超时、不出现在任何监控上
    await expect(
      Promise.race([idle, new Promise((_, r) => setTimeout(() => r(new Error('悬挂')), 2000))]),
    ).resolves.toBeUndefined()
  }, 30_000)

  it('崩溃进 supervisor 事件流 —— 审计据此归类', async () => {
    const events: SupervisorEvent[] = []
    const pool = makeSupervisor({ onEvent: (e) => events.push(e) })
    const lease = pool.acquire(alice)
    await createRemoteAgent(
      lease,
      { sessionId: 's-audit', model: undefined, provider: undefined },
      () => {},
    )

    // 从外面把进程杀掉 —— 模拟 OOM / 段错误,而不是主动回收
    process.kill(lease.pid!, 'SIGKILL')
    await new Promise((r) => setTimeout(r, 300))

    const crash = events.find((e) => e.kind === 'crash')
    expect(crash, '崩溃没进事件流').toBeDefined()
    expect(crash).toMatchObject({ kind: 'crash', principalId: alice.id })
  }, 30_000)
})

// V0.4.6 Session 4:agent/error 是上游的**另一条通道**(挂在 Context 上,
// 不是 SessionEventMap 成员)。不专门转发它,进程隔离档就会悄悄丢掉错误通知 ——
// 而红线 2 要求客户端不该知道自己跑在哪一档,**包括出错的时候**。
describe('agent/error 穿过进程边界', () => {
  it('★ 子进程里 agent 报错,父进程收得到', async () => {
    const remote = await createRemoteAgent(
      makeSupervisor().acquire(alice),
      { sessionId: 's-boom', model: 'm', provider: 'boom' },
      () => {},
    )

    const errors: { turn?: number }[] = []
    remote.agent.ctx.on('agent/error', (payload) => errors.push(payload))

    remote.agent.followup(remoteUserMessage('会炸'))
    await remote.agent.whenIdle()
    await new Promise((r) => setTimeout(r, 100))

    expect(errors.length, 'agent 在子进程里炸了,父进程什么都没收到').toBeGreaterThan(0)
  }, 30_000)
})
