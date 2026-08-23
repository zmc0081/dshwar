/**
 * 按钮。高 32px(默认)/ 28px(紧凑)· r-2 · label 12/500。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 里的原版用 JS style 对象 + `useState` 表达 hover / active,
 * 用 `onFocus` 直接改 `style.boxShadow` 表达焦点环。移植时全部换成 CSS 伪类 ——
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`,一句话:
 * **`onFocus` 对鼠标点击也触发,焦点环因此常亮**,而焦点环是设计语言里
 * 明写的键盘可达性通道,它对所有人常亮那条规则就名存实亡。
 *
 * @module @dshwar/design-system/components/Button
 */
import type * as React from 'react'
import { Icon } from './Icon.tsx'

export interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  /** primary 用 accent.solid(**每屏只应有一个**)· secondary 中性描边 · ghost 无边 · danger 描边式危险操作 */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  /** default = 32px · compact = 28px(表格工具条、行内) */
  size?: 'default' | 'compact'
  /** Lucide 图标名,置于文字前 */
  icon?: string
  children?: React.ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'default',
  icon,
  disabled,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const classes = ['ds-button', `ds-button--${variant}`]
  if (size === 'compact') classes.push('ds-button--compact')

  return (
    <button
      type="button"
      // 与原版一致:`disabled` 之外**同时**给 aria-disabled ——
      // 原生 disabled 会让元素移出 tab 序,读屏用户就再也遇不到它。
      aria-disabled={disabled === true ? 'true' : undefined}
      disabled={disabled}
      className={classes.join(' ')}
      {...rest}
    >
      {icon === undefined ? null : <Icon name={icon} size={14} tone="inherit" />}
      {children}
    </button>
  )
}
