/**
 * 配额判定。重点:fail open 的边界、周期滚动、以及「不限」的三种写法。
 */
import { InMemoryMeteringStore, type MeteringStore, type RawUsage } from '@dshwar/metering'
import { describe, expect, it } from 'vitest'
import {
  checkWorkspaceCount,
  checkWorkspaceSize,
  InMemoryQuotaStore,
  InMemoryWorkspaceQuotaStore,
  monthlyPeriod,
  PolicyService,
  type WorkspaceLimits,
} from '../src/index.ts'

const raw = (over: Partial<RawUsage> = {}): RawUsage => ({
  subjectId: 'alice',
  tenantId: 'acme',
  sessionId: 's-1',
  turn: 1,
  step: 0,
  provider: 'deepseek',
  model: 'deepseek-chat',
  usage: { inputTokens: 60, outputTokens: 40 },
  unreported: false,
  at: '2026-08-16T10:00:00.000Z',
  ...over,
})

const NOW = new Date('2026-08-16T12:00:00.000Z')

function makeService(over: {
  metering?: MeteringStore
  used?: RawUsage[]
  limit?: number | null
  onUnavailable?: (d: string) => void
}): { service: PolicyService; quotas: InMemoryQuotaStore } {
  const metering = over.metering ?? new InMemoryMeteringStore()
  const quotas = new InMemoryQuotaStore()

  if (over.used !== undefined && over.metering === undefined) {
    for (const r of over.used) void (metering as InMemoryMeteringStore).record(r)
  }
  if (over.limit !== undefined) void quotas.setLimit('alice', over.limit)

  return {
    quotas,
    service: new PolicyService({
      quotas,
      metering,
      tenantOf: async (id) => (id === 'alice' || id === 'bob' ? 'acme' : undefined),
      onMeteringUnavailable: over.onUnavailable ?? (() => undefined),
      now: () => NOW,
    }),
  }
}

describe('基本判定', () => {
  it('用量低于上限 → 放行,quota 带实时数字', async () => {
    const { service } = makeService({ used: [raw()], limit: 1000 })
    const decision = await service.check('alice')

    expect(decision.kind).toBe('allow')
    expect(decision.quota).toMatchObject({ tokenLimit: 1000, tokenUsed: 100 })
  })

  it('烧到上限 → 拒绝,原因是 quota_exhausted', async () => {
    const { service } = makeService({
      used: [raw({ usage: { inputTokens: 600, outputTokens: 400 } })],
      limit: 1000,
    })
    const decision = await service.check('alice')

    expect(decision).toMatchObject({ kind: 'deny', reason: 'quota_exhausted' })
  })

  it('超限之后再判仍然拒绝 —— 不存在「刚好超一点放一次」', async () => {
    const { service } = makeService({
      used: [raw({ usage: { inputTokens: 2000, outputTokens: 0 } })],
      limit: 1000,
    })
    expect((await service.check('alice')).kind).toBe('deny')
  })

  it('deny 只有 quota_exhausted 一种 —— 本包不做「换模型继续」的裁决(红线 3)', async () => {
    const { service } = makeService({
      used: [raw({ usage: { inputTokens: 9999, outputTokens: 0 } })],
      limit: 1,
    })
    const decision = await service.check('alice')
    if (decision.kind === 'deny') {
      const reason: 'quota_exhausted' = decision.reason
      expect(reason).toBe('quota_exhausted')
    } else {
      expect.unreachable('应当拒绝')
    }
  })
})

describe('「不限」的三种写法', () => {
  it('从未设置过上限 → 不限', async () => {
    const { service } = makeService({ used: [raw()] })
    expect((await service.check('alice')).kind).toBe('allow')
  })

  it('显式 null → 不限', async () => {
    const { service } = makeService({ used: [raw()], limit: null })
    expect((await service.check('alice')).kind).toBe('allow')
  })

  it('不限时连 metering 都不读 —— metering 挂了也不影响不限流的主体', async () => {
    const exploding: MeteringStore = {
      record: async () => undefined,
      query: async () => {
        throw new Error('metering down')
      },
    }
    const { service } = makeService({ metering: exploding })
    expect((await service.check('alice')).kind).toBe('allow')
  })
})

describe('周期滚动', () => {
  it('上个周期的用量不计入本周期', async () => {
    const { service } = makeService({
      used: [
        raw({ at: '2026-07-31T23:59:00.000Z', usage: { inputTokens: 999_999, outputTokens: 0 } }),
        raw({ at: '2026-08-16T10:00:00.000Z' }),
      ],
      limit: 1000,
    })
    const decision = await service.check('alice')
    expect(decision.kind).toBe('allow')
    expect(decision.quota.tokenUsed).toBe(100)
  })

  it('周期边界是 UTC 自然月', () => {
    const { start, end } = monthlyPeriod.current(new Date('2026-08-16T12:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('fail open —— 计量挂了不该把所有人锁在外面', () => {
  it('设了上限但 metering 读不到 → 放行 + 回调可见', async () => {
    const exploding: MeteringStore = {
      record: async () => undefined,
      query: async () => {
        throw new Error('metering down')
      },
    }
    const unavailable: string[] = []
    const { service, quotas } = makeService({
      metering: exploding,
      onUnavailable: (d) => unavailable.push(d),
    })
    await quotas.setLimit('alice', 1000)

    const decision = await service.check('alice')
    expect(decision.kind).toBe('allow')
    expect(unavailable).toHaveLength(1)
    expect(unavailable[0]).toMatch(/放行/)
  })

  it('租户未知同样走 fail open(账目组件的故障不升级成服务中断)', async () => {
    const unavailable: string[] = []
    const { service, quotas } = makeService({ onUnavailable: (d) => unavailable.push(d) })
    await quotas.setLimit('nobody', 100)
    // tenantOf('nobody') → undefined
    const nobodyService = new PolicyService({
      quotas,
      metering: new InMemoryMeteringStore(),
      tenantOf: async () => undefined,
      onMeteringUnavailable: (d) => unavailable.push(d),
      now: () => NOW,
    })
    expect((await nobodyService.check('nobody')).kind).toBe('allow')
    expect(unavailable.length).toBeGreaterThan(0)
    void service
  })
})

describe('quotaOf —— 契约形状的状态查询', () => {
  it('五个字段与契约 Quota 对齐', async () => {
    const { service } = makeService({ used: [raw()], limit: 1000 })
    const quota = await service.quotaOf('alice')

    expect(Object.keys(quota!).sort()).toEqual([
      'periodEnd',
      'periodStart',
      'subjectId',
      'tokenLimit',
      'tokenUsed',
    ])
    expect(quota).toMatchObject({ tokenLimit: 1000, tokenUsed: 100 })
  })

  it('租户未知的主体返回 undefined(端点侧 → 404)', async () => {
    const { service } = makeService({})
    expect(await service.quotaOf('stranger')).toBeUndefined()
  })
})

// ============================================================================
// 工作区配额(V0.4.1 R7)
// ============================================================================
describe('工作区配额 —— 与 token 配额同一套形状', () => {
  const make = async (limits?: WorkspaceLimits) => {
    const store = new InMemoryWorkspaceQuotaStore()
    if (limits !== undefined) await store.setWorkspaceLimits('alice', limits)
    return store
  }

  it('未设置上限 → 不限', async () => {
    const store = await make()
    expect((await checkWorkspaceCount(store, 'alice', 9999)).kind).toBe('allow')
    expect((await checkWorkspaceSize(store, 'alice', 9e12)).kind).toBe('allow')
  })

  it('显式 null → 不限(与 tokenLimit: null 同义)', async () => {
    const store = await make({ maxWorkspaces: null, maxBytesPerWorkspace: null })
    expect((await checkWorkspaceCount(store, 'alice', 100)).kind).toBe('allow')
  })

  it('未达上限放行,达到即拒绝', async () => {
    const store = await make({ maxWorkspaces: 3, maxBytesPerWorkspace: null })
    expect((await checkWorkspaceCount(store, 'alice', 2)).kind).toBe('allow')
    // 已有 3 个时再建就是第 4 个 —— 用 >= 而不是 >
    expect(await checkWorkspaceCount(store, 'alice', 3)).toMatchObject({
      kind: 'deny',
      reason: 'workspace_limit_exceeded',
      limit: 3,
    })
  })

  it('容量上限同理,且 deny 带上限值供错误信息与审计使用', async () => {
    const store = await make({ maxWorkspaces: null, maxBytesPerWorkspace: 1024 })
    expect((await checkWorkspaceSize(store, 'alice', 1023)).kind).toBe('allow')
    expect(await checkWorkspaceSize(store, 'alice', 1024)).toMatchObject({
      kind: 'deny',
      reason: 'workspace_size_exceeded',
      limit: 1024,
    })
  })

  it('两条上限互不干扰', async () => {
    const store = await make({ maxWorkspaces: 1, maxBytesPerWorkspace: 1_000_000 })
    // 数量超了但容量没超
    expect((await checkWorkspaceCount(store, 'alice', 5)).kind).toBe('deny')
    expect((await checkWorkspaceSize(store, 'alice', 100)).kind).toBe('allow')
  })

  it('别的主体不受影响', async () => {
    const store = await make({ maxWorkspaces: 1, maxBytesPerWorkspace: null })
    expect((await checkWorkspaceCount(store, 'bob', 100)).kind).toBe('allow')
  })
})
