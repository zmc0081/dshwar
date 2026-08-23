/**
 * 2–4 字符缩写块。降级阶梯 ④ 与 favicon 回落共用同一算法 —— 两处不得各算一次。
 *
 * 28×28 · r-1 · 底 n-900 · 字 n-050 · 12px · +0.02em。
 * favicon 变体:正方画布、无圆角(浏览器标签自身会裁圆)、字号为画布的 44%。
 *
 * ## 与设计 kit 的差别:静态样式进 CSS,只有按 `size` 算出来的尺寸留内联
 *
 * kit 原版把整块样式写成一个 JS style 对象。移植时底色 / 字色 / 圆角 / 字号 /
 * 字距全部搬进 `styles/components/monogram.css`;`width` / `height` 与 favicon
 * 的字号是**按入参算的一次性尺寸**,做成类反而更糟,那一档保留内联。
 *
 * @module @dshwar/design-system/components/Monogram
 */
import type * as React from 'react'

/** 2–4 字符缩写块。wordmark 降级阶梯 ④ 与 favicon 回落共用。 */
export interface MonogramProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'className'> {
  /** 完整产品名;组件自行缩写。未配置时为 DSHWAR → DS */
  name?: string
  /** 边长,槽位用 28,favicon 导出 32 / 180 / 512 */
  size?: number
  /** slot = r-1 圆角 · favicon = 无圆角(浏览器标签自身会裁圆) */
  variant?: 'slot' | 'favicon'
}

/** 与顶栏 monogram 同一缩写算法,供 favicon 导出复用 */
export function abbreviate(name?: string): string {
  const s = (name || 'DSHWAR').trim()
  if (/[\u3000-\u9fff]/.test(s)) return s.slice(0, 2)
  const words = s.split(/[\s\-_]+/).filter(Boolean)
  // kit 原文是 `w[0]`。`noUncheckedIndexedAccess` 下索引访问会带出 undefined,
  // 而 `filter(Boolean)` 已保证每段非空 —— 改用 charAt,取值与结果都不变。
  if (words.length > 1)
    return words
      .slice(0, 3)
      .map((w) => w.charAt(0))
      .join('')
      .toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

export function Monogram({
  name = 'DSHWAR',
  size = 28,
  variant = 'slot',
  style,
  ...rest
}: MonogramProps): React.JSX.Element {
  const text = abbreviate(name)
  return (
    <span
      role="img"
      aria-label={name}
      {...rest}
      className={variant === 'favicon' ? 'ds-monogram ds-monogram--favicon' : 'ds-monogram'}
      style={{
        width: size,
        height: size,
        // favicon 的字号是画布的 44%,按 size 算;slot 恒 12px,在 CSS 里。
        ...(variant === 'favicon' ? { fontSize: Math.round(size * 0.44) } : {}),
        ...style,
      }}
    >
      {text}
    </span>
  )
}
