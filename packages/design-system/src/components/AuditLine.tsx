/**
 * 审计一行:action · actor · 时间戳,全 mono。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * 这个组件本来就没有交互态,移植只是把 style 对象搬进
 * `styles/components/auditline.css`。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 06 · 动作词一律 mono 小写下划线原样输出,不本地化、不换成自然语言。
 *
 * @module @dshwar/design-system/components/AuditLine
 */
import type * as React from 'react'
import { CodeRef } from './CodeRef.tsx'

export interface AuditLineProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  /** 动作词,如 "branding.update" —— 小写下划线原样,不本地化 */
  action: string
  /** 操作者 ID,如 "adm_71c2" */
  actor: string
  /** ISO 时间戳,如 "2026-08-18T09:14Z" */
  at: string
}

export function AuditLine({ action, actor, at, ...rest }: AuditLineProps): React.JSX.Element {
  return (
    <div className="ds-auditline" {...rest}>
      <CodeRef>{action}</CodeRef>
      <span className="ds-auditline__sep">·</span>
      <CodeRef>actor={actor}</CodeRef>
      <span className="ds-auditline__sep">·</span>
      <CodeRef>{at}</CodeRef>
    </div>
  )
}
