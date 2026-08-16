/**
 * `@dshwar/policy` —— 配额判定。
 *
 * ## 红线:判定与执行分离
 *
 * 本包只回答「这个主体现在还能不能用」。**没有任何 HTTP 概念** —— 429 由网关发,
 * 判定逻辑必须能被控制平面(V0.5.0 的后台)原样复用,不能长在 HTTP 层里。
 *
 * ## fail open —— 与硬规则 6 不冲突,理由要写清楚
 *
 * 计量数据取不到时**放行并落审计**,而不是拒绝。这与身份层的 fail closed
 * (硬规则 6)方向相反,因为两者保护的东西不同:
 *
 * - 身份认不出 → 放行的后果是**别人的数据被看到**,不可逆 → fail closed。
 * - 用量读不到 → 拒绝的后果是**计量组件的故障升级成全员服务中断**;
 *   放行的后果只是几轮对话没被限额,账目可从审计补 → fail open。
 *
 * 计量是账目组件,不是安全组件。把账目组件放进关键路径的故障域,
 * 等于给自己造了一个「记账挂了所以谁都不能用」的事故模式。
 *
 * ## 超限拒绝,不静默降级(红线 3)
 *
 * 配额烧完就是拒绝。**本包永远不会回答「换个便宜模型继续」** ——
 * 降级是 `@dshwar/model-router` 的显式配置,不是配额判定的隐式行为。
 * 两件事混在一起,用户就无法回答「我为什么被换了模型」。
 *
 * @module @dshwar/policy
 */
import { totalBilledTokens, type MeteringStore } from '@dshwar/metering'

/** 与契约 `Quota` 对齐的配额状态。 */
export interface QuotaState {
  readonly subjectId: string
  /** 计费周期内的 token 上限;null = 不限。 */
  readonly tokenLimit: number | null
  /** 本周期已消耗(计费口径:billedInput + output)。 */
  readonly tokenUsed: number
  readonly periodStart: string
  readonly periodEnd: string
}

/** 配额配置存储:每主体一条上限设定。 */
export interface QuotaStore {
  /** @returns 该主体的上限;从未设置过时 `undefined`(视同不限)。 */
  getLimit(subjectId: string): Promise<number | null | undefined>
  setLimit(subjectId: string, tokenLimit: number | null): Promise<void>
}

/** 内存实现。 */
export class InMemoryQuotaStore implements QuotaStore {
  private readonly limits = new Map<string, number | null>()

  async getLimit(subjectId: string): Promise<number | null | undefined> {
    return this.limits.has(subjectId) ? this.limits.get(subjectId)! : undefined
  }

  async setLimit(subjectId: string, tokenLimit: number | null): Promise<void> {
    this.limits.set(subjectId, tokenLimit)
  }
}

/** 判定结果。`deny` 带机器可读原因 —— 网关据此选状态码,审计据此归类。 */
export type QuotaDecision =
  | { readonly kind: 'allow'; readonly quota: QuotaState }
  | { readonly kind: 'deny'; readonly reason: 'quota_exhausted'; readonly quota: QuotaState }

/** 计费周期。`current()` 返回当前周期的边界;周期翻转即 tokenUsed 从零累计。 */
export interface BillingPeriod {
  current(now: Date): { start: Date; end: Date }
}

/** 自然月周期(UTC)。默认实现 —— 账单按月是最不需要解释的口径。 */
export const monthlyPeriod: BillingPeriod = {
  current(now: Date) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    return { start, end }
  },
}

export interface PolicyServiceOptions {
  readonly quotas: QuotaStore
  readonly metering: MeteringStore
  readonly tenantOf: (subjectId: string) => Promise<string | undefined>
  readonly period?: BillingPeriod
  /** fail open 时的去处(通常落审计)。**必须有人接**。 */
  readonly onMeteringUnavailable: (detail: string) => void
  /** 测试用时钟。 */
  readonly now?: () => Date
}

/**
 * 配额判定服务。
 *
 * `tokenUsed` 每次判定时从 metering 现算,不缓存 —— 缓存的余额会让用户在
 * 烧完之后继续用到缓存过期,而「烧完后还能用多久」恰恰是客户问的第一个问题。
 * 身份数据量级(REPORT-V4 的已知限制)下现算可接受;大账目量的部署换
 * Postgres 实现时再谈物化。
 */
export class PolicyService {
  private readonly options: PolicyServiceOptions

  constructor(options: PolicyServiceOptions) {
    this.options = options
  }

  private period(now: Date): { start: Date; end: Date } {
    return (this.options.period ?? monthlyPeriod).current(now)
  }

  /** 当前周期内该主体的已用量(计费口径)。metering 不可用时抛给调用方处理。 */
  private async usedInPeriod(subjectId: string, tenantId: string, now: Date): Promise<number> {
    const { start, end } = this.period(now)
    const records = await this.options.metering.query({ tenantId, subjectId })
    const inPeriod = records.filter((r) => {
      const at = Date.parse(r.at)
      return at >= start.getTime() && at < end.getTime()
    })
    return totalBilledTokens(inPeriod)
  }

  /** 组装契约形状的配额状态。 */
  async quotaOf(subjectId: string): Promise<QuotaState | undefined> {
    const tenantId = await this.options.tenantOf(subjectId)
    if (tenantId === undefined) return undefined

    const now = (this.options.now ?? (() => new Date()))()
    const { start, end } = this.period(now)
    const limit = await this.options.quotas.getLimit(subjectId)

    let used = 0
    try {
      used = await this.usedInPeriod(subjectId, tenantId, now)
    } catch (cause) {
      // 读不到就报 0 —— 状态查询里的 fail open,与判定同一条理由
      this.options.onMeteringUnavailable(
        `policy: 读取用量失败(subject=${subjectId}):${String(cause)}`,
      )
    }

    return {
      subjectId,
      tokenLimit: limit === undefined ? null : limit,
      tokenUsed: used,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    }
  }

  /**
   * 判定:该主体现在还能不能发起新的一轮。
   *
   * @returns allow / deny。deny 仅有 `quota_exhausted` 一种 ——
   *   本包不做「换模型继续」的裁决(红线 3)
   */
  async check(subjectId: string): Promise<QuotaDecision> {
    const now = (this.options.now ?? (() => new Date()))()
    const { start, end } = this.period(now)
    const limit = await this.options.quotas.getLimit(subjectId)

    const tenantId = await this.options.tenantOf(subjectId)

    // 上限未设置或显式 null → 不限。先判它,连 metering 都不必读。
    if (limit === undefined || limit === null) {
      return {
        kind: 'allow',
        quota: {
          subjectId,
          tokenLimit: null,
          tokenUsed: 0,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
        },
      }
    }

    let used: number
    try {
      if (tenantId === undefined) throw new Error('subject 的租户未知')
      used = await this.usedInPeriod(subjectId, tenantId, now)
    } catch (cause) {
      // ---- fail open(见模块说明)----
      this.options.onMeteringUnavailable(
        `policy: 配额判定时读不到用量,放行(subject=${subjectId}):${String(cause)}`,
      )
      return {
        kind: 'allow',
        quota: {
          subjectId,
          tokenLimit: limit,
          tokenUsed: 0,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
        },
      }
    }

    const quota: QuotaState = {
      subjectId,
      tokenLimit: limit,
      tokenUsed: used,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    }

    return used >= limit
      ? { kind: 'deny', reason: 'quota_exhausted', quota }
      : { kind: 'allow', quota }
  }
}

// ============================================================================
// 工作区配额(V0.4.1 R7)
//
// 与 token 配额**同一套判定形状**:同样的 allow/deny 联合,同样的
// 「未设置即不限」,同样的 fail open 取向。任务书要求「与已完成的
// policy / metering 对齐,不另起一套」—— 这里是那条要求的落点。
//
// 但它与 token 配额有一处**刻意的不同**:工作区数与容量的判定**不 fail open**。
// 理由是数据源不同 —— token 用量来自 metering(账目组件,可能挂),
// 而工作区数来自调用方现场给出的当前值,读不到就是调用方的 bug,不是外部故障。
// 把这两种失败混为一谈,会让一个真 bug 伪装成「计量暂时不可用」。
// ============================================================================

/** 工作区维度的上限。两项都可为 null,表示不限。 */
export interface WorkspaceLimits {
  /** 每用户可拥有的工作区数上限。 */
  readonly maxWorkspaces: number | null
  /** 单个工作区的容量上限(字节)。 */
  readonly maxBytesPerWorkspace: number | null
}

/** 工作区配额存储。与 {@link QuotaStore} 并列,不合并 —— 两者的生命周期不同。 */
export interface WorkspaceQuotaStore {
  /** @returns 该主体的工作区上限;从未设置过时 `undefined`(视同不限)。 */
  getWorkspaceLimits(subjectId: string): Promise<WorkspaceLimits | undefined>
  setWorkspaceLimits(subjectId: string, limits: WorkspaceLimits): Promise<void>
}

/** 内存实现。 */
export class InMemoryWorkspaceQuotaStore implements WorkspaceQuotaStore {
  private readonly limits = new Map<string, WorkspaceLimits>()

  async getWorkspaceLimits(subjectId: string): Promise<WorkspaceLimits | undefined> {
    return this.limits.get(subjectId)
  }

  async setWorkspaceLimits(subjectId: string, limits: WorkspaceLimits): Promise<void> {
    this.limits.set(subjectId, limits)
  }
}

/** 与 {@link QuotaDecision} 同形。deny 的两种原因对应两条上限。 */
export type WorkspaceDecision =
  | { readonly kind: 'allow' }
  | {
      readonly kind: 'deny'
      readonly reason: 'workspace_limit_exceeded' | 'workspace_size_exceeded'
      /** 触发的上限值,便于错误信息与审计写清「超了什么」。 */
      readonly limit: number
    }

/**
 * 能不能再建一个工作区。
 *
 * @param currentCount 该主体**当前已有**的工作区数,由调用方现场统计
 * @returns allow / deny
 */
export async function checkWorkspaceCount(
  store: WorkspaceQuotaStore,
  subjectId: string,
  currentCount: number,
): Promise<WorkspaceDecision> {
  const limits = await store.getWorkspaceLimits(subjectId)
  const max = limits?.maxWorkspaces
  // 未设置或显式 null → 不限。与 token 配额的语义完全一致。
  if (max === undefined || max === null) return { kind: 'allow' }

  return currentCount >= max
    ? { kind: 'deny', reason: 'workspace_limit_exceeded', limit: max }
    : { kind: 'allow' }
}

/**
 * 某个工作区还能不能再写入。
 *
 * @param currentBytes 该工作区**当前**占用字节数,由调用方现场统计
 */
export async function checkWorkspaceSize(
  store: WorkspaceQuotaStore,
  subjectId: string,
  currentBytes: number,
): Promise<WorkspaceDecision> {
  const limits = await store.getWorkspaceLimits(subjectId)
  const max = limits?.maxBytesPerWorkspace
  if (max === undefined || max === null) return { kind: 'allow' }

  return currentBytes >= max
    ? { kind: 'deny', reason: 'workspace_size_exceeded', limit: max }
    : { kind: 'allow' }
}
