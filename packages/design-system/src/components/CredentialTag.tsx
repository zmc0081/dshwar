/**
 * 凭据「值不可见」提示。neutral Tag + 掩码,措辞锁死,绝不用 success。
 *
 * ## 措辞与配色都不是风格选择
 *
 * 「已配置(值不可见)」**不可改写**,且**不用 success 绿** ——
 * 绿会读成"已验证通过",而它只表示存在。这与 CLAUDE.md 硬规则 5 是同一件事:
 * 凭据端点只暴露 `describe` 语义(configured / source / writable),永不返回值。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * 见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/components/CredentialTag
 */
import type * as React from 'react'
import { Tag } from './Tag.tsx'

export interface CredentialTagProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'className'
> {
  /** false 时显示「未配置」且不渲染掩码 */
  configured?: boolean
}

export function CredentialTag({
  configured = true,
  ...rest
}: CredentialTagProps): React.JSX.Element {
  return (
    <span className="ds-credentialtag" {...rest}>
      <Tag tone="neutral">{configured ? '已配置（值不可见）' : '未配置'}</Tag>
      {configured ? <span className="ds-credentialtag__mask">••••••••</span> : null}
    </span>
  )
}
