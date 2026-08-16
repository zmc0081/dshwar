/**
 * 模型裁决。顺序是准入 → 降级,且降级目标也要过准入。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOWNGRADE_THRESHOLD,
  InMemoryPolicyStore,
  ModelRouter,
  type ModelPolicy,
} from '../src/index.ts'

const policy = (over: Partial<ModelPolicy> = {}): ModelPolicy => ({
  id: 'p-1',
  tenantId: 'acme',
  allowedModels: ['deepseek/deepseek-chat', 'deepseek/deepseek-lite'],
  fallbackModel: 'deepseek/deepseek-lite',
  updatedAt: '2026-08-16T00:00:00.000Z',
  ...over,
})

const router = (p?: ModelPolicy) =>
  new ModelRouter({ policies: new InMemoryPolicyStore(p === undefined ? [] : [p]) })

describe('准入是 opt-in 的治理', () => {
  it('没配策略的租户原样放行', async () => {
    const decision = await router().resolve({
      tenantId: 'acme',
      requested: 'anything/expensive',
    })
    expect(decision).toEqual({ kind: 'allow', model: 'anything/expensive', downgraded: false })
  })

  it('空清单 = 全部允许(契约语义)', async () => {
    const decision = await router(policy({ allowedModels: [] })).resolve({
      tenantId: 'acme',
      requested: 'any/model',
    })
    expect(decision.kind).toBe('allow')
  })

  it('清单外的模型拒绝 —— 403 而不是静默换', async () => {
    const decision = await router(policy()).resolve({
      tenantId: 'acme',
      requested: 'openai/o3-pro',
    })
    expect(decision).toEqual({ kind: 'deny', reason: 'model_not_allowed' })
  })

  it('清单内放行', async () => {
    const decision = await router(policy()).resolve({
      tenantId: 'acme',
      requested: 'deepseek/deepseek-chat',
    })
    expect(decision).toMatchObject({ kind: 'allow', model: 'deepseek/deepseek-chat' })
  })
})

describe('预算降级是显式配置', () => {
  it('预算到阈值且配了 fallback → 降级,且结果可见', async () => {
    const decision = await router(policy()).resolve({
      tenantId: 'acme',
      requested: 'deepseek/deepseek-chat',
      budgetUsedRatio: 0.85,
    })
    expect(decision).toEqual({
      kind: 'allow',
      model: 'deepseek/deepseek-lite',
      downgraded: true,
    })
  })

  it('没配 fallback → 超阈值也不降级(不静默换,超限走 policy 的 429)', async () => {
    const decision = await router(policy({ fallbackModel: null })).resolve({
      tenantId: 'acme',
      requested: 'deepseek/deepseek-chat',
      budgetUsedRatio: 0.99,
    })
    expect(decision).toMatchObject({
      kind: 'allow',
      model: 'deepseek/deepseek-chat',
      downgraded: false,
    })
  })

  it('阈值以下不降级', async () => {
    const decision = await router(policy()).resolve({
      tenantId: 'acme',
      requested: 'deepseek/deepseek-chat',
      budgetUsedRatio: DEFAULT_DOWNGRADE_THRESHOLD - 0.01,
    })
    expect(decision).toMatchObject({ downgraded: false })
  })

  it('预算水位未知(无上限/读不到)不降级 —— 降级的依据必须是真数', async () => {
    const decision = await router(policy()).resolve({
      tenantId: 'acme',
      requested: 'deepseek/deepseek-chat',
    })
    expect(decision).toMatchObject({ downgraded: false })
  })

  it('已经在用降级目标就不再"降"—— 响应头不该永远挂着 downgraded', async () => {
    const decision = await router(policy()).resolve({
      tenantId: 'acme',
      requested: 'deepseek/deepseek-lite',
      budgetUsedRatio: 0.95,
    })
    expect(decision).toMatchObject({ model: 'deepseek/deepseek-lite', downgraded: false })
  })

  it('降级目标配成清单外 → 拒绝,而不是放行一个清单外的模型', async () => {
    const decision = await router(policy({ fallbackModel: 'free/tier-model' })).resolve({
      tenantId: 'acme',
      requested: 'deepseek/deepseek-chat',
      budgetUsedRatio: 0.9,
    })
    expect(decision).toEqual({ kind: 'deny', reason: 'model_not_allowed' })
  })

  it('先准入后降级:清单外的请求即使预算充足也是拒绝', async () => {
    const decision = await router(policy()).resolve({
      tenantId: 'acme',
      requested: 'openai/o3-pro',
      budgetUsedRatio: 0.1,
    })
    expect(decision.kind).toBe('deny')
  })
})
