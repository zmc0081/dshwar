import { Context } from '@deepseek-ai/cordis'
import {
  InvalidMinorUnitsError,
  InvoiceStateError,
  assertMinorUnits,
  type BillingPeriod,
} from '@dshwar/billing'
import { InMemoryMeteringStore, type PriceTable, type RawUsage } from '@dshwar/metering'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryInvoiceStore, LocalBilling } from '../src/index.ts'

// deepseek-chat:输入 ¥2/M tokens = 200 分,输出 ¥8/M = 800 分
const PRICES: PriceTable = {
  currency: 'CNY',
  prices: {
    'deepseek/deepseek-chat': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 },
    'deepseek/deepseek-reasoner': { inputPerMTokenMinor: 400, outputPerMTokenMinor: 1600 },
  },
}

const JULY: BillingPeriod = { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' }

function usage(over: Partial<RawUsage> & { at: string }): RawUsage {
  return {
    subjectId: 'alice',
    tenantId: 'acme',
    sessionId: 's1',
    turn: 1,
    step: 1,
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
    unreported: false,
    ...over,
  }
}

async function harness() {
  const ctx = new Context()
  const metering = new InMemoryMeteringStore()
  const invoices = new InMemoryInvoiceStore()
  let tick = 0
  await ctx.plugin(LocalBilling, {
    metering,
    prices: PRICES,
    invoices,
    // 单调时钟:listInvoices 的排序断言需要 createdAt 可区分
    now: () => `2026-08-01T00:00:${String((tick += 1)).padStart(2, '0')}Z`,
  })
  return { ctx, metering, invoices }
}

describe('验收:从 metering 用量出一张账单,金额全程整数', () => {
  let h: Awaited<ReturnType<typeof harness>>

  beforeEach(async () => {
    h = await harness()
  })

  it('★ 用量 × 价格 = 发票,行与总额都对', async () => {
    // alice:1M 输入(含缓存口径)+ 0.5M 输出 → 200 + 400 = 600 分
    await h.metering.record(usage({ at: '2026-07-03T10:00:00Z' }))
    // bob 用 reasoner:2M 输入 + 1M 输出 → 800 + 1600 = 2400 分
    await h.metering.record(
      usage({
        at: '2026-07-15T09:00:00Z',
        subjectId: 'bob',
        model: 'deepseek-reasoner',
        usage: { inputTokens: 2_000_000, outputTokens: 1_000_000 },
      }),
    )

    const invoice = await h.ctx.billing.generateInvoice('acme', JULY)

    expect(invoice.status).toBe('draft')
    expect(invoice.currency).toBe('CNY')
    expect(invoice.lines).toHaveLength(2)
    // 金额降序:bob 的 2400 在前
    expect(invoice.lines[0]).toMatchObject({ subjectId: 'bob', amountMinor: 2400 })
    expect(invoice.lines[1]).toMatchObject({ subjectId: 'alice', amountMinor: 600 })
    expect(invoice.totalMinor).toBe(3000)
  })

  it('★ 缓存 token 进计费口径(billedInputTokens,不是裸 inputTokens)', async () => {
    // 裸输入 100k + 缓存读 800k + 缓存写 100k = 1M 计费输入 → 200 分
    // 只按裸 inputTokens 算的话是 20 分 —— 少计费 10 倍
    await h.metering.record(
      usage({
        at: '2026-07-05T00:00:00Z',
        usage: {
          inputTokens: 100_000,
          outputTokens: 0,
          cacheReadTokens: 800_000,
          cacheWriteTokens: 100_000,
        },
      }),
    )

    const invoice = await h.ctx.billing.generateInvoice('acme', JULY)
    expect(invoice.lines[0]!.inputTokens).toBe(1_000_000)
    expect(invoice.lines[0]!.amountMinor).toBe(200)
  })

  it('★ 每行只 round 一次:先整期累加 token,再算钱', async () => {
    // 单条 1,249 输入 token → 0.2498 分,单条 round = 0
    // 100 条累加 = 124,900 token → 24.98 分 → round = 25
    // 若逐条算钱再相加,总额是 0 —— 两种算法差出整整 25 分
    for (let i = 0; i < 100; i += 1) {
      await h.metering.record(
        usage({
          at: `2026-07-10T00:${String(i % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
          turn: i,
          usage: { inputTokens: 1_249, outputTokens: 0 },
        }),
      )
    }

    const invoice = await h.ctx.billing.generateInvoice('acme', JULY)
    expect(invoice.lines[0]!.inputTokens).toBe(124_900)
    expect(invoice.lines[0]!.amountMinor).toBe(25)
  })

  it('金额字段全是安全整数(纪律本身,不只是这几个样例)', async () => {
    await h.metering.record(
      usage({ at: '2026-07-03T10:00:00Z', usage: { inputTokens: 123_457, outputTokens: 76_543 } }),
    )
    const invoice = await h.ctx.billing.generateInvoice('acme', JULY)

    for (const line of invoice.lines) {
      expect(Number.isSafeInteger(line.amountMinor), `line.amountMinor=${line.amountMinor}`).toBe(
        true,
      )
    }
    expect(Number.isSafeInteger(invoice.totalMinor)).toBe(true)
  })

  it('周期是半开区间:end 时刻的用量进下一期', async () => {
    await h.metering.record(usage({ at: '2026-06-30T23:59:59Z' })) // 前一期
    await h.metering.record(usage({ at: '2026-07-01T00:00:00Z' })) // 本期第一刻
    await h.metering.record(usage({ at: '2026-08-01T00:00:00Z' })) // 下一期第一刻

    const invoice = await h.ctx.billing.generateInvoice('acme', JULY)
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.totalMinor).toBe(600)
  })

  it('租户过滤:别家的用量绝不进这张发票', async () => {
    await h.metering.record(usage({ at: '2026-07-03T10:00:00Z' }))
    await h.metering.record(
      usage({ at: '2026-07-03T11:00:00Z', tenantId: 'globex', subjectId: 'eve' }),
    )

    const invoice = await h.ctx.billing.generateInvoice('acme', JULY)
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines.every((l) => l.subjectId !== 'eve')).toBe(true)
  })

  it('没配价的模型:行在、token 在、金额 0 —— 是「没配价」不是「隐身」', async () => {
    await h.metering.record(usage({ at: '2026-07-03T10:00:00Z', model: 'unknown-model' }))

    const invoice = await h.ctx.billing.generateInvoice('acme', JULY)
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]!.amountMinor).toBe(0)
    expect(invoice.lines[0]!.inputTokens).toBe(1_000_000)
  })

  it('幂等:同一周期重复出账返回同一张,void 后才能重出', async () => {
    await h.metering.record(usage({ at: '2026-07-03T10:00:00Z' }))

    const first = await h.ctx.billing.generateInvoice('acme', JULY)
    const second = await h.ctx.billing.generateInvoice('acme', JULY)
    expect(second.id).toBe(first.id)

    await h.ctx.billing.voidInvoice('acme', first.id)
    const reissued = await h.ctx.billing.generateInvoice('acme', JULY)
    expect(reissued.id).not.toBe(first.id)
  })
})

describe('状态机', () => {
  let h: Awaited<ReturnType<typeof harness>>
  let invoiceId: string

  beforeEach(async () => {
    h = await harness()
    await h.metering.record(usage({ at: '2026-07-03T10:00:00Z' }))
    invoiceId = (await h.ctx.billing.generateInvoice('acme', JULY)).id
  })

  it('正路:draft → issued → paid,时间戳与凭证号落上', async () => {
    const issued = await h.ctx.billing.issueInvoice('acme', invoiceId)
    expect(issued.status).toBe('issued')
    expect(issued.issuedAt).toBeDefined()

    const paid = await h.ctx.billing.markPaid('acme', invoiceId, 'pi_stripe_123')
    expect(paid.status).toBe('paid')
    expect(paid.paymentRef).toBe('pi_stripe_123')
    expect(paid.paidAt).toBeDefined()
  })

  it('draft 不能直接 paid —— 没定稿的账不能收钱', async () => {
    await expect(h.ctx.billing.markPaid('acme', invoiceId, 'x')).rejects.toThrow(InvoiceStateError)
  })

  it('paid 是终态:不能 void,不能再 issue', async () => {
    await h.ctx.billing.issueInvoice('acme', invoiceId)
    await h.ctx.billing.markPaid('acme', invoiceId, 'pi_1')

    await expect(h.ctx.billing.voidInvoice('acme', invoiceId)).rejects.toThrow(InvoiceStateError)
    await expect(h.ctx.billing.issueInvoice('acme', invoiceId)).rejects.toThrow(InvoiceStateError)
  })

  it('跨租户拿不到别家发票:get 是 undefined,迁移是抛', async () => {
    expect(await h.ctx.billing.getInvoice('globex', invoiceId)).toBeUndefined()
    await expect(h.ctx.billing.issueInvoice('globex', invoiceId)).rejects.toThrow(InvoiceStateError)
  })

  it('listInvoices 按 createdAt 降序', async () => {
    await h.ctx.billing.voidInvoice('acme', invoiceId)
    const second = await h.ctx.billing.generateInvoice('acme', JULY)

    const list = await h.ctx.billing.listInvoices('acme')
    expect(list).toHaveLength(2)
    expect(list[0]!.id).toBe(second.id)
  })
})

describe('钱的纪律(负向:这些都必须炸)', () => {
  it('浮点不是钱', () => {
    expect(() => assertMinorUnits(12.5, 'x')).toThrow(InvalidMinorUnitsError)
  })

  it('负数不是钱', () => {
    expect(() => assertMinorUnits(-1, 'x')).toThrow(InvalidMinorUnitsError)
  })

  it('超出安全整数不是钱', () => {
    expect(() => assertMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'x')).toThrow(InvalidMinorUnitsError)
  })

  it('NaN 不是钱', () => {
    expect(() => assertMinorUnits(Number.NaN, 'x')).toThrow(InvalidMinorUnitsError)
  })

  it('合法整数原样通过', () => {
    expect(assertMinorUnits(0, 'x')).toBe(0)
    expect(assertMinorUnits(3000, 'x')).toBe(3000)
  })
})
