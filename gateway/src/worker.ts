/**
 * 隔离进程的子进程入口 —— **一个进程只服务一个 principal**。
 *
 * ## 它与 `runtime.ts` 的关系
 *
 * 装配逻辑一行都不重复:直接调 {@link assembleRuntime}。子进程与父进程装的是
 * **同一套插件**,这是「切到进程隔离后行为不变」的前提 —— 两份装配代码迟早会漂,
 * 而漂出来的差异会表现为「只在进程隔离下复现」的怪 bug。
 *
 * ## 协议
 *
 * 与 `@dshwar/supervisor` 的信封一致,每条消息带 `leaseId`。
 * **一个 lease = 一个会话**,所以这里用 `leaseId` 直接索引 agent 句柄。
 *
 * | 方向 | 消息 | 含义 |
 * | --- | --- | --- |
 * | 父→子 | `bootstrap` | 开机配置,收到才开工 |
 * | 父→子 | `work` `{op:'create'}` | 建会话 |
 * | 父→子 | `work` `{op:'followup', text}` | 发一轮 |
 * | 父→子 | `work` `{op:'dispose'}` | 释放会话 |
 * | 父→子 | `cancel` | 取消本路会话 ★ 红线 3 |
 * | 父→子 | `ping` | 健康检查 |
 * | 子→父 | `event` `{kind:'session'}` | 上游 session 事件,原样转发 |
 * | 子→父 | `event` `{kind:'agent-error'}` | agent 执行出错(另一条通道) |
 * | 子→父 | `event` `{kind:'created'\|'idle'\|'disposed'}` | 状态回执 |
 * | 子→父 | `error` | 该 lease 出错 |
 *
 * @module @dshwar/gateway/worker
 */
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { assembleRuntime, type AssembledRuntime, type RuntimeOptions } from './runtime.ts'
import type { AgentHandleLike } from './sessions/store.ts'

/** 子进程从父进程收到的开机配置。就是 {@link RuntimeOptions},只是过了一趟 IPC。 */
export type WorkerBootstrap = RuntimeOptions

interface Incoming {
  readonly leaseId: string
  readonly kind: 'bootstrap' | 'work' | 'cancel' | 'ping'
  readonly payload?: unknown
}

type Op =
  | { readonly op: 'create'; readonly sessionId: string; readonly model?: string; readonly provider?: string }
  | { readonly op: 'followup'; readonly text: string }
  | { readonly op: 'dispose' }

/** 从启动参数取身份。**不读环境变量** —— 环境会被 shell 工具拉的孙进程继承。 */
export function parseWorkerArgs(argv: readonly string[]): {
  principalId: string
  tenantId: string
  profile: string
} {
  const at = (name: string): string => {
    const i = argv.indexOf(`--${name}`)
    const value = i >= 0 ? argv[i + 1] : undefined
    if (value === undefined) throw new Error(`worker 缺少启动参数 --${name}`)
    return value
  }
  return { principalId: at('principal'), tenantId: at('tenant'), profile: at('profile') }
}

/**
 * 跑一个 worker。
 *
 * @param channel 收发消息的通道。抽出来是为了让测试不必真起进程 ——
 *   `process` 自身就满足这个形状。
 */
export interface WorkerOptions {
  /**
   * 装配完成、开始受理会话**之前**的钩子。
   *
   * 存在的理由是 LLM provider:{@link assembleRuntime} 装了 `dsh-llm` 这个 runtime,
   * 但不注册任何 adapter —— 注册哪个 provider 是部署决策。钩子是本地回调,
   * 不过 IPC,所以可以是闭包。
   */
  readonly onReady?: (runtime: AssembledRuntime) => void | Promise<void>
}

export function runWorker(
  channel: {
    on(event: 'message', listener: (message: unknown) => void): unknown
    send?: ((message: unknown) => unknown) | undefined
  },
  options: WorkerOptions = {},
): void {
  const send = (leaseId: string, kind: 'event' | 'pong' | 'error', payload?: unknown): void => {
    channel.send?.({ leaseId, kind, ...(payload === undefined ? {} : { payload }) })
  }

  let runtime: AssembledRuntime | undefined
  const handles = new Map<string, AgentHandleLike>()
  /** bootstrap 之前到达的消息。丢弃它们等于让「谁先到」决定行为。 */
  const queued: Incoming[] = []

  const create = async (leaseId: string, op: Extract<Op, { op: 'create' }>): Promise<void> => {
    const handle = await runtime!.createAgent({
      sessionId: op.sessionId,
      model: op.model,
      provider: op.provider,
    })
    handles.set(leaseId, handle)

    // 事件挂在 **agent 自己的 ctx** 上,与进程内驱动同一处挂载点。
    // 挂全局的话每个会话都能看到别人的事件流 —— 一个进程服务一个 principal,
    // 但同一个 principal 的多个会话仍要彼此隔离。
    handle.agent.ctx.on('session/event', (_session, event) => {
      send(leaseId, 'event', { kind: 'session', event })
    })

    // agent/error 是另一条通道(挂在 Context 上,不是 SessionEventMap 成员)。
    // 不转发它,进程隔离档就会悄悄丢掉错误通知 —— 红线 2 要求两档一致。
    // ⚠️ 只转发 turn / step,**不转发 error 对象本身**:它要过 IPC 的 JSON
    // 序列化,而上游的错误可能带着请求 URL 甚至凭据片段。父进程也不需要它。
    handle.agent.ctx.on('agent/error', (payload) => {
      send(leaseId, 'event', {
        kind: 'agent-error',
        turn: payload?.turn,
        step: payload?.step,
      })
    })

    send(leaseId, 'event', { kind: 'created', agentId: handle.agent.id })
  }

  const handle = async (message: Incoming): Promise<void> => {
    if (message.kind === 'ping') {
      channel.send?.({ leaseId: message.leaseId, kind: 'pong' })
      return
    }

    if (message.kind === 'bootstrap') {
      runtime = await assembleRuntime(message.payload as WorkerBootstrap)
      await options.onReady?.(runtime)
      const backlog = queued.splice(0, queued.length)
      for (const queuedMessage of backlog) await handle(queuedMessage)
      return
    }

    // bootstrap 还没到:排队而不是丢弃,也不是报错。IPC 不保证父进程的
    // bootstrap 一定先于第一条 work 被投递,而「偶尔丢第一轮」是最难查的那种 bug。
    if (runtime === undefined) {
      queued.push(message)
      return
    }

    if (message.kind === 'cancel') {
      // ★ 红线 3。Session 0 验证 C 的结论:IPC 送指令 + 子进程内调进程内的
      // cancel 真的截断输出。杀进程是兜底,不是这里的语义。
      handles.get(message.leaseId)?.agent.cancel({ kind: 'user' })
      return
    }

    const op = message.payload as Op
    if (op.op === 'create') {
      await create(message.leaseId, op)
      return
    }

    const target = handles.get(message.leaseId)
    if (target === undefined) {
      send(message.leaseId, 'error', { message: `lease ${message.leaseId} 没有对应的会话` })
      return
    }

    if (op.op === 'followup') {
      target.agent.followup(runtime.userMessage(op.text))
      void target.agent.whenIdle().then(() => send(message.leaseId, 'event', { kind: 'idle' }))
      return
    }

    if (op.op === 'dispose') {
      handles.delete(message.leaseId)
      await target.dispose()
      send(message.leaseId, 'event', { kind: 'disposed' })
    }
  }

  channel.on('message', (raw) => {
    const message = raw as Incoming
    if (typeof message?.leaseId !== 'string') return
    handle(message).catch((e: unknown) => {
      // 报回去而不是让子进程崩掉:一路会话的错不该连坐同进程的其他会话。
      send(message.leaseId, 'error', { message: e instanceof Error ? e.message : String(e) })
    })
  })
}

// 被 fork 直接拉起时自启。`pathToFileURL` 而不是路径字符串比较 ——
// Windows 上 `process.argv[1]` 是 `D:\…`,而 `import.meta.url` 是 `file:///D:/…`。
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  // 身份此刻就解析,解析不出立刻死 —— 一个不知道自己服务谁的隔离进程
  // 是最危险的东西:它有一份文件系统权限,却没有归属。
  parseWorkerArgs(argv)
  runWorker(process)
}
