/**
 * 运行期主题 —— 把派生出来的令牌写进 CSS 自定义属性。
 *
 * ## 为什么是运行期,而不是按租户各构建一份
 *
 * 白牌走**运行期主题**:安装包永远中性,一个二进制服务所有租户;
 * 品牌配置由服务端下发,前端在拿到之后把派生结果打到 DOM 上。
 *
 * 反过来的做法(每个客户构建一份带色的包)每多一个客户就多一条发布线,
 * 而客户改一次主色就要重新构建、重新签名、重新分发 —— 桌面端尤其贵,
 * 因为签名是外部资源。运行期主题把「改主色」从一次发布降成一次配置写入。
 *
 * ## 它为什么在这里,而不在某一屏里
 *
 * V0.9.0 Session 1 移植设计 kit 时,这段实现落在
 * `screens/console/BrandingScreen.tsx` 内部,注释里写着「落在这里是移植的将就,
 * 不是设计决定……之后若有第二个消费方,应当提到 `accent/` 去」。
 * **第二个消费方现在有了**:三个宿主的应用外壳都要在拿到租户配置后把主题打上去。
 * 本文件是那条 TODO 的兑现,写入的属性与值一个没改。
 *
 * ## 🚨 未配置 ≠ 配置成某个颜色
 *
 * 种子为 `null` 时**不派生、不写任何属性**,并且把之前写过的清掉。
 * 这不是「少做一件事」,而是这一层唯一正确的动作:写一个兜底色会把 V0.8.0
 * 那次「哨兵默认色 → `string | null`」的类型层区分**完全抵消** ——
 * 类型上仍然分开,渲染上又合并了,而且没有任何东西会变红。
 *
 * 中性外观的权威值在 `styles/accent.css` 的 `:root` 与 `[data-theme='dark']`,
 * 不在本文件;这里只负责**不挡住它**。
 *
 * ⚠️ 判空**收敛在这一处**,调用点不各判一次。每个调用点各判一次的后果是
 * 总有一个点判错,而那个点的表现是「这个租户的界面莫名其妙有颜色」。
 *
 * @module @dshwar/design-system/accent/apply
 */
import { derive, type DeriveResult, type Theme } from './derive.ts'

/**
 * 本模块需要的那一点点 DOM —— 结构类型,不是 `HTMLElement`。
 *
 * 三个宿主传进来的都是真的 `HTMLElement`,它结构上满足这个接口,调用点不用改。
 * 之所以不直接写 `HTMLElement`:测试要传一个**能记账的假货**,
 * 而按 `HTMLElement` 造假货意味着补几百个成员 —— 没人会写,
 * 于是实际发生的总是用断言绕过去,而那等于这一层根本没有类型。
 */
export interface AccentTarget {
  readonly style: {
    setProperty(name: string, value: string): void
    /** 真实 CSSOM 返回被移除的旧值;这里用不到,声明成 `void` 好让假货少写一行。 */
    removeProperty(name: string): void
  }
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/**
 * 一次派生结果对应的**全部写入**,形如 `[属性名, 值]`。
 *
 * ★ `applyAccent` 与 `clearAccent` 的清单同源就落在这个函数上:写的是它的键,
 * 清的也是它的键(见 {@link ACCENT_PROPERTIES})。两份手抄的清单迟早分家,
 * 而分家的表现极不显眼 —— 「重置为中性外观」之后还剩一两个变量没清,
 * 界面上只是某个描边还带着上一个品牌的颜色,没有人会把它当成 bug 报上来。
 *
 * ⚠️ **这里必须无条件列出每一项。** 若将来某个属性只在某些种子下写
 * (比如「只有 RE-LIT 时才写 `--accent-hover`」),同源性就断了:
 * {@link ACCENT_PROPERTIES} 是拿一个固定种子取的键名,取不到条件分支里的那些。
 * 测试对 RE-LIT 与 VERBATIM 两种种子、亮暗两个主题各断言一次写入键集,盯的就是这件事。
 */
function tokenWrites(d: DeriveResult): readonly (readonly [string, string])[] {
  return [
    // 种子原值。它不参与渲染,是留给「这块 DOM 现在挂的是哪个租户的色」的可读凭证。
    ['--seed', d.seed],
    ...d.ramp.map((r) => [`--a-${r.step}`, r.hex] as const),
    ['--accent-solid', d.solid],
    ['--accent-on', d.on],
    ['--accent-hover', d.hover],
    ['--accent-active', d.active],
    ['--accent-text', d.text],
    ['--accent-text-strong', d.strong],
    ['--accent-border', d.border],
    ['--accent-surface', d.surface],
    // 配了主色之后链接靠颜色就能与正文区分,下划线退回 hover 态。
    // 未配置态相反:`accent.text` 与正文同为 n-900,**形态必须接替颜色**,
    // 所以那边的默认值是 `underline`(见 accent.css)。
    ['--link-underline', 'none'],
  ]
}

/**
 * 只用来取键名的探针种子。
 *
 * ⚠️ **它不是默认色,也永远不会被写进 DOM。** 键名只跟结构有关、与种子无关,
 * 取哪个都一样。名字里带 `NAME_PROBE` 是因为一个孤零零的 hex 摆在这个文件里,
 * 下一个人有充分理由把它读成兜底色 —— 而本模块最要紧的一条正是「没有兜底色」。
 */
const NAME_PROBE_SEED = '#000000'

/**
 * {@link applyAccent} 会写、{@link clearAccent} 就要清的那一组自定义属性。
 *
 * **从 {@link tokenWrites} 现取,不抄一份** —— 抄一份就等于给自己留了
 * 「ramp 加一档而 clearAccent 清不掉它」的洞,而那个洞不会有任何东西报警。
 */
export const ACCENT_PROPERTIES: readonly string[] = tokenWrites(
  derive(NAME_PROBE_SEED, 4.5, 'light'),
).map(([name]) => name)

/**
 * 把租户主色打到一棵 DOM 子树上。
 *
 * @param seed 租户配置的种子色;`null` = 未配置,空串 = 配置错误 —— **两者都不派生**
 * @param el 写入作用域。传 `document.documentElement` 就是全局主题;
 *   传某个容器就只影响那一块(配置页的实时预览正是这么用的)
 * @param theme 当前主题。**必填**,理由见下
 * @returns 派生结果;未配置时 `null`
 *
 * ⚠️ **`theme` 刻意不给默认值。** 忘了传的表现是:亮主题派生出的文字色落在
 * 暗画布(n-950)上只有 2 点几比一 —— 它看起来像「颜色淡了一点」而不是「坏了」,
 * 不会有任何东西变红,也不会有人报上来。`derive()` 保留了 `'light'` 默认
 * (它是纯计算,调用点多在测试与工具里);而**写进 DOM 的这一层不给默认**,
 * 于是每个调用点都必须真的说出自己在哪个主题下。
 */
export function applyAccent(
  seed: string | null,
  el: AccentTarget,
  theme: Theme,
): DeriveResult | null {
  // 🚨 未配置 = 中性外观,这里**不派生**:`derive()` 认不出种子时会回落到
  //    它自己的兜底色,于是一个空串会渲染成一个**没人配置过的颜色**。
  //    空串与 null 在这一层的动作相同、理由不同 —— 空串是配置错误,
  //    该由上层报错;但这一层同样不能替它猜一个颜色,两种都必须先清干净。
  if (seed === null || seed === '') {
    clearAccent(el)
    return null
  }
  const d = derive(seed, 4.5, theme)
  // ⚠️ 一律走 `setProperty`:自定义属性本来也只能这么写,
  //    而在 `style` 上直接给具名属性赋值是 check-guards.mjs 明禁的形状。
  for (const [name, value] of tokenWrites(d)) el.style.setProperty(name, value)
  // accent.css 里 `[data-brand='configured']` 那条规则挂在这个属性上。
  // 它与上面那条 `--link-underline` 看着重复,但两者的通路不同:属性是给
  // CSS 选择器用的钩子(宿主还能挂自己的品牌态规则),自定义属性是直接覆盖。
  // kit 里两者并存,这里原样保留。
  el.setAttribute('data-brand', 'configured')
  return d
}

/**
 * 重置为中性外观 —— 把 {@link applyAccent} 写过的东西全部移除。
 *
 * ⚠️ **是移除,不是写一套中性值。** 中性外观的权威值在 `styles/accent.css` 的
 * `:root` 与 `[data-theme='dark']` 两处;在这里再写一遍就是第三个副本,
 * 而第三个副本会在改暗主题中性档时被忘掉 —— 表现是暗主题下「重置」之后
 * 拿到一套**亮主题的**中性色,对比度当场垮掉。
 * 移除让层叠自己回落,于是这一层不需要知道回落到什么。
 */
export function clearAccent(el: AccentTarget): void {
  for (const name of ACCENT_PROPERTIES) el.style.removeProperty(name)
  el.removeAttribute('data-brand')
}
