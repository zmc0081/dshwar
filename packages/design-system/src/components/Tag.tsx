/**
 * 状态标签。高 20px · r-1 · caption 11。文字均 ≥4.5:1 于各自底色。
 *
 * ## 与设计 kit 的差别:配色表在 CSS
 *
 * kit 的 `TONES` 表把前景 / 底色内联到 `style` 上;移植后是
 * `styles/components/tag.css` 的 `.ds-tag--<tone>`,组件只出 `className`。
 * `TONES[tone] || TONES.neutral` 那条兜底也一起搬过去了 —— 中性档的两个颜色
 * 就写在 `.ds-tag` 上,tone 传了表里没有的值时自然退回中性,而不是没有颜色。
 *
 * @module @dshwar/design-system/components/Tag
 */
import type * as React from 'react'

export interface TagProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'className'> {
  /** success 运行中 · warn 降级/接近配额 · danger 失败/隔离 · neutral 草稿/已停用 · accent 仅"当前/选中" */
  tone?: 'success' | 'warn' | 'danger' | 'neutral' | 'accent'
  /** 前置 5px 状态点 */
  dot?: boolean
  /** 内容为标识串时置 true → mono */
  mono?: boolean
  children?: React.ReactNode
}

export function Tag({
  tone = 'neutral',
  dot,
  mono,
  children,
  ...rest
}: TagProps): React.JSX.Element {
  const classes = ['ds-tag', `ds-tag--${tone}`]
  if (mono === true) classes.push('ds-tag--mono')

  return (
    <span className={classes.join(' ')} {...rest}>
      {dot === true ? <span className="ds-tag__dot" /> : null}
      {children}
    </span>
  )
}
