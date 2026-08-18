/**
 * 本地用量统计 —— 统计,不是计费(V0.6.5 Session 3)。
 *
 * 两件事各一组断言:
 * 1. 统计投影:同一条 metering 管道,billedInputTokens 口径,与云端可比
 * 2. 账单语义:本地行金额恒 0 **且行仍在、token 仍在** ——
 *    「本地算力不计费」不等于「本地用量隐身」
 */
import { Context } from '@deepseek-ai/cordis'
import { legalEntity } from '@dshwar/billing'
import { InMemoryInvoiceStore, LocalBilling } from '@dshwar/billing-local'
import { InMemoryMeteringStore, type PriceTable, type RawUsage } from '@dshwar/metering'
import { describe, expect, it } from 'vitest'
import { summarizeLocalUsage } from '../src/index.ts'

const SELLER = { legalName: legalEntity('Acme Inc.'), taxId: null, address: null }

function usage(over: Partial<RawUsage>): RawUsage {
  return {
    subjectId: 'alice',
    tenantId: 'acme',
    sessionId: 's1',
    turn: 1,
    step: 1,
    provider: 'local',
    model: 'qwen3:8b',
    usage: { inputTokens: 1000, outputTokens: 500 },
    unreported: false,
    at: '2026-07-03T10:00:00Z',
    ...over,
  }
}

describe('统计投影', () => {
  it('★ 按模型聚合,billedInputTokens 口径(含缓存),会话数正确', () => {
    const rows = summarizeLocalUsage([
      usage({
        sessionId: 's1',
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 9000 },
      }),
      usage({ sessionId: 's2', usage: { inputTokens: 2000, outputTokens: 300 } }),
      usage({ sessionId: 's1', turn: 2, usage: { inputTokens: 500, outputTokens: 100 } }),
    ])

    expect(rows).toHaveLength(1)
    // 1000+9000 + 2000 + 500 = 12500 —— 缓存读进口径,与云端可比
    expect(rows[0]).toEqual({
      provider: 'local',
      model: 'qwen3:8b',
      inputTokens: 12_500,
      outputTokens: 900,
      sessions: 2,
    })
  })

  it('云端用量不进本地统计;自定义 provider 名显式传入', () => {
    const records = [
      usage({ provider: 'deepseek', model: 'deepseek-chat' }),
      usage({ provider: 'ollama', model: 'qwen3:8b' }),
    ]

    expect(summarizeLocalUsage(records)).toHaveLength(0) // 默认只认 local
    const rows = summarizeLocalUsage(records, ['ollama'])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.provider).toBe('ollama')
  })

  it('多模型按总用量降序 —— 看板大头先看到', () => {
    const rows = summarizeLocalUsage([
      usage({ model: 'small', usage: { inputTokens: 100, outputTokens: 10 } }),
      usage({ model: 'big', usage: { inputTokens: 100_000, outputTokens: 10_000 } }),
    ])
    expect(rows.map((r) => r.model)).toEqual(['big', 'small'])
  })

  it('空明细 → 空统计,不抛', () => {
    expect(summarizeLocalUsage([])).toEqual([])
  })
})

describe('账单语义:本地算力不计费,但不隐身', () => {
  it('★ 发票里本地行金额 0、行在、token 在;云端行照常计费', async () => {
    const ctx = new Context()
    const metering = new InMemoryMeteringStore()
    // 价格表只配云端 —— 给本地 provider 配价才是错误(见 GOVERNANCE.md)
    const prices: PriceTable = {
      currency: 'CNY',
      prices: { 'deepseek/deepseek-chat': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 } },
    }
    await metering.record(
      usage({
        provider: 'deepseek',
        model: 'deepseek-chat',
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
      }),
    )
    await metering.record(
      usage({ subjectId: 'bob', usage: { inputTokens: 5_000_000, outputTokens: 1_000_000 } }),
    )
    await ctx.plugin(LocalBilling, {
      seller: SELLER,
      metering,
      prices,
      invoices: new InMemoryInvoiceStore(),
    })

    const invoice = await ctx.billing.generateInvoice('acme', {
      start: '2026-07-01T00:00:00Z',
      end: '2026-08-01T00:00:00Z',
    })

    expect(invoice.lines).toHaveLength(2)
    const cloud = invoice.lines.find((l) => l.provider === 'deepseek')!
    const local = invoice.lines.find((l) => l.provider === 'local')!

    expect(cloud.amountMinor).toBe(200)
    // 本地:金额 0(不计费),但 token 完整可见(不隐身)
    expect(local.amountMinor).toBe(0)
    expect(local.inputTokens).toBe(5_000_000)
    expect(local.outputTokens).toBe(1_000_000)
    expect(invoice.totalMinor).toBe(200) // 总额只含云端
  })
})
