/**
 * `@dshwar/design-system` —— DSHWAR 设计系统的实现包。
 *
 * ## 边界:实现在这里,形状在契约包
 *
 * `@dshwar/console-contract` 只有**配置契约的形状**(字段、类型、可空性);
 * 派生算法、令牌、组件在这里。理由见 `accent/derive.ts` 的模块注释 ——
 * 一句话:契约包的价值在于稳定,而派生算法会随对比度规则调整而变。
 *
 * ## 样式不从 TS 里 import
 *
 * 组件只出 `className`,样式在 `src/styles/*.css`,由宿主自己引。
 * 这样交互态(hover / active / focus-visible)天然落在 CSS 伪类上,
 * 而不是 JS 状态 —— `check-guards.mjs` 有一条守卫盯着这件事。
 *
 * @module @dshwar/design-system
 */
export {
  clampC,
  contrast,
  derive,
  hex,
  MID_BAND,
  normalizeHex,
  toOklch,
  type DeriveResult,
  type DeriveTrace,
  type Oklch,
  type RampStep,
  type RoleRow,
  type Theme,
} from './accent/derive.ts'

export {
  CONTRACT_FLOORS,
  DARK,
  DESIGN_CARD_SNAPSHOT,
  LIGHT,
  ROLE_TOKENS,
  SEED_MATRIX,
} from './accent/spec.ts'

// ---- 组件(V0.9.0 Session 1 由设计 kit 移植)----
//
// ⚠️ 样式**不从这里出** —— 每个组件的 CSS 在 src/styles/components/<小写名>.css,
// 由宿主自己引(见本文件顶部「样式不从 TS 里 import」)。只 import 组件不引 CSS,
// 拿到的是一堆没有样式的 className。
//
// 屏幕(src/screens/**)刻意**不**从这里导出:它们是应用级的成品页面,
// 由各宿主按路径引。放进公共导出会让「组件库」与「示例页」混成一个面。

export { AuditLine, type AuditLineProps } from './components/AuditLine.tsx'
export { Button, type ButtonProps } from './components/Button.tsx'
export { Card, type CardProps } from './components/Card.tsx'
export { Checkbox, type CheckboxProps } from './components/Checkbox.tsx'
export { CodeRef, type CodeRefProps } from './components/CodeRef.tsx'
export { CredentialTag, type CredentialTagProps } from './components/CredentialTag.tsx'
export { DegradeNotice, type DegradeNoticeProps } from './components/DegradeNotice.tsx'
export { Icon, type IconProps } from './components/Icon.tsx'
export { IconButton, type IconButtonProps } from './components/IconButton.tsx'
export { Input, type InputProps } from './components/Input.tsx'
export { LogoSlot, type LogoSlotProps } from './components/LogoSlot.tsx'
export { Metric, type MetricProps } from './components/Metric.tsx'
export { abbreviate, Monogram, type MonogramProps } from './components/Monogram.tsx'
export { PlatformFooter, type PlatformFooterProps } from './components/PlatformFooter.tsx'
export { QuarantineBanner, type QuarantineBannerProps } from './components/QuarantineBanner.tsx'
export { QuotaBar, type QuotaBarProps } from './components/QuotaBar.tsx'
export { Select, type SelectProps } from './components/Select.tsx'
export { Table, type TableColumn, type TableProps } from './components/Table.tsx'
export { Tag, type TagProps } from './components/Tag.tsx'
export { Wordmark, type WordmarkProps } from './components/Wordmark.tsx'
