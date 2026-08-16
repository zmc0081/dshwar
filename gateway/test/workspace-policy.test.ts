/**
 * **策略预授权(V0.5.5 Session 2)**。
 *
 * ## 验收:被拒绝的动作必须进审计
 *
 * 静默拒绝不是「少一条日志」这么简单。用户看到动作没生效、没有任何解释,
 * 第一反应是**这是个 bug** —— 然后他会去想办法绕过:换个工具名、换条路径、
 * 把文件挪到别处。**静默的拒绝会主动训练用户去对抗策略。**
 *
 * 所以这里断言的不只是「返回了 deny」,而是「审计里真的多了一条,
 * 且那条记录说得出被什么规则拒了」。
 */
import { describe, expect, it } from 'vitest'
import type { AuditRecord } from '@dshwar/audit'
import { createPrincipal } from '@dshwar/principal'
import { createPolicyEnforcer } from '../src/workspaces/enforce.ts'
import {
  checkHost,
  checkWrite,
  defaultPolicy,
  InMemoryWorkspacePolicyStore,
} from '../src/workspaces/policy.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })

function setup() {
  const entries: AuditRecord[] = []
  const policies = new InMemoryWorkspacePolicyStore()
  const enforcer = createPolicyEnforcer({
    policies,
    audit: { record: (e) => entries.push(e as AuditRecord) },
  })
  return { entries, policies, enforcer }
}

describe('默认必须是最紧的', () => {
  it('★ 空数组 = 全部禁止,不是全部允许', () => {
    const policy = defaultPolicy('w1')
    expect(policy.allowedTools).toEqual([])
    expect(policy.writablePaths).toEqual([])
    expect(policy.allowedHosts).toEqual([])
    // 最危险的一个,默认必须是关的
    expect(policy.allowShell).toBe(false)
  })

  it('没配过策略的工作区拿到的是全关的默认值', async () => {
    // 「忘了配」是最常见的状态。若默认放行,一个忘了配的工作区
    // 就拥有全部权限 —— 而那不会有任何症状,直到出事。
    const { policies } = setup()
    const policy = await policies.get('never-configured')
    expect(policy.allowShell).toBe(false)
    expect(policy.allowedTools).toEqual([])
  })
})

describe('★ 路径与主机匹配必须按段对齐', () => {
  it('writablePaths: ["out"] 不放行 output-secret.txt', () => {
    // 朴素的 startsWith 会放行它 —— 那是个真实的越界:
    // 配置的人想开放 out/ 目录,结果连 output-secret.txt 也开放了。
    const policy = { ...defaultPolicy('w'), writablePaths: ['out'] }
    expect(checkWrite(policy, 'output-secret.txt').kind).toBe('deny')
    expect(checkWrite(policy, 'out/report.md').kind).toBe('allow')
    expect(checkWrite(policy, 'out').kind).toBe('allow')
  })

  it('allowedHosts: ["example.com"] 放行子域但不放行 evil-example.com', () => {
    // 朴素的 endsWith 分不清这两者,而它们是完全不同的域。
    const policy = { ...defaultPolicy('w'), allowedHosts: ['example.com'] }
    expect(checkHost(policy, 'api.example.com').kind).toBe('allow')
    expect(checkHost(policy, 'example.com').kind).toBe('allow')
    expect(checkHost(policy, 'evil-example.com').kind).toBe('deny')
    expect(checkHost(policy, 'exampleXcom').kind).toBe('deny')
  })

  it('主机匹配不区分大小写', () => {
    const policy = { ...defaultPolicy('w'), allowedHosts: ['Example.COM'] }
    expect(checkHost(policy, 'API.example.com').kind).toBe('allow')
  })
})

describe('★ 被拒绝的动作进审计', () => {
  it('拒绝工具调用 → 审计里多一条,且说得出原因', async () => {
    const { entries, enforcer } = setup()
    const decision = await enforcer.check({
      principal: alice,
      workspaceId: 'w1',
      action: { kind: 'tool', tool: 'shell.exec' },
      requestId: 'req-1',
    })

    expect(decision.kind).toBe('deny')
    expect(entries).toHaveLength(1)

    const entry = entries[0]!
    expect(entry.action).toBe('workspace.policy.denied')
    expect(entry.target).toBe('tool:shell.exec')
    // actor 是**发起动作的主体**,不是凭证 —— 审计要能回答「谁被拒了」
    expect(entry.actor).toBe(alice.id)
    expect(entry.tenantId).toBe(alice.tenantId)
    expect(entry.requestId).toBe('req-1')
    // ★ 记录自己就能解释这次拒绝,不必再去翻当时的配置版本
    expect(JSON.stringify(entry.after)).toContain('未配置任何允许的工具')
    expect(JSON.stringify(entry.before)).toContain('w1')
  })

  it('四类动作都会被记', async () => {
    const { entries, enforcer } = setup()
    for (const action of [
      { kind: 'tool', tool: 't' },
      { kind: 'write', path: 'a.txt' },
      { kind: 'network', host: 'x.com' },
      { kind: 'shell' },
    ] as const) {
      await enforcer.check({ principal: alice, workspaceId: 'w1', action, requestId: 'r' })
    }
    expect(entries).toHaveLength(4)
    expect(entries.map((e) => e.target)).toEqual(['tool:t', 'path:a.txt', 'host:x.com', 'shell'])
  })

  it('★ 放行**不**记审计 —— 每次调用都记会把审计淹掉', async () => {
    // 淹掉的审计等于没有。审计要留给异常:被拒了什么、谁拒的、什么时候。
    const { entries, policies, enforcer } = setup()
    await policies.update('w1', { allowedTools: ['fs.read'] })

    const decision = await enforcer.check({
      principal: alice,
      workspaceId: 'w1',
      action: { kind: 'tool', tool: 'fs.read' },
      requestId: 'r',
    })
    expect(decision.kind).toBe('allow')
    expect(entries).toHaveLength(0)
  })

  it('★ 判定与记录绑在一起 —— 没有「只判不记」的入口', () => {
    // 若两者分开,「被拒进审计」就依赖每个调用点都记得记 ——
    // 而这个仓库已反复证明「靠人记得」的事会被忘。
    const { enforcer } = setup()
    expect(Object.keys(enforcer)).toEqual(['check'])
  })
})

describe('策略更新', () => {
  it('部分更新只动传进来的字段', async () => {
    const { policies } = setup()
    await policies.update('w1', { allowShell: true })
    const after = await policies.update('w1', { allowedTools: ['fs.read'] })
    // allowShell 不该被这次更新重置回 false
    expect(after.allowShell).toBe(true)
    expect(after.allowedTools).toEqual(['fs.read'])
  })
})
