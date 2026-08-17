/**
 * Stripe 支付网关 —— `PaymentGateway` 的 Stripe 实现。
 *
 * ## 为什么裸 fetch 而不是官方 `stripe` SDK
 *
 * 本适配器只用两个端点(创建/回查 PaymentIntent)。官方 SDK 带来的是
 * 全 API 面的类型与一个需要跟版的大依赖;而我们要的两个调用,
 * form 编码 + Bearer 头就是全部。**依赖面越小,供应链审计越短** ——
 * 对一个碰钱的包,这条权重最高。
 *
 * ## 金额单位:恰好对齐,不需换算
 *
 * Stripe 的 `amount` 用的就是各币种的最小单位(cent / 分;JPY 这类
 * 零小数币种就是整円)。`Invoice.totalMinor` 同一约定,**原样透传**。
 * 若哪天出现两边口径不一致的币种,修这里,并在契约测试里钉死那个币种。
 *
 * ## ⚠️ stripe-mock 是响应生成器,不是验证器(2026-08-17 实测)
 *
 * `amount=-5` 它照样 200。所以「坏输入必须被拒」这道防线**在本适配器里**
 * ({@link assertPayable} + `assertMinorUnits`),对应的负向测试打的是
 * 本地防线,不指望模拟器替我们红。模拟器验的是:请求形状(auth 头、
 * form 编码)真的被一个实现了 Stripe 协议的服务端接受。
 */
import {
  assertMinorUnits,
  assertPayable,
  type Invoice,
  type PaymentGateway,
  type PaymentHandle,
} from '@dshwar/billing'

export interface StripeGatewayOptions {
  /**
   * Stripe secret key(`sk_test_…` / `sk_live_…`)。
   * 经部署方的凭据通道注入 —— 不落配置文件,不进版本控制。
   */
  readonly apiKey: string
  /**
   * API 地址。默认真实 Stripe;测试指向 stripe-mock(`http://localhost:12111`)。
   */
  readonly baseUrl?: string
  /** fetch 注入,单测用。默认全局 fetch。 */
  readonly fetchImpl?: typeof fetch
}

/**
 * Stripe 调用失败。
 *
 * ⚠️ **message 永不包含 API key。** 构造时只接受状态码与 Stripe 返回的
 * 错误描述 —— 请求头不进错误对象,这是结构上的保证而不是「记得别写」。
 */
export class StripeGatewayError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(`Stripe 返回 ${status}:${detail}`)
    this.name = 'StripeGatewayError'
    this.status = status
  }
}

/** Stripe PaymentIntent 响应里本适配器消费的字段。 */
interface PaymentIntentLike {
  readonly id: string
  readonly status: string
  readonly client_secret?: string | null
}

export class StripeGateway implements PaymentGateway {
  private readonly options: StripeGatewayOptions

  constructor(options: StripeGatewayOptions) {
    this.options = options
  }

  async createPayment(invoice: Invoice): Promise<PaymentHandle> {
    // 判据只有一份(契约的 assertPayable):draft/paid/void/0 元一律在本地拒,
    // 不打网络 —— stripe-mock 实测不验证业务规则,真实 Stripe 的拒绝又太晚
    assertPayable(invoice)
    assertMinorUnits(invoice.totalMinor, `invoice(${invoice.id}).totalMinor`)

    const body = new URLSearchParams({
      amount: String(invoice.totalMinor),
      currency: invoice.currency.toLowerCase(),
      'metadata[invoiceId]': invoice.id,
      'metadata[tenantId]': invoice.tenantId,
      description: `DSHWAR invoice ${invoice.id} (${invoice.period.start} – ${invoice.period.end})`,
    })

    const intent = await this.call<PaymentIntentLike>('POST', '/v1/payment_intents', {
      body,
      // 幂等键 = 发票 id:网络重试、进程重启后的重试,都落在同一笔支付上。
      // Stripe 对相同幂等键返回首次的结果,这正是「一张发票至多一笔支付」的实现。
      idempotencyKey: `dshwar-${invoice.id}`,
    })
    return toHandle(intent)
  }

  async getPayment(externalId: string): Promise<PaymentHandle> {
    const intent = await this.call<PaymentIntentLike>(
      'GET',
      `/v1/payment_intents/${encodeURIComponent(externalId)}`,
      {},
    )
    return toHandle(intent)
  }

  /** 唯一的 HTTP 通路:认证、编码、错误映射都在这一处。 */
  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    extras: { body?: URLSearchParams; idempotencyKey?: string },
  ): Promise<T> {
    const base = this.options.baseUrl ?? 'https://api.stripe.com'
    const doFetch = this.options.fetchImpl ?? fetch

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.apiKey}`,
    }
    if (extras.body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded'
    if (extras.idempotencyKey !== undefined) headers['idempotency-key'] = extras.idempotencyKey

    const response = await doFetch(`${base}${path}`, {
      method,
      headers,
      ...(extras.body === undefined ? {} : { body: extras.body.toString() }),
    })

    if (!response.ok) {
      // 只取 Stripe 的错误描述进 message —— 请求头(含 key)在结构上到不了这里
      const detail = await response
        .json()
        .then((j) => {
          const err = (j as { error?: { message?: string; type?: string } }).error
          return err?.message ?? err?.type ?? '(无错误描述)'
        })
        .catch(() => '(响应不是 JSON)')
      throw new StripeGatewayError(response.status, detail)
    }
    return (await response.json()) as T
  }
}

function toHandle(intent: PaymentIntentLike): PaymentHandle {
  return {
    provider: 'stripe',
    externalId: intent.id,
    status: intent.status,
    ...(intent.client_secret == null ? {} : { clientSecret: intent.client_secret }),
  }
}
