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
import {
  logoFor,
  NEUTRAL_BRANDING,
  SUGGESTED_PRIMARY_COLOR,
  type AssetRef,
  type TenantBranding,
} from '../src/branding.ts'

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
  it('★ 除产品名外,其余**一律**为 null —— 含主色', () => {
    // ⚠️ V0.8.0 起 primaryColor 也在这一组里。
    // 它此前是 `#2F6FEB`,一个**哨兵默认值** —— 于是「用户没配」与
    // 「用户就想要这个蓝」在类型层无法区分。改成 null 之后,
    // 中性外观里非 null 的字段**只剩产品名**一个。
    const { productName, ...rest } = NEUTRAL_BRANDING
    expect(productName).toBe('DSHWAR')

    // 逐个数,而不是笼统断言 —— 将来加字段时若忘了给中性默认值,
    // 这条会红并指出是哪个字段。
    let asserted = 0
    for (const [key, value] of Object.entries(rest)) {
      asserted += 1
      expect(value, `${key} 在中性外观里应当是 null`).toBeNull()
    }
    expect(asserted, '一个字段都没断言到 —— 本条空跑了').toBeGreaterThan(0)
  })

  it('★ primaryColor 是 null —— 未配置,不是某个默认色', () => {
    // 单列一条,因为它是 V0.8.0 回写的那一处,值得一条指名道姓的断言:
    // 有人「顺手」给它加回一个默认色时,这条会红。
    expect(
      NEUTRAL_BRANDING.primaryColor,
      '中性外观里出现了默认主色 —— 那会让「未配置」重新变得不可见',
    ).toBeNull()
  })

  it('signInHandle 预留但未启用 —— V0.7.x 之前恒为 null', () => {
    expect(NEUTRAL_BRANDING.signInHandle).toBeNull()
  })
})

/**
 * 建议主色必须**落在重打光带之外**。
 *
 * ## 它守的不是「当前这个值对不对」
 *
 * 守的是**将来有人改这个值又改回带内**。旧默认色 `#2F6FEB` 就是那样 ——
 * L 0.573 落在中亮带 `(0.55, 0.80)` 内,于是契约一边要求「带内要阻塞确认」,
 * 一边把一个带内的值设成默认,**那条确认流程在默认路径上永远走不到**。
 *
 * ## 为什么 L 的计算写在测试里,而不是从契约导出
 *
 * 「色阶不进契约」这条不变。本文件需要的不是派生器,只是**一个数**:
 * 建议色的 L。把 OKLab 转换写在这里,契约的对外面不因为一条守卫而变宽。
 */
describe('SUGGESTED_PRIMARY_COLOR · 派生策略必须是 VERBATIM', () => {
  /** 中亮带 —— 落在其中的实心填充会被重打光(RE-LIT)。 */
  const RELIT_BAND = { lo: 0.55, hi: 0.8 } as const

  const srgbToLinear = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

  /** sRGB hex → OKLab 的 L。公式取自 OKLab 定义。 */
  function oklabLightness(hex: string): number {
    const h = hex.replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as [
      number,
      number,
      number,
    ]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  }

  it('★ 建议色的 L 落在中亮带之外 → 策略是 VERBATIM,不触发重打光', () => {
    const L = oklabLightness(SUGGESTED_PRIMARY_COLOR)
    expect(
      L <= RELIT_BAND.lo || L >= RELIT_BAND.hi,
      `建议主色 ${SUGGESTED_PRIMARY_COLOR} 的 L=${L.toFixed(4)} 落在中亮带 ` +
        `(${RELIT_BAND.lo}, ${RELIT_BAND.hi}) 内 —— 它会触发 RE-LIT,` +
        `而那正是契约要求「阻塞确认」的分支。一个建议值不该把管理员直接推进那条路。`,
    ).toBe(true)
  })

  it('L 的实测值与文档记录的 0.509 一致(文档不许与代码分家)', () => {
    expect(oklabLightness(SUGGESTED_PRIMARY_COLOR)).toBeCloseTo(0.509, 3)
  })

  it('★ 对照:旧默认色 #2F6FEB **确实**落在带内 —— 换掉它不是无的放矢', () => {
    // 少了这一条,上面那条就可能是「无论什么颜色都在带外」的空断言。
    // 它同时是那次回写的证据:旧值真的命中了契约自己禁止的分支。
    const L = oklabLightness('#2F6FEB')
    expect(L).toBeGreaterThan(RELIT_BAND.lo)
    expect(L).toBeLessThan(RELIT_BAND.hi)
  })

  it('建议色是合法的 6 位 hex', () => {
    expect(SUGGESTED_PRIMARY_COLOR).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('★ 建议色**不是** NEUTRAL_BRANDING 的值 —— 建议与默认是两回事', () => {
    expect(
      NEUTRAL_BRANDING.primaryColor,
      '建议色被塞回中性外观了 —— 那样「未配置」又变得不可见',
    ).not.toBe(SUGGESTED_PRIMARY_COLOR)
  })
})
