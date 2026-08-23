/**
 * 隔离档警告。平台自述,零 accent。固定在内容区顶端,永不进入卡片内部。
 *
 * 06 · 九类不可替换内容之一,误认风险最高。
 * danger 语义色 + r-1 通栏条,位置固定在内容区顶端、与页头之间留 s-6,永不进入卡片内部。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 原版把条、文案、档位码各写成一个 JS style 对象,并把图标的 `color`
 * 直接写在图标的内联 style 上。移植时全部落到
 * `styles/components/quarantinebanner.css`:图标仍走 `tone="inherit"`
 * (= `currentColor`),那份 `var(--danger)` 改由条自身出色 —— 取值与结果都不变。
 * 本组件没有任何交互态,因此不涉及伪类改写。
 *
 * @module @dshwar/design-system/components/QuarantineBanner
 */
import type * as React from 'react'
import { Icon } from './Icon.tsx'

export interface QuarantineBannerProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'className'
> {
  /** 默认「该租户处于隔离档,出站请求已阻断。」不建议改写 */
  message?: string
  /** 档位码,mono 可选中 */
  code?: string
}

export function QuarantineBanner({
  message = '该租户处于隔离档，出站请求已阻断。',
  code = 'QUARANTINE_T3',
  ...rest
}: QuarantineBannerProps): React.JSX.Element {
  return (
    <div role="alert" {...rest} className="ds-quarantine-banner">
      <Icon name="shield-alert" size={15} tone="inherit" />
      <span className="ds-quarantine-banner__message">{message}</span>
      <span className="ds-quarantine-banner__code">{code}</span>
    </div>
  )
}
