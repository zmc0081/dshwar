/**
 * webhook 端点的 HTTP 全链路 —— 签名字节进来,发票状态出去。
 *
 * 包级测试(billing-stripe)已经验过三条防线;这里验的是**接线**:
 * - 原始 body 原样到达验签(Hono 没有偷偷解析再序列化)
 * - 验签失败统一 401,响应体不含原因
 * - 未配置支付的网关,同一路径同样 401(fail closed,不是 404)
 */
import { createHmac } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { StaticAuth } from '@dshwar/auth-static'
import { legalEntity } from '@dshwar/billing'
import { InMemoryInvoiceStore, LocalBilling } from '@dshwar/billing-local'
import { InMemoryProcessedEventStore, type PaymentApplied } from '@dshwar/billing-stripe'
import { InMemoryMeteringStore, type PriceTable } from '@dshwar/metering'
import { PrincipalService } from '@dshwar/principal'
import { beforeEach, describe, expect, it } from 'vitest'
import { createGateway } from '../src/app.ts'
import { InMemoryAdminKeyResolver } from '../src/admin-keys.ts'
import { registerStripeWebhook } from '../src/billing/webhook.ts'

const SELLER = { legalName: legalEntity('Acme Inc.'), taxId: null, address: null }

const SECRET = 'whsec_gw_test'
const PRICES: PriceTable = {
  currency: 'CNY',
  currencyExponent: 2,
  prices: { 'deepseek/deepseek-chat': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 } },
}

function sign(payload: string, secret = SECRET): string {
  const t = Math.floor(Date.now() / 1000)
  const mac = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  return `t=${t},v1=${mac}`
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, { entries: [], quiet: true })
  const metering = new InMemoryMeteringStore()
  await metering.record({
    subjectId: 'alice',
    tenantId: 'acme',
    sessionId: 's1',
    turn: 1,
    step: 1,
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
    unreported: false,
    at: '2026-07-03T10:00:00Z',
  })
  await ctx.plugin(LocalBilling, {
    seller: SELLER,
    metering,
    prices: PRICES,
    invoices: new InMemoryInvoiceStore(),
  })

  const invoice = await ctx.billing.generateInvoice('acme', {
    start: '2026-07-01T00:00:00Z',
    end: '2026-08-01T00:00:00Z',
  })
  await ctx.billing.issueInvoice('acme', invoice.id)

  const rejected: string[] = []
  const applied: { payload: PaymentApplied; requestId: string }[] = []
  const app = createGateway({
    ctx,
    adminKeys: new InMemoryAdminKeyResolver([]),
    billingRoutes: registerStripeWebhook({
      secret: SECRET,
      billing: ctx.billing,
      processed: new InMemoryProcessedEventStore(),
      onRejected: (r) => rejected.push(r),
      onApplied: (payload, requestId) => applied.push({ payload, requestId }),
    }),
  })
  return { app, ctx, invoiceId: invoice.id, rejected, applied }
}

function paidPayload(invoiceId: string, eventId = 'evt_gw_1'): string {
  return JSON.stringify({
    id: eventId,
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_gw_1', metadata: { invoiceId, tenantId: 'acme' } } },
  })
}

describe('webhook HTTP 全链路', () => {
  let h: Awaited<ReturnType<typeof harness>>

  beforeEach(async () => {
    h = await harness()
  })

  it('★ 签名的支付事件 → 200 applied,发票真的变 paid', async () => {
    const payload = paidPayload(h.invoiceId)
    const res = await h.app.request('/v1/billing/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sign(payload), 'content-type': 'application/json' },
      body: payload,
    })

    expect(res.status).toBe(200)
    const ack = (await res.json()) as { received: boolean; outcome: string; requestId: string }
    expect(ack.received).toBe(true)
    expect(ack.outcome).toBe('applied')
    // 横切约定:2xx 响应带 requestId —— Stripe 后台展示的响应体能对到日志
    expect(ack.requestId.length).toBeGreaterThan(0)

    const invoice = await h.ctx.billing.getInvoice('acme', h.invoiceId)
    expect(invoice?.status).toBe('paid')
    expect(invoice?.paymentRef).toBe('pi_gw_1')

    // ★ V0.8.0:落账必须留痕。此前成功路径直接返回 200,审计里一条都没有 ——
    //   而「钱到账、发票转 paid」是合规审查一定会问时间线的那一类。
    expect(h.applied, '发票转成了 paid,却没有任何落账通报进审计').toHaveLength(1)
    expect(h.applied[0]!.payload.paymentRef).toBe('pi_gw_1')
    expect(h.applied[0]!.payload.tenantId).toBe('acme')
    // requestId 由网关层补进来(billing-stripe 不该知道有 HTTP),
    // 它是审计记录与 Stripe 后台那一次投递之间唯一的桥。
    expect(h.applied[0]!.requestId).toBe(ack.requestId)
  })

  it('无签名 → 401,响应体不含任何原因;拒绝进了通报回调', async () => {
    const payload = paidPayload(h.invoiceId)
    const res = await h.app.request('/v1/billing/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    // 统一的贫瘠信息 —— 不区分「没头」「签错」「过期」
    expect(body.error.message).toBe('authentication failed')
    expect(h.rejected.length).toBe(1)

    expect((await h.ctx.billing.getInvoice('acme', h.invoiceId))?.status).toBe('issued')
  })

  it('错误 secret 的签名 → 401,与无签名不可区分', async () => {
    const payload = paidPayload(h.invoiceId)
    const res = await h.app.request('/v1/billing/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': sign(payload, 'whsec_wrong'),
        'content-type': 'application/json',
      },
      body: payload,
    })

    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'authentication failed',
    )
  })

  it('重复投递同一事件 → 第二次是 duplicate,账本只动一次', async () => {
    const payload = paidPayload(h.invoiceId, 'evt_gw_dup')
    const send = () =>
      h.app.request('/v1/billing/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': sign(payload), 'content-type': 'application/json' },
        body: payload,
      })

    const first = await send()
    const second = await send()
    expect(((await first.json()) as { outcome: string }).outcome).toBe('applied')
    expect(((await second.json()) as { outcome: string }).outcome).toBe('duplicate')

    // ★ 与上面「applied 必须通报」成对:Stripe 是 at-least-once,
    //   重试若也通报,审计里就会出现两笔同样的收款。
    //   **只验「有通报」的话,一个每次都通报的实现照样全绿。**
    expect(h.applied, '重复投递被多通报了一次 —— 审计里会多出一笔不存在的收款').toHaveLength(1)
  })

  it('★ 未配置支付的网关:同一路径 401 而不是 404 —— 配没配从外面看不出来', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    await ctx.plugin(StaticAuth, { entries: [], quiet: true })
    const bare = createGateway({ ctx, adminKeys: new InMemoryAdminKeyResolver([]) })

    const res = await bare.request('/v1/billing/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })
})
