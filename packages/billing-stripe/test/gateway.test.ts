/**
 * StripeGateway 离线单测 —— fetch spy,不碰网络,永远跑。
 *
 * 这一层是「坏输入必须被拒」的**真正防线**:stripe-mock 实测不验证
 * 业务规则(amount=-5 照样 200),真实 Stripe 的拒绝又发生在钱已经
 * 走到门口之后。所以 draft/paid/void/0 元的拒绝必须发生在本地,
 * 且断言「fetch 根本没被调」—— 拒绝晚了就不算拒绝。
 */
import type { BillingPeriod, Invoice } from '@dshwar/billing'
import { legalEntity, PaymentNotAllowedError } from '@dshwar/billing'
import { describe, expect, it, vi } from 'vitest'
import { StripeGateway, StripeGatewayError } from '../src/index.ts'

const PERIOD: BillingPeriod = { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' }

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv_test_1',
    tenantId: 'acme',
    period: PERIOD,
    currency: 'CNY',
    currencyExponent: 2,
    seller: { legalName: legalEntity('Acme Inc.'), taxId: null, address: null },
    status: 'issued',
    lines: [],
    totalMinor: 3000,
    createdAt: '2026-08-01T00:00:01Z',
    issuedAt: '2026-08-01T00:00:02Z',
    ...over,
  }
}

function stubFetch(status: number, json: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status }))
}

const INTENT = { id: 'pi_123', status: 'requires_payment_method', client_secret: 'pi_123_secret_x' }

describe('createPayment · 请求形状', () => {
  it('★ 打对端点,Bearer 认证 + 幂等键 + form 编码的金额与归属', async () => {
    const fetchSpy = stubFetch(200, INTENT)
    const gw = new StripeGateway({ apiKey: 'sk_test_k', fetchImpl: fetchSpy })

    const handle = await gw.createPayment(invoice())

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.stripe.com/v1/payment_intents')
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer sk_test_k')
    // 幂等键 = 发票 id:重试不产生第二笔支付
    expect(headers['idempotency-key']).toBe('dshwar-inv_test_1')
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded')

    const body = new URLSearchParams(init.body as string)
    expect(body.get('amount')).toBe('3000')
    expect(body.get('currency')).toBe('cny')
    expect(body.get('metadata[invoiceId]')).toBe('inv_test_1')
    expect(body.get('metadata[tenantId]')).toBe('acme')

    expect(handle).toEqual({
      provider: 'stripe',
      externalId: 'pi_123',
      status: 'requires_payment_method',
      clientSecret: 'pi_123_secret_x',
    })
  })

  it('baseUrl 可注入 —— stripe-mock 与自建代理走这里', async () => {
    const fetchSpy = stubFetch(200, INTENT)
    const gw = new StripeGateway({
      apiKey: 'sk_test_k',
      baseUrl: 'http://localhost:12111',
      fetchImpl: fetchSpy,
    })
    await gw.createPayment(invoice())
    expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://localhost:12111/v1/payment_intents',
    )
  })
})

describe('createPayment · 本地防线(拒绝时 fetch 不得被调)', () => {
  for (const status of ['draft', 'paid', 'void'] as const) {
    it(`${status} 的发票拒绝支付`, async () => {
      const fetchSpy = stubFetch(200, INTENT)
      const gw = new StripeGateway({ apiKey: 'sk_test_k', fetchImpl: fetchSpy })

      await expect(gw.createPayment(invoice({ status }))).rejects.toThrow(PaymentNotAllowedError)
      // 拒绝必须发生在网络之前 —— 打出去再拒就晚了
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  }

  it('0 元发票拒绝走支付通道(该直接 markPaid)', async () => {
    const fetchSpy = stubFetch(200, INTENT)
    const gw = new StripeGateway({ apiKey: 'sk_test_k', fetchImpl: fetchSpy })

    await expect(gw.createPayment(invoice({ totalMinor: 0 }))).rejects.toThrow(
      PaymentNotAllowedError,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('错误映射', () => {
  it('非 2xx → StripeGatewayError,带上 Stripe 的错误描述', async () => {
    const fetchSpy = stubFetch(402, { error: { message: 'Your card was declined.' } })
    const gw = new StripeGateway({ apiKey: 'sk_test_k', fetchImpl: fetchSpy })

    await expect(gw.createPayment(invoice())).rejects.toThrow(/402.*declined/)
  })

  it('★ 错误信息永不包含 API key —— 对一个碰钱的包,这条是红线', async () => {
    const fetchSpy = stubFetch(500, { error: { message: 'internal' } })
    const secret = 'sk_test_SUPER_SECRET_VALUE'
    const gw = new StripeGateway({ apiKey: secret, fetchImpl: fetchSpy })

    const err = await gw.createPayment(invoice()).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(StripeGatewayError)
    expect(err instanceof Error && err.message.includes(secret)).toBe(false)
    // stack 与自定义字段也不放过:序列化整个错误对象查一遍
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err)).includes(secret)).toBe(false)
  })

  it('响应不是 JSON 时错误仍可读,不二次抛', async () => {
    const fetchSpy = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }))
    const gw = new StripeGateway({ apiKey: 'sk_test_k', fetchImpl: fetchSpy })

    await expect(gw.createPayment(invoice())).rejects.toThrow(/502/)
  })
})

describe('getPayment', () => {
  it('按 id 回查并映射状态', async () => {
    const fetchSpy = stubFetch(200, { id: 'pi_9', status: 'succeeded', client_secret: null })
    const gw = new StripeGateway({ apiKey: 'sk_test_k', fetchImpl: fetchSpy })

    const handle = await gw.getPayment('pi_9')
    expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.stripe.com/v1/payment_intents/pi_9',
    )
    expect(handle.status).toBe('succeeded')
    // client_secret 为 null 时不出现在句柄里,而不是挂一个 null
    expect('clientSecret' in handle).toBe(false)
  })
})
