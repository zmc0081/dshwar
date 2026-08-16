/**
 * 进程创建与**僵尸进程防护**。
 *
 * ## 为什么 launcher 是一个可替换的接口
 *
 * 进程池的逻辑(复用、上限、空闲回收)与「怎么创建进程」是两件事。
 * 把创建抽出来,池逻辑就能对着一个假 launcher 做确定性测试 —— 否则每条断言
 * 都要付 115 ms 的冷启动,而且回收计时得靠真等。真进程只在少数几条测试里用。
 *
 * ## 僵尸进程
 *
 * 父进程退出而子进程留着,是运维噩梦:机器上慢慢堆满没人认领的 Node 进程,
 * 每个 58 MB。Node 不保证子进程随父进程死亡 —— POSIX 上子进程会被 init 收养,
 * Windows 上没有进程组的概念可用。
 *
 * 所以这里维护一份**模块级的存活登记**,并在 `process.on('exit')` 里同步杀光。
 * `exit` 回调**不能做异步操作**,所以只能用同步的 `kill()` —— 这也是为什么
 * 登记表存的是 `ChildProcessLike` 而不是某个需要 await 的句柄。
 *
 * @module @dshwar/supervisor/launcher
 */
import { fork } from 'node:child_process'

/** 子进程的最小面。抽出来是为了让测试能塞假实现。 */
export interface ChildProcessLike {
  readonly pid: number | undefined
  send(message: unknown): void
  kill(signal?: NodeJS.Signals): void
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void
  on(event: 'error', listener: (error: Error) => void): void
}

/** 创建一个子进程时要交待清楚的东西。 */
export interface LaunchSpec {
  readonly principalId: string
  readonly tenantId: string
  /** 子进程要装的 profile 名。子进程据此决定装哪些插件、用哪个工作区根。 */
  readonly profile: string
}

export interface ProcessLauncher {
  launch(spec: LaunchSpec): ChildProcessLike
}

/** 存活登记 —— 父进程退出时按这份表清场。 */
const live = new Set<ChildProcessLike>()
let hooksInstalled = false

/**
 * 装上退出钩子。幂等 —— 多个 Supervisor 实例共用同一份登记表,
 * 钩子只该装一次,否则 SIGINT 时会重复 kill(无害但噪音)。
 */
function installExitHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true

  // exit 回调里只能做同步事 —— 这是唯一能保证在父进程消失前跑完的时机
  process.on('exit', () => {
    for (const child of live) {
      try {
        child.kill('SIGKILL')
      } catch {
        // 已经死了就算了。exit 回调里抛异常会盖掉真正的退出原因。
      }
    }
    live.clear()
  })

  // Ctrl-C 与 kill 走的是信号,默认行为不触发 exit 钩子里的清理时机太晚 ——
  // 显式转成一次正常退出,让上面的 exit 钩子有机会跑。
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
}

/** 登记一个子进程,返回注销函数。供自定义 launcher 复用同一套防护。 */
export function trackChild(child: ChildProcessLike): () => void {
  installExitHooks()
  live.add(child)
  return () => live.delete(child)
}

/** 当前登记在册的子进程数。测试用。 */
export function trackedCount(): number {
  return live.size
}

export interface ForkOptions {
  /**
   * 追加给子进程的启动参数,拼在身份三项之后。
   *
   * 用于 worker 入口自己的开关(装哪个 provider、日志级别之类)。
   * **不要往这里放密钥**:启动参数在 `ps` 里人人可见。
   */
  readonly args?: readonly string[]
  /**
   * 开机配置,fork 之后**立刻**经 IPC 送给子进程,子进程收到才开始工作。
   *
   * 走 IPC 而不是启动参数,是因为这里装的是工作区根、会话日志根这类东西 ——
   * 启动参数在 `ps` 里人人可见,把部署的目录结构挂在那儿没有必要。
   * 身份则相反,见下。
   */
  readonly bootstrap?: Readonly<Record<string, unknown>>
}

/** 开机配置消息的信封 id。不会与真实 lease 撞号 —— 真实 id 带前缀 `L`。 */
export const BOOTSTRAP_LEASE = '#bootstrap'

/**
 * 用 `child_process.fork` 拉起子进程的 launcher。
 *
 * `principal` 经**启动参数**传入,不用环境变量。理由是环境变量会被子进程再
 * fork 出的孙进程继承 —— 而 agent 的 shell 工具**就是**在拉孙进程。principal
 * 漏进那些进程的环境里没有任何用处,却给了被执行的命令一个读取它的机会。
 * 启动参数不继承,所以到此为止。
 *
 * (启动参数和环境变量在 `ps` 里同样可见,身份走 argv 并不隐藏什么 ——
 * 隐藏也不是目的:运维需要一眼看出某个进程在为谁服务。)
 */
export function forkLauncher(modulePath: string, options: ForkOptions = {}): ProcessLauncher {
  return {
    launch(spec) {
      const child = fork(modulePath, [
        '--principal',
        spec.principalId,
        '--tenant',
        spec.tenantId,
        '--profile',
        spec.profile,
        ...(options.args ?? []),
      ]) as unknown as ChildProcessLike

      const untrack = trackChild(child)
      child.on('exit', untrack)

      if (options.bootstrap !== undefined) {
        child.send({ leaseId: BOOTSTRAP_LEASE, kind: 'bootstrap', payload: options.bootstrap })
      }
      return child
    },
  }
}
