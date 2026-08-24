/**
 * 成本那一格 —— V0.9.0 Session 5.5 的两条验收都落在这里。
 *
 * | 验收 | 判据 |
 * | --- | --- |
 * | ① 三种情况在类型层可分,**没有一种能退化成 0** | `unpriced` / `unbilled` 各有断言,且都不显示成数字 |
 * | ② JPY(指数 0)与 KWD(指数 3)各一条 | 金额显示正确,且**不等于**按 ÷100 算出来的那个数 |
 *
 * ## ⚠️ 每条币种断言都带一个「不等于」
 *
 * 只断言「JPY 的 38204 显示成 38,204」是不够的:一个仍然写死 `÷ 100` 的实现
 * 会给出 `382.04`,而这两个串**都不像错的**。所以每条都再钉一次
 * 「**不等于**写死 100 的那个结果」—— 那才是这次改动真正要防的东西。
 *
 * 负向验证在 `scripts/verify-assertions.mjs` 探针 27:把指数写死回 2,
 * 确认这两条**各自**变红。
 */
import { describe, expect, it } from 'vitest'
import { formatMinorUnits, rollupCost, formatCost, toUsageProps } from '../src/view/usage.ts'
import { toEstimatedBill } from '../src/view/overview.ts'
import type { UsageRecord } from '../src/api.ts'

/** 一条用量记录。`cost` 由调用方给,其余的填成可辨认的常量。 */
function record(cost: UsageRecord['cost'], over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    subjectId: 'alice-e6f1',
    tenantId: 'acme',
    date: '2026-08-16',
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 1000,
    outputTokens: 200,
    cost,
    ...over,
  }
}

const priced = (amountMinor: number, currency: string, currencyExponent: number) =>
  ({ kind: 'priced', amountMinor, currency, currencyExponent }) as const
const UNPRICED = {
  kind: 'unpriced',
  amountMinor: null,
  currency: null,
  currencyExponent: null,
} as const
const UNBILLED = {
  kind: 'unbilled',
  amountMinor: null,
  currency: null,
  currencyExponent: null,
} as const

/** 同一个整数,三种币种下三个不同的读法 —— 这就是「÷100 没有来源」的全部内容。 */
const AMOUNT = 38_204

describe('验收② 指数由契约给:JPY 与 KWD 各一条', () => {
  it('★ JPY(指数 0):38204 minor = 38,204 円,**不是** 382.04', () => {
    expect(formatMinorUnits(AMOUNT, 0)).toBe('38,204')
    // 写死 ÷100 的实现会给出这个 —— 两个串都不像错的,所以要钉「不等于」。
    expect(formatMinorUnits(AMOUNT, 0)).not.toBe('382.04')
  })

  it('★ KWD(指数 3):38204 minor = 38.204 第纳尔,**不是** 382.04', () => {
    expect(formatMinorUnits(AMOUNT, 3)).toBe('38.204')
    expect(formatMinorUnits(AMOUNT, 3)).not.toBe('382.04')
  })

  it('CNY(指数 2)照旧 —— 改动没有把常见情况改坏', () => {
    expect(formatMinorUnits(AMOUNT, 2)).toBe('382.04')
  })

  it('★ 指数越界抛,不回落到 2', () => {
    // 回落到 2 会让一个上游违约**看起来正常** —— 而那正是这个字段存在的原因。
    expect(() => formatMinorUnits(AMOUNT, 5)).toThrow(/0–4/)
    expect(() => formatMinorUnits(AMOUNT, -1)).toThrow(/0–4/)
  })

  it('★ 指标卡与表格用的是同一条换算 —— 三种币种各走一遍完整链路', () => {
    const cases = [
      { currency: 'JPY', exponent: 0, expected: 'JPY 38,204', wrong: 'JPY 382.04' },
      { currency: 'KWD', exponent: 3, expected: 'KWD 38.204', wrong: 'KWD 382.04' },
      { currency: 'CNY', exponent: 2, expected: 'CNY 382.04', wrong: 'CNY 38,204' },
    ]
    let asserted = 0
    for (const c of cases) {
      const props = toUsageProps({
        records: [record(priced(AMOUNT, c.currency, c.exponent))],
        dimension: 'model',
        tenant: '全部租户',
        seriesLimit: 6,
        barDensity: 'regular',
        requestId: 'req_test',
      })
      asserted += 1
      expect(props.summary.cost.value, `${c.currency} 的指标卡算错了`).toBe(c.expected)
      expect(props.summary.cost.value).not.toBe(c.wrong)
      expect(props.currency).toBe(c.currency)
    }
    expect(asserted, '一个币种都没走到 —— 本条空跑了').toBe(cases.length)
  })
})

describe('验收① 三种情况分得开,没有一种退化成 0', () => {
  it('★ 算不出来 → 合计不成立,显示 —— 而不是「已算出来的那部分」', () => {
    const rollup = rollupCost([
      { kind: 'priced', amountMinor: 500, currency: 'CNY', currencyExponent: 2 },
      { kind: 'unpriced' },
    ])
    expect(rollup.unpriced).toBe(1)
    // 🚨 判据:**不是** '5.00'。给一个只算了一部分的数是最糟的选项 ——
    //    它看起来是全部,而少了几行谁也不知道。
    expect(formatCost(rollup)).toBe('—')
    expect(formatCost(rollup)).not.toBe('5.00')
  })

  it('★ 不计费 → 显示一个词,不是 0.00', () => {
    const rollup = rollupCost([{ kind: 'unbilled' }, { kind: 'unbilled' }])
    expect(formatCost(rollup)).toBe('不计费')
    expect(formatCost(rollup)).not.toBe('0.00')
    expect(formatCost(rollup)).not.toBe('0')
  })

  it('★ 「算不出来」与「不计费」显示成不同的东西 —— 它们曾经都是 ¥0.00', () => {
    const unpriced = formatCost(rollupCost([{ kind: 'unpriced' }]))
    const unbilled = formatCost(rollupCost([{ kind: 'unbilled' }]))
    expect(unpriced).not.toBe(unbilled)
  })

  it('★ 附注说清为什么算不出来 —— 一个光秃秃的「—」会被读成「系统没算」', () => {
    const props = toUsageProps({
      records: [record(UNPRICED), record(priced(500, 'CNY', 2), { model: 'other' })],
      dimension: 'model',
      tenant: '全部租户',
      seriesLimit: 6,
      barDensity: 'regular',
      requestId: 'req_test',
    })
    expect(props.summary.cost.value).toBe('—')
    expect(props.summary.cost.note).toMatch(/没配价/)
  })

  it('★ 全部不计费时表头不拼一个 (—) 出来', () => {
    const props = toUsageProps({
      records: [record(UNBILLED)],
      dimension: 'model',
      tenant: '全部租户',
      seriesLimit: 6,
      barDensity: 'regular',
      requestId: 'req_test',
    })
    // 没有金额也就没有币种 —— null 让屏幕显示「成本」而不是「成本 (—)」。
    expect(props.currency).toBeNull()
    expect(props.rows[0]!.cost).toBe('不计费')
  })

  it('★ 混币仍然抛 —— 这次改动没有把那条纪律弄丢', () => {
    expect(() =>
      rollupCost([
        { kind: 'priced', amountMinor: 1, currency: 'CNY', currencyExponent: 2 },
        { kind: 'priced', amountMinor: 1, currency: 'USD', currencyExponent: 2 },
      ]),
    ).toThrow(/两种货币|2 种货币/)
  })

  it('★ 同币种两个指数也抛 —— 两段数据不在同一个刻度上', () => {
    // 它意味着服务端中途改过 currencyExponent。相加得到的数没有意义,
    // 而它与正常的数长得一模一样。
    expect(() =>
      rollupCost([
        { kind: 'priced', amountMinor: 1, currency: 'JPY', currencyExponent: 0 },
        { kind: 'priced', amountMinor: 1, currency: 'JPY', currencyExponent: 2 },
      ]),
    ).toThrow(/指数/)
  })
})

describe('概览页的「预估账单」走同一套判据', () => {
  it('★ JPY 的合计不按 ÷100 算', () => {
    const metric = toEstimatedBill([record(priced(AMOUNT, 'JPY', 0))])
    expect(metric.value).toBe('JPY 38,204')
    expect(metric.value).not.toBe('JPY 382.04')
  })

  it('★ KWD 的合计不按 ÷100 算', () => {
    const metric = toEstimatedBill([record(priced(AMOUNT, 'KWD', 3))])
    expect(metric.value).toBe('KWD 38.204')
    expect(metric.value).not.toBe('KWD 382.04')
  })

  it('★ 有算不出来的行 → 合计不成立,并说出有几格', () => {
    const metric = toEstimatedBill([record(priced(500, 'CNY', 2)), record(UNPRICED)])
    expect(metric.value).toBe('—')
    expect(metric.note).toMatch(/没配价/)
  })

  it('★ 全部不计费 → 说「全部不计费」,而不是给一个 0 元账单', () => {
    const metric = toEstimatedBill([record(UNBILLED)])
    expect(metric.note).toBe('全部不计费')
  })

  it('不计费的行不影响已算出来的合计 —— 它的贡献是**真的**零', () => {
    const metric = toEstimatedBill([record(priced(500, 'CNY', 2)), record(UNBILLED)])
    expect(metric.value).toBe('CNY 5.00')
  })
})
