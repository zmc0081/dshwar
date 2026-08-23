/**
 * 容量 / 配额条。填充恒为 n-700,不接受 accent —— 这是 06 节的不可替换内容之一。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 里的原版把整套静态样式写在 JS style 对象里。这个组件本来就没有交互态,
 * 所以移植只是搬家:除**按数据算出来的两处**(填充宽度、目标线位置)之外,
 * 全部落进 `styles/components/quotabar.css`。那两处保留内联 ——
 * 按数据算的一次性布局做成类反而更糟,守卫也不禁它。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 06 · 容量数字:进度条填充**不用 accent** —— accent 会被读成"客户承诺的额度"。
 * 填充取 --text-secondary(亮主题 = n-700,暗主题 = n-400),轨道取 --surface-disabled,
 * 两者随主题翻转:06 的规则是"填充不得是 accent",不是"必须是 n-700 字面值"。
 * 只有客户自设的配额目标线可用 accent。
 *
 * @module @dshwar/design-system/components/QuotaBar
 */
import type * as React from 'react'

export interface QuotaBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  /** 已用量 */
  used: number
  /** 平台容量(非承诺值) */
  total: number
  /** 单位,默认 "tok" */
  unit?: string
  /** 客户自设的配额目标线 —— 这是条上唯一允许用 accent 的元素 */
  target?: number
  /** 附注,默认「平台容量 · 非承诺值」,不建议改写 */
  note?: string
}

export function QuotaBar({
  used,
  total,
  unit = 'tok',
  target,
  note = '平台容量 · 非承诺值',
  ...rest
}: QuotaBarProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(1, total ? used / total : 0))
  const fmt = (n: number): string => n.toLocaleString('en-US')

  return (
    <div className="ds-quotabar" {...rest}>
      <div className="ds-quotabar__head">
        <span className="ds-quotabar__amount">
          {fmt(used)} / {fmt(total)} {unit}
        </span>
        <span className="ds-quotabar__pct">{(pct * 100).toFixed(1)}%</span>
      </div>
      <div
        className="ds-quotabar__track"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        {/* 宽度按数据算 —— 一次性布局,保留内联 */}
        <div className="ds-quotabar__fill" style={{ width: `${pct * 100}%` }} />
        {typeof target === 'number' && total ? (
          <span
            className="ds-quotabar__target"
            title="客户自设配额目标线"
            style={{ left: `${Math.min(100, (target / total) * 100)}%` }}
          />
        ) : null}
      </div>
      <div className="ds-quotabar__note">{note}</div>
    </div>
  )
}
