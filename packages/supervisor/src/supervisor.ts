/**
 * 进程池 —— 一 principal 一进程。
 *
 * @module @dshwar/supervisor/supervisor
 */
import { isAnonymousPrincipal, type Principal } from '@dshwar/principal'
import type { ChildProcessLike, ProcessLauncher } from './launcher.ts'
import { asChildMessage, HEALTH_LEASE, makeLeaseId, type ChildMessage } from './protocol.ts'

/** 进程池的可观测事件。Session 3 把它接到 `@dshwar/audit`。 */
export type SupervisorEvent =
  | { readonly kind: 'spawn'; readonly principalId: string; readonly pid: number | undefined }
  | { readonly kind: 'reclaim'; readonly principalId: string; readonly pid: number | undefined }
  | {
      readonly kind: 'crash'
      readonly principalId: string
      readonly pid: number | undefined
      readonly exitCode: number | null
      readonly signal: string | null
    }
  | { readonly kind: 'rejected'; readonly principalId: string; readonly reason: 'at_capacity' }

export interface SupervisorConfig {
  readonly launcher: ProcessLauncher
  /** 传给子进程的 profile 名。 */
  readonly profile: string
  /**
   * 单机进程数上限。**不是可选的调优项。**
   *
   * 实测常驻 58 MB/进程(`docs/FEASIBILITY-REPORT-V45.md` §6),100 个活跃
   * principal ≈ 5.8 GB。没有上限的进程池在流量尖峰下会把机器吃到 OOM,
   * 而 OOM killer 挑中谁是随机的 —— 可能是网关自己。
   */
  readonly maxProcesses: number
  /** 引用归零后多久回收。 */
  readonly idleTimeoutMs: number
  /** SIGTERM 之后等多久再 SIGKILL。 */
  readonly terminateGraceMs?: number
  readonly onEvent?: (event: SupervisorEvent) => void
}

/**
 * 进程数达到上限时抛出。
 *
 * ## 为什么是拒绝而不是排队
 *
 * 任务书要求「排队还是拒绝——选一个并说明」。**选拒绝。**
 *
 * 排队的问题不在于等待本身,而在于**等待时间不可预测且不可观测**:一个槽位
 * 什么时候空出来,取决于别的 principal 什么时候闲下来,可能是 3 秒也可能是 20 分钟。
 * 排队意味着 HTTP 请求一直挂着,而挂着的请求本身占用网关的连接与内存 ——
 * 于是「进程不够」这个局部问题升级成「网关被挂起的请求拖垮」的全局问题。
 * 这正是加上限想避免的事故。
 *
 * 拒绝则给出一个立即、明确、可重试的答复。网关把它映射成 `503` + `Retry-After`,
 * 客户端和负载均衡器都认得这个语义,能据此做扩容与退避。
 *
 * 沿用 `@dshwar/policy` 的「判定与执行分离」:本包只抛类型化错误,状态码由网关决定。
 */
export class AtCapacityError extends Error {
  override readonly name = 'AtCapacityError'
  readonly principalId: string
  readonly maxProcesses: number

  // 不用参数属性:`tsconfig.base.json` 要求源码可被
  // `node --experimental-strip-types` 直接跑,而参数属性不可擦除。
  constructor(principalId: string, maxProcesses: number) {
    super(`进程池已满(${maxProcesses}),拒绝为 ${principalId} 创建新进程`)
    this.principalId = principalId
    this.maxProcesses = maxProcesses
  }
}

/** 匿名主体请求进程时抛出。硬规则 6 —— 缺 principal 一律 fail closed。 */
export class AnonymousNotAllowedError extends Error {
  override readonly name = 'AnonymousNotAllowedError'
  constructor() {
    super('匿名主体不得获取隔离进程 —— 那等于给「认不出是谁」发一个专属沙箱')
  }
}

/**
 * 一路会话对某个进程的租约。
 *
 * **不是进程本身** —— 同一 principal 的多个并发会话各持一个 lease,共用一个进程。
 * 释放最后一个 lease 才会开始计空闲。
 */
export interface Lease {
  readonly leaseId: string
  readonly principalId: string
  readonly pid: number | undefined
  /** 进程是否还活着。与「还能响应吗」是两回事,见 {@link Supervisor.ping}。 */
  readonly alive: boolean
  /** 送一条工作消息。进程已死时抛错 —— 静默丢弃会让调用方以为送出去了。 */
  send(payload: unknown): void
  /** 只订阅本 lease 的消息。返回退订函数。 */
  onMessage(listener: (message: ChildMessage) => void): () => void
  /** 取消本路会话。**不波及同进程的其他 lease。** */
  cancel(): void
  /** 释放租约。幂等。 */
  release(): void
}

interface Pooled {
  readonly principalId: string
  readonly child: ChildProcessLike
  readonly listeners: Map<string, Set<(m: ChildMessage) => void>>
  refs: number
  alive: boolean
  idleTimer: ReturnType<typeof setTimeout> | undefined
  killTimer: ReturnType<typeof setTimeout> | undefined
}

/**
 * 一 principal 一进程的进程池。
 *
 * ## 只实现「进程」这一档
 *
 * 隔离三档里,**「逻辑」档根本不经过本包** —— 它就是 V0.2.0 以来的进程内驱动,
 * 加一层 supervisor 只会凭空多出一次消息往返。「容器」档留接口不实现
 * (V0.4.5 红线 4):容器编排是部署方的 Kubernetes / Nomad 的事,
 * 在这里自造一套只会和它们打架。要接容器,自定义一个 {@link ProcessLauncher} 即可 ——
 * 池逻辑(复用、上限、回收)与创建方式正交。
 */
export class Supervisor {
  private readonly pool = new Map<string, Pooled>()
  private readonly config: SupervisorConfig
  private leaseSeq = 0
  private disposed = false

  constructor(config: SupervisorConfig) {
    this.config = config
  }

  /** 当前活着的进程数。 */
  get size(): number {
    return this.pool.size
  }

  /**
   * 取得一个进程租约。同一 principal 的并发调用复用同一进程。
   *
   * @throws {AnonymousNotAllowedError} 匿名主体(硬规则 6)
   * @throws {AtCapacityError} 已达进程上限且该 principal 尚无进程
   */
  acquire(principal: Principal): Lease {
    if (this.disposed) throw new Error('Supervisor 已停止')
    if (isAnonymousPrincipal(principal)) throw new AnonymousNotAllowedError()

    let pooled = this.pool.get(principal.id)
    if (pooled === undefined || !pooled.alive) {
      // 上限只拦**新进程**。已有进程的 principal 再开会话不该被拒 ——
      // 那既不省内存,又让「并发会话」变成一件时灵时不灵的事。
      if (this.pool.size >= this.config.maxProcesses) {
        this.config.onEvent?.({
          kind: 'rejected',
          principalId: principal.id,
          reason: 'at_capacity',
        })
        throw new AtCapacityError(principal.id, this.config.maxProcesses)
      }
      pooled = this.spawn(principal)
    }

    if (pooled.idleTimer !== undefined) {
      clearTimeout(pooled.idleTimer)
      pooled.idleTimer = undefined
    }
    pooled.refs += 1

    return this.makeLease(pooled)
  }

  /**
   * 健康检查之一:**进程还活着吗**。
   *
   * 与 {@link ping} 是两件不同的事。活着 = 没退出;能响应 = 事件循环没被卡死。
   * 一个陷入死循环或被同步 IO 阻塞的进程完全「活着」,但送进去的消息永远没有回音。
   * 只检查存活的健康检查会把这种进程一直留在池子里,占着 58 MB 谁也用不上。
   */
  isAlive(principalId: string): boolean {
    return this.pool.get(principalId)?.alive === true
  }

  /**
   * 健康检查之二:**还能响应吗**。送 ping 等 pong,超时即判定失联。
   *
   * @returns 响应耗时(毫秒);超时或进程已死则 `undefined`
   */
  async ping(principalId: string, timeoutMs: number): Promise<number | undefined> {
    const pooled = this.pool.get(principalId)
    if (pooled === undefined || !pooled.alive) return undefined

    const started = Date.now()
    return new Promise<number | undefined>((resolve) => {
      let settled = false
      const done = (value: number | undefined): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        off()
        resolve(value)
      }
      const timer = setTimeout(() => done(undefined), timeoutMs)
      const off = this.subscribe(pooled, HEALTH_LEASE, (m) => {
        if (m.kind === 'pong') done(Date.now() - started)
      })
      pooled.child.send({ leaseId: HEALTH_LEASE, kind: 'ping' })
    })
  }

  /** 立刻回收某 principal 的进程,不等空闲超时。 */
  reclaim(principalId: string): void {
    const pooled = this.pool.get(principalId)
    if (pooled !== undefined) this.terminate(pooled, 'reclaim')
  }

  /** 停止全部进程。父进程正常关闭时调用。 */
  dispose(): void {
    this.disposed = true
    for (const pooled of [...this.pool.values()]) this.terminate(pooled, 'reclaim')
  }

  private spawn(principal: Principal): Pooled {
    const child = this.config.launcher.launch({
      principalId: principal.id,
      tenantId: principal.tenantId,
      profile: this.config.profile,
    })

    const pooled: Pooled = {
      principalId: principal.id,
      child,
      listeners: new Map(),
      refs: 0,
      alive: true,
      idleTimer: undefined,
      killTimer: undefined,
    }

    child.on('message', (raw) => {
      const message = asChildMessage(raw)
      if (message === undefined) return
      for (const listener of pooled.listeners.get(message.leaseId) ?? []) listener(message)
    })

    child.on('exit', (code, signal) => {
      pooled.alive = false
      if (pooled.idleTimer !== undefined) clearTimeout(pooled.idleTimer)
      if (pooled.killTimer !== undefined) clearTimeout(pooled.killTimer)
      // 只有当池里还是这一个才摘 —— 回收后重新起的进程会占用同一个 key,
      // 旧进程迟到的 exit 事件不该把新进程摘掉。
      if (this.pool.get(principal.id) === pooled) this.pool.delete(principal.id)

      // 主动回收走 terminate(),那里已经发过 reclaim 事件。这里只报非预期的死亡。
      if (pooled.refs > 0) {
        this.config.onEvent?.({
          kind: 'crash',
          principalId: principal.id,
          pid: child.pid,
          exitCode: code,
          signal,
        })
      }
    })

    // 起不来与起来后崩溃,对调用方是同一件事:这个进程用不了。
    child.on('error', () => {
      pooled.alive = false
    })

    this.pool.set(principal.id, pooled)
    this.config.onEvent?.({ kind: 'spawn', principalId: principal.id, pid: child.pid })
    return pooled
  }

  private subscribe(
    pooled: Pooled,
    leaseId: string,
    listener: (m: ChildMessage) => void,
  ): () => void {
    let set = pooled.listeners.get(leaseId)
    if (set === undefined) {
      set = new Set()
      pooled.listeners.set(leaseId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) pooled.listeners.delete(leaseId)
    }
  }

  private makeLease(pooled: Pooled): Lease {
    this.leaseSeq += 1
    const leaseId = makeLeaseId(this.leaseSeq)
    let released = false

    const send = (kind: 'work' | 'cancel', payload?: unknown): void => {
      if (!pooled.alive) throw new Error(`进程已退出,lease ${leaseId} 无法送达`)
      pooled.child.send({ leaseId, kind, ...(payload === undefined ? {} : { payload }) })
    }

    return {
      leaseId,
      principalId: pooled.principalId,
      get pid() {
        return pooled.child.pid
      },
      get alive() {
        return pooled.alive
      },
      send: (payload) => send('work', payload),
      onMessage: (listener) => this.subscribe(pooled, leaseId, listener),
      // 取消只针对本 lease —— 同进程的其他会话不受影响。
      // 「杀进程」是 Session 2 三级降级里的兜底,不是这里的语义。
      cancel: () => send('cancel'),
      release: () => {
        if (released) return
        released = true
        pooled.listeners.delete(leaseId)
        pooled.refs -= 1
        if (pooled.refs <= 0 && pooled.alive) this.startIdle(pooled)
      },
    }
  }

  private startIdle(pooled: Pooled): void {
    if (pooled.idleTimer !== undefined) clearTimeout(pooled.idleTimer)
    pooled.idleTimer = setTimeout(() => {
      pooled.idleTimer = undefined
      // 计时期间可能又被 acquire 了 —— 再确认一次
      if (pooled.refs <= 0) this.terminate(pooled, 'reclaim')
    }, this.config.idleTimeoutMs)
    // 空闲计时不该拖住父进程退出
    pooled.idleTimer.unref?.()
  }

  private terminate(pooled: Pooled, reason: 'reclaim'): void {
    if (!pooled.alive) return
    if (pooled.idleTimer !== undefined) {
      clearTimeout(pooled.idleTimer)
      pooled.idleTimer = undefined
    }

    this.config.onEvent?.({ kind: reason, principalId: pooled.principalId, pid: pooled.child.pid })
    if (this.pool.get(pooled.principalId) === pooled) this.pool.delete(pooled.principalId)
    pooled.alive = false
    pooled.child.kill('SIGTERM')

    // SIGTERM 之后不认账的进程要有人收尸,否则「回收」只是把它从池子里摘掉,
    // 内存还占着 —— 那是最难查的一类泄漏:监控看到进程数正常,机器却在涨。
    pooled.killTimer = setTimeout(() => {
      try {
        pooled.child.kill('SIGKILL')
      } catch {
        // 已经退了
      }
    }, this.config.terminateGraceMs ?? 5_000)
    pooled.killTimer.unref?.()
  }
}
