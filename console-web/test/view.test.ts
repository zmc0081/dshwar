/**
 * 转换层的断言 —— Session 3 的两条验收各占一半。
 *
 * ## 为什么测这一层
 *
 * 与 `workbench-web/test` 同一表态:本仓刻意不引 jsdom + testing-library。
 * 于是「界面对不对」被拆成
 * 「**数据变成什么样**」(这里,纯函数可断言)与
 * 「**长什么样**」(实测台在真实浏览器里看)。
 *
 * 而这一版的两条验收恰好都落在数据那一半:
 *
 * | 验收 | 判据 |
 * | --- | --- |
 * | ① 容量读数与开户闸门同一个来源 | 只有一个构造点,且认不出的档位**抛**而不是回落 |
 * | ② `primaryColor: null` 走中性令牌 | 转换层**原样传递** null,一处兜底都没有 |
 */
import { describe, expect, it } from 'vitest'
import { NEUTRAL_BRANDING, SUGGESTED_PRIMARY_COLOR } from '@dshwar/console-contract'
import type { TenantBranding } from '@dshwar/console-contract'
import { toCapacityReading, toIsolation } from '../src/view/capacity.ts'
import { toBranding, toDraft } from '../src/view/branding.ts'

const CAPACITY = {
  isolationLevel: 'process',
  maxProcesses: 12,
  memberCap: 12,
  memberCount: 3,
  rssPerProcessMb: 63,
  basis: '2560 MB / 63 MB',
} as const

describe('验收① D2:容量读数与开户闸门同一个来源', () => {
  it('★ 服务端给什么就是什么 —— 五个数一个不改、一个不补', () => {
    const reading = toCapacityReading(CAPACITY)
    expect(reading.memberCap).toBe(12)
    expect(reading.memberCount).toBe(3)
    expect(reading.maxProcesses).toBe(12)
    expect(reading.rssPerProcessMb).toBe(63)
    expect(reading.basis).toBe('2560 MB / 63 MB')
    // ⚠️ 39 是 kit 里那两份独立默认值的值。它**一次都不该出现** ——
    //   出现就说明某处又兜了底。
    expect(JSON.stringify(reading)).not.toContain('39')
  })

  it('★ 逻辑档下 maxProcesses 是 null —— null 不是 0', () => {
    // 服务端在逻辑档下给 null:「这一档不按进程算」。
    // 兜成 0 会让界面说「一个进程都起不来」。
    const reading = toCapacityReading({
      ...CAPACITY,
      isolationLevel: 'logical',
      maxProcesses: null,
    })
    expect(reading.maxProcesses).toBeNull()
    expect(reading.isolation).toBe('logical')
  })

  it('★ 认不出的隔离档**抛**,不回落 —— 回落是在猜,而猜错长得像正常', () => {
    expect(() => toIsolation('container')).toThrow(/认不出的隔离档/)
    expect(() => toIsolation('')).toThrow()
    // 反向对照:两个已知档必须放行,否则「一律抛」也能通过上面那条。
    expect(toIsolation('logical')).toBe('logical')
    expect(toIsolation('process')).toBe('process')
  })
})

describe('验收② primaryColor: null 走中性令牌而非兜底色', () => {
  it('★ null 原样传递 —— 一处兜底都没有', () => {
    const draft = toDraft(NEUTRAL_BRANDING)
    expect(draft.primaryColor, 'null 被兜成了一个颜色 —— V0.8.0 那次类型层区分被抵消了').toBeNull()
    // ⚠️ 建议色只是输入框占位,**不参与派生**。它出现在 primaryColor 上就是兜底。
    expect(draft.primaryColor).not.toBe(SUGGESTED_PRIMARY_COLOR)
    expect(draft.primaryColor).not.toBe('#2F6FEB') // V0.8.0 拆掉的那个哨兵值
  })

  it('配置了颜色时原样带过去', () => {
    const configured: TenantBranding = { ...NEUTRAL_BRANDING, primaryColor: '#1D5BD4' }
    expect(toDraft(configured).primaryColor).toBe('#1D5BD4')
  })

  it('★ 回写时空串还原成 null —— 「没填」与「填了个空的」不能在库里合并', () => {
    const draft = { ...toDraft(NEUTRAL_BRANDING), primaryColor: '', legalEntityName: '' }
    const back = toBranding(draft, NEUTRAL_BRANDING)
    expect(back.primaryColor).toBeNull()
    expect(back.legalEntityName).toBeNull()
  })

  it('往返一趟不丢信息(已配置的那条路)', () => {
    const configured: TenantBranding = {
      ...NEUTRAL_BRANDING,
      primaryColor: '#1D5BD4',
      productName: 'Acme Console',
    }
    const back = toBranding(toDraft(configured), configured)
    expect(back.primaryColor).toBe('#1D5BD4')
    expect(back.productName).toBe('Acme Console')
  })
})
