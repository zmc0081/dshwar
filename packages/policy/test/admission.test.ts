/**
 * 配额两段判定 —— 准入(建会话)与精确判定(发起轮次)。
 *
 * 重点不在「拒不拒」,而在**准入不阻塞、不引入新故障域**:
 * 它同步返回、读快照,计量挂掉时照样放行。
 */
import { InMemoryMeteringStore, type MeteringStore, type RawUsage } from '@dshwar/metering'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryQuotaStore, PolicyService } from '../src/index.ts'

const raw = (over: Partial<RawUsage> = {}): RawUsage => ({
  subjectId: 'alice',
  tenantId: 'acme',
  sessionId: 's-1',
  turn: 1,
  step: 1,
  provider: 'deepseek',
  model: 'deepseek-chat',
  usage: { inputTokens: 100, outputTokens: 100 },
  unreported: false,
  at: new Date().toISOString(),
  ...over,
})

async function make(
  options: {
    limit?: number | null
    used?: number
    metering?: MeteringStore
    admissionTtlMs?: number
  } = {},
) {
  const quotas = new InMemoryQuotaStore()
  if (options.limit !== undefined) await quotas.setLimit('alice', options.limit)

  const metering = options.metering ?? new InMemoryMeteringStore()
  for (let i = 0; i < (options.used ?? 0); i += 1) {
    await metering.record(raw({ turn: i + 1 }))
  }

  const errors: string[] = []
  const policy = new PolicyService({
    quotas,
    metering,
    tenantOf: async (id) => (id === 'alice' ? 'acme' : undefined),
    onMeteringUnavailable: (d) => errors.push(d),
    ...(options.admissionTtlMs === undefined ? {} : { admissionTtlMs: options.admissionTtlMs }),
  })
  return { policy, quotas, metering, errors }
}

describe('准入判定 admit()', () => {
  it('★ 同步返回 —— 不是 Promise', async () => {
    const { policy } = await make({ limit: 100 })
    const decision = policy.admit('alice')

    // 这一条是本方法存在的理由。若它变成异步,建会话就等于等一次 metering 查询,
    // 而那把计量组件放进了会话创建的故障域。
    expect(decision).not.toBeInstanceOf(Promise)
    expect(decision.kind).toBe('allow')
  })

  it('第一次调用没有快照 → 放行(fail open)', async () => {
    const { policy } = await make({ limit: 100, used: 10 })
    // 首次建会话必然没有快照。这时拒绝等于「新用户一律先被拒一次」。
    expect(policy.admit('alice').kind).toBe('allow')
  })

  it('精确判定跑过之后,快照被喂热', async () => {
    const { policy } = await make({ limit: 100, used: 10 })
    await policy.check('alice') // used = 10 * 200 = 2000 ≥ 100

    const snapshot = policy.admissionSnapshot('alice')
    expect(snapshot?.exhausted).toBe(true)
    expect(policy.admit('alice')).toEqual({ kind: 'deny', reason: 'quota_exhausted' })
  })

  it('未超限时快照为未耗尽,准入放行', async () => {
    const { policy } = await make({ limit: 1_000_000, used: 1 })
    await policy.check('alice')

    expect(policy.admissionSnapshot('alice')?.exhausted).toBe(false)
    expect(policy.admit('alice').kind).toBe('allow')
  })

  it('不限额的主体,快照记为未耗尽', async () => {
    const { policy } = await make({ limit: null, used: 100 })
    await policy.check('alice')
    expect(policy.admissionSnapshot('alice')?.exhausted).toBe(false)
    expect(policy.admit('alice').kind).toBe('allow')
  })

  it('快照过期后不再据它拒绝', async () => {
    vi.useFakeTimers()
    try {
      const { policy } = await make({ limit: 100, used: 10, admissionTtlMs: 1000 })
      await policy.check('alice')
      expect(policy.admit('alice').kind).toBe('deny')

      vi.advanceTimersByTime(1001)
      // 过期的快照不再作数 —— 宁可放行也不据一个陈旧的结论拒人
      expect(policy.admit('alice').kind).toBe('allow')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('准入不引入新的故障域', () => {
  it('★ metering 挂掉时,准入照样放行(与本包 fail open 一致)', async () => {
    const broken: MeteringStore = {
      record: async () => {
        throw new Error('metering down')
      },
      query: async () => {
        throw new Error('metering down')
      },
    }
    const { policy, errors } = await make({ limit: 100, metering: broken })

    expect(policy.admit('alice').kind).toBe('allow')
    await policy.check('alice') // 触发 fail open 路径
    expect(policy.admit('alice').kind).toBe('allow')
    expect(errors.length).toBeGreaterThan(0)
  })

  it('metering 抖动不会把「已耗尽」的结论洗掉', async () => {
    // 先用正常 metering 判出耗尽
    const metering = new InMemoryMeteringStore()
    for (let i = 0; i < 10; i += 1) await metering.record(raw({ turn: i + 1 }))

    const quotas = new InMemoryQuotaStore()
    await quotas.setLimit('alice', 100)

    let failing = false
    const flaky: MeteringStore = {
      record: (r) => metering.record(r),
      query: async (f) => {
        if (failing) throw new Error('metering down')
        return metering.query(f)
      },
    }

    const policy = new PolicyService({
      quotas,
      metering: flaky,
      tenantOf: async () => 'acme',
      onMeteringUnavailable: () => undefined,
    })

    await policy.check('alice')
    expect(policy.admissionSnapshot('alice')?.exhausted).toBe(true)

    // 一次抖动 —— 读不到用量时**不更新快照**,否则一次网络抖动就能让
    // 已经烧完的主体重新被放行
    failing = true
    await policy.check('alice')
    expect(policy.admissionSnapshot('alice')?.exhausted).toBe(true)
  })

  it('并发建会话只触发一次后台刷新,不打穿 metering', async () => {
    let queries = 0
    const counting: MeteringStore = {
      record: async () => undefined,
      query: async () => {
        queries += 1
        await new Promise((r) => setTimeout(r, 10))
        return []
      },
    }
    const { policy } = await make({ limit: 100, metering: counting })

    // 20 次并发准入 —— 都没有快照,都会想去刷
    for (let i = 0; i < 20; i += 1) policy.admit('alice')
    await new Promise((r) => setTimeout(r, 50))

    expect(queries, `触发了 ${queries} 次查询 —— 并发去重失效`).toBeLessThanOrEqual(1)
  })
})

describe('两段判定的分工', () => {
  it('准入放行 ≠ 精确判定放行 —— 后者才是计费口径', async () => {
    const { policy } = await make({ limit: 100, used: 10 })

    // 没有快照 → 准入放行(建会话可以)
    expect(policy.admit('alice').kind).toBe('allow')
    // 但真要发一轮,精确判定说不行
    const decision = await policy.check('alice')
    expect(decision.kind).toBe('deny')
  })

  it('精确判定仍然现算,不读快照', async () => {
    const { policy, metering } = await make({ limit: 1_000_000, used: 1 })
    await policy.check('alice')
    expect(policy.admissionSnapshot('alice')?.exhausted).toBe(false)

    // 把用量灌到超限 —— 精确判定必须立刻反映,不能被快照挡住
    for (let i = 0; i < 10_000; i += 1) await metering.record(raw({ turn: i + 100 }))
    const after = await policy.check('alice')
    expect(after.kind).toBe('deny')
  }, 30_000)
})
