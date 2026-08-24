/**
 * `@dshwar/metering` —— 用量归属与成本核算。
 *
 * ## 红线:观测不阻断
 *
 * 计量挂在会话事件流上。它挂了**不能**影响会话 —— 丢一条用量记录是账目问题,
 * 断一次会话是事故。采集入口 {@link safeRecord} 吞掉一切异常并交给失败回调;
 * 网关侧的接线必须走它,不得直接调 `record()`。
 *
 * ## 计费口径(REPORT-V4 §4)
 *
 * 上游 `TokenUsage` 的计数是 **DISJOINT** 的:`inputTokens` 只算未命中缓存的
 * 输入。计费输入 = `inputTokens + cacheReadTokens + cacheWriteTokens` ——
 * 直接用 `inputTokens` 会**少计费**。{@link billedInputTokens} 是唯一的口径实现,
 * 聚合与配额都从它走,不允许第二处加法。
 *
 * ## 缺席容忍
 *
 * 上游的 `usage` 是可选的:适配器没报就没有。没报的 step 计 0 并标
 * `unreported: true`,**不估算** —— 估算值混进账目比缺口更难审。
 *
 * ## 钱:三种情况,三个类型
 *
 * 「这一格值多少钱」的答案有三种,而它们**不能共用一个 `0`**:
 * 算出来了 / 没配价(算不出来)/ 不计费(终值就是不收)。
 * 判据、价格表、线上形状全在 `cost.ts`,本文件只消费它。
 *
 * @module @dshwar/metering
 */
export {
  assertAllPriced,
  assertPriceTable,
  costFor,
  costToWire,
  MalformedCostError,
  PriceTableError,
  readCost,
  UnpricedModelError,
  type Cost,
  type CostWire,
  type PriceTable,
} from './cost.ts'
import { costFor, type Cost, type PriceTable } from './cost.ts'

/** 上游 TokenUsage 的结构性子集(不 import dsh-llm,契约包不拉运行时依赖)。 */
export interface TokenUsageLike {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

/** 一条原始用量记录 —— step 级,采集粒度与上游一致。 */
export interface RawUsage {
  readonly subjectId: string
  readonly tenantId: string
  readonly sessionId: string
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly model: string
  readonly usage: TokenUsageLike
  /** 适配器没报用量时为 true,数值全 0。不估算。 */
  readonly unreported: boolean
  /** ISO 8601。 */
  readonly at: string
}

/**
 * 计费输入的**唯一**口径实现。
 *
 * DISJOINT 加法:未命中缓存的输入 + 缓存读 + 缓存写。
 * 上游哪天改口径,`adapters/dsh-0.1.0` 的契约测试会先红,然后改这里一处。
 */
export function billedInputTokens(usage: TokenUsageLike): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** 与契约 `UsageRecord` 对齐的聚合行(按日 × 主体 × 模型)。 */
export interface DailyUsageRow {
  readonly subjectId: string
  readonly tenantId: string
  readonly date: string
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  /**
   * 这一格值多少钱 —— **三种情况在类型层可分**,见 {@link Cost}。
   *
   * ⚠️ V0.9.0 Session 5.5 之前这里是 `costMinorUnits: number` + `currency: string`,
   * 而那个 `number` 同时表示「算不出来」与「不收费」两句相反的话。
   */
  readonly cost: Cost
}

export interface UsageFilter {
  /** 强制 —— 与 audit 同一条理由:可选的租户过滤总有一天被忘掉。 */
  readonly tenantId: string
  readonly subjectId?: string
}

export interface MeteringStore {
  record(raw: RawUsage): Promise<void>
  /**
   * 原始明细,按 `at` **字典序**升序;同 `at` 保持写入顺序。
   *
   * ⚠️ 「字典序」不是啰嗦 —— **两个实现只有用同一种比较才可能给出同一个顺序**。
   * `KvMeteringStore` 靠 `Object.keys().sort()`(UTF-16 码元序)兑现,
   * 换成 `localeCompare` 或 `Date.parse` 差值都会在混合精度的 ISO 串上分家:
   * 字典序把 `…00.500Z` 排在 `…00Z` 之前(`.` = 0x2E < `Z` = 0x5A),`Date.parse` 排在之后。
   *
   * 这条前提已经被消费方**显式依赖**:`billing-local/src/service.ts:107`
   * 用 `r.at >= start && r.at < end` 圈账期,注释就写着「ISO 8601 UTC 的字典序即时间序」。
   *
   * ⚠️ V0.8.0 之前 `InMemoryMeteringStore` **没有兑现这条**(返回 push 顺序),
   * 而接口上这句话从 V0.4.0 起就写着 —— 同一个接口的两个实现,在一条写死的
   * 保证上行为不同,且没有任何测试盯着。现在两个实现由**同一条参数化测试**验。
   */
  query(filter: UsageFilter): Promise<RawUsage[]>
}

/** 内存实现。 */
export class InMemoryMeteringStore implements MeteringStore {
  private readonly records: RawUsage[] = []

  async record(raw: RawUsage): Promise<void> {
    this.records.push(raw)
  }

  async query(filter: UsageFilter): Promise<RawUsage[]> {
    return (
      this.records
        .filter(
          (r) =>
            r.tenantId === filter.tenantId &&
            (filter.subjectId === undefined || r.subjectId === filter.subjectId),
        )
        // 排的是 filter() 返回的**副本**,不是 this.records —— 原地排会永久毁掉
        // 写入顺序,而那正是同一毫秒多条记录唯一的定序信息(Kv 侧靠 `#seq` 尾缀保住)。
        // 比较用字典序,与 KvMeteringStore 的 `Object.keys().sort()` 字节级一致;
        // 理由见 MeteringStore.query 的说明。ES2019 起 sort 稳定,同 at 保持写入序。
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    )
  }
}

/** 上游 KvUnit 的最小形状(同 subject / audit 的做法)。 */
export interface KvUnitLike {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
}

export const USAGE_TABLE = 'usage'

/** 走上游 storage 契约的实现。同款已知限制:loadAll 整表进内存。 */
export class KvMeteringStore implements MeteringStore {
  private readonly unit: KvUnitLike
  private seq = 0

  constructor(unit: KvUnitLike) {
    this.unit = unit
  }

  async record(raw: RawUsage): Promise<void> {
    this.seq += 1
    // 键含时间与序号:同一毫秒多条不覆盖,字典序即时间序
    const key = `${raw.at}#${String(this.seq).padStart(9, '0')}`
    await this.unit.putRecord(USAGE_TABLE, key, raw)
  }

  async query(filter: UsageFilter): Promise<RawUsage[]> {
    const snapshot = await this.unit.loadAll()
    const table = snapshot.tables[USAGE_TABLE] ?? {}
    return Object.keys(table)
      .sort()
      .map((k) => table[k] as RawUsage)
      .filter(
        (r) =>
          r.tenantId === filter.tenantId &&
          (filter.subjectId === undefined || r.subjectId === filter.subjectId),
      )
  }
}

/**
 * 明细 → 契约的按日聚合行。
 *
 * 成本用**最小货币单位的整数**算:`tokens × pricePerMTokenMinor / 1e6`,
 * 每行四舍五入一次(桶级重算而不是逐条累加 —— 先加 token 再算钱,
 * 舍入误差只发生一次)。
 *
 * ⚠️ **查不到价的模型不再计 0**,它落进 {@link Cost} 的 `unpriced` 分支。
 * 那个 0 曾经同时表示「没配价」与「不计费」两句相反的话,而账面上都是 ¥0.00
 * —— 见 `cost.ts` 的模块注释。
 *
 * @param prices 价格表。`undefined` = 这个部署**没有声明计价口径**,
 *   于是每一行都是 `unpriced`。**不回落到一个默认币种**:
 *   一个「默认 CNY」的价格表会让「没配」与「配成人民币零价」再次长得一样。
 */
export function aggregateDaily(
  records: readonly RawUsage[],
  prices: PriceTable | undefined,
): DailyUsageRow[] {
  const buckets = new Map<string, Omit<DailyUsageRow, 'cost'>>()

  for (const r of records) {
    const date = r.at.slice(0, 10)
    const key = `${date}|${r.subjectId}|${r.provider}|${r.model}`
    const prev = buckets.get(key)

    const input = billedInputTokens(r.usage)
    const output = r.usage.outputTokens

    buckets.set(key, {
      subjectId: r.subjectId,
      tenantId: r.tenantId,
      date,
      provider: r.provider,
      model: r.model,
      inputTokens: (prev?.inputTokens ?? 0) + input,
      outputTokens: (prev?.outputTokens ?? 0) + output,
    })
  }

  // ★ 定价走 costFor —— 与发票行是**同一个判据**。两处各写一遍,正是这个字段
  //   最初出问题的方式:用量页与发票对同一笔消耗给出不同的说法。
  const rows: DailyUsageRow[] = [...buckets.values()].map((row) => ({
    ...row,
    cost: costFor(prices, row.provider, row.model, row.inputTokens, row.outputTokens),
  }))

  // 稳定排序:日期降序(最近的先看到),同日按主体
  return rows.sort((a, b) =>
    a.date === b.date ? a.subjectId.localeCompare(b.subjectId) : b.date.localeCompare(a.date),
  )
}

/** 某租户在一段明细里的计费 token 总量。policy 的配额判定从这里取数。 */
export function totalBilledTokens(records: readonly RawUsage[]): number {
  return records.reduce((sum, r) => sum + billedInputTokens(r.usage) + r.usage.outputTokens, 0)
}

/**
 * 安全采集入口 —— 红线 1 的实现。
 *
 * 任何异常都吞掉并交给 `onError`(通常落审计),绝不向上抛。
 * 网关的事件监听器必须走这里,不得直接调 `store.record()`。
 */
export async function safeRecord(
  store: MeteringStore,
  raw: RawUsage,
  onError: (detail: string) => void,
): Promise<void> {
  try {
    await store.record(raw)
  } catch (cause) {
    try {
      onError(`metering: 用量记录失败(session=${raw.sessionId} turn=${raw.turn}):${String(cause)}`)
    } catch {
      // 连失败回调都炸了 —— 到此为止,会话绝不能受影响
    }
  }
}
