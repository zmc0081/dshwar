/**
 * 白牌契约的测试 —— 只测**有判断的那部分**。
 *
 * 纯类型声明不需要测试(`typecheck:test` 已经照到);这里测的是
 * 两处真的会算错的地方:
 *
 * 1. `logoFor` 的三级回落 —— 尤其**最后一级**
 * 2. `NEUTRAL_BRANDING` 不含任何客户品牌
 *
 * ⚠️ 本文件**不进** `conformance.test.ts` 的领域模型一致性断言:
 * 品牌是**纯管理端概念**,运行时平面没有对应的领域模型 ——
 * 没有可投影的源,那条断言无从谈起。这一点写在这里,免得下一个人
 * 以为是漏加了。
 */
import { describe, expect, it } from 'vitest'
import { logoFor, NEUTRAL_BRANDING, type AssetRef, type TenantBranding } from '../src/branding.ts'

const light: AssetRef = { id: 'a-light', path: '/assets/a-light.svg' }
const dark: AssetRef = { id: 'a-dark', path: '/assets/a-dark.svg' }

function branding(over: Partial<TenantBranding> = {}): TenantBranding {
  return { ...NEUTRAL_BRANDING, productName: 'Acme Copilot', ...over }
}

describe('logoFor · 三级回落', () => {
  it('深色主题优先用深色标志', () => {
    expect(logoFor(branding({ logoLight: light, logoDark: dark }), 'dark')).toBe(dark)
  })

  it('没有深色标志时回落到浅色 —— 而不是不显示', () => {
    expect(logoFor(branding({ logoLight: light }), 'dark')).toBe(light)
  })

  it('浅色主题不会误用深色标志', () => {
    expect(logoFor(branding({ logoLight: light, logoDark: dark }), 'light')).toBe(light)
  })

  it('★ 两个都没传 → null(调用方渲染产品名的文字 wordmark)', () => {
    // 最后一级是关键:**不能回落到 DSHWAR 的标志**。
    // 一个只填了产品名的租户,界面上不该出现我们的标志。
    for (const theme of ['light', 'dark'] as const) {
      expect(logoFor(branding(), theme), theme).toBeNull()
    }
  })

  it('只有深色标志时,浅色主题也返回 null —— 不硬塞一个对比度不对的图', () => {
    // 深色标志画在浅色背景上通常读不了。返回 null 让调用方走文字 wordmark,
    // 比显示一个看不清的标志好。
    expect(logoFor(branding({ logoDark: dark }), 'light')).toBeNull()
  })
})

describe('NEUTRAL_BRANDING · 未配置时的受支持形态', () => {
  it('★ 除产品名与主色外,其余一律为 null —— 不预置任何客户品牌', () => {
    const { productName, primaryColor, ...rest } = NEUTRAL_BRANDING
    expect(productName).toBe('DSHWAR')
    expect(primaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/)

    // 逐个数,而不是笼统断言 —— 将来加字段时若忘了给中性默认值,
    // 这条会红并指出是哪个字段。
    let asserted = 0
    for (const [key, value] of Object.entries(rest)) {
      asserted += 1
      expect(value, `${key} 在中性外观里应当是 null`).toBeNull()
    }
    expect(asserted, '一个字段都没断言到 —— 本条空跑了').toBeGreaterThan(0)
  })

  it('signInHandle 预留但未启用 —— V0.7.x 之前恒为 null', () => {
    expect(NEUTRAL_BRANDING.signInHandle).toBeNull()
  })
})
