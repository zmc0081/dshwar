/**
 * 复选框。15px 方块 · r-1 · 勾选态 accent.solid。
 *
 * 勾选态用 `accent.solid` —— **选中态是 accent 的五个合法落点之一**。
 * **审计表除外**:审计表的选中态改用 n-100 底。
 *
 * ## 与设计 kit 的差别:三态改由属性选择器接管
 *
 * kit 里 `background` / `border` / 文字色都是 JS 三元
 * (`disabled ? … : checked ? … : …`)。移植后同一组条件写成
 * `[aria-checked='true']` 与 `[aria-disabled='true']` 两条 CSS 规则,
 * 「禁用压过勾选」靠**后写的规则赢**表达 —— 与三元的短路顺序等价。
 *
 * 勾号的颜色也跟着搬:方块自己取 `color: var(--accent-on)`,
 * 图标用 `tone="inherit"` 继承它,而不是给 Icon 传一个内联色。
 *
 * @module @dshwar/design-system/components/Checkbox
 */
import type * as React from 'react'
import { Icon } from './Icon.tsx'

export interface CheckboxProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'className' | 'onChange' | 'style'
> {
  checked?: boolean
  label?: string
  disabled?: boolean
  /** 收到的是**变更后**的值 */
  onChange?: (next: boolean) => void
  /**
   * 落在最外层 `<label>` 上 —— 与 kit 一致。
   * 其余属性(`id` / `aria-*` / 事件)落在方块 `<span>` 上。
   */
  style?: React.CSSProperties
}

export function Checkbox({
  checked,
  label,
  disabled,
  onChange,
  style,
  ...rest
}: CheckboxProps): React.JSX.Element {
  const classes = ['ds-checkbox']
  if (disabled === true) classes.push('ds-checkbox--disabled')

  return (
    <label className={classes.join(' ')} style={style}>
      <span
        role="checkbox"
        aria-checked={checked === true}
        aria-disabled={disabled === true ? 'true' : undefined}
        onClick={() => {
          if (disabled === true) return
          onChange?.(checked !== true)
        }}
        className="ds-checkbox__box"
        {...rest}
      >
        {checked === true ? <Icon name="check" size={11} tone="inherit" /> : null}
      </span>
      {label === undefined ? null : <span className="ds-checkbox__label">{label}</span>}
    </label>
  )
}
