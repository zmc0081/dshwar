/**
 * `@dshwar/webhooks` —— 出站事件投递。
 *
 * ## 明确不做的事:投递保证
 *
 * 本包**不保证送达**。重试三次仍失败的事件只落审计,不落持久队列 ——
 * 可靠投递需要落盘的队列、去重、消费位点,那是控制平面(V0.5.0)的活。
 * 在库层面伪装可靠性(内存队列 + 无限重试)比明说「尽力而为」更糟:
 * 进程一重启,「保证」就静默蒸发了,而用户是按保证来设计下游的。
 *
 * 下游要的是**最终一致**:错过 webhook 的系统应当定期拉
 * `/v1/admin/subjects` 兜底,而不是假设每条事件都到了。文档里就这么写。
 *
 * ## 签名可被第三方独立验证
 *
 * `X-Dshwar-Signature: sha256=<hex>`,对 `<timestamp>.<body>` 做 HMAC-SHA256。
 * 时间戳参与签名是为了抗重放:签名只盖住 body 的话,截获的请求可以原样重发。
 * 验证方拿 `X-Dshwar-Timestamp` 头 + 原始 body + 共享密钥即可复算 ——
 * 测试里有一条用 node:crypto 从头实现验证,证明文档描述的算法是自足的。
 *
 * @module @dshwar/webhooks
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** 事件类型。词表由 DSHWAR 定义,与 SCIM 的动词解耦 —— 供给方换了动作,下游不用改。 */
export type SubjectEventType = 'subject.created' | 'subject.updated' | 'subject.deactivated'

/** 一条出站事件。 */
export interface SubjectEvent {
  readonly type: SubjectEventType
  /** 镜像里的 subject id。**只发 id 不发全量** —— webhook 会经过下游的日志、
   * 代理与重试队列,载荷越少,泄漏面越小。下游拿 id 回查 Admin API。 */
  readonly subjectId: string
  readonly tenantId: string
  readonly source: string
  /** ISO 8601。 */
  readonly at: string
}

/** 一个订阅端点。 */
export interface WebhookEndpoint {
  readonly url: string
  /** HMAC 密钥。由部署方在两侧各配一份,DSHWAR 不生成也不存储明文之外的形式。 */
  readonly secret: string
}

export interface DispatchOptions {
  /** 重试次数(不含首次)。默认 2,即总共至多 3 次。 */
  readonly retries?: number
  /** 首次重试延迟(毫秒),之后指数退避。默认 500。 */
  readonly backoffMs?: number
  /** 单次请求超时(毫秒)。默认 5000。 */
  readonly timeoutMs?: number
  /** 投递失败(重试耗尽)时的去处。**必须有人接** —— 静默丢弃连排查的线索都不留。 */
  readonly onFailure: (failure: DeliveryFailure) => void
  /** 自定义 fetch。测试注入。 */
  readonly fetch?: typeof globalThis.fetch
  /** 测试用:替换真实延时。 */
  readonly sleep?: (ms: number) => Promise<void>
}

export interface DeliveryFailure {
  readonly endpoint: string
  readonly event: SubjectEvent
  readonly attempts: number
  readonly lastError: string
}

export const SIGNATURE_HEADER = 'x-dshwar-signature'
export const TIMESTAMP_HEADER = 'x-dshwar-timestamp'

/**
 * 计算签名。`sha256=<hex(HMAC-SHA256(secret, `${timestamp}.${body}`))>`。
 *
 * @param secret 共享密钥
 * @param timestamp `X-Dshwar-Timestamp` 头的值(Unix 秒)
 * @param body 原始请求体(序列化后的 JSON 字符串,不是对象)
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `sha256=${mac}`
}

/**
 * 验证签名。给下游用的辅助函数 —— 但算法本身自足,不用本包也能验
 * (见模块说明)。
 *
 * @param maxSkewSec 时间戳容差(秒)。默认 300。超窗的请求即使签名正确也拒绝 ——
 *   这是抗重放的另一半:签名防篡改,时间窗防重发。
 */
export function verifySignature(input: {
  secret: string
  signature: string
  timestamp: string
  body: string
  maxSkewSec?: number
  nowSec?: number
}): boolean {
  const now = input.nowSec ?? Math.floor(Date.now() / 1000)
  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(now - ts) > (input.maxSkewSec ?? 300)) return false

  const expected = signPayload(input.secret, input.timestamp, input.body)
  const a = Buffer.from(expected)
  const b = Buffer.from(input.signature)
  // 时间恒定比较:普通 === 的短路时间可被用来逐字节猜签名
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * 投递一条事件到一个端点,带重试退避。
 *
 * @returns 是否最终送达
 */
export async function deliver(
  endpoint: WebhookEndpoint,
  event: SubjectEvent,
  options: DispatchOptions,
): Promise<boolean> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const retries = options.retries ?? 2
  const backoffMs = options.backoffMs ?? 500

  const body = JSON.stringify(event)
  let lastError = ''

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1))

    // 每次尝试都用新时间戳重签 —— 重试间隔可能超过验证方的时间窗,
    // 复用首次的签名会让「重试」在下游看来像「重放攻击」而被拒
    const timestamp = String(Math.floor(Date.now() / 1000))

    try {
      const response = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signPayload(endpoint.secret, timestamp, body),
          [TIMESTAMP_HEADER]: timestamp,
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      })
      if (response.ok) return true
      lastError = `HTTP ${response.status}`
    } catch (cause) {
      lastError = String(cause)
    }
  }

  // 重试耗尽 → 落审计,不静默丢弃。审计是排查「下游为什么没收到」的唯一线索。
  options.onFailure({
    endpoint: endpoint.url,
    event,
    attempts: retries + 1,
    lastError,
  })
  return false
}

/**
 * 多端点分发器。
 *
 * 端点之间互不影响:一个下游挂了不该拖住其它下游 —— 各自独立投递、独立重试、
 * 独立落审计。
 */
export class WebhookDispatcher {
  private readonly endpoints: readonly WebhookEndpoint[]
  private readonly options: DispatchOptions

  constructor(endpoints: readonly WebhookEndpoint[], options: DispatchOptions) {
    this.endpoints = endpoints
    this.options = options
  }

  /**
   * 向全部端点投递。
   *
   * @returns 每个端点是否送达(与构造时的端点顺序一致)
   */
  async dispatch(event: SubjectEvent): Promise<boolean[]> {
    return Promise.all(this.endpoints.map((e) => deliver(e, event, this.options)))
  }
}
