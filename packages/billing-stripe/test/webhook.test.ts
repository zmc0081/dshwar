/**
 * Webhook 三条防线 —— D5 强制的三条负向验证在此:
 *
 * 1. 伪造签名 → 拒
 * 2. 重放旧事件(时间戳过期)→ 拒
 * 3. 重复投递同一事件 → 只生效一次
 *
 * 支付是唯一一处「测试没覆盖 = 真金白银出错」的地方 ——
 * 这里的负向测试不是锦上添花,是验收本体。
 */
import { createHmac } from 'node:crypto'
import { InMemoryMeteringStore, type PriceTable } from '@dshwar/metering'
import { InMemoryInvoiceStore, LocalBilling } from '@dshwar/billing-local'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryProcessedEventStore,
  WebhookVerificationError,
  processStripeEvent,
  verifyStripeSignature,
} from '../src/index.ts'

const SECRET = 'whsec_test_secret_1'
const NOW = 1_780_000_000 // 固定的 epoch 秒;所有时间断言相对它

/** 按 Stripe 的方案签一个负载 —— 测试自己实现一遍,证明方案是自足的。 */
function sign(payload: string, at: number, secret = SECRET): string {
  const mac = createHmac('sha256', secret).update(`${at}.${payload}`).digest('hex')
  return `t=${at},v1=${mac}`
}

function eventPayload(over: Partial<{ id: string; type: string; metadata: unknown }> = {}): string {
  return JSON.stringify({
    id: over.id ?? 'evt_1',
    type: over.type ?? 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_hook_1',
        metadata: over.metadata ?? { invoiceId: 'inv_x', tenantId: 'acme' },
      },
    },
  })
}

describe('防线 1 · 验签', () => {
  it('正确签名通过,解析出事件', () => {
    const payload = eventPayload()
    const event = verifyStripeSignature({
      payload,
      header: sign(payload, NOW),
      secret: SECRET,
      now: () => NOW,
    })
    expect(event.id).toBe('evt_1')
    expect(event.type).toBe('payment_intent.succeeded')
  })

  it('★ 负向 1:伪造签名 → 拒', () => {
    const payload = eventPayload()
    expect(() =>
      verifyStripeSignature({
        payload,
        header: sign(payload, NOW, 'whsec_attacker_guess'),
        secret: SECRET,
        now: () => NOW,
      }),
    ).toThrow(WebhookVerificationError)
  })

  it('负向 1b:签名对但正文被改 → 拒(签的是 body,不是心意)', () => {
    const payload = eventPayload()
    const tampered = payload.replace('inv_x', 'inv_attacker')
    expect(() =>
      verifyStripeSignature({
        payload: tampered,
        header: sign(payload, NOW),
        secret: SECRET,
        now: () => NOW,
      }),
    ).toThrow(/signature-mismatch|一致/)
  })

  it('负向 1c:没有签名头 → 拒', () => {
    expect(() =>
      verifyStripeSignature({ payload: eventPayload(), header: null, secret: SECRET }),
    ).toThrow(/missing-header|没有/)
  })

  it('secret 轮换:多个 v1 里任一匹配即通过', () => {
    const payload = eventPayload()
    const good = sign(payload, NOW)
    const [t, v1] = good.split(',') as [string, string]
    const rotated = `${t},v1=deadbeef,${v1}`
    const event = verifyStripeSignature({
      payload,
      header: rotated,
      secret: SECRET,
      now: () => NOW,
    })
    expect(event.id).toBe('evt_1')
  })
})

describe('防线 2 · 时间戳容差', () => {
  it('★ 负向 2:重放 6 分钟前的旧事件 → 拒(默认容差 300s)', () => {
    const payload = eventPayload()
    expect(() =>
      verifyStripeSignature({
        payload,
        header: sign(payload, NOW - 360), // 签名是**真的**,只是过期了
        secret: SECRET,
        now: () => NOW,
      }),
    ).toThrow(/stale-timestamp|重放/)
  })

  it('容差内(4 分钟前)通过 —— 容差不是零,网络与重试需要余量', () => {
    const payload = eventPayload()
    const event = verifyStripeSignature({
      payload,
      header: sign(payload, NOW - 240),
      secret: SECRET,
      now: () => NOW,
    })
    expect(event.id).toBe('evt_1')
  })

  it('改时间戳绕容差 → 签名随之失配(时间戳参与签名,这是方案的要点)', () => {
    const payload = eventPayload()
    const stale = sign(payload, NOW - 360)
    // 攻击者把 t= 改成现在,想让过期事件显得新鲜
    const doctored = stale.replace(`t=${NOW - 360}`, `t=${NOW}`)
    expect(() =>
      verifyStripeSignature({ payload, header: doctored, secret: SECRET, now: () => NOW }),
    ).toThrow(/signature-mismatch|一致/)
  })
})

describe('防线 3 · 幂等', () => {
  const PRICES: PriceTable = {
    currency: 'CNY',
    prices: { 'deepseek/deepseek-chat': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 } },
  }

  let ctx: Context
  let processed: InMemoryProcessedEventStore
  let invoiceId: string

  beforeEach(async () => {
    ctx = new Context()
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
      metering,
      prices: PRICES,
      invoices: new InMemoryInvoiceStore(),
    })
    processed = new InMemoryProcessedEventStore()

    const invoice = await ctx.billing.generateInvoice('acme', {
      start: '2026-07-01T00:00:00Z',
      end: '2026-08-01T00:00:00Z',
    })
    await ctx.billing.issueInvoice('acme', invoice.id)
    invoiceId = invoice.id
  })

  function paidEvent(eventId: string) {
    return {
      id: eventId,
      type: 'payment_intent.succeeded',
      raw: {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_hook_1', metadata: { invoiceId, tenantId: 'acme' } } },
      },
    }
  }

  it('首次投递:发票落账为 paid,凭证号是 PaymentIntent id', async () => {
    const outcome = await processStripeEvent({
      event: paidEvent('evt_first'),
      billing: ctx.billing,
      processed,
    })
    expect(outcome).toBe('applied')

    const invoice = await ctx.billing.getInvoice('acme', invoiceId)
    expect(invoice?.status).toBe('paid')
    expect(invoice?.paymentRef).toBe('pi_hook_1')
  })

  it('★ 负向 3:同一事件重复投递 → 只生效一次', async () => {
    const first = await processStripeEvent({
      event: paidEvent('evt_dup'),
      billing: ctx.billing,
      processed,
    })
    const second = await processStripeEvent({
      event: paidEvent('evt_dup'),
      billing: ctx.billing,
      processed,
    })

    expect(first).toBe('applied')
    expect(second).toBe('duplicate')
    // 账本只动了一次:paymentRef 仍是第一次的
    const invoice = await ctx.billing.getInvoice('acme', invoiceId)
    expect(invoice?.status).toBe('paid')
  })

  it('负向 3b:dedup 记录丢失(如进程重启)后的重复投递 → 账本层兜住', async () => {
    await processStripeEvent({ event: paidEvent('evt_a'), billing: ctx.billing, processed })

    // 模拟重启:全新的 processed store,同一支付换了事件 id 重投
    const freshStore = new InMemoryProcessedEventStore()
    const outcome = await processStripeEvent({
      event: paidEvent('evt_b'),
      billing: ctx.billing,
      processed: freshStore,
    })

    // paid → paid 被账本拒,翻译成幂等成功 —— 不是 5xx,Stripe 停止重试
    expect(outcome).toBe('already-paid')
  })

  it('不认识的事件类型 → ignored,不碰账本', async () => {
    const outcome = await processStripeEvent({
      event: {
        id: 'evt_c',
        type: 'customer.created',
        raw: { id: 'evt_c', type: 'customer.created' },
      },
      billing: ctx.billing,
      processed,
    })
    expect(outcome).toBe('ignored')
    expect((await ctx.billing.getInvoice('acme', invoiceId))?.status).toBe('issued')
  })

  it('没有 DSHWAR metadata 的支付事件 → ignored(别的系统的收款,不报错不重试)', async () => {
    const outcome = await processStripeEvent({
      event: {
        id: 'evt_d',
        type: 'payment_intent.succeeded',
        raw: {
          id: 'evt_d',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_other', metadata: {} } },
        },
      },
      billing: ctx.billing,
      processed,
    })
    expect(outcome).toBe('ignored')
  })

  it('draft 发票收到支付事件 → 抛(5xx 换 Stripe 重试),不静默吞', async () => {
    // 构造:另一张从未 issue 的发票 —— markPaid 会抛 InvoiceStateError,
    // 且当前状态不是 paid,所以不能翻译成幂等成功
    await ctx.billing.voidInvoice('acme', invoiceId)
    const draft = await ctx.billing.generateInvoice('acme', {
      start: '2026-07-01T00:00:00Z',
      end: '2026-08-01T00:00:00Z',
    })

    await expect(
      processStripeEvent({
        event: {
          id: 'evt_e',
          type: 'payment_intent.succeeded',
          raw: {
            id: 'evt_e',
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_x', metadata: { invoiceId: draft.id, tenantId: 'acme' } } },
          },
        },
        billing: ctx.billing,
        processed,
      }),
    ).rejects.toThrow()
  })
})
