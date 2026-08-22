/**
 * Stripe Webhook:验签 + 防重放 + 幂等 —— 收款闭环的最后一段。
 *
 * ## 为什么这三条一条都不能少(D5)
 *
 * webhook 是**别人打进来的请求**,而它的语义是「钱到了,记账」。
 * 三条防线各挡一种攻击:
 *
 * | 防线 | 挡什么 |
 * | --- | --- |
 * | HMAC 验签 | 伪造「已支付」事件 —— 不花钱把发票改成 paid |
 * | 时间戳容差 | 重放截获的真实事件(签名是真的,但已过期) |
 * | 事件 id 幂等 | 同一事件的重复投递(Stripe 明文说 at-least-once) |
 *
 * ## 签名方案(与 Stripe 文档一致,可独立复算)
 *
 * `Stripe-Signature: t=<epoch秒>,v1=<hex>`,其中
 * `v1 = HMAC-SHA256(secret, "<t>.<原始请求体>")`。
 * 时间戳参与签名,所以改时间戳会同时毁掉签名 —— 这正是「容差检查
 * 放在验签之后也安全」的原因:能通过验签的时间戳一定是 Stripe 写的。
 *
 * ⚠️ **必须用原始请求体**。解析再序列化会改变键序与空白,签名必然失配 ——
 * 这是接 webhook 的第一大坑,所以类型上就只收 string。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { InvoiceStateError, type Billing, type Invoice } from '@dshwar/billing'
// 无循环依赖:gateway.ts 只 import @dshwar/billing,不 import 本文件。
import { STRIPE_PROVIDER } from './gateway.ts'

/**
 * 验签失败。`reason` 只面向服务端日志与审计 ——
 * **HTTP 响应必须统一 401,不携带 reason**。与 `@dshwar/auth` 的
 * AuthError 不同(那个错误对象会跨 API 边界到客户端,所以连字段都没有),
 * 本错误从不离开服务端,内部区分原因是为了让运维分得清
 * 「配置错了」与「有人在探」。
 */
export class WebhookVerificationError extends Error {
  readonly reason: 'missing-header' | 'malformed-header' | 'signature-mismatch' | 'stale-timestamp'

  constructor(reason: WebhookVerificationError['reason'], detail: string) {
    super(`Stripe webhook 验签失败(${reason}):${detail}`)
    this.name = 'WebhookVerificationError'
    this.reason = reason
  }
}

/** 验签通过后解析出的事件。字段是本包消费的最小集,原始负载在 `raw`。 */
export interface StripeEvent {
  readonly id: string
  readonly type: string
  readonly raw: Record<string, unknown>
}

export interface VerifyInput {
  /** **原始**请求体。不是解析后的对象 —— 见模块注释的第一大坑。 */
  readonly payload: string
  /** `Stripe-Signature` 头,缺失传 null。 */
  readonly header: string | null
  /** endpoint secret(`whsec_…`)。 */
  readonly secret: string
  /** 时间戳容差秒数。默认 300 —— Stripe 官方 SDK 的默认值。 */
  readonly toleranceSeconds?: number
  /** 当前时间(epoch 秒)。测试注入。 */
  readonly now?: () => number
}

/**
 * 验证签名与时间戳,通过则解析事件。任何失败抛 {@link WebhookVerificationError}。
 *
 * 顺序刻意是「先验签,后验时间戳」:伪造的请求不该从响应差异里学到
 * 「我的时间戳过没过容差」—— 验签不过的请求什么都探不到。
 */
export function verifyStripeSignature(input: VerifyInput): StripeEvent {
  if (input.header === null || input.header === '') {
    throw new WebhookVerificationError('missing-header', '请求没有 Stripe-Signature 头')
  }

  // 头格式:k=v 逗号分隔;v1 可重复(secret 轮换期间新旧各签一个)
  let timestamp: string | undefined
  const candidates: string[] = []
  for (const part of input.header.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 't') timestamp = value
    if (key === 'v1') candidates.push(value)
  }
  if (timestamp === undefined || !/^\d+$/.test(timestamp) || candidates.length === 0) {
    throw new WebhookVerificationError('malformed-header', '头里缺 t= 或 v1=,或 t 不是整数')
  }

  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf8')
  const match = candidates.some((c) => {
    const buf = Buffer.from(c, 'utf8')
    // timingSafeEqual 要求等长;长度不同直接不匹配(长度本身不是秘密)
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf)
  })
  if (!match) {
    throw new WebhookVerificationError('signature-mismatch', '没有任何 v1 与本地 HMAC 一致')
  }

  const tolerance = input.toleranceSeconds ?? 300
  const nowSec = (input.now ?? (() => Math.floor(Date.now() / 1000)))()
  const age = Math.abs(nowSec - Number(timestamp))
  if (age > tolerance) {
    throw new WebhookVerificationError(
      'stale-timestamp',
      `事件时间戳与当前相差 ${age}s,超出容差 ${tolerance}s —— 疑似重放`,
    )
  }

  const raw = JSON.parse(input.payload) as Record<string, unknown>
  const id = raw['id']
  const type = raw['type']
  if (typeof id !== 'string' || typeof type !== 'string') {
    throw new WebhookVerificationError('malformed-header', '事件体缺 id 或 type')
  }
  return { id, type, raw }
}

/**
 * 已处理事件的记录 —— 幂等的第一层(快路径)。
 *
 * ⚠️ 它**不是**幂等的最终保证:进程重启会丢内存实现的记录,
 * 而 Stripe 的重试窗口以天计。最终保证在账本层 ——
 * `markPaid` 对已 paid 的发票抛 `InvoiceStateError`,
 * {@link processStripeEvent} 把那个错翻译成「幂等成功」。
 * 两层缺一不可:只有账本层,每次重复投递都要打一遍账本;
 * 只有本层,重启后的重复投递会二次记账。
 */
export interface ProcessedEventStore {
  has(eventId: string): Promise<boolean>
  record(eventId: string): Promise<void>
}

/** 内存实现。 */
export class InMemoryProcessedEventStore implements ProcessedEventStore {
  private readonly seen = new Set<string>()

  async has(eventId: string): Promise<boolean> {
    return this.seen.has(eventId)
  }

  async record(eventId: string): Promise<void> {
    this.seen.add(eventId)
  }
}

/** 处理结果。`duplicate` 与 `already-paid` 都是幂等成功 —— 对 Stripe 一律 2xx,停止重试。 */
export type WebhookOutcome = 'applied' | 'duplicate' | 'already-paid' | 'ignored'

/**
 * 一次「钱到账,并且账本真的改了」的事实 —— {@link ProcessInput.onApplied} 的载荷。
 *
 * ## 为什么需要它:`markPaid` 记不了审计,而这件事必须留痕
 *
 * `@dshwar/billing` 的契约**不从 ctx 读任何东西**(见其类注释:租户由调用方
 * 显式传入),所以 `markPaid` 拿不到 AuditSink —— 它做不到自己记审计。
 * 而「钱到账、发票从 issued 变 paid」是全系统最该有时间线的状态变更:
 * **任何合规审查都会问「这笔钱什么时候、凭什么记进来的」。**
 *
 * V0.8.0 之前这里一条记录都没有,`markPaid` 的注释却写着「落进发票与审计」——
 * 已兑现的前半句掩护了未兑现的后半句。
 *
 * ## 字段按「审查会问什么」选,不按「手头有什么」选
 *
 * `paymentRef` 与 `eventId` 是两个东西:前者是支付意图(能对到银行流水),
 * 后者是这一次投递(能对到 Stripe 后台的重试记录)。审计只留一个都对不上账。
 */
export interface PaymentApplied {
  /** 通道名。与 PaymentHandle.provider 同一个字面量,否则对账对的是两张表。 */
  readonly provider: string
  readonly tenantId: string
  readonly invoiceId: string
  /** 外部凭证:支付网关的意图 id。 */
  readonly paymentRef: string
  /** 这一次 webhook 投递的事件 id —— 与 paymentRef 不是一回事。 */
  readonly eventId: string
  readonly totalMinor: number
  readonly currency: string
}

export interface ProcessInput {
  readonly event: StripeEvent
  readonly billing: Billing
  readonly processed: ProcessedEventStore
  /**
   * 落账通报 —— 只在**账本真的改了**时触发,即 outcome 为 `applied` 的那一次。
   *
   * ⚠️ **`duplicate` / `already-paid` / `ignored` 一律不触发。**
   * 这不是节省日志:那三条路径下账本一个字节都没改,而一条「已收款」的审计
   * 记录意味着「这一刻账变了」。Stripe 会对同一笔支付重试多次,
   * 若每次重试都记一条,审计里就出现 N 笔收款 —— **重复记账的回归从此看不见**。
   *
   * 所以对应的测试是成对的:applied 恰好一条,另外三条路径**保持为空**。
   */
  readonly onApplied?: (applied: PaymentApplied) => void
}

/**
 * 把一个**已验签**的事件落到账本上。幂等,可重入。
 *
 * 只认 `payment_intent.succeeded` 且 metadata 带 `invoiceId` + `tenantId`
 * (createPayment 写入的归属)。其它一律 `ignored` —— 同一个 Stripe 账户
 * 可能还有别的系统在收款,不是我们的事件**不能**报错:报错会让 Stripe
 * 无限重试一个我们永远不会处理的事件。
 *
 * ## 顺序:先记账,后记事件 id
 *
 * 反过来(先记 id 后记账)的坏处:两步之间进程崩掉,事件已标记
 * 「处理过」而账没记 —— 重试被 dedup 挡住,这笔支付**永久丢失**。
 * 现在的顺序下,崩在两步之间只会让重试多打一次账本,
 * 而账本层把 paid→paid 翻译成幂等成功。丢一次记录可以重来,丢一笔账不行。
 */
export async function processStripeEvent(input: ProcessInput): Promise<WebhookOutcome> {
  const { event, billing, processed } = input

  if (await processed.has(event.id)) return 'duplicate'

  if (event.type !== 'payment_intent.succeeded') return 'ignored'

  const object = (event.raw['data'] as { object?: Record<string, unknown> } | undefined)?.object
  const intentId = typeof object?.['id'] === 'string' ? (object['id'] as string) : undefined
  const metadata = object?.['metadata'] as Record<string, unknown> | undefined
  const invoiceId = typeof metadata?.['invoiceId'] === 'string' ? metadata['invoiceId'] : undefined
  const tenantId = typeof metadata?.['tenantId'] === 'string' ? metadata['tenantId'] : undefined
  if (invoiceId === undefined || tenantId === undefined || intentId === undefined) {
    // 没有我们写的归属 metadata = 不是 DSHWAR 发起的支付
    return 'ignored'
  }

  let invoice: Invoice
  try {
    invoice = await billing.markPaid(tenantId, invoiceId, intentId)
  } catch (cause) {
    if (cause instanceof InvoiceStateError) {
      // paid → paid:账已记过(比如上一次处理在 record() 前崩掉后的重试)。
      // 这是幂等成功,不是错误 —— 5xx 会让 Stripe 重试到天荒地老。
      const current = await billing.getInvoice(tenantId, invoiceId)
      if (current?.status === 'paid') {
        await processed.record(event.id)
        // ★ 刻意不通报:账本一个字节都没改。见 onApplied 的说明。
        return 'already-paid'
      }
    }
    // 其它错误(store 抖动、发票真的不在)原样抛 —— 5xx 换取 Stripe 重试
    throw cause
  }

  await processed.record(event.id)
  // ★ 通报紧贴 `return 'applied'`,中间不许插任何分支 ——
  //   这样「哪条路径会通报」读一眼就能确定,不必推理控制流。
  input.onApplied?.({
    provider: STRIPE_PROVIDER,
    tenantId,
    invoiceId,
    paymentRef: intentId,
    eventId: event.id,
    totalMinor: invoice.totalMinor,
    currency: invoice.currency,
  })
  return 'applied'
}
