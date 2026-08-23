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
        // ⚠️ **kit 原版没有 tabIndex 也没有 onKeyDown —— 键盘完全够不到它。**
        //
        // 一个 `role="checkbox"` 的 span 对读屏是复选框,对键盘是一段死文字:
        // Tab 停不下来,空格与回车不做任何事。而设计语言明写
        // 「键盘可达性不依赖颜色差异」—— 这里根本不是「依赖颜色」的问题,
        // 是**那条通道整个不存在**。
        //
        // ARIA 的 checkbox 角色规定键盘契约是**空格**切换;回车不是必须的,
        // 但很多人会按,所以一并收下 —— 多收一个键不会让任何人更难用。
        // `preventDefault` 是必需的:空格在页面上默认滚动。
        tabIndex={disabled === true ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled === true) return
          if (e.key !== ' ' && e.key !== 'Enter') return
          e.preventDefault()
          onChange?.(checked !== true)
        }}
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
