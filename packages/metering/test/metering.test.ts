/**
 * 计量。核心是三件事:口径只有一处、会计恒等式成立、观测永不阻断。
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateDaily,
  billedInputTokens,
  InMemoryMeteringStore,
  KvMeteringStore,
  safeRecord,
  totalBilledTokens,
  USAGE_TABLE,
  type KvUnitLike,
  type MeteringStore,
  type PriceTable,
  type RawUsage,
} from '../src/index.ts'

const raw = (over: Partial<RawUsage> = {}): RawUsage => ({
  subjectId: 'alice',
  tenantId: 'acme',
  sessionId: 's-1',
  turn: 1,
  step: 0,
  provider: 'deepseek',
  model: 'deepseek-chat',
  usage: { inputTokens: 100, outputTokens: 10 },
  unreported: false,
  at: '2026-08-16T10:00:00.000Z',
  ...over,
})

const prices: PriceTable = {
  currency: 'CNY',
  // 每百万 token:输入 200 分(2 元),输出 800 分(8 元)
  prices: { 'deepseek/deepseek-chat': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 } },
}

function fakeUnit(): KvUnitLike {
  const tables: Record<string, Record<string, unknown>> = { [USAGE_TABLE]: {} }
  return {
    loadAll: async () => JSON.parse(JSON.stringify({ tables, global: null })) as never,
    putRecord: async (table, key, value) => {
      ;(tables[table] ??= {})[key] = value
    },
  }
}

describe('计费口径 —— DISJOINT 加法只在一处(REPORT-V4 §4)', () => {
  it('billedInput = input + cacheRead + cacheWrite', () => {
    expect(
      billedInputTokens({
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 30,
        cacheWriteTokens: 5,
      }),
    ).toBe(135)
  })

  it('缓存字段缺席时不为 NaN', () => {
    expect(billedInputTokens({ inputTokens: 100, outputTokens: 0 })).toBe(100)
  })

  it('聚合走同一口径 —— 直接用 inputTokens 会少计费,这条测试就是防它', () => {
    const rows = aggregateDaily(
      [raw({ usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 } })],
      prices,
    )
    expect(rows[0]!.inputTokens).toBe(150)
  })
})

describe('按日聚合', () => {
  it('同日同主体同模型合并,跨日分行', () => {
    const rows = aggregateDaily(
      [raw(), raw({ turn: 2 }), raw({ at: '2026-08-17T09:00:00.000Z' })],
      prices,
    )
    expect(rows).toHaveLength(2)
    // 日期降序:最近的先看到
    expect(rows[0]!.date).toBe('2026-08-17')
    expect(rows[1]!).toMatchObject({ date: '2026-08-16', inputTokens: 200, outputTokens: 20 })
  })

  it('成本按整数分计算,舍入只发生一次', () => {
    // 200 万 token 输入 × 200 分/百万 = 400 分;10 万输出 × 800 分/百万 = 80 分
    const rows = aggregateDaily(
      [raw({ usage: { inputTokens: 2_000_000, outputTokens: 100_000 } })],
      prices,
    )
    expect(rows[0]!.costMinorUnits).toBe(480)
    expect(rows[0]!.currency).toBe('CNY')
  })

  it('查不到价的模型成本计 0 —— 是"没配价"不是"免费",README 有加粗警告', () => {
    const rows = aggregateDaily([raw({ model: 'unknown-model' })], prices)
    expect(rows[0]!.costMinorUnits).toBe(0)
  })

  it('会计恒等式:聚合行的 token 总和 = 明细逐条相加', () => {
    const records = [
      raw(),
      raw({ turn: 2, usage: { inputTokens: 33, outputTokens: 7, cacheReadTokens: 11 } }),
      raw({ subjectId: 'bob', usage: { inputTokens: 55, outputTokens: 5 } }),
      raw({ at: '2026-08-17T00:00:01.000Z', usage: { inputTokens: 20, outputTokens: 2 } }),
    ]
    const rows = aggregateDaily(records, prices)

    const fromRows = rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)
    const fromRecords = totalBilledTokens(records)
    expect(fromRows).toBe(fromRecords)
  })

  it('unreported 的记录计 0,不污染总量', () => {
    const records = [
      raw(),
      raw({ turn: 2, unreported: true, usage: { inputTokens: 0, outputTokens: 0 } }),
    ]
    expect(totalBilledTokens(records)).toBe(110)
  })
})

for (const [label, make] of [
  ['InMemoryMeteringStore', () => new InMemoryMeteringStore()],
  ['KvMeteringStore', () => new KvMeteringStore(fakeUnit())],
] as const) {
  describe(`${label}`, () => {
    it('record 后 query 可见,按租户强制过滤', async () => {
      const store: MeteringStore = make()
      await store.record(raw())
      await store.record(raw({ tenantId: 'globex', subjectId: 'mallory' }))

      const acme = await store.query({ tenantId: 'acme' })
      expect(acme).toHaveLength(1)
      expect(acme[0]!.subjectId).toBe('alice')
    })

    it('按 subjectId 细分过滤', async () => {
      const store = make()
      await store.record(raw())
      await store.record(raw({ subjectId: 'bob' }))
      expect(await store.query({ tenantId: 'acme', subjectId: 'bob' })).toHaveLength(1)
    })

    it('同一毫秒的多条记录不互相覆盖', async () => {
      const store = make()
      await store.record(raw())
      await store.record(raw({ step: 1 }))
      expect(await store.query({ tenantId: 'acme' })).toHaveLength(2)
    })

    it('★ query 按 at 升序 —— 接口写死的保证,两个实现各验一次', async () => {
      // ⚠️ 这条补于 V0.8.0。此前 `InMemoryMeteringStore.query` 只 filter 不 sort,
      // 而接口注释从 V0.4.0 起就写着「按 at 升序」——
      // **同一个接口的两个实现,在一条写死的保证上行为不同,且没人盯着。**
      //
      // 它一直没咬人只因为唯一的生产接线取 `at` 后同步 push(push 序恰好=时间序),
      // 而三个消费方都与顺序无关。但注释在**邀请**下一个消费方直接取首尾条当边界。
      //
      // 「一个接口有几个实现,那条保证就要被验几次」—— 与 V0.8.0
      // 「SDK 三种语言各验一次」是同一条纪律,所以这条放在参数化循环里。
      const store = make()
      // 故意乱序写入:中 → 早 → 晚。不排序时会原样吐回写入顺序。
      await store.record(raw({ turn: 2, at: '2026-08-16T10:00:02.000Z' }))
      await store.record(raw({ turn: 1, at: '2026-08-16T10:00:01.000Z' }))
      await store.record(raw({ turn: 3, at: '2026-08-16T10:00:03.000Z' }))

      const got = await store.query({ tenantId: 'acme' })
      expect(got.map((r) => r.at)).toEqual([
        '2026-08-16T10:00:01.000Z',
        '2026-08-16T10:00:02.000Z',
        '2026-08-16T10:00:03.000Z',
      ])
    })

    it('★ 同 at 的多条保持写入顺序 —— 排序必须是稳定的', async () => {
      // 注释承诺了两件事(升序 + 同 at 保持写入序),所以要验两条。
      // 只验升序的话,一个用不稳定比较的实现照样能通过上一条。
      const store = make()
      await store.record(raw({ step: 0 }))
      await store.record(raw({ step: 1 }))
      await store.record(raw({ step: 2 }))

      const got = await store.query({ tenantId: 'acme' })
      expect(got.map((r) => r.step)).toEqual([0, 1, 2])
    })
  })
}

describe('safeRecord —— 红线 1:观测不阻断', () => {
  it('store 抛错时不向上抛,错误进回调', async () => {
    const exploding: MeteringStore = {
      record: async () => {
        throw new Error('disk full')
      },
      query: async () => [],
    }
    const errors: string[] = []

    await expect(safeRecord(exploding, raw(), (d) => errors.push(d))).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/disk full/)
  })

  it('连失败回调都炸了也不向上抛 —— 会话绝不能受影响', async () => {
    const exploding: MeteringStore = {
      record: async () => {
        throw new Error('x')
      },
      query: async () => [],
    }
    await expect(
      safeRecord(exploding, raw(), () => {
        throw new Error('回调也炸了')
      }),
    ).resolves.toBeUndefined()
  })
})
