/**
 * 真进程测试 —— 只放**假 launcher 证明不了**的那几条。
 *
 * 其余池逻辑在 `pool.test.ts` 里对着假 launcher 跑,那边快且确定。
 * 这里的每条断言都要付真实的进程创建耗时,所以数量刻意压到最少。
 */
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createPrincipal } from '@dshwar/principal'
import { afterEach, describe, expect, it } from 'vitest'
import { forkLauncher, Supervisor, trackedCount } from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const ECHO = join(here, 'fixtures', 'echo-child.mjs')
const ORPHAN = join(here, 'fixtures', 'orphan-parent.ts')
const EXIT_HOOK = join(here, 'fixtures', 'exit-hook.ts')

const alice = createPrincipal({ id: 'u-alice', tenantId: 'acme' })
const bob = createPrincipal({ id: 'u-bob', tenantId: 'globex' })

let supervisor: Supervisor | undefined
afterEach(() => {
  supervisor?.dispose()
  supervisor = undefined
})

/** 等一条属于该 lease 的消息。 */
function nextMessage(lease: {
  onMessage: (l: (m: { payload?: unknown }) => void) => () => void
}): Promise<unknown> {
  return new Promise((resolve) => {
    const off = lease.onMessage((m) => {
      off()
      resolve(m.payload)
    })
  })
}

/** 进程是否还在。`kill(pid, 0)` 只探测不发信号。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('真进程:身份经启动参数传入', () => {
  it('子进程只认拉起它的那一个 principal', async () => {
    supervisor = new Supervisor({
      launcher: forkLauncher(ECHO),
      profile: 'enterprise',
      maxProcesses: 4,
      idleTimeoutMs: 60_000,
    })

    const a = supervisor.acquire(alice)
    const b = supervisor.acquire(bob)

    const [ra, rb] = await Promise.all([
      (a.send('hi'), nextMessage(a)),
      (b.send('hi'), nextMessage(b)),
    ])

    expect(ra).toEqual({
      echo: 'hi',
      identity: { principalId: 'u-alice', tenantId: 'acme', profile: 'enterprise' },
    })
    expect(rb).toEqual({
      echo: 'hi',
      identity: { principalId: 'u-bob', tenantId: 'globex', profile: 'enterprise' },
    })
    expect(a.pid).not.toBe(b.pid)
  })

  /**
   * 验证 E 的**可测部分**(Session 0 报告 §5 挂账的那条)。
   *
   * 完整的验证 E 是「node-pty 在两层嵌套下仍可用」。本次只能测到嵌套进程创建
   * 这一层 —— `@deepseek-ai/dsh-subprocess-local` 不是本仓依赖,node-pty 也没装
   * (它要原生构建,且上游 `ProcessInspector` 在 win32 直接抛错)。
   *
   * **切开来看,两件事的风险不对等:** supervisor 可能破坏的是「子进程还能不能
   * 再拉起进程」—— IPC 通道、stdio 继承、句柄传递都在它的影响范围内,这条测了。
   * 而「node-pty 的原生绑定在深度 2 是否工作」是 node-pty 自己的问题,
   * supervisor 碰不到它,V0.1.0 验证 D 已证明深度 1 可用。
   *
   * 仍未验证的残余记在 `docs/FEASIBILITY-REPORT-V45.md`,由 Session 3 装上
   * subprocess 之后补。
   */
  it('两层嵌套:子进程还能再拉起孙进程(agent 的 shell 工具依赖这个)', async () => {
    supervisor = new Supervisor({
      launcher: forkLauncher(ECHO),
      profile: 'gateway',
      maxProcesses: 4,
      idleTimeoutMs: 60_000,
    })
    const lease = supervisor.acquire(alice)

    lease.send('#nest')
    await expect(nextMessage(lease)).resolves.toEqual({
      nested: 'grandchild-ok',
      exitCode: 0,
    })
  }, 20_000)

  it('ping 在真进程上拿得到 pong', async () => {
    supervisor = new Supervisor({
      launcher: forkLauncher(ECHO),
      profile: 'gateway',
      maxProcesses: 4,
      idleTimeoutMs: 60_000,
    })
    supervisor.acquire(alice)

    await expect(supervisor.ping('u-alice', 3000)).resolves.toBeTypeOf('number')
  })

  it('回收之后进程真的没了', async () => {
    supervisor = new Supervisor({
      launcher: forkLauncher(ECHO),
      profile: 'gateway',
      maxProcesses: 4,
      idleTimeoutMs: 60_000,
    })
    const lease = supervisor.acquire(alice)
    const pid = lease.pid!
    expect(pidAlive(pid)).toBe(true)

    supervisor.reclaim('u-alice')
    // SIGTERM 到进程真正消失之间有个窗口
    await vi_waitFor(() => !pidAlive(pid))
    expect(pidAlive(pid)).toBe(false)
  })

  it('存活登记随进程退出而清空 —— 登记表不会无限涨', async () => {
    // 先等计数静默再取基线:前几条测试 dispose 掉的进程还在异步退出,
    // 直接取快照会把它们算进基线,之后计数掉到基线以下,断言永远不成立。
    const before = await waitForStableCount()
    supervisor = new Supervisor({
      launcher: forkLauncher(ECHO),
      profile: 'gateway',
      maxProcesses: 4,
      idleTimeoutMs: 60_000,
    })
    supervisor.acquire(alice)
    expect(trackedCount()).toBe(before + 1)

    supervisor.reclaim('u-alice')
    await vi_waitFor(() => trackedCount() === before)
    expect(trackedCount()).toBe(before)
  })
})

// 僵尸进程是运维噩梦:机器上慢慢堆满没人认领的 Node 进程,每个 58 MB。
// 这条只能用真进程验 —— 假 launcher 根本没有「父进程退出」这个概念。
describe('真进程:父进程退出时子进程不残留', () => {
  it('父进程不调 dispose 直接退出,子进程仍随之消失', async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', ORPHAN],
      { cwd: here },
    )

    const pids = JSON.parse(stdout.trim().split('\n').at(-1)!) as number[]
    expect(pids).toHaveLength(2)
    expect(pids.every((p) => typeof p === 'number')).toBe(true)

    // 父进程已经退出(execFile 已 resolve)。子进程应当已被退出钩子杀掉。
    await vi_waitFor(() => pids.every((p) => !pidAlive(p)))
    for (const pid of pids) expect(pidAlive(pid), `pid ${pid} 残留了`).toBe(false)
  }, 20_000)

  /**
   * ⚠️ 上一条**在本机与 CI 上会白过**,原因记在这里免得将来有人误信它。
   *
   * 实测(2026-08-16,Windows):把 `trackChild` 完全绕开、直接 `fork` 的子进程
   * 同样随父进程消失;连不带 IPC 的 `spawn` 子进程也一样。这不是 Windows 的
   * 语义 —— Windows 根本没有父子生命周期绑定,Linux 上孤儿会被 init 收养 ——
   * 而是**测试沙箱把整棵进程树放进了一个会连坐清理的作用域**
   * (Windows Job Object / Linux cgroup)。
   *
   * 后果:「子进程没了」这个观测无法区分「守卫起作用」和「沙箱替我收了尸」。
   * 所以上一条只作端状态的兜底断言,**守卫本身由下面这两条负责**——
   * 它们直接验机制,平台无关,守卫被摘掉就立刻变红。
   */
  it('退出钩子真的杀掉登记在册的子进程', async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', EXIT_HOOK],
      { cwd: here },
    )
    expect(stdout).toContain('KILLED:SIGKILL')
  }, 20_000)

  it('没登记的就不杀 —— 证明上一条测的是登记表,不是别的什么', async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', EXIT_HOOK, '--no-track'],
      { cwd: here },
    )
    expect(stdout).not.toContain('KILLED')
  }, 20_000)
})

/** 等到存活登记数连续若干次不变,返回该值。 */
async function waitForStableCount(): Promise<number> {
  let last = trackedCount()
  let stable = 0
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && stable < 4) {
    await new Promise((r) => setTimeout(r, 25))
    const now = trackedCount()
    stable = now === last ? stable + 1 : 0
    last = now
  }
  return last
}

/** 轮询等待条件成立。进程消失是异步的,没有可订阅的事件。 */
async function vi_waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
}
