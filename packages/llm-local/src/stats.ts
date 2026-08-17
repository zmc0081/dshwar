/**
 * 本地用量统计 —— **统计,不是计费**。
 *
 * ## 为什么本地没有计费(推理链,一步都不能省)
 *
 * 云端 token 是计费对象,因为它花的是**别人按量收的钱**;
 * 本地算力花的是部署方自己的电与显卡,DSHWAR 没有立场替它标价。
 * 于是:本地推理 → 没有金额 → 不需要额度、预授权、签名账本、时钟回拨检测 ——
 * **不做离线额度机制**不是偷工,是这条链的必然结论。
 *
 * ## 但统计口径与云端完全一致
 *
 * 本地用量走**同一条 metering 管道**(`RawUsage`,同一个
 * `billedInputTokens` 口径)。不另起一张表的理由:两套采集就是两套 bug,
 * 而「本地/云端用量对比」这个最常见的看板需求恰恰要求两边口径可比。
 * 「一张本地表」指的是**查询投影**(本函数),不是独立存储。
 *
 * ## 账单上的本地行
 *
 * `billing-local` 出账时本地模型查不到价 → 金额 0,**行仍在、token 仍在**。
 * 那个 0 是「本地算力不计费」,不是「没配价」—— 给本地 provider 配价
 * 反而是错误(见 docs/GOVERNANCE.md)。联网后可选把统计上报做看板,
 * 上报的也是这些行,不是钱。
 */
import { billedInputTokens, type RawUsage } from '@dshwar/metering'
import { DEFAULT_LOCAL_PROVIDER } from './detect.ts'

/** 一行本地用量统计(按模型聚合)。没有金额字段 —— 这是设计,不是遗漏。 */
export interface LocalUsageRow {
  readonly provider: string
  readonly model: string
  /** billedInputTokens 口径(含缓存读写)—— 与云端可比。 */
  readonly inputTokens: number
  readonly outputTokens: number
  /** 产生过用量的会话数。看板上「本地模型有多少人在用」的依据。 */
  readonly sessions: number
}

/**
 * 从 metering 明细投影出本地用量统计。
 *
 * @param records metering 的原始明细(已按租户过滤 —— 与 billing 同款,
 *   本函数不做租户裁决,调用方负责)
 * @param localProviders 哪些 provider 算「本地」。默认只有 `local`;
 *   部署方注册了 `ollama` / `llamacpp` 等名字时显式传入
 */
export function summarizeLocalUsage(
  records: readonly RawUsage[],
  localProviders: readonly string[] = [DEFAULT_LOCAL_PROVIDER],
): LocalUsageRow[] {
  const providers = new Set(localProviders)
  const buckets = new Map<string, { input: number; output: number; sessions: Set<string> }>()

  for (const r of records) {
    if (!providers.has(r.provider)) continue
    const key = `${r.provider}|${r.model}`
    const bucket = buckets.get(key) ?? { input: 0, output: 0, sessions: new Set<string>() }
    bucket.input += billedInputTokens(r.usage)
    bucket.output += r.usage.outputTokens
    bucket.sessions.add(r.sessionId)
    buckets.set(key, bucket)
  }

  return (
    [...buckets.entries()]
      .map(([key, b]) => {
        const [provider, model] = key.split('|') as [string, string]
        return {
          provider,
          model,
          inputTokens: b.input,
          outputTokens: b.output,
          sessions: b.sessions.size,
        }
      })
      // 用量降序 —— 看板上大头先看到
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
  )
}
