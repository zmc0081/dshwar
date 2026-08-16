/**
 * 作业簿 —— **状态外置,dsh 进程只作执行器**(V0.5.5 Session 3)。
 *
 * ## 为什么状态必须外置
 *
 * 状态留在 dsh 进程里的话,进程一死作业就没了。而**进程隔离档下进程本来
 * 就会被空闲回收** —— 那不是异常路径,是正常运行的一部分:
 * 一个人午休回来,他上午提交的长作业所在的进程早已被回收。
 *
 * 换句话说,「进程死了作业没了」在这个架构里不是罕见事故,是**默认行为**。
 * 所以外置不是加固,是让它能用。
 *
 * ## `interrupted` 与 `failed` 分开
 *
 * | 状态 | 意思 | 用户该做什么 |
 * | --- | --- | --- |
 * | `failed` | **它自己跑错了** | 查输入、改参数 |
 * | `interrupted` | **承载它的进程没了** | 直接重试 |
 *
 * 合成一个的话,用户看到 `failed` 会去查自己的输入 —— 而实际上重试一次就好。
 * 那是把一次五秒的操作变成一次十分钟的排查。
 *
 * @module @dshwar/gateway/jobs/store
 */
import type { Principal } from '@dshwar/principal'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled'

/** 终态 —— 不会再变的状态。恢复扫描跳过它们。 */
const TERMINAL: ReadonlySet<JobStatus> = new Set([
  'succeeded',
  'failed',
  'interrupted',
  'cancelled',
])

/** 一个作业。字段与契约的 `Job` 对齐。 */
export interface Job {
  readonly id: string
  readonly workspaceId: string
  readonly subjectId: string
  readonly tenantId: string
  readonly status: JobStatus
  readonly kind: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly finishedAt: string | null
  /**
   * 失败原因。只有 `failed` / `interrupted` 才非空。
   *
   * ⚠️ **不塞原始异常** —— 它可能带请求 URL 甚至凭据片段,而作业记录的
   * 保留期比凭据轮换周期长。凭 requestId 查日志。
   */
  readonly error: string | null
  /**
   * 认领它的执行器实例。`null` = 还没被认领。
   *
   * 恢复扫描靠它判断「这个 running 作业的执行器还在不在」。
   */
  readonly claimedBy: string | null
}

export interface JobStore {
  create(principal: Principal, input: { workspaceId: string; kind: string }): Promise<Job>
  get(principal: Principal, id: string): Promise<Job | undefined>
  list(principal: Principal): Promise<Job[]>
  /** 认领一个排队中的作业。返回 `undefined` 表示没有可认领的。 */
  claim(executorId: string): Promise<Job | undefined>
  finish(
    id: string,
    outcome: { status: JobStatus; error?: string | null },
  ): Promise<Job | undefined>
  /**
   * **恢复**:把「属于已经不在的执行器」的 running 作业重新标出来。
   *
   * @param liveExecutors 当前还活着的执行器 id。**不在这个集合里的都算死了。**
   * @param mode `requeue` = 放回队列重试;`interrupt` = 标成 interrupted 交给用户决定
   * @returns 被处理的作业
   */
  recover(liveExecutors: readonly string[], mode: 'requeue' | 'interrupt'): Promise<Job[]>
}

function newJobId(): string {
  return `j${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/**
 * 内存实现。
 *
 * ⚠️ **内存实现的「外置」只是形式上的** —— 它与网关同生共死。
 * 真正的跨重启恢复需要持久化后端。这里把**接口与恢复语义**定下来,
 * 换后端时不用改调用方。
 *
 * 那为什么现在不直接上持久化?因为选后端(SQLite / Postgres / KV)是个
 * 部署决策,而这一版要定的是**语义**。语义定错了,换后端也救不回来。
 */
export class InMemoryJobStore implements JobStore {
  private readonly items = new Map<string, Job>()

  async create(principal: Principal, input: { workspaceId: string; kind: string }): Promise<Job> {
    const now = new Date().toISOString()
    const job: Job = {
      id: newJobId(),
      workspaceId: input.workspaceId,
      subjectId: principal.id,
      tenantId: principal.tenantId,
      status: 'queued',
      kind: input.kind,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      error: null,
      claimedBy: null,
    }
    this.items.set(job.id, job)
    return job
  }

  async get(principal: Principal, id: string): Promise<Job | undefined> {
    const found = this.items.get(id)
    // 归属判定做进 get —— 与 WorkspaceStore 同一条纪律:
    // 「取出来再判」可以被忘记,而忘记的后果是跨主体读到别人的作业。
    if (found === undefined) return undefined
    if (found.subjectId !== principal.id || found.tenantId !== principal.tenantId) return undefined
    return found
  }

  async list(principal: Principal): Promise<Job[]> {
    return [...this.items.values()]
      .filter((j) => j.subjectId === principal.id && j.tenantId === principal.tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async claim(executorId: string): Promise<Job | undefined> {
    // 先进先出。找第一个 queued 的。
    const next = [...this.items.values()]
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (next === undefined) return undefined

    const claimed: Job = {
      ...next,
      status: 'running',
      claimedBy: executorId,
      updatedAt: new Date().toISOString(),
    }
    this.items.set(claimed.id, claimed)
    return claimed
  }

  async finish(
    id: string,
    outcome: { status: JobStatus; error?: string | null },
  ): Promise<Job | undefined> {
    const found = this.items.get(id)
    if (found === undefined) return undefined
    // ⚠️ 终态不可再变。一个已经 succeeded 的作业被后到的失败回调改成 failed,
    // 是分布式系统里很常见的一类错乱 —— 这里直接拒绝,而不是覆盖。
    if (TERMINAL.has(found.status)) return found

    const now = new Date().toISOString()
    const next: Job = {
      ...found,
      status: outcome.status,
      error: outcome.error ?? null,
      updatedAt: now,
      finishedAt: TERMINAL.has(outcome.status) ? now : null,
    }
    this.items.set(id, next)
    return next
  }

  async recover(liveExecutors: readonly string[], mode: 'requeue' | 'interrupt'): Promise<Job[]> {
    const live = new Set(liveExecutors)
    const orphaned = [...this.items.values()].filter(
      (j) => j.status === 'running' && (j.claimedBy === null || !live.has(j.claimedBy)),
    )

    const now = new Date().toISOString()
    const recovered: Job[] = []
    for (const job of orphaned) {
      const next: Job =
        mode === 'requeue'
          ? // 放回队列:清掉 claimedBy,否则下一轮恢复会以为它还被认领着
            { ...job, status: 'queued', claimedBy: null, updatedAt: now }
          : {
              ...job,
              status: 'interrupted',
              // ★ 说清是「进程没了」而不是「作业错了」—— 用户据此决定
              //   是直接重试还是去查输入
              error: '承载该作业的执行器已不存在(进程回收或重启)',
              updatedAt: now,
              finishedAt: now,
            }
      this.items.set(job.id, next)
      recovered.push(next)
    }
    return recovered
  }
}
