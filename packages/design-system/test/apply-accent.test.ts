/**
 * 运行期主题的写入与清除 —— 四条断言。
 *
 * ## 它们守的是「未配置」这个状态
 *
 * V0.8.0 把 `primaryColor` 从「哨兵默认色」改成 `string | null`,让**未配置**与
 * **配置成某个颜色**在类型层可分。而那次改动能被一行代码完全抵消:
 * 只要 `applyAccent` 在种子为空时随手派生一个兜底色,类型上仍然分开、
 * 渲染上又合并了,**并且没有任何东西会变红** —— 因为没有人在看 DOM 上写了什么。
 *
 * 这四条就是那个「人」:
 *
 * | 断言 | 绑住什么 | 它坏了会怎样 |
 * | --- | --- | --- |
 * | ① 写入的键集恰好是 ACCENT_PROPERTIES | 写与清的清单同源 | 重置之后残留一两个变量,只表现为「某个描边还带着上一个品牌的颜色」 |
 * | ② null / 空串:一个属性都不写,并且清干净 | 未配置 ≠ 配置成某个值 | 客户看到一个自己没选过的颜色 |
 * | ③ 亮暗两个主题派生出不同的值 | `theme` 参数真的被用上 | 暗主题下文字 2 点几比一,看起来只是「淡了一点」 |
 * | ④ 反向对照:正常种子确实写了属性 | ② 不是空跑 | 一个「什么都不写」的实现能让 ② 全绿 |
 *
 * ## ⚠️ 为什么必须有 ④
 *
 * ② 断言的是「没写」。一个把 `applyAccent` 整个改成空函数的实现能通过它 ——
 * 而那正是「按已知缺口列清单」照不到的方向:整条链上问的都是
 * 「这个违规会不会被抓到」,没有一条问「合法的那一半还在不在」。
 */
import { describe, expect, it } from 'vitest'
import {
  ACCENT_PROPERTIES,
  applyAccent,
  clearAccent,
  type AccentTarget,
} from '../src/accent/apply.ts'
import { derive } from '../src/accent/derive.ts'

/** 记账用的假 element —— 只记,不真的改任何东西。 */
interface Recorder {
  readonly el: AccentTarget
  /** 按调用顺序记下的写入,含重复:「写了几次」与「写了什么」都要能看。 */
  readonly writes: [string, string][]
  readonly removed: string[]
  readonly attrs: [string, string][]
  readonly removedAttrs: string[]
}

function recorder(): Recorder {
  const writes: [string, string][] = []
  const removed: string[] = []
  const attrs: [string, string][] = []
  const removedAttrs: string[] = []
  return {
    el: {
      style: {
        setProperty: (name, value) => {
          writes.push([name, value])
        },
        removeProperty: (name) => {
          removed.push(name)
        },
      },
      setAttribute: (name, value) => {
        attrs.push([name, value])
      },
      removeAttribute: (name) => {
        removedAttrs.push(name)
      },
    },
    writes,
    removed,
    attrs,
    removedAttrs,
  }
}

const names = (r: Recorder): string[] => r.writes.map(([name]) => name)

/** 带外(VERBATIM)与带内(RE-LIT)各一个 —— 两条派生路径写的属性必须一样多。 */
const VERBATIM_SEED = '#1D5BD4'
const RELIT_SEED = '#2F6FEB'

describe('① 配了主色 —— 写进去的就是 ACCENT_PROPERTIES 那一组', () => {
  it('★ 写入的属性名与 ACCENT_PROPERTIES 逐条相等(两条派生路径 × 两个主题)', () => {
    let asserted = 0
    for (const seed of [VERBATIM_SEED, RELIT_SEED]) {
      for (const theme of ['light', 'dark'] as const) {
        const r = recorder()
        const d = applyAccent(seed, r.el, theme)
        expect(d, `${seed} 配了色,应当有派生结果`).not.toBeNull()
        asserted += 1
        // 顺序也比:清单同源意味着两边逐条对齐,而不只是集合相等。
        expect(names(r), `${seed} / ${theme} 写入的属性名`).toEqual([...ACCENT_PROPERTIES])
        expect(r.attrs, 'data-brand 是 accent.css 那条规则的钩子').toEqual([
          ['data-brand', 'configured'],
        ])
        expect(r.removed, '配了色不该顺手清掉什么').toEqual([])
      }
    }
    // 出口计数:一个遍历零次的循环与没有断言等价,而它显示为「通过」。
    expect(asserted, '一次都没写到 —— 本条空跑了').toBe(4)
  })

  it('清单的构成:1 个 --seed + 10 档 ramp + 8 个角色令牌 + --link-underline', () => {
    // ⚠️ ramp 那一段**从 derive() 的真实输出现取**,不抄一份档名。
    //    抄一份就等于给自己留了「ramp 加一档而 clearAccent 清不掉它」的洞。
    const ramp = derive(VERBATIM_SEED, 4.5, 'light').ramp.map((step) => `--a-${step.step}`)
    expect(ACCENT_PROPERTIES.filter((n) => n.startsWith('--a-'))).toEqual(ramp)
    expect(ACCENT_PROPERTIES).toHaveLength(1 + ramp.length + 8 + 1)
    expect(new Set(ACCENT_PROPERTIES).size, '清单里有重复项').toBe(ACCENT_PROPERTIES.length)
  })

  it('写下去的值就是 derive() 的输出 —— 不是另算一遍', () => {
    const r = recorder()
    applyAccent(VERBATIM_SEED, r.el, 'light')
    const d = derive(VERBATIM_SEED, 4.5, 'light')
    const wrote = new Map(r.writes)

    let asserted = 0
    const pairs: readonly (readonly [string, string])[] = [
      ['--seed', d.seed],
      ['--accent-solid', d.solid],
      ['--accent-on', d.on],
      ['--accent-hover', d.hover],
      ['--accent-active', d.active],
      ['--accent-text', d.text],
      ['--accent-text-strong', d.strong],
      ['--accent-border', d.border],
      ['--accent-surface', d.surface],
      ...d.ramp.map((step) => [`--a-${step.step}`, step.hex] as const),
    ]
    for (const [name, want] of pairs) {
      asserted += 1
      expect(wrote.get(name), `${name} 写下去的值与 derive() 不符`).toBe(want)
    }
    expect(asserted, '一个值都没比到 —— 本条空跑了').toBe(9 + d.ramp.length)
    expect(wrote.get('--link-underline'), '配了色的链接靠颜色区分,下划线退回 hover 态').toBe('none')
  })
})

describe('② 未配置 —— 一个属性都不写,并且清干净', () => {
  it('★ null 与空串都不派生、不写、把那一组属性与 data-brand 一并清掉', () => {
    let asserted = 0
    for (const seed of [null, ''] as const) {
      const label = seed === null ? 'null(未配置)' : '空串(配置错误)'
      const r = recorder()
      const d = applyAccent(seed, r.el, 'light')
      asserted += 1
      expect(d, `${label} 不该有派生结果`).toBeNull()
      expect(
        r.writes,
        `${label} 时写了属性 —— 那等于给客户配了一个他没选过的颜色,\n` +
          '而 V0.8.0 把 primaryColor 改成 string | null 正是为了让这两种状态分开。',
      ).toEqual([])
      expect(r.attrs, `${label} 不该挂 data-brand`).toEqual([])
      expect(r.removed, `${label} 要把之前写过的清干净`).toEqual([...ACCENT_PROPERTIES])
      expect(r.removedAttrs).toEqual(['data-brand'])
    }
    expect(asserted, '本条空跑了').toBe(2)
  })

  it('先写后清 —— clearAccent 清掉的正是 applyAccent 写过的每一条,不多不少', () => {
    const r = recorder()
    applyAccent(RELIT_SEED, r.el, 'dark')
    const written = names(r)
    clearAccent(r.el)

    expect(written.length, '一条都没写 —— 那这条对照什么也没证明').toBeGreaterThan(0)
    // 两个方向都要:少清 = 残留上一个品牌的颜色;多清 = 两份清单已经分家(只是方向反了)。
    expect(new Set(r.removed), 'clearAccent 与 applyAccent 的清单不一致').toEqual(new Set(written))
    expect(r.removedAttrs).toEqual(['data-brand'])
  })
})

describe('③ 暗主题与亮主题派生出不同的值', () => {
  it('★ 同一个种子,两个主题写出的值必须不同 —— 少了这条,「theme 被忽略」也全绿', () => {
    const light = recorder()
    const dark = recorder()
    applyAccent(VERBATIM_SEED, light.el, 'light')
    applyAccent(VERBATIM_SEED, dark.el, 'dark')
    const lm = new Map(light.writes)
    const dm = new Map(dark.writes)

    let compared = 0
    let differing = 0
    for (const name of ACCENT_PROPERTIES) {
      compared += 1
      if (lm.get(name) !== dm.get(name)) differing += 1
    }
    expect(compared, '一个属性都没比到 —— 本条空跑了').toBe(ACCENT_PROPERTIES.length)
    expect(differing, '两个主题写出了完全一样的值 —— theme 参数没被用上').toBeGreaterThan(0)

    // 具体钉一条:暗主题的正文强调色要落在暗画布上,与亮主题不可能同值。
    expect(dm.get('--accent-text')).not.toBe(lm.get('--accent-text'))
    expect(dm.get('--accent-text')).toBe(derive(VERBATIM_SEED, 4.5, 'dark').text)
    expect(lm.get('--accent-text')).toBe(derive(VERBATIM_SEED, 4.5, 'light').text)
    // --seed 是种子原值,两个主题下当然相同 —— 差异不该来自它。
    expect(dm.get('--seed')).toBe(lm.get('--seed'))
  })
})

describe('④ 反向对照 —— 正常种子必须真的写属性', () => {
  it('★ 一个「什么都不写」的实现能让 ② 全绿,这条不许它绿', () => {
    const r = recorder()
    const d = applyAccent(VERBATIM_SEED, r.el, 'light')
    expect(d, '配了主色却没有派生结果').not.toBeNull()
    expect(r.writes.length, '配了主色却一个属性都没写').toBe(ACCENT_PROPERTIES.length)
    expect(r.removedAttrs, '配了主色不该走清除那条路').toEqual([])
    expect(new Map(r.writes).get('--accent-solid')).toBe(derive(VERBATIM_SEED, 4.5, 'light').solid)
  })
})
