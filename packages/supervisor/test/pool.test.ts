/**
 * 进程池逻辑 —— 复用、上限、空闲回收、租约隔离。
 *
 * 全部对着**假 launcher** 跑:池逻辑与「怎么创建进程」正交,而真进程每条断言
 * 要付 115 ms 冷启动、回收还得真等。真进程留给 `process.test.ts`。
 */
import { createPrincipal, ANONYMOUS } from '@dshwar/principal'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AnonymousNotAllowedError,
  AtCapacityError,
  Supervisor,
  type ChildProcessLike,
  type LaunchSpec,
  type ProcessLauncher,
  type SupervisorConfig,
  type SupervisorEvent,
} from '../src/index.ts'

const alice = createPrincipal({ id: 'u-alice', tenantId: 'acme' })
const bob = createPrincipal({ id: 'u-bob', tenantId: 'acme' })
/** 同 id 不同租户是**不同**主体 —— 但池按 id 分键,这里用来钉死这个前提。 */
const aliceElsewhere = createPrincipal({ id: 'u-alice', tenantId: 'other' })

interface FakeChild extends ChildProcessLike {
  readonly sent: unknown[]
  readonly signals: (NodeJS.Signals | undefined)[]
  readonly spec: LaunchSpec
  emitMessage(message: unknown): void
  emitExit(code: number | null, signal: string | null): void
}

function fakeLauncher(): { launcher: ProcessLauncher; children: FakeChild[] } {
  const children: FakeChild[] = []
  let nextPid = 1000

  const launcher: ProcessLauncher = {
    launch(spec) {
      const messageListeners: ((m: unknown) => void)[] = []
      const exitListeners: ((c: number | null, s: string | null) => void)[] = []
      const child: FakeChild = {
        pid: (nextPid += 1),
        spec,
        sent: [],
        signals: [],
        send(message) {
          child.sent.push(message)
        },
        kill(signal) {
          child.signals.push(signal)
        },
        on(event: string, listener: (...args: never[]) => void) {
          if (event === 'message') messageListeners.push(listener as (m: unknown) => void)
          if (event === 'exit')
            exitListeners.push(listener as (c: number | null, s: string | null) => void)
        },
        emitMessage(message) {
          for (const l of messageListeners) l(message)
        },
        emitExit(code, signal) {
          for (const l of exitListeners) l(code, signal)
        },
      }
      children.push(child)
      return child
    },
  }
  return { launcher, children }
}

function make(over: Partial<SupervisorConfig> = {}) {
  const { launcher, children } = fakeLauncher()
  const events: SupervisorEvent[] = []
  const supervisor = new Supervisor({
    launcher,
    profile: 'gateway',
    maxProcesses: 4,
    idleTimeoutMs: 60_000,
    onEvent: (e) => events.push(e),
    ...over,
  })
  return { supervisor, children, events }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('一 principal 一进程', () => {
  it('同一 principal 的两个会话复用同一进程', () => {
    const { supervisor, children } = make()

    const a = supervisor.acquire(alice)
    const b = supervisor.acquire(alice)

    expect(children).toHaveLength(1)
    expect(a.pid).toBe(b.pid)
    // 但 lease 是两个 —— 共用进程不等于共用会话身份
    expect(a.leaseId).not.toBe(b.leaseId)
    expect(supervisor.size).toBe(1)
  })

  it('不同 principal 落在不同进程', () => {
    const { supervisor, children } = make()

    const a = supervisor.acquire(alice)
    const b = supervisor.acquire(bob)

    expect(children).toHaveLength(2)
    expect(a.pid).not.toBe(b.pid)
    expect(supervisor.size).toBe(2)
  })

  it('principal 与 profile 交给 launcher,不经环境变量', () => {
    const { supervisor, children } = make({ profile: 'enterprise' })
    supervisor.acquire(alice)

    expect(children[0]!.spec).toEqual({
      principalId: 'u-alice',
      tenantId: 'acme',
      profile: 'enterprise',
    })
  })

  it('匿名主体不得取得进程(硬规则 6)', () => {
    const { supervisor, children } = make()
    expect(() => supervisor.acquire(ANONYMOUS)).toThrow(AnonymousNotAllowedError)
    expect(children).toHaveLength(0)
  })
})

describe('租约隔离:同进程的两路会话互不干扰', () => {
  it('消息只送到对应 lease 的订阅者', () => {
    const { supervisor, children } = make()
    const a = supervisor.acquire(alice)
    const b = supervisor.acquire(alice)

    const toA: unknown[] = []
    const toB: unknown[] = []
    a.onMessage((m) => toA.push(m.payload))
    b.onMessage((m) => toB.push(m.payload))

    children[0]!.emitMessage({ leaseId: a.leaseId, kind: 'event', payload: 'for-a' })
    children[0]!.emitMessage({ leaseId: b.leaseId, kind: 'event', payload: 'for-b' })

    expect(toA).toEqual(['for-a'])
    expect(toB).toEqual(['for-b'])
  })

  it('取消只针对本 lease —— 不杀进程,不波及兄弟会话', () => {
    const { supervisor, children } = make()
    const a = supervisor.acquire(alice)
    const b = supervisor.acquire(alice)

    a.cancel()

    expect(children[0]!.sent).toEqual([{ leaseId: a.leaseId, kind: 'cancel' }])
    expect(children[0]!.signals).toEqual([]) // 没有杀进程
    expect(b.alive).toBe(true)
  })

  it('格式不对的子进程消息被丢弃,不炸掉分发', () => {
    const { supervisor, children } = make()
    const a = supervisor.acquire(alice)
    const seen: unknown[] = []
    a.onMessage((m) => seen.push(m))

    // 子进程实现可换,不能假定它守规矩
    children[0]!.emitMessage(null)
    children[0]!.emitMessage('nope')
    children[0]!.emitMessage({ leaseId: 42 })
    children[0]!.emitMessage({ leaseId: a.leaseId, kind: 'bogus' })
    children[0]!.emitMessage({ leaseId: a.leaseId, kind: 'event', payload: 1 })

    expect(seen).toHaveLength(1)
  })

  it('退订之后不再收到消息', () => {
    const { supervisor, children } = make()
    const a = supervisor.acquire(alice)
    const seen: unknown[] = []
    const off = a.onMessage((m) => seen.push(m))

    children[0]!.emitMessage({ leaseId: a.leaseId, kind: 'event', payload: 1 })
    off()
    children[0]!.emitMessage({ leaseId: a.leaseId, kind: 'event', payload: 2 })

    expect(seen).toHaveLength(1)
  })
})

describe('空闲回收', () => {
  it('最后一个 lease 释放后到点才回收', () => {
    const { supervisor, children, events } = make({ idleTimeoutMs: 1000 })
    const a = supervisor.acquire(alice)
    const b = supervisor.acquire(alice)

    a.release()
    vi.advanceTimersByTime(5000)
    // 还有 b 持着 —— 不能回收
    expect(supervisor.size).toBe(1)
    expect(children[0]!.signals).toEqual([])

    b.release()
    vi.advanceTimersByTime(999)
    expect(supervisor.size).toBe(1)

    vi.advanceTimersByTime(2)
    expect(supervisor.size).toBe(0)
    expect(children[0]!.signals).toContain('SIGTERM')
    expect(events.filter((e) => e.kind === 'reclaim')).toHaveLength(1)
  })

  it('计时期间被重新 acquire 则取消回收', () => {
    const { supervisor, children } = make({ idleTimeoutMs: 1000 })
    supervisor.acquire(alice).release()

    vi.advanceTimersByTime(500)
    const again = supervisor.acquire(alice)
    vi.advanceTimersByTime(5000)

    expect(supervisor.size).toBe(1)
    expect(children).toHaveLength(1) // 复用,没有重开
    expect(again.alive).toBe(true)
  })

  it('回收之后再 acquire 能重新起来', () => {
    const { supervisor, children } = make({ idleTimeoutMs: 1000 })
    supervisor.acquire(alice).release()
    vi.advanceTimersByTime(1001)
    expect(supervisor.size).toBe(0)

    const revived = supervisor.acquire(alice)
    expect(children).toHaveLength(2)
    expect(revived.alive).toBe(true)
    expect(revived.pid).not.toBe(children[0]!.pid)
  })

  it('SIGTERM 之后不认账的进程会被 SIGKILL 收尸', () => {
    const { supervisor, children } = make({ idleTimeoutMs: 1000, terminateGraceMs: 3000 })
    supervisor.acquire(alice).release()

    vi.advanceTimersByTime(1001)
    expect(children[0]!.signals).toEqual(['SIGTERM'])

    vi.advanceTimersByTime(3001)
    expect(children[0]!.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('release 幂等 —— 重复释放不会把引用计数压成负数', () => {
    const { supervisor } = make({ idleTimeoutMs: 1000 })
    const a = supervisor.acquire(alice)
    const b = supervisor.acquire(alice)

    a.release()
    a.release()
    a.release()

    vi.advanceTimersByTime(5000)
    // b 还持着,不该被回收 —— 若计数被压成负数这里就会误回收
    expect(supervisor.size).toBe(1)
    expect(b.alive).toBe(true)
  })
})

describe('进程上限', () => {
  it('达到上限后拒绝新 principal,行为与声明一致', () => {
    const { supervisor, events } = make({ maxProcesses: 2 })
    supervisor.acquire(alice)
    supervisor.acquire(bob)

    const carol = createPrincipal({ id: 'u-carol', tenantId: 'acme' })
    expect(() => supervisor.acquire(carol)).toThrow(AtCapacityError)
    // 拒绝要可观测 —— 运维据此判断该扩容还是该调上限
    expect(events).toContainEqual({
      kind: 'rejected',
      principalId: 'u-carol',
      reason: 'at_capacity',
    })
  })

  it('上限只拦新进程 —— 已有进程的 principal 再开会话不受影响', () => {
    const { supervisor } = make({ maxProcesses: 2 })
    supervisor.acquire(alice)
    supervisor.acquire(bob)

    // 满了,但 alice 已经有进程。拒绝她既不省内存,又让并发会话时灵时不灵。
    expect(() => supervisor.acquire(alice)).not.toThrow()
    expect(supervisor.size).toBe(2)
  })

  it('回收腾出槽位后,之前被拒的 principal 能进来', () => {
    const { supervisor } = make({ maxProcesses: 1, idleTimeoutMs: 1000 })
    const a = supervisor.acquire(alice)
    expect(() => supervisor.acquire(bob)).toThrow(AtCapacityError)

    a.release()
    vi.advanceTimersByTime(1001)

    expect(() => supervisor.acquire(bob)).not.toThrow()
  })

  it('AtCapacityError 带机器可读的上下文', () => {
    const { supervisor } = make({ maxProcesses: 1 })
    supervisor.acquire(alice)
    try {
      supervisor.acquire(bob)
      expect.unreachable('应当抛 AtCapacityError')
    } catch (e) {
      expect(e).toBeInstanceOf(AtCapacityError)
      expect((e as AtCapacityError).principalId).toBe('u-bob')
      expect((e as AtCapacityError).maxProcesses).toBe(1)
    }
  })
})

describe('崩溃', () => {
  it('持有 lease 时进程死亡 → 报 crash', () => {
    const { supervisor, children, events } = make()
    supervisor.acquire(alice)

    children[0]!.emitExit(7, null)

    expect(events).toContainEqual({
      kind: 'crash',
      principalId: 'u-alice',
      pid: children[0]!.pid,
      exitCode: 7,
      signal: null,
    })
    expect(supervisor.size).toBe(0)
  })

  it('主动回收导致的退出不报 crash —— 那是预期内的', () => {
    const { supervisor, children, events } = make({ idleTimeoutMs: 1000 })
    supervisor.acquire(alice).release()
    vi.advanceTimersByTime(1001)

    children[0]!.emitExit(null, 'SIGTERM')

    expect(events.some((e) => e.kind === 'crash')).toBe(false)
    expect(events.filter((e) => e.kind === 'reclaim')).toHaveLength(1)
  })

  it('进程死后再 acquire 会重开,而不是把死进程交出去', () => {
    const { supervisor, children } = make()
    const dead = supervisor.acquire(alice)
    children[0]!.emitExit(1, null)
    expect(dead.alive).toBe(false)

    const fresh = supervisor.acquire(alice)
    expect(children).toHaveLength(2)
    expect(fresh.alive).toBe(true)
  })

  it('向已死进程送消息抛错,不静默丢弃', () => {
    const { supervisor, children } = make()
    const a = supervisor.acquire(alice)
    children[0]!.emitExit(1, null)

    // 静默丢弃会让调用方以为送出去了,然后永远等一个不会来的回复
    expect(() => a.send({ hello: 1 })).toThrow(/无法送达/)
  })

  it('旧进程迟到的 exit 不会把重开的新进程摘掉', () => {
    const { supervisor, children } = make()
    supervisor.acquire(alice)
    children[0]!.emitExit(1, null)
    supervisor.acquire(alice)
    expect(supervisor.size).toBe(1)

    // 同一个 child 再报一次 exit(重复事件在真实 IPC 上会发生)
    children[0]!.emitExit(1, null)

    expect(supervisor.size).toBe(1)
    expect(supervisor.isAlive('u-alice')).toBe(true)
  })
})

describe('健康检查:活着 ≠ 能响应', () => {
  it('isAlive 只看进程有没有退出', () => {
    const { supervisor, children } = make()
    supervisor.acquire(alice)
    expect(supervisor.isAlive('u-alice')).toBe(true)

    children[0]!.emitExit(0, null)
    expect(supervisor.isAlive('u-alice')).toBe(false)
    expect(supervisor.isAlive('u-nobody')).toBe(false)
  })

  it('ping 拿到 pong 才算能响应', async () => {
    const { supervisor, children } = make()
    supervisor.acquire(alice)

    const pending = supervisor.ping('u-alice', 1000)
    expect(children[0]!.sent).toContainEqual({ leaseId: '#health', kind: 'ping' })
    children[0]!.emitMessage({ leaseId: '#health', kind: 'pong' })

    await expect(pending).resolves.toBeTypeOf('number')
  })

  it('活着但不回 pong —— 这正是只查存活会漏掉的那种进程', async () => {
    const { supervisor } = make()
    supervisor.acquire(alice)

    const pending = supervisor.ping('u-alice', 1000)
    await vi.advanceTimersByTimeAsync(1001)

    expect(supervisor.isAlive('u-alice')).toBe(true) // 活着
    await expect(pending).resolves.toBeUndefined() // 但没人应答
  })

  it('ping 一个不存在的 principal 返回 undefined', async () => {
    const { supervisor } = make()
    await expect(supervisor.ping('u-nobody', 100)).resolves.toBeUndefined()
  })
})

describe('停机', () => {
  it('dispose 停掉全部进程', () => {
    const { supervisor, children } = make()
    supervisor.acquire(alice)
    supervisor.acquire(bob)

    supervisor.dispose()

    expect(supervisor.size).toBe(0)
    expect(children[0]!.signals).toContain('SIGTERM')
    expect(children[1]!.signals).toContain('SIGTERM')
  })

  it('dispose 之后不再受理 acquire', () => {
    const { supervisor } = make()
    supervisor.dispose()
    expect(() => supervisor.acquire(alice)).toThrow(/已停止/)
  })

  it('reclaim 可以不等超时立刻回收', () => {
    const { supervisor, children } = make()
    supervisor.acquire(alice)
    supervisor.reclaim('u-alice')
    expect(supervisor.size).toBe(0)
    expect(children[0]!.signals).toContain('SIGTERM')
  })
})

describe('分键前提', () => {
  it('池按 principal id 分键 —— 同 id 跨租户会撞进程', () => {
    const { supervisor, children } = make()
    supervisor.acquire(alice)
    supervisor.acquire(aliceElsewhere)

    // 这**不是** bug:principal id 按定义是全局唯一且不可轮换的
    // (`@dshwar/principal` 的 id 文档 —— 必须来自 IdP 的不可变主键)。
    // 两个租户出现同一个 id 意味着身份映射已经错了,那要在 tenant-map 层拦,
    // 不该由进程池兜底。这条断言把这个前提钉死,免得将来有人以为池会替他分租户。
    expect(children).toHaveLength(1)
    expect(supervisor.size).toBe(1)
  })
})
