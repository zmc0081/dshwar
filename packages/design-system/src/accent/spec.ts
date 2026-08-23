/**
 * ★ **设计系统规则的可导出形态** —— 「两个副本」变回「一份事实」的那一份。
 *
 * ## 为什么现在做,而不是等「第二次不一致」
 *
 * `design-system-sync.md` 原本的判据是「同一处不一致出现**第二次**时,
 * 才把设计侧的规则变成可导出数据」。**那条判据本身是失效的**:
 *
 * 它的前提是「不一致会被人发现」。而同一份文档自己列的三项
 * (带边界改了 / 角色令牌增删 / 对比度下限改了)明写着**目前无人看着** ——
 * 不一致出现第一次时不会有人知道,于是「等第二次」这个条件**永远不会被满足**。
 *
 * ⇒ 一条永远等不到触发条件的判据,与没有判据等价。V0.9.0 提前做掉。
 *
 * ## 这份数据是什么
 *
 * 设计系统那三项规则的**机器可读副本**,由 `test/accent.test.ts` 逐条断言:
 *
 * | 规则 | 这里的字段 | 谁断言 |
 * | --- | --- | --- |
 * | 中亮带边界 | {@link MID_BAND}(从 `derive.ts` 再导出) | 断言 ③:带内 RE-LIT / 带外 VERBATIM |
 * | 角色令牌清单 | {@link ROLE_TOKENS} | 断言 ②:逐字节比对设计卡记录值 |
 * | 对比度下限 | {@link CONTRACT_FLOORS} / {@link ROLE_TOKENS} 的 `min` | 断言 ①:任意种子都达标 |
 *
 * **改设计系统的这三项而不改这里,测试会红。** 这就是它存在的全部意义。
 *
 * @module @dshwar/design-system/accent/spec
 */
import { MID_BAND } from './derive.ts'

export { MID_BAND }

/**
 * 六个受对比度约束的角色令牌。
 *
 * ⚠️ **是六个,不是八个。** `derive()` 返回八个键,其中 `hover` / `active`
 * 是**交互档**(实心档 L ∓ 0.05 / 0.10),不受独立的对比度下限约束 ——
 * 它们的可读性由 `accent.on` 那一条保证。数错这个数会让断言 ② 少验两项
 * 或多验两项,两种都不对。
 *
 * `key` 是 `derive()` 结果里的字段名;`role` 是设计卡与契约里的名字。
 */
export const ROLE_TOKENS = [
  { key: 'solid', role: 'accent.solid', min: 4.5, against: 'on' },
  { key: 'on', role: 'accent.on', min: 4.5, against: 'solid' },
  { key: 'text', role: 'accent.text', min: 4.5, against: 'canvas' },
  { key: 'strong', role: 'accent.text.strong', min: 7, against: 'canvas' },
  { key: 'border', role: 'accent.border', min: 3, against: 'canvas' },
  { key: 'surface', role: 'accent.surface', min: 7, against: 'ink' },
] as const satisfies readonly {
  key: 'solid' | 'on' | 'text' | 'strong' | 'border' | 'surface'
  role: string
  min: number
  against: 'canvas' | 'ink' | 'solid' | 'on'
}[]

/**
 * 契约在**写入时**校验的三项下限。
 *
 * ⚠️ 这是 {@link ROLE_TOKENS} 的**子集,不是它的全部** ——
 * `branding-variables.md` 明写「校验的是派生结果的三项下限」。
 *
 * 为什么只校三项:另外三项由构造保证,校了也不会红。
 * `accent.on` 是**挑**出来的(白/墨中取对比更高者),所以 solid/on 那一对
 * 恒达标;`accent.text.strong` 取 ramp 800,比 `accent.text` 的 ramp 700 更深,
 * text 达标它必达标。**剩下的三项才是会真的失败的那三项。**
 */
export const CONTRACT_FLOORS = [
  { role: 'accent.text', min: 4.5 },
  { role: 'accent.border', min: 3.0 },
  { role: 'accent.surface', min: 7.0 },
] as const

/** 亮主题的画布与墨色。断言 ① 要拿它们算对比度。 */
export const LIGHT = { canvas: '#FFFFFF', ink: '#1C2029' } as const
/** 暗主题同上(R5:替换画布与墨色,k 表不动)。 */
export const DARK = { canvas: '#0C0F17', ink: '#F4F6F9' } as const

/**
 * 设计卡 `guidelines/colors-accent-roles.html` 记录的演示种子与它的六个令牌。
 *
 * ⚠️ **这是「另一个副本」的原文快照** —— 断言 ② 拿它逐字节比对。
 * 设计侧改了派生算法或改了这张卡而没同步这里,断言就会红。
 *
 * 种子是 `#3A5CCC`(设计侧的演示值),与仓库的
 * `SUGGESTED_PRIMARY_COLOR = '#1D5BD4'` **不是同一个** ——
 * 两者都只是演示值,中性态(`primaryColor: null`)双方一致,不构成分歧。
 */
export const DESIGN_CARD_SNAPSHOT = {
  seed: '#3A5CCC',
  theme: 'light',
  strategy: 'VERBATIM',
  tokens: {
    'accent.solid': { hex: '#3A5CCC', ratio: 5.86 },
    'accent.on': { hex: '#FFFFFF', ratio: 5.86 },
    'accent.text': { hex: '#3A5CCC', ratio: 5.86 },
    'accent.text.strong': { hex: '#2844A3', ratio: 8.59 },
    'accent.border': { hex: '#638AFA', ratio: 3.21 },
    'accent.surface': { hex: '#E3EBFF', ratio: 13.66 },
  },
} as const

/**
 * 断言 ① 用的**固定**种子表 —— 刻意不随机。
 *
 * ## 为什么不随机
 *
 * 随机种子会让失败**不可复现**:CI 红一次,本地跑十次都绿,
 * 而那条红到底测到了什么没人说得清。一条不可复现的红,
 * 与一条恒绿的检查一样没用 —— 后者从不报警,前者报了也没人能跟进。
 *
 * ## 覆盖的形态,逐条说明为什么在表里
 *
 * `L` 与 `expect` 全部是**实测值**,不是按直觉填的 ——
 * 填表时我把 `#FF0000` 猜成带外、`#00FF00` 猜成带内,两个都反了。
 * 纯红 L 0.628 在带内,纯绿 L 0.866 在带外。**这种表必须量,不能猜。**
 *
 * | 种子 | L | 形态 | 它能抓到什么 |
 * | --- | --- | --- | --- |
 * | `#1D5BD4` | 0.509 | 带外 · 仓库建议色 | 基线:VERBATIM 路径 |
 * | `#3A5CCC` | 0.515 | 带外 · 设计演示色 | 与设计卡比对的那一个 |
 * | `#2F6FEB` | 0.573 | **带内** · V0.8.0 换掉的旧默认 | RE-LIT 路径 —— 真实发生过的那个值 |
 * | `#7FBF3F` | 0.736 | **带内** · 偏亮的绿 | RE-LIT 往**亮**边吸附(另一半分支) |
 * | `#050505` | 0.115 | 极暗 · 近黑 | ramp 全在暗端;`pick()` 的外推分支 |
 * | `#FAFAFA` | 0.985 | 极亮 · 近白 | 亮端对称 |
 * | `#808080` | 0.600 | 无彩(C = 0)· **带内** | `C0 = max(s.C, 0.012)` 那条兜底 |
 * | `#FF0000` | 0.628 | 撞 gamut 边界 · 纯红 · **带内** | 14 次二分钳制的真实触发点 |
 * | `#00FF00` | 0.866 | 撞 gamut 边界 · 纯绿 · 带外 | 钳制 + 明度都在极端 |
 *
 * ⚠️ 表里**必须有带内也有带外** —— 全是带外的话,一个「永远 VERBATIM」的
 * 实现照样全绿。断言 ③ 就是为这条而加的。当前 4 带内 / 5 带外。
 */
export const SEED_MATRIX = [
  { seed: '#1D5BD4', form: '带外 · 仓库建议色', expect: 'VERBATIM' },
  { seed: '#3A5CCC', form: '带外 · 设计演示色', expect: 'VERBATIM' },
  { seed: '#2F6FEB', form: '带内 · V0.8.0 换掉的旧默认', expect: 'RE-LIT' },
  { seed: '#7FBF3F', form: '带内 · 偏亮的绿', expect: 'RE-LIT' },
  { seed: '#050505', form: '极暗 · 近黑', expect: 'VERBATIM' },
  { seed: '#FAFAFA', form: '极亮 · 近白', expect: 'VERBATIM' },
  { seed: '#808080', form: '无彩 · C = 0 · 带内', expect: 'RE-LIT' },
  { seed: '#FF0000', form: '撞 gamut 边界 · 纯红 · 带内', expect: 'RE-LIT' },
  { seed: '#00FF00', form: '撞 gamut 边界 · 纯绿 · 带外', expect: 'VERBATIM' },
] as const
