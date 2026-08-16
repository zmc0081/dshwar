/**
 * **开户闸门(V0.5.0,D2)** —— 隔离档的约束表达在「建成员」那一步。
 *
 * ## 三个方向都要断言,少一个都不算数
 *
 * | 方向 | 为什么必须有 |
 * | --- | --- |
 * | 逻辑档建**第二个**成员 → 拒 | 这是闸门存在的理由 |
 * | 逻辑档建**第一个**成员 → 放行 | 少了它,一条「一律拒绝」的闸门也能通过上一条 —— 而那会让单用户部署根本用不了 |
 * | 进程档建第二个成员 → 放行 | 少了它,闸门可能拦的是「多用户」而不是「逻辑档的多用户」 |
 *
 * 第二条最容易漏,而漏掉的后果最严重:**产品对单用户不可用**,
 * 却因为「拒绝」看起来像是闸门在正常工作而不会被当成 bug。
 */
import { InMemorySubjectStore, type SubjectStore } from '@dshwar/subject'
import { describe, expect, it } from 'vitest'
import {
  guardMemberCapacity,
  MemberCapacityError,
  memberCapacityOf,
} from '../src/member-capacity.ts'

const GB = 1024 * 1024 * 1024

function guarded(level: 'logical' | 'process', configuredMax?: number): SubjectStore {
  return guardMemberCapacity(new InMemorySubjectStore(), () =>
    memberCapacityOf({
      level,
      totalMemoryBytes: 8 * GB,
      ...(configuredMax === undefined ? {} : { configuredMax }),
    }),
  )
}

const member = (externalId: string, extra: Record<string, unknown> = {}) => ({
  source: 'okta',
  externalId,
  userName: externalId,
  tenantId: 'acme',
  ...extra,
})

describe('开户闸门:逻辑档', () => {
  it('★ 建第一个成员 —— 放行(单用户部署必须能用)', async () => {
    const store = guarded('logical')
    const first = await store.upsert(member('alice'))
    expect(first.userName).toBe('alice')
  })

  it('★ 建第二个成员 —— 拒绝', async () => {
    const store = guarded('logical')
    await store.upsert(member('alice'))
    await expect(store.upsert(member('bob'))).rejects.toBeInstanceOf(MemberCapacityError)
  })

  it('★ 错误信息含三要素:出路 · 代价 · 不吓退单用户', async () => {
    const store = guarded('logical')
    await store.upsert(member('alice'))

    const error = await store.upsert(member('bob')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MemberCapacityError)
    const text = (error as Error).message

    // 出路 —— 光说「不行」而不说怎么办,等于把人赶走
    expect(text, '没给出路').toContain('"process"')
    // 代价 —— 让人在改之前就知道要付什么,而不是改完发现内存不够
    expect(text, '没写明代价').toMatch(/63 MB/)
    // ★ 不吓退单用户 —— 这一条最容易漏
    expect(text, '没告诉单用户「这条与你无关」').toContain('只有你一个人用')
    // 顺带:要说清原因不是「隔离强度不够」,那个误解会让人以为可以靠信任绕过
    expect(text).toContain('根本没有分隔')
  })

  it('更新已有成员不被拦 —— 否则超限的部署连停用成员都做不到', async () => {
    // 这是脱困路径:管理员发现超限,想停用几个人。若 upsert 一律被拦,
    // 他就被锁死了 —— 而停用恰恰是唯一不需要加内存的解法。
    const store = guarded('logical')
    await store.upsert(member('alice'))
    const renamed = await store.upsert(member('alice', { displayName: 'Alice A.' }))
    expect(renamed.displayName).toBe('Alice A.')
  })

  it('推一个一上来就停用的成员不占名额 —— 供给系统同步历史用户是合法的', async () => {
    const store = guarded('logical')
    await store.upsert(member('alice'))
    const inactive = await store.upsert(member('bob', { active: false }))
    expect(inactive.active).toBe(false)
  })

  it('停用之后腾出名额 —— 判据是「会不会真的起一个进程」', async () => {
    const store = guarded('logical')
    const alice = await store.upsert(member('alice'))
    await expect(store.upsert(member('bob'))).rejects.toBeInstanceOf(MemberCapacityError)

    await store.deactivate(alice.id)
    const bob = await store.upsert(member('bob'))
    expect(bob.userName).toBe('bob')
  })
})

describe('开户闸门:进程档', () => {
  it('★ 建第二个成员 —— 放行(闸门拦的是逻辑档的多用户,不是多用户本身)', async () => {
    const store = guarded('process')
    await store.upsert(member('alice'))
    const bob = await store.upsert(member('bob'))
    expect(bob.userName).toBe('bob')
  })

  it('超过 maxProcesses 时才拒,错误信息指向加内存而不是改档', async () => {
    const store = guarded('process', 2)
    await store.upsert(member('alice'))
    await store.upsert(member('bob'))

    const error = await store.upsert(member('carol')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MemberCapacityError)
    const text = (error as Error).message
    expect(text).toContain('maxProcesses')
    expect(text).toContain('加内存')
    // 进程档已经是对的档位了,不该再劝人改档
    expect(text).not.toContain('"process"')
  })
})

describe('容量推导:与 supervisor 同一个来源', () => {
  it('★ 进程档的 memberCap 等于 deriveMaxProcesses 的结果,不是另算一遍', async () => {
    const { deriveMaxProcesses } = await import('@dshwar/supervisor')
    const cap = memberCapacityOf({ level: 'process', totalMemoryBytes: 4 * GB })
    // 控制台显示 64、实际拦在 39 —— 那种不一致里,管理员会相信界面上那个数
    expect(cap.memberCap).toBe(deriveMaxProcesses(4 * GB).value)
    expect(cap.maxProcesses).toBe(deriveMaxProcesses(4 * GB).value)
  })

  it('逻辑档的 maxProcesses 是 null 而不是 0 —— 它不起子进程,这个数没有意义', () => {
    const cap = memberCapacityOf({ level: 'logical', totalMemoryBytes: 8 * GB })
    expect(cap.maxProcesses).toBeNull()
    expect(cap.memberCap).toBe(1)
    expect(cap.basis).toContain('架构限制')
  })

  it('显式配置覆盖推导,并在 basis 里说明推导会得到什么', () => {
    const cap = memberCapacityOf({ level: 'process', totalMemoryBytes: 8 * GB, configuredMax: 5 })
    expect(cap.memberCap).toBe(5)
    expect(cap.basis).toContain('显式配置')
    expect(cap.basis).toContain('按内存推导会得到')
  })
})
