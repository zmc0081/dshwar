/**
 * 机器串:错误码、requestId、审计动作词、密钥句柄。mono + n-600 + 可选中。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 原版把整份排版写在内联 style 对象里,移植时搬进
 * `styles/components/coderef.css` —— 理由见
 * `docs/DECISIONS/design-kit-adoption.md`(内联样式写不了伪类,也写不了媒体查询)。
 *
 * ⚠️ **`state` 留着**:它是复制的短暂回执(1200ms 后自己退回),
 * 不是 hover / active / focus 那类 CSS 伪类本来就能表达的交互态 —— 伪类换不掉它。
 *
 * ## 🚨 V0.9.0 修:kit 原版会给出**假的成功回执**
 *
 * 原版是 `try { void navigator.clipboard.writeText(text) } catch {} setDone(true)` ——
 * 两处都错:
 *
 * 1. `setDone(true)` 在 try **之外**,失败时照样翻成 check、aria-label 照样变「已复制」;
 * 2. 更隐蔽的一处:`writeText` 返回 **Promise**,而 `try/catch` **捕不到 Promise 的拒绝** ——
 *    真实的失败形态(用户拒绝剪贴板权限、非安全上下文)恰恰是拒绝而不是同步抛出,
 *    所以那个 catch 块在最常见的失败路径上**从来不会执行**。
 *
 * 合起来的后果:**复制没成功,而界面说成功了**。用户以为串在剪贴板里,
 * 粘贴出来是上一次的内容 —— 而他不会怀疑这个按钮,只会怀疑自己。
 *
 * 现在:等 Promise 落定,成功 → `copied`,失败 → `failed`(可见的失败反馈)。
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
  /** `idle` → 点击 → `copied` | `failed`,1200ms 后退回 `idle`。 */
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const text = String(children ?? '')

  const classes = ['ds-coderef']
  if (tone === 'danger') classes.push('ds-coderef--danger')

  return (
    <span className={classes.join(' ')} {...rest}>
      {children}
      {copyable === true ? (
        <button
          type="button"
          aria-label={state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : '复制'}
          title={state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : '复制'}
          className={
            state === 'failed' ? 'ds-coderef__copy ds-coderef__copy--failed' : 'ds-coderef__copy'
          }
          onClick={() => {
            // ★ 回执只在**真的成功之后**给。
            //   `writeText` 是异步的,所以必须等它落定 —— 同步的 try/catch
            //   捕不到它的拒绝,而拒绝才是最常见的失败形态(权限、非安全上下文)。
            //   `navigator.clipboard` 本身可能是 undefined(旧浏览器 / 非安全上下文),
            //   那是同步抛出,所以外面仍要包一层。
            const settle = (next: 'copied' | 'failed'): void => {
              setState(next)
              setTimeout(() => setState('idle'), 1200)
            }
            try {
              navigator.clipboard.writeText(text).then(
                () => settle('copied'),
                () => settle('failed'),
              )
            } catch {
              settle('failed')
            }
          }}
        >
          <Icon
            name={state === 'copied' ? 'check' : state === 'failed' ? 'x' : 'copy'}
            size={13}
            tone="inherit"
          />
        </button>
      ) : null}
    </span>
  )
}
