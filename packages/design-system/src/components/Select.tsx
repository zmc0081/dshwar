/**
 * 下拉选择。与 Input 同高同圆角同聚焦规则。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 样式全在 `styles/components/select.css`,组件只出 `className`;
 *    聚焦态从 `useState` + `onFocus` / `onBlur` 换成 CSS `:focus-visible`
 *    —— 理由见 `docs/DECISIONS/design-kit-adoption.md`。
 * 2. 右侧的 chevron 多包了一层 `<span class="ds-select__chevron">`。
 *    kit 是把定位写成内联 `style` 传给 `Icon` 的;`Icon` 的契约里只有
 *    `name` / `size` / `tone` / `style`,没有 `className`,而定位属于
 *    「本组件的样式」该进 CSS —— 包一层是不改 `Icon` 契约的唯一办法。
 *
 * @module @dshwar/design-system/components/Select
 */
import type * as React from 'react'
import { Icon } from './Icon.tsx'

export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'className' | 'style' | 'value' | 'disabled' | 'onChange'
> {
  label?: string
  value?: string
  /** 选项文本数组 */
  options?: string[]
  /** 模型名等标识串置 true → mono */
  mono?: boolean
  disabled?: boolean
  /** 省略即为只展示(受控只读),不会触发 React 的 value-without-onChange 警告 */
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  /**
   * 落在**外层 `<label>`** 上 —— 与 kit 一致;`...rest` 则落在 `<select>` 上。
   */
  style?: React.CSSProperties
}

export function Select({
  label,
  value,
  options = [],
  mono,
  disabled,
  onChange,
  style,
  ...rest
}: SelectProps): React.JSX.Element {
  // 只展示的 Select(筛选器默认值、契约里锁死的选项)合法:不传 onChange 时
  // 退化为受控只读,而不是让 React 报 "value without onChange"。
  const handle = onChange ?? ((): void => {})

  const control = ['ds-select__control']
  if (mono === true) control.push('ds-select__control--mono')

  return (
    <label className="ds-select" style={style}>
      {label === undefined || label === '' ? null : (
        <span className="ds-select__label">{label}</span>
      )}
      <span className="ds-select__field">
        <select
          value={value}
          disabled={disabled}
          aria-disabled={disabled === true ? 'true' : undefined}
          onChange={handle}
          className={control.join(' ')}
          {...rest}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <span className="ds-select__chevron">
          <Icon name="chevron-down" size={14} />
        </span>
      </span>
    </label>
  )
}
