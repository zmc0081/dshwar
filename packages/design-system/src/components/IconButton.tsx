/**
 * 仅图标的操作按钮。图标锁 n-500 / hover n-700,**永不 accent**。
 *
 * 表格行尾操作区、卡片头部工具、复制按钮用它。行内操作一律用它而不是文字按钮
 * —— 表格行内不放主色按钮。`label` 必填:图标按钮没有可见文字。
 *
 * ## 与设计 kit 的差别:hover 与焦点态全交给伪类
 *
 * kit 用 `useState` + 一对鼠标进出事件同时驱动两件事:按钮底色,
 * 以及**传给 Icon 的 `tone`**(hover 时 `strong`)。移植后两件事都进
 * `styles/components/iconbutton.css`:底色走 `:hover`,图标色由
 * `.ds-iconbutton:hover .ds-icon` 覆盖 —— 于是 `tone` 恒为 `default`,
 * 不再是一个随鼠标变的属性。
 *
 * ⚠️ kit 的 IconButton **没有焦点态**(它既没设 `outline: none`,也没有焦点环)。
 * 这里补上与 Button 同款的 `:focus-visible` 焦点环 —— 设计语言明写焦点环是
 * 键盘可达性通道,而一个能 tab 到、却没有规范焦点指示的按钮是那条规则的漏洞。
 *
 * @module @dshwar/design-system/components/IconButton
 */
import type * as React from 'react'
import { Icon } from './Icon.tsx'

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  /** Lucide 图标名 */
  icon: string
  /** 无障碍名称,必填 —— 图标按钮没有可见文字 */
  label: string
  /** 边长 px,默认 28 */
  size?: number
}

export function IconButton({
  icon,
  label,
  size = 28,
  disabled,
  style,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // 与 Button 一致:`disabled` 之外**同时**给 aria-disabled ——
      // 原生 disabled 会让元素移出 tab 序,读屏用户就再也遇不到它。
      aria-disabled={disabled === true ? 'true' : undefined}
      disabled={disabled}
      className="ds-iconbutton"
      // 边长由数据决定,是「一次性布局」那一类,留在内联里。
      // ⚠️ `...style` 放最后 —— 与 kit 一致,调用方给的值压过默认边长。
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      <Icon name={icon} size={15} tone="default" />
    </button>
  )
}
