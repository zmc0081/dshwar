/**
 * 机器串:错误码、requestId、审计动作词、密钥句柄。mono + n-600 + 可选中。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 原版把整份排版写在内联 style 对象里,移植时搬进
 * `styles/components/coderef.css` —— 理由见
 * `docs/DECISIONS/design-kit-adoption.md`(内联样式写不了伪类,也写不了媒体查询)。
 *
 * ⚠️ **`done` 这个 state 留着**:它是复制成功的短暂回执(1200ms 后自己退回),
 * 不是 hover / active / focus 那类 CSS 伪类本来就能表达的交互态 —— 伪类换不掉它。
 *
 * @module @dshwar/design-system/components/CodeRef
 */
import type * as React from 'react'
import { useState } from 'react'
import { Icon } from './Icon.tsx'

export interface CodeRefProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'className'> {
  /** 串内容,原样输出 —— 禁止本地化、禁止改写大小写 */
  children: React.ReactNode
  /** 附一键复制(图标 n-500,非 accent) */
  copyable?: boolean
  /** 错误上下文里用 danger 上色;其余保持 n-600 */
  tone?: 'default' | 'danger'
}

export function CodeRef({
  children,
  copyable,
  tone = 'default',
  ...rest
}: CodeRefProps): React.JSX.Element {
  const [done, setDone] = useState(false)
  const text = String(children ?? '')

  const classes = ['ds-coderef']
  if (tone === 'danger') classes.push('ds-coderef--danger')

  return (
    <span className={classes.join(' ')} {...rest}>
      {children}
      {copyable === true ? (
        <button
          type="button"
          aria-label={done ? '已复制' : '复制'}
          title={done ? '已复制' : '复制'}
          className="ds-coderef__copy"
          onClick={() => {
            try {
              void navigator.clipboard.writeText(text)
            } catch {
              // 与原版一致:复制失败静默。
              // ⚠️ 注意 `setDone(true)` 在 try **之外** —— 失败时图标同样翻成 check,
              // 即"复制成功"的回执照给。这是 kit 原版的行为,移植时原样保留。
            }
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          }}
        >
          <Icon name={done ? 'check' : 'copy'} size={13} />
        </button>
      ) : null}
    </span>
  )
}
