/**
 * Lucide 图标的薄包装。颜色锁在中性档,禁止 accent。
 *
 * ## Lucide 0.544.0 —— 规范图标集(源文档未提供图标资产,2026-08-21 定为规范)
 *
 * **版本号锁死在 0.544.0**,理由与锁 npm 依赖版本相同:图标集升级会静默改变字形,
 * 而那在设计稿上看不出来。升级必须是一次显式的、走复核的变更,不是自动跟随 latest。
 *
 * 实现读 Lucide UMD 暴露的 icon data(`window.lucide.icons`)直接渲染内联 SVG:
 * 不用 CSS mask(`mask-image` 在部分宿主的 CSP 下不生效,图标会退化成实心方块),
 * 也不做每图标一次网络请求。stroke 继承 `currentColor`,因此颜色由 tone 锁在中性档。
 * 宿主需在 head 里加载:
 *
 * ```html
 * <script src="https://unpkg.com/lucide@0.544.0/dist/umd/lucide.js"></script>
 * ```
 *
 * ## 与设计 kit 的差别:tone 从内联色变成 CSS 类
 *
 * kit 里 `TONES` 是一张 JS 表,值直接写进 `style.color`。移植时改成
 * `ds-icon--<tone>` 三个类,色值搬进 `styles/components/icon.css` ——
 * 同一组 token,只是换了承载处。理由见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/components/Icon
 */
import type * as React from 'react'
import { createElement, useEffect, useState } from 'react'

/**
 * Lucide 的一个子元素:`[标签名, 属性]`。
 * 属性就是 SVG 呈现属性,原样透给 `createElement`。
 */
type LucideChild = [string, React.SVGProps<SVGElement>]

/**
 * `window.lucide.icons` 里一个图标的数据。
 *
 * 两种形态都收 —— kit 里就是这么写的(`Array.isArray(node) ? node : node.children`),
 * 因为 Lucide 不同小版本给的一个是裸数组、一个是带 `children` 的对象。
 */
type LucideIconNode = LucideChild[] | { children?: LucideChild[] }

interface LucideGlobal {
  icons?: Record<string, LucideIconNode>
}

/**
 * 取 UMD 暴露的图标表;没加载完(或不在浏览器里)返回 `null`。
 *
 * 用断言而不是 `declare global` 是刻意的:后者会把 `lucide` 加进**每个消费方**的
 * `Window` 类型里,而它只是本组件与宿主 script 标签之间的约定。
 */
function lucideIcons(): Record<string, LucideIconNode> | null {
  if (typeof window === 'undefined') return null
  const g = (window as unknown as { lucide?: LucideGlobal }).lucide
  return g?.icons ?? null
}

/** kebab-case → PascalCase。Lucide 的 `icons` 键是 PascalCase。 */
function pascal(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

export interface IconProps extends Omit<
  React.SVGProps<SVGSVGElement>,
  'className' | 'name' | 'size' | 'tone'
> {
  /** Lucide 图标名,kebab-case,如 "plus" / "copy" / "chevron-down" */
  name: string
  /** 边长 px,默认 16 */
  size?: number
  /** default = n-500(3.12:1)· strong = n-700 · inherit = currentColor */
  tone?: 'default' | 'strong' | 'inherit'
}

export function Icon({ name, size = 16, tone = 'default', ...rest }: IconProps): React.JSX.Element {
  // Lucide UMD 可能在首次渲染之后才加载完(ds-base.js 里是异步 append)。
  // 轮询到位后自增一次,让图标补画出来;到位即停,不常驻计时器。
  const [, tick] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined' || lucideIcons() !== null) return
    let n = 0
    const t = setInterval(() => {
      if (lucideIcons() !== null || ++n > 40) {
        clearInterval(t)
        tick((v) => v + 1)
      }
    }, 60)
    return () => {
      clearInterval(t)
    }
  }, [])

  const lib = lucideIcons()
  const node = lib === null ? undefined : (lib[pascal(name)] ?? lib[name])
  const kids =
    node === undefined
      ? null
      : (Array.isArray(node) ? node : (node.children ?? [])).map(([tag, attrs], i) =>
          createElement<React.SVGProps<SVGElement>, SVGElement>(tag, { key: i, ...attrs }),
        )

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`ds-icon ds-icon--${tone}`}
      {...rest}
    >
      {kids}
    </svg>
  )
}
