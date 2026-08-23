/**
 * 文本输入。高 34px。错误态改描边与文案,不改背景色。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 里的原版用 `useState` + `onFocus` / `onBlur` 表达聚焦态(描边 accent.border
 * + 3px accent.surface 光圈)。移植时换成 CSS `:focus-visible` ——
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`,一句话:
 * **`onFocus` 对鼠标点击也触发,焦点环因此常亮**,而焦点环是设计语言里
 * 明写的键盘可达性通道,它对所有人常亮那条规则就名存实亡。
 *
 * ## 唯一保留内联的:后缀预留宽度
 *
 * 它按 `suffix` 的**字符数**算,是随数据变的一次性布局 —— 做成 CSS 类
 * 反而要为每种长度各写一条。守卫也不禁这一类内联。
 *
 * @module @dshwar/design-system/components/Input
 */
import type * as React from 'react'

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'className' | 'style' | 'value' | 'placeholder' | 'disabled' | 'onChange'
> {
  /** 字段名,label 12/500 / n-700 */
  label?: string
  value?: string
  placeholder?: string
  /** 辅助说明,caption 11 / n-600 */
  hint?: string
  /** 错误文案;非空即进入错误态(描边 danger) */
  error?: string
  /** ID、模型名、token 数、密钥等标识串置 true → mono */
  mono?: boolean
  disabled?: boolean
  /** 右侧单位/后缀,mono caption */
  suffix?: string
  /** 省略即为只展示(受控只读),不会触发 React 的 value-without-onChange 警告 */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  /**
   * 落在**外层 `<label>`** 上 —— 与 kit 一致(那里 `style` 也是给容器的,
   * 用来覆盖栅格占位);`...rest` 则落在 `<input>` 上。
   */
  style?: React.CSSProperties
}

export function Input({
  label,
  value,
  placeholder,
  hint,
  error,
  mono,
  disabled,
  suffix,
  onChange,
  style,
  ...rest
}: InputProps): React.JSX.Element {
  // 同 Select:只展示的输入框(继承值、锁死字段)不传 onChange 时退化为受控只读。
  const handle = onChange ?? ((): void => {})

  const hasError = error !== undefined && error !== ''
  const hasHint = hint !== undefined && hint !== ''

  // 后缀预留按字符数算(mono 11px ≈ 6.6px/字符 + 左右各 8px),不再是固定 76px
  const suffixPad =
    suffix === undefined || suffix === '' ? undefined : `${Math.round(suffix.length * 6.6 + 16)}px`

  const control = ['ds-input__control']
  if (mono === true) control.push('ds-input__control--mono')
  if (hasError) control.push('ds-input__control--error')

  return (
    <label className="ds-input" style={style}>
      {label === undefined || label === '' ? null : (
        <span className="ds-input__label">{label}</span>
      )}
      <span className="ds-input__field">
        <input
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handle}
          aria-disabled={disabled === true ? 'true' : undefined}
          aria-invalid={hasError ? 'true' : undefined}
          className={control.join(' ')}
          style={suffixPad === undefined ? undefined : { paddingRight: suffixPad }}
          {...rest}
        />
        {suffixPad === undefined ? null : <span className="ds-input__suffix">{suffix}</span>}
      </span>
      {hasError || hasHint ? (
        <span
          className={hasError ? 'ds-input__message ds-input__message--error' : 'ds-input__message'}
        >
          {hasError ? error : hint}
        </span>
      ) : null}
    </label>
  )
}
