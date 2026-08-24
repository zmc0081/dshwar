/**
 * **线上类型与领域模型的一致性** —— 「不另起一套模型」这条要求的落实方式。
 *
 * ## 它防的是什么
 *
 * `console-contract` 声明的是**投影**,不是模型副本。投影的风险很具体:
 * 领域模型改了字段名或类型,而投影还是老样子 —— **两边都编译得过**,
 * 只有在运行时读出 `undefined` 时才发现。
 *
 * 所以这里做**类型级断言**:每个线上类型都必须能被对应的领域类型
 * **结构性地满足**。领域类型删字段、改名、改类型,这里编译不过。
 *
 * ## 断言的方向是单向的
 *
 * ✅ 领域类型 → 线上类型(领域能满足线上)
 * ❌ 不要求反过来
 *
 * 因为**少上线一些字段是正常的** —— `Subject.externalId` 是供给方的
 * 内部 id,管理端不需要看。要求双向相等等于禁止投影,那就退化成复制模型了。
 *
 * ## 为什么是运行时测试而不是纯 `.test-d.ts`
 *
 * 本仓没有接 `vitest typecheck` / `expect-typeof`,而**新接一个工具就要
 * 回答「谁验证它」**(CLAUDE.md 第六节元规则)。这里用一个更省的办法:
 * 把断言写成**真的赋值**,由 `pnpm typecheck:test` 检查 ——
 * 那条门禁已经存在、已经有守卫盯着、已经在 CI 里跑。
 *
 * ⚠️ 赋值必须真的发生(而不是只声明类型),否则 `noUnusedLocals` 会先报错,
 * 而那个红是关于「变量没用」的,不是关于「类型对不上」的 —— 会误导人。
 */
import type { AuditRecord } from '@dshwar/audit'
import { costToWire, readCost, type Cost, type DailyUsageRow } from '@dshwar/metering'
import type { QuotaState } from '@dshwar/policy'
import type { Subject } from '@dshwar/subject'
import { describe, expect, it } from 'vitest'
import type {
  ConsoleAuditEntry,
  ConsoleMember,
  ConsoleQuota,
  ConsoleUsageRow,
} from '../src/index.ts'

/**
 * 把领域对象投影成线上对象。
 *
 * ★ **这四个函数就是断言本身。** 它们的返回类型标着线上类型,入参是领域类型 ——
 * 若某个字段在领域侧改名或改类型,这里立刻编译不过。
 *
 * 顺带它们是有用的:服务端真的需要这层投影,不必再写一遍。
 */
export function memberOf(subject: Subject): ConsoleMember {
  return {
    id: subject.id,
    source: subject.source,
    userName: subject.userName,
    displayName: subject.displayName,
    active: subject.active,
    tenantId: subject.tenantId,
    // 结构性拷贝而不是直接透传:领域侧的 SubjectEmail 将来可能加字段,
    // 而线上类型不该跟着自动长出来 —— 那是**隐式**扩大契约。
    emails: subject.emails.map((e) => ({ value: e.value, primary: e.primary })),
    groups: [...subject.groups],
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  }
}

export function quotaOf(state: QuotaState): ConsoleQuota {
  return {
    subjectId: state.subjectId,
    tokenLimit: state.tokenLimit,
    tokenUsed: state.tokenUsed,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
  }
}

export function usageRowOf(row: DailyUsageRow): ConsoleUsageRow {
  return {
    subjectId: row.subjectId,
    tenantId: row.tenantId,
    date: row.date,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    // ★ 成本走 costToWire —— 领域侧是判别联合,线上是扁平形状。
    //   这一行的返回类型标着 ConsoleUsageRow,所以两个形状对不上时**编译不过**。
    cost: costToWire(row.cost),
  }
}

export function auditEntryOf(record: AuditRecord): ConsoleAuditEntry {
  return {
    id: record.id,
    at: record.at,
    actor: record.actor,
    tenantId: record.tenantId,
    action: record.action,
    target: record.target,
  }
}

describe('线上类型与领域模型一致', () => {
  it('★ 投影函数编译得过 —— 这一条本身就是断言', () => {
    // 类型层面的断言由 `pnpm typecheck:test` 完成(上面四个函数的签名)。
    // 这条运行时测试的作用是**让投影真的被执行一次**,
    // 因为「编译得过」不代表「跑起来不炸」—— 比如 emails 是 undefined。
    const member = memberOf({
      id: 'u1',
      source: 'okta',
      externalId: 'ext-1',
      userName: 'alice',
      active: true,
      tenantId: 'acme',
      emails: [{ value: 'a@acme.com', primary: true }],
      groups: ['eng'],
      displayName: 'Alice',
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    })

    expect(member.id).toBe('u1')
    // ★ 关键断言:externalId **不**在线上类型里。
    //   管理端不需要看供给方的内部 id,而契约里多一个字段就是多一个
    //   将来删不掉的东西 —— 契约只能加,不能删。
    expect(Object.keys(member)).not.toContain('externalId')
  })

  it('emails 是拷贝而不是同一个引用 —— 领域侧后续加字段不会隐式泄漏', () => {
    const emails = [{ value: 'a@acme.com', primary: true }]
    const member = memberOf({
      id: 'u1',
      source: 'okta',
      externalId: 'ext-1',
      userName: 'alice',
      active: true,
      tenantId: 'acme',
      emails,
      groups: [],
      displayName: null,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    })
    expect(member.emails).not.toBe(emails)
    expect(member.emails[0]).not.toBe(emails[0])
  })

  /**
   * ★ 成本的**往返**:领域 → 线上 → 领域,三个分支各走一次。
   *
   * 这一条盯的是本 Session 的整个理由:线上形状是扁平的(为了让
   * Kotlin / Swift 拿到类型),而扁平形状**允许**非法组合。
   * 往返相等证明两件事:投影没丢信息,读回来也没猜。
   *
   * ⚠️ 判据是「三个分支都走过」的**出口计数**,不是「循环跑完了」——
   * 三个分支里少写一个,而 `expect` 照样全绿。
   */
  it('★ 成本三个分支往返不丢信息,也不互相坍缩', () => {
    const cases: readonly Cost[] = [
      { kind: 'priced', amountMinor: 38204, currency: 'CNY', currencyExponent: 2 },
      { kind: 'unpriced' },
      { kind: 'unbilled' },
    ]
    const seen = new Set<Cost['kind']>()
    let asserted = 0
    for (const domain of cases) {
      const wire = costToWire(domain)
      expect(readCost(wire)).toEqual(domain)
      seen.add(domain.kind)
      asserted += 1
    }
    expect(asserted, '一个分支都没断言到 —— 本条空跑了').toBe(cases.length)
    expect([...seen].sort()).toEqual(['priced', 'unbilled', 'unpriced'])
  })

  it('★ 「算不出来」与「不收费」在线上仍然分得开 —— 它们曾经是同一个 0', () => {
    const unpriced = costToWire({ kind: 'unpriced' })
    const unbilled = costToWire({ kind: 'unbilled' })
    // 两者的载荷都是 null,唯一的区别是 kind —— 而那正是区别所在。
    expect(unpriced.kind).not.toBe(unbilled.kind)
    // 🚨 关键:两者都**不是** 0。把它们渲染成 0 是这个 Session 要拆掉的那句谎。
    expect(unpriced.amountMinor).toBeNull()
    expect(unbilled.amountMinor).toBeNull()
    expect(unpriced.amountMinor).not.toBe(0)
    expect(unbilled.amountMinor).not.toBe(0)
  })

  it('配额 tokenLimit 的 null 语义原样保留 —— null 是「不限」,不是 0', () => {
    const quota = quotaOf({
      subjectId: 'u1',
      tokenLimit: null,
      tokenUsed: 1234,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
    })
    // 把 null 折成 0 是个很容易犯的「顺手规范化」,而它的后果是
    // 界面显示「上限 0」—— 管理员会以为这个人一个 token 都不能用。
    expect(quota.tokenLimit).toBeNull()
    expect(quota.tokenLimit).not.toBe(0)
  })
})

describe('角色能力映射', () => {
  it('认不出的角色返回最小权限,而不是抛错或给默认值', async () => {
    const { capabilitiesOf } = await import('../src/index.ts')
    const unknown = capabilitiesOf('superadmin')
    expect(unknown).toEqual({ manageMembers: false, viewUsage: false, manageBilling: false })
  })

  it('owner 与 admin 只差 manageBilling —— 刻意不做更细的矩阵', async () => {
    const { capabilitiesOf } = await import('../src/index.ts')
    const owner = capabilitiesOf('owner')
    const admin = capabilitiesOf('admin')
    expect(owner.manageBilling).toBe(true)
    expect(admin.manageBilling).toBe(false)
    expect({ ...owner, manageBilling: false }).toEqual(admin)
  })

  it('member 看不到用量 —— 用量是租户的商业信息,不是个人信息', async () => {
    const { capabilitiesOf } = await import('../src/index.ts')
    expect(capabilitiesOf('member').viewUsage).toBe(false)
  })
})
