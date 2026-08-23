/**
 * 卡片 / 面板。r-3 · 1px n-200 描边 · 无阴影。
 *
 * **不加阴影。** 分层靠 1px 描边与 n-025 底 —— 高密度界面里阴影会糊。
 * 嵌套时内层圆角需比 r-3 小 ≥3px,否则改 r-0。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,`pad` 走自定义属性
 *
 * kit 里整块样式是 JS style 对象,`pad` 直接拼进两处 `padding`。
 * 移植后静态部分进 `styles/components/card.css`,只有 `pad` 这个**由数据决定**的
 * 值经 `--ds-card-pad` 递进去 —— 它被拼在 `var(--s-5) <pad>` 这个复合值里,
 * 留在 JS 等于把「头部上下 s-5、左右跟 pad」这条布局规则也留在 JS。
 *
 * @module @dshwar/design-system/components/Card
 */
import type * as React from 'react'

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'title'> {
  /** 标题,title-3 17/600;省略则无头部 */
  title?: string
  /** 头部右侧操作区(通常是 IconButton 或 ghost Button) */
  action?: React.ReactNode
  /** 内边距,默认 s-6 (16px);宽松场景用 s-8 */
  pad?: string
  children?: React.ReactNode
}

export function Card({
  title,
  action,
  pad = 'var(--s-6)',
  children,
  style,
  ...rest
}: CardProps): React.JSX.Element {
  // `--ds-card-pad` 是自定义属性,csstype 只声明标准属性,键集里没有它。
  // 断言一次不是为了绕过类型检查,是因为这条属性按定义就在类型之外。
  const padVar = { '--ds-card-pad': pad } as React.CSSProperties

  return (
    <section className="ds-card" style={{ ...padVar, ...style }} {...rest}>
      {title === undefined ? null : (
        <header className="ds-card__header">
          <h3 className="ds-card__title">{title}</h3>
          {action}
        </header>
      )}
      <div className="ds-card__body">{children}</div>
    </section>
  )
}
