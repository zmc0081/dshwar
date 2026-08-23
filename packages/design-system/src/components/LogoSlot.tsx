/**
 * 顶栏 Logo 槽位,含三级回落(图像 → wordmark → monogram)。
 * 每个产品外壳的左上角只用它。
 *
 * ## `src` 接的是 `AssetRef.path`,不是 URL
 *
 * 组件内**不拼串**:三个宿主(远端 Web / 本地 sidecar / Tauri)对"资产放在哪"的
 * 答案不一样。**不接受 `https://` 外链** —— 外链等于向那台服务器报告客户
 * 每个员工的每次访问。
 *
 * 回落等价于契约的 `logoFor()`:深色主题取 logoDark 否则 logoLight,
 * 两者都没有 → 渲染 `productName` 的文字 wordmark,**而不是 DSHWAR 的标志**。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * 见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/components/LogoSlot
 */
import type * as React from 'react'
import { Monogram } from './Monogram.tsx'
import { Wordmark } from './Wordmark.tsx'

export interface LogoSlotProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'className'> {
  /** logoLight 的 AssetRef.path,直接给 img src;前端不拼串 */
  src?: string
  /** logoDark;缺失时回落 logoLight,不做自动反色 */
  srcDark?: string
  theme?: 'light' | 'dark'
  /** productName,用于 alt 与文字回落 */
  name?: string
  /** 无图像时的回落形态 */
  fallback?: 'wordmark' | 'monogram'
  /** 透传给 Wordmark;顶栏一律传 "topbar"(跳过降字号那一档) */
  context?: 'slot' | 'topbar'
}

export function LogoSlot({
  src,
  srcDark,
  theme = 'light',
  name = 'DSHWAR',
  fallback = 'wordmark',
  context = 'slot',
  ...rest
}: LogoSlotProps): React.JSX.Element {
  // 原版就是 `||` 而不是 `??` —— 空串与缺失同样回落到 logoLight。原样保留。
  const url = theme === 'dark' ? srcDark || src : src

  return (
    <span className="ds-logoslot" {...rest}>
      {url ? (
        <img src={url} alt={name} className="ds-logoslot__img" />
      ) : fallback === 'monogram' ? (
        <Monogram name={name} />
      ) : (
        <Wordmark name={name} theme={theme} context={context} />
      )}
    </span>
  )
}
