/**
 * 模型降级提示。warn 语义色,句式锁死,零 accent。
 *
 * ## 句式与配色都不是风格选择
 *
 * 句式固定「{reason},本次由 X 降级至 Y」,**不带劝导语气**(不写"以获得更快响应")。
 * 零 accent、模型名一律 mono —— 降级是平台行为,染上客户主色会被读成客户的产品决策。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * 见 `docs/DECISIONS/design-kit-adoption.md`。原版给图标单挂了一句
 * 内联 `color: var(--warn)`,这里改由容器给 `currentColor`、图标用 `tone="inherit"` 接住 ——
 * 渲染结果相同,少一处内联样式。
 *
 * @module @dshwar/design-system/components/DegradeNotice
 */
import type * as React from 'react'
import { Icon } from './Icon.tsx'

export interface DegradeNoticeProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'className'
> {
  /** 原模型名,mono */
  from: string
  /** 降级目标模型名,mono */
  to: string
  /** 原因短语,默认「容量受限」 */
  reason?: string
}

export function DegradeNotice({
  from,
  to,
  reason = '容量受限',
  ...rest
}: DegradeNoticeProps): React.JSX.Element {
  return (
    <div role="status" className="ds-degradenotice" {...rest}>
      <Icon name="triangle-alert" size={15} tone="inherit" />
      <span className="ds-degradenotice__text">
        {reason}，本次由 <span className="ds-degradenotice__model">{from}</span> 降级至{' '}
        <span className="ds-degradenotice__model">{to}</span>
      </span>
    </div>
  )
}
