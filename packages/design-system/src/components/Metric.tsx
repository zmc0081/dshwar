/**
 * 单个指标数字。caption 标签 + title-1 数值(tabular-nums)+ mono 附注。
 *
 * ## 与设计 kit 的差别:字号阶梯的四级进了 CSS
 *
 * kit 用一张 `SIZES` 表把三个排版 token 内联到 `style` 上。移植后这四级是
 * `styles/components/metric.css` 的 `.ds-metric__value--s0`…`--s3`,
 * 组件只负责**选第几级**。测量逻辑照旧留在 JS —— 它读的是
 * `scrollWidth` / `clientWidth`,CSS 表达不了。
 *
 * @module @dshwar/design-system/components/Metric
 */
import type * as React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

/*
   有意添加:05 节的「本月消耗 2.56M」形态有明确规格但无组件名。

   溢出处理(2026-08-21 裁决):**缩到最小字号**,阶梯 title-1 26 → title-2 21 → title-3 17。
   为什么不选另两条:
   · 横向截断 + 完整值留在 title —— 被截断的数字会被**读成一个更小的数**,
     而读者不会察觉。这与"永不用 … 截断品牌名"同一判据:截断看着像出错,
     而数字截断比出错更糟——它看起来是对的。
   · 容器随内容撑开 —— 会破坏 4 列指标栅格,相邻卡片宽度不再一致,
     窄视口下还会把卡片挤出屏幕。密度优先的界面不接受布局随数据抖动。
   阶梯到 body-lg 15px 为止(实测依据:4 列指标栅格在 1200px 内容宽下每卡仅
   118px 可用,"¥ 18,402,751.60" 在 17px 需要 130px,仍溢出 12px;15px 需 115px 才够)。
   **降到 15px 是一个信号**:此时数值已不再是标题级,说明这个数字不该放进 4 列栅格——
   正确的修法是这一行少放一张卡,而不是继续缩字号。组件不替调用方做这个决定,
   但会保证无论如何不溢出、不截断。15px 仍放不下时横向可滚动,仍然不截断。 */
const STEP_COUNT = 4

export interface MetricProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  /** 指标名,caption 11 / n-600 */
  label: string
  /** 数值,title-1 26/600 / tabular-nums */
  value: string
  /** 附注,mono caption,如 "配额 4.00M · 64%" */
  sub?: string
  /** muted 用于平台容量等非承诺值(n-700) */
  tone?: 'default' | 'muted'
}

export function Metric({
  label,
  value,
  sub,
  tone = 'default',
  ...rest
}: MetricProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  useLayoutEffect(() => {
    setStep(0)
  }, [value])
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    if (el.scrollWidth > el.clientWidth + 1 && step < STEP_COUNT - 1) setStep(step + 1)
  }, [step, value])

  const valueClasses = ['ds-metric__value', `ds-metric__value--s${step}`]
  if (tone === 'muted') valueClasses.push('ds-metric__value--muted')

  return (
    <div className="ds-metric" {...rest}>
      <div className="ds-metric__label">{label}</div>
      <div ref={ref} className={valueClasses.join(' ')}>
        {value}
      </div>
      {sub === undefined || sub === '' ? null : <div className="ds-metric__sub">{sub}</div>}
    </div>
  )
}
