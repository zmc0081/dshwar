/**
 * 文字 wordmark —— Logo 三级回落的第三级。专用 token,不参与正文阶梯。
 * 降级阶梯按实测宽度驱动;放不下时自动切到 Monogram,调用方无需判断。
 *
 * 06 · LOGO 三级回落的第三级。字号锁死、行高锁 1、字距加大、只有两种颜色。
 * 唯一允许把字距开到 0.14em 的地方。永不用 … 截断品牌名。
 *
 * 降级阶梯是**按实测宽度驱动**的,不是按字符数猜的(字符数猜不出实际宽度:
 * "Shanghai Manufacturing" 22 字符在 15px 下需要 207px,而槽位只有 168px,
 * 按字符数判定会漏过去,然后被 overflow:hidden 无声裁掉——比 … 更糟,
 * 因为它看起来不像被截断过)。
 *
 * ★ 槽位不可被 flex 压缩(flex: 0 0 auto)。
 *   阶梯必须由**声明的槽位上限 168px** 驱动,而不是由"这一行还剩多少空间"驱动。
 *   否则同一个品牌名在拥挤的顶栏里会静默降级成 monogram,而在宽松的顶栏里正常——
 *   品牌的呈现取决于旁边放了几个按钮,这是错的。行挤了就该让它溢出(看得见、能修),
 *   不该让品牌先替布局问题受罚。
 *
 * ★ firstSegment 只在**真能省下宽度**时才进阶梯。
 *   无分隔符的名字("智造运营平台"、"Unternehmensdatenverarbeitungsplattform")
 *   切首段返回原串,这一档白走一次,下一档直接就是 monogram ——
 *   等于阶梯从 tighten 一步跳到 monogram,中间什么都没有。
 *   这类名字改用 shrink 档补位。
 *
 * ★ topbar 一般跳过 shrink(wordmark 紧邻 13px 工作区名,降到 15px 会与之趋同、
 *   失去"哪个是品牌、哪个是当前位置"的层级线索)。
 *   但无分隔符时例外:唯一的中间档是 shrink,此时 16→15px 比"一步跳 monogram"好得多,
 *   且 CJK 基准本就是 16px、字形方而密,15px CJK 与 13px 拉丁仍可区分。
 *   衡量的是两害相权,不是放弃那条理由。
 *
 * ★ 阶梯可**逆向回升**:窗口变宽时重置到第 0 档重测。
 *   单向阶梯一旦在窄窗口落到 monogram 就再也回不去,用户得刷新页面。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 原版把槽位与文字各写成一个 JS style 对象,阶梯算出的 `fontSize` /
 * `letterSpacing` / 颜色直接赋进那个对象。移植时改成修饰类,
 * **取值一个不动**(见 `styles/components/wordmark.css` 里那张对照)。
 * 阶梯本身仍在 JS —— 它靠 `scrollWidth` 实测,CSS 表达不了。
 *
 * @module @dshwar/design-system/components/Wordmark
 */
import type * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Monogram } from './Monogram.tsx'

/** 阶梯档位。顺序即下探顺序;`active` 恒为 `rungs` 的前缀。 */
type Rung = 'base' | 'tighten' | 'shrink' | 'firstSegment' | 'monogram'

const hasCJK = (s: string | undefined): boolean => /[\u3000-\u9fff\uff00-\uffef]/.test(s || '')
const firstSegmentOf = (s: string | undefined): string =>
  String(s || '')
    .split(/[\s\-\u3000]/)
    .filter(Boolean)[0] || String(s || '')

/* 档位表按上下文各持一份,**不做索引平移**。
   早先的实现用 `if (topbar && s >= 2) s += 1` 跳过一档,但后面的赋值仍是累积式
   `if (s >= 2) size = 15` —— 平移之后 s=3 依然命中 s>=2,于是 topbar 在
   "取首段"那一档把字号一起降了,正是 context="topbar" 要防的事。
   教训:跳过一档要改**档位表**,不是改索引。 */
function ladderFor(name: string | undefined, topbar: boolean): Rung[] {
  const usefulSegment = firstSegmentOf(name).length < String(name || '').length
  if (topbar) {
    return usefulSegment
      ? ['base', 'tighten', 'firstSegment', 'monogram']
      : ['base', 'tighten', 'shrink', 'monogram']
  }
  return usefulSegment
    ? ['base', 'tighten', 'shrink', 'firstSegment', 'monogram']
    : ['base', 'tighten', 'shrink', 'monogram']
}

export interface WordmarkProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'className'> {
  /** 产品名。契约允许 40 字符,过长自动走降级阶梯(字距 → 字号 → 首段 → monogram) */
  name?: string
  /** light → n-900 · dark → n-050 */
  theme?: 'light' | 'dark'
  /** 默认 false(不与主操作抢签名)。客户显式要求时才允许 accent.text.strong */
  allowAccent?: boolean
  /**
   * slot = 完整阶梯(默认)。
   * topbar = **跳过降字号那一档**:顶栏里 wordmark 紧邻 13px 的工作区名,
   * 降到 15px 两者几乎无法区分,读者失去品牌/当前位置的层级线索。顶栏只换形态。
   */
  context?: 'slot' | 'topbar'
}

export function Wordmark({
  name = 'DSHWAR',
  theme = 'light',
  allowAccent = false,
  context = 'slot',
  ...rest
}: WordmarkProps): React.JSX.Element {
  const slotRef = useRef<HTMLSpanElement | null>(null)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const seenWidth = useRef(0)
  const [step, setStep] = useState(0)
  const cjk = hasCJK(name)
  const topbar = context === 'topbar'
  const rungs = ladderFor(name, topbar)

  useLayoutEffect(() => {
    setStep(0)
    seenWidth.current = 0
  }, [name, context])

  // 逐档下探:放不下就走下一档,一直可以走到 monogram。
  useLayoutEffect(() => {
    const slot = slotRef.current
    const text = textRef.current
    if (!slot || !text || step >= rungs.length - 1) return
    if (text.scrollWidth > slot.clientWidth + 1) setStep(step + 1)
  }, [step, name, context, rungs.length])

  // 槽位变宽时回到第 0 档重测 —— 否则阶梯单向,窄窗口落到 monogram 后再也回不去。
  useEffect(() => {
    const slot = slotRef.current
    if (!slot || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = slot.clientWidth
      if (w > seenWidth.current + 1) {
        seenWidth.current = w
        setStep(0)
      } else seenWidth.current = Math.max(seenWidth.current, w)
    })
    ro.observe(slot)
    return () => ro.disconnect()
  }, [])

  const active = rungs.slice(0, step + 1)
  let text = name
  if (active.includes('firstSegment')) text = firstSegmentOf(name)
  const monogram = active.includes('monogram')

  // ⚠️ 这三个修饰类的**顺序不表达优先级**,优先级由 CSS 的源码顺序决定,
  //    而那个顺序照抄的是 kit 里那串 if 的赋值顺序。见 wordmark.css 顶部。
  const textClasses = ['ds-wordmark__text']
  if (cjk) textClasses.push('ds-wordmark__text--cjk')
  if (active.includes('tighten')) textClasses.push('ds-wordmark__text--tighten')
  if (active.includes('shrink')) textClasses.push('ds-wordmark__text--shrink')
  // 颜色恰好一个类 —— kit 里是一个三元,这里原样保留那个三元的判定次序,
  // 于是颜色不依赖 CSS 源码顺序。
  textClasses.push(
    allowAccent
      ? 'ds-wordmark__text--accent'
      : theme === 'dark'
        ? 'ds-wordmark__text--dark'
        : 'ds-wordmark__text--light',
  )

  return (
    <span ref={slotRef} role="img" aria-label={name} {...rest} className="ds-wordmark">
      {monogram ? (
        <Monogram name={name} aria-hidden="true" />
      ) : (
        <span ref={textRef} className={textClasses.join(' ')}>
          {text}
        </span>
      )}
    </span>
  )
}
