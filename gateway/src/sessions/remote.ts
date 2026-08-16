/**
 * 跨进程 agent 句柄 —— 让一条 IPC 通道戴上 {@link AgentHandleLike} 的面孔。
 *
 * ## 这一个文件就是红线 2 的实现
 *
 * 红线 2 要求 `/v1` 契约零变更:客户端不该知道自己跑在哪种隔离下。
 * 达成方式不是在路由里到处写 `if (isolation === 'process')`,而是让跨进程句柄
 * **满足与进程内句柄完全相同的契约**。于是 `GatewaySessionStore`、SSE 路由、
 * 计量采集、`DELETE /v1/sessions/{id}` 全部一行不改。
 *
 * 分派只发生在**一处**:创建句柄的时候(Session 3 的网关接线)。
 *
 * ## 事件透传,不重编号
 *
 * seq 原样透传。V0.4.5 Session 2 实测:上游的 seq 是**每 agent 各自从 0 起算**的,
 * 不是进程内全局递增 —— 所以「哪些会话挤在同一个进程里」根本不影响 seq,
 * 跨进程与进程内的序号逐条相同。
 *
 * (Session 0 的报告曾建议把 seq 权威收归父进程,那是在没测这一条时的保守取向。
 * 实测之后不需要:重编号只会凭空制造一个进程内与跨进程不一致的风险面。)
 *
 * @module @dshwar/gateway/sessions/remote
 */
import type { Lease } from '@dshwar/supervisor'
import type { AgentHandleLike, SessionEventSource } from './store.ts'

/** 子进程回传的消息载荷。与 `gateway/src/worker.ts` 的 `send` 一一对应。 */
interface WorkerPayload {
  readonly kind: 'session' | 'agent-error' | 'created' | 'idle' | 'disposed'
  readonly event?: unknown
  readonly agentId?: string
  readonly turn?: number
  readonly step?: number
}

/** 父进程侧构造一次会话所需的信息。 */
export interface RemoteAgentInput {
  readonly sessionId: string
  readonly model: string | undefined
  readonly provider: string | undefined
  /** 等子进程回执的超时。超时即认为这个进程不可用。 */
  readonly createTimeoutMs?: number
}

/**
 * 把 `followup(message)` 的入参在父进程侧表达出来。
 *
 * 进程内驱动时 `AssembledRuntime.userMessage(text)` 返回上游的 `UserMessage`
 * 对象。跨进程时构造它没有意义 —— 真正驱动的是子进程,它自己会构造。
 * 所以这里只包一层文本,由 worker 在那边还原。
 */
export function remoteUserMessage(text: string): unknown {
  return { __dshwarRemoteText: text }
}

/** 从 {@link remoteUserMessage} 的包装里取回文本。 */
function textOf(message: unknown): string {
  const wrapped = message as { __dshwarRemoteText?: unknown } | null
  if (typeof wrapped?.__dshwarRemoteText === 'string') return wrapped.__dshwarRemoteText
  // 有人绕过 remoteUserMessage 直接塞了上游对象:这在跨进程下送不过去,
  // 与其静默发一轮空消息,不如立刻炸在调用点。
  throw new TypeError('跨进程 followup 需要 remoteUserMessage(text) 构造的消息')
}

/**
 * 一个由子进程驱动的 agent 句柄。
 *
 * 用 {@link createRemoteAgent} 创建 —— 构造是异步的(要等子进程建好会话),
 * 而构造函数不能是异步的。
 */
class RemoteAgentHandle implements AgentHandleLike {
  readonly agent: AgentHandleLike['agent']

  private readonly lease: Lease
  private readonly detach: () => void
  private status: 'idle' | 'running' = 'idle'
  private readonly listeners = new Set<(session: unknown, event: unknown) => void>()
  /**
   * `agent/error` 的订阅者。与 `session/event` **分开两个集合** ——
   * 它们是上游的两条不同通道(一条是 `SessionEventMap`,一条挂在 Context 上),
   * 回调签名也不同。合成一个集合会逼调用方在回调里自己分辨,那正是这个 bug
   * 当初能藏三个版本的形状。
   */
  private readonly errorListeners = new Set<
    (payload: { turn?: number; step?: number; error?: unknown }) => void
  >()
  private idleWaiters: (() => void)[] = []

  // 不用参数属性:`tsconfig.base.json` 要求源码可被
  // `node --experimental-strip-types` 直接跑,而参数属性不可擦除。
  constructor(lease: Lease, agentId: string, detach: () => void) {
    this.lease = lease
    this.detach = detach
    const statusOf = (): 'idle' | 'running' => this.status

    // 事件订阅者与状态用闭包持有,不用 `const self = this` ——
    // ctx 与 agent 都是要交出去的普通对象,它们的方法里的 `this` 不是本实例。
    const listeners = this.listeners
    const errorListeners = this.errorListeners
    const ctx: SessionEventSource = {
      // 两条通道分开挂 —— `session/event` 与 `agent/error` 是上游的两个不同
      // 事件源,回调签名也不同。这里的断言集中在一处,而不是让调用方
      // 在回调里自己分辨。
      on: ((event: string, listener: (...args: never[]) => void) => {
        if (event === 'agent/error') {
          const l = listener as unknown as (p: {
            turn?: number
            step?: number
            error?: unknown
          }) => void
          errorListeners.add(l)
          return () => errorListeners.delete(l)
        }
        const l = listener as unknown as (session: unknown, e: unknown) => void
        listeners.add(l)
        return () => listeners.delete(l)
      }) as SessionEventSource['on'],
    }

    this.agent = {
      id: agentId,
      get status(): 'idle' | 'running' {
        return statusOf()
      },
      ctx,
      // ★ 红线 3。走 IPC 取消而不是杀进程:杀进程会连坐同一个 principal
      // 的其他会话,而它们没做错什么。Session 0 验证 C 证明这条路可行。
      cancel: () => lease.cancel(),
      followup: (message) => {
        this.status = 'running'
        lease.send({ op: 'followup', text: textOf(message) })
      },
      whenIdle: () =>
        this.status === 'idle'
          ? Promise.resolve()
          : new Promise<void>((resolve) => this.idleWaiters.push(resolve)),
    }
  }

  /** 由 {@link createRemoteAgent} 在收到子进程消息时调用。 */
  ingest(payload: WorkerPayload): void {
    if (payload.kind === 'session') {
      for (const listener of this.listeners) listener(undefined, payload.event)
      return
    }
    if (payload.kind === 'agent-error') {
      // 跨进程也要送到 —— 否则进程隔离档会悄悄丢掉错误通知,
      // 而红线 2 要求两档对外行为一致。
      for (const listener of this.errorListeners) {
        listener({
          ...(payload.turn === undefined ? {} : { turn: payload.turn }),
          ...(payload.step === undefined ? {} : { step: payload.step }),
        })
      }
      return
    }
    if (payload.kind === 'idle') this.settleIdle()
  }

  /**
   * 承载进程死了。
   *
   * 把等在 `whenIdle()` 上的人放掉 —— 否则它们会永远挂着,而一个永远不 settle
   * 的 promise 在 Node 里不会报错、不会超时、也不会出现在任何监控上。
   */
  onProcessDeath(): void {
    this.settleIdle()
  }

  private settleIdle(): void {
    this.status = 'idle'
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  async dispose(): Promise<void> {
    this.settleIdle()
    if (this.lease.alive) this.lease.send({ op: 'dispose' })
    this.detach()
    this.lease.release()
  }
}

/**
 * 在一条租约上建一个跨进程会话。
 *
 * @param lease 由 `Supervisor.acquire(principal)` 取得
 * @param input 会话参数
 * @param onProcessDeath 承载进程死亡时的回调。**调用方必须处理**(R5)——
 *   不处理就是静默丢失:客户端的流会停住,而它无从知道原因。
 */
export function createRemoteAgent(
  lease: Lease,
  input: RemoteAgentInput,
  onProcessDeath: () => void,
): Promise<AgentHandleLike> {
  const timeoutMs = input.createTimeoutMs ?? 10_000

  return new Promise((resolve, reject) => {
    let handle: RemoteAgentHandle | undefined
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      off()
      unwatch()
      reject(new Error(`子进程在 ${timeoutMs} ms 内没有建好会话 ${input.sessionId}`))
    }, timeoutMs)

    const off = lease.onMessage((message) => {
      if (message.kind === 'error') {
        if (settled) return
        settled = true
        clearTimeout(timer)
        off()
        unwatch()
        const detail = (message.payload as { message?: string } | undefined)?.message
        reject(new Error(detail ?? '子进程建会话失败'))
        return
      }
      if (message.kind !== 'event') return

      const payload = message.payload as WorkerPayload
      if (payload.kind === 'created') {
        settled = true
        clearTimeout(timer)
        handle = new RemoteAgentHandle(lease, payload.agentId ?? input.sessionId, off)
        resolve(handle)
        return
      }
      handle?.ingest(payload)
    })

    // 进程死亡由 supervisor 推过来 —— SSE 是推送模型,没人会来轮询
    // 「我的会话还在吗」。`onDeath` 对已经死掉的进程会同步回调一次,
    // 所以「死在 acquire 与这一行之间」的窄窗口也盖得住。
    const unwatch = lease.onDeath(() => {
      handle?.onProcessDeath()
      if (!settled) {
        settled = true
        clearTimeout(timer)
        off()
        reject(new Error('子进程在建会话期间死亡'))
        return
      }
      onProcessDeath()
    })

    lease.send({
      op: 'create',
      sessionId: input.sessionId,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
    })
  })
}
