/**
 * 主色派生 —— 三条断言。
 *
 * ## 它们绑的是「同一份契约的两个副本」
 *
 * 设计系统与 `@dshwar/console-contract` 是同一个决定的两个落点,
 * 而 `design-system-sync.md` 明写:三项规则(带边界 / 角色令牌 / 对比度下限)
 * **目前无人看着**。这三条断言就是那个「人」。
 *
 * | 断言 | 绑住什么 | 它坏了会怎样 |
 * | --- | --- | --- |
 * | ① 九个种子都满足契约三条下界 | 对比度下限 | 租户配了色,按钮上的字读不了 |
 * | ② 演示种子的六个令牌逐字节等于设计卡 | 角色令牌清单 + 派生实现 | 设计稿与产品长得不一样 |
 * | ③ 带内必 RE-LIT、带外必 VERBATIM | 中亮带边界 | 见下 |
 *
 * ## ⚠️ 为什么必须有 ③
 *
 * ①② 两条用的种子**都是带外的**(`#1D5BD4` L 0.509、`#3A5CCC` L 0.515)——
 * 一个「永远原样返回、从不重打光」的实现能通过它们两条。
 *
 * 这与 `SUGGESTED_PRIMARY_COLOR` 那条负向验证同源:V0.8.0 的旧默认色
 * `#2F6FEB` 落在带内,于是「带内要阻塞确认」那条流程**在默认路径上永远走不到**,
 * 等于半条死代码。③ 把两个分支都钉住。
 */
import { describe, expect, it } from 'vitest'
import { contrast, derive, MID_BAND, toOklch } from '../src/accent/derive.ts'
import {
  CONTRACT_FLOORS,
  DESIGN_CARD_SNAPSHOT,
  LIGHT,
  ROLE_TOKENS,
  SEED_MATRIX,
} from '../src/accent/spec.ts'

/** 按 `against` 取该角色令牌配对的另一侧。 */
function pairFor(result: ReturnType<typeof derive>, against: string): string {
  if (against === 'canvas') return LIGHT.canvas
  if (against === 'ink') return LIGHT.ink
  if (against === 'solid') return result.solid
  return result.on
}

describe('① 契约的三条下界 —— 固定种子表,不随机', () => {
  it('★ 九个种子的派生结果全部满足 accent.text / border / surface 的下界', () => {
    // 随机种子会让失败不可复现:CI 红一次、本地十次都绿,而那条红测到了什么
    // 没人说得清。一条不可复现的红,与一条恒绿的检查一样没用。
    let asserted = 0
    const failures: string[] = []

    for (const { seed, form } of SEED_MATRIX) {
      const d = derive(seed, 4.5, 'light')
      for (const floor of CONTRACT_FLOORS) {
        const token = ROLE_TOKENS.find((t) => t.role === floor.role)
        expect(token, `${floor.role} 不在 ROLE_TOKENS 里 —— 两份清单已经分家`).toBeDefined()
        if (token === undefined) continue
        const hex = d[token.key]
        const ratio = contrast(hex, pairFor(d, token.against))
        asserted += 1
        // 容差 0.005:比的是四舍五入到两位之后的数,与规范卡上印的一致。
        if (ratio < floor.min - 0.005) {
          failures.push(`${seed}(${form})的 ${floor.role} = ${ratio.toFixed(2)} < ${floor.min}`)
        }
      }
    }

    // 出口计数:一个遍历零次的循环与没有断言等价,而它显示为「通过」。
    expect(asserted, '一条下界都没验到 —— 本条空跑了').toBe(
      SEED_MATRIX.length * CONTRACT_FLOORS.length,
    )
    expect(
      failures,
      '派生结果没达到契约写入时校验的下界 —— 这种种子契约会拒绝保存,\n' +
        '若它出现在这张表里,要么算法退化了,要么这个种子本来就不该进表。',
    ).toEqual([])
  })

  it('契约只校三项,而角色令牌有六个 —— 三项是它的子集,不是全部', () => {
    // 另外三项由构造保证:accent.on 是挑出来的(白/墨取对比更高者),
    // accent.text.strong 取 ramp 800 比 text 的 700 更深。剩下三项才会真的失败。
    const roles = new Set(ROLE_TOKENS.map((t) => t.role))
    expect(ROLE_TOKENS).toHaveLength(6)
    for (const f of CONTRACT_FLOORS) expect(roles.has(f.role)).toBe(true)
    expect(CONTRACT_FLOORS).toHaveLength(3)
  })
})

describe('② 与设计卡逐字节比对', () => {
  it('★ 演示种子的六个角色令牌,与 colors-accent-roles.html 记录值完全一致', () => {
    const d = derive(DESIGN_CARD_SNAPSHOT.seed, 4.5, 'light')
    expect(d.strategy).toBe(DESIGN_CARD_SNAPSHOT.strategy)

    let asserted = 0
    for (const token of ROLE_TOKENS) {
      const snap =
        DESIGN_CARD_SNAPSHOT.tokens[token.role as keyof typeof DESIGN_CARD_SNAPSHOT.tokens]
      expect(snap, `设计卡快照里没有 ${token.role} —— 两份清单已经分家`).toBeDefined()
      asserted += 1
      expect(
        d[token.key],
        `${token.role} 与设计卡记录值不一致 —— 设计侧改了算法或改了卡,而这里没跟`,
      ).toBe(snap.hex)
      expect(
        contrast(d[token.key], pairFor(d, token.against)),
        `${token.role} 的对比度`,
      ).toBeCloseTo(snap.ratio, 1)
    }
    expect(asserted, '一个令牌都没比到 —— 本条空跑了').toBe(6)
  })
})

describe('③ 中亮带的两个分支都要走到', () => {
  it('★ 带内必 RE-LIT、带外必 VERBATIM —— 少了这条,「永远 VERBATIM」也全绿', () => {
    let inBandSeen = 0
    let outBandSeen = 0
    const wrong: string[] = []

    for (const { seed, form, expect: want } of SEED_MATRIX) {
      const { L } = toOklch(seed)
      const inBand = L > MID_BAND[0] && L < MID_BAND[1]
      if (inBand) inBandSeen += 1
      else outBandSeen += 1

      const got = derive(seed, 4.5, 'light').strategy
      const should = inBand ? 'RE-LIT' : 'VERBATIM'
      if (got !== should) {
        wrong.push(`${seed}(${form})L=${L.toFixed(3)} ${inBand ? '带内' : '带外'} → 得到 ${got}`)
      }
      // 表里写死的期望值也要与实测一致 —— 否则表本身会腐烂成一份过期快照。
      expect(got, `${seed} 的 SEED_MATRIX.expect 与实测不符`).toBe(want)
    }

    // ★ 两个分支都必须**真的被走到**。只验「结论对」不够:
    //   一张全是带外种子的表,同样能让每一条断言通过。
    expect(inBandSeen, '表里一个带内种子都没有 —— RE-LIT 分支从未被走到').toBeGreaterThan(0)
    expect(outBandSeen, '表里一个带外种子都没有 —— VERBATIM 分支从未被走到').toBeGreaterThan(0)
    expect(wrong, '中亮带的判定与实际派生策略不符').toEqual([])
  })
})
