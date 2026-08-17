/**
 * 离线判定与自动降级 —— 云端不可达时把请求切到本地模型。
 *
 * ## 裁决点与 model-router 同位,信号轴不同
 *
 * model-router 在 createAgent 入口按**预算与准入**裁决「用哪个模型」;
 * 本模块在同一入口按**可达性**裁决。两者都只裁决不路由(上游做能力),
 * 且共享同一条红线:**降级必须可见** —— 结果带 downgraded 语义,
 * 网关设响应头并落审计,用户有权知道自己被换了模型。
 *
 * ## 三态,不是布尔
 *
 * | 态 | 含义 | 网关行为 |
 * | --- | --- | --- |
 * | `online` | 云端可达 | 原样放行 |
 * | `downgraded` | 云端不可达,本地端点活着 | 换本地模型,头 + 审计 |
 * | `offline-unavailable` | 云端不可达,本地也没起 | **503 明确报错** |
 *
 * 第三态不能塌缩进前两态:静默排队或假装在线都会把「断网」变成
 * 「界面卡死」,而一句「Agent 推理离线不可用,配置本地模型可离线用」
 * 是用户能拿去行动的信息。
 *
 * ## 可达性的判据:**连接层,不是状态码**
 *
 * 云端返回 401 / 500 说明**网络通着**(服务器答话了)—— 那是凭据或
 * 服务端问题,降级到本地反而会掩盖真实故障。只有 fetch 连接失败
 * (DNS / 拒连 / 超时)才算不可达。
 */
import { DEFAULT_LOCAL_BASE_URL, detectLocalEndpoint } from './detect.ts'

export interface OfflineFallbackOptions {
  /**
   * 云端可达性探测地址(如 `https://api.deepseek.com`)。
   * 显式配置 —— 猜「云端」是哪台会在多 provider 部署里猜错。
   */
  readonly cloudProbeUrl: string
  /** 降级目标。显式配置,不自动挑(与 model-router 的 fallbackModel 同哲学)。 */
  readonly localTarget: { readonly provider: string; readonly model: string }
  /** 本地端点(确认降级目标真的活着)。默认 Ollama。 */
  readonly localBaseUrl?: string
  /** 单次探测超时。默认 1500ms。 */
  readonly probeTimeoutMs?: number
  /**
   * 云端探测结果缓存。默认 15s —— 断网时每个请求都等一次完整超时,
   * 等于把故障放大成全站卡顿;缓存把代价压到每 15s 一次。
   */
  readonly cacheTtlMs?: number
  /** 时钟注入,测试用。 */
  readonly now?: () => number
  /** fetch 注入,测试用。 */
  readonly fetchImpl?: typeof fetch
}

export type OfflineDecision =
  | { readonly kind: 'online' }
  | { readonly kind: 'downgraded'; readonly provider: string; readonly model: string }
  | { readonly kind: 'offline-unavailable' }

export class OfflineFallback {
  private readonly options: OfflineFallbackOptions
  private cache: { at: number; reachable: boolean } | undefined

  constructor(options: OfflineFallbackOptions) {
    this.options = options
  }

  /**
   * 对一个已过准入的请求做可达性裁决。
   *
   * @param requestedProvider 请求(或已被预算降级)的 provider
   */
  async decide(requestedProvider: string): Promise<OfflineDecision> {
    // 请求的就是本地 → 没有「降」可言,也不必探测云端
    if (requestedProvider === this.options.localTarget.provider) {
      return { kind: 'online' }
    }

    if (await this.cloudReachable()) return { kind: 'online' }

    const localAlive = await detectLocalEndpoint(
      this.options.localBaseUrl ?? DEFAULT_LOCAL_BASE_URL,
      this.options.probeTimeoutMs ?? 1500,
    )
    if (!localAlive) return { kind: 'offline-unavailable' }

    return {
      kind: 'downgraded',
      provider: this.options.localTarget.provider,
      model: this.options.localTarget.model,
    }
  }

  /** 带缓存的云端探测。连接层判据:答话(无论状态码)= 可达。 */
  private async cloudReachable(): Promise<boolean> {
    const now = (this.options.now ?? Date.now)()
    const ttl = this.options.cacheTtlMs ?? 15_000
    if (this.cache !== undefined && now - this.cache.at < ttl) return this.cache.reachable

    const doFetch = this.options.fetchImpl ?? fetch
    let reachable: boolean
    try {
      await doFetch(this.options.cloudProbeUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(this.options.probeTimeoutMs ?? 1500),
      })
      reachable = true // 4xx/5xx 也算可达 —— 服务器答话了,故障不在网络
    } catch {
      reachable = false
    }
    this.cache = { at: now, reachable }
    return reachable
  }
}
