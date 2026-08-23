/**
 * 隔离档闸门(模态)。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. 内联 `style={{}}` 原样保留 —— 本屏没有 hover / active / focus 的 JS 状态,
 *    没有要转成伪类的东西,因此也没有对应的 `styles/screens/*.css`。
 * 3. 三条(为什么拦 / 出路 / 代价)的数组在 kit 里是无类型的元组数组;
 *    这里给它写出 `[标签, 色调, 正文]` 的元组类型,值一个不改。
 *
 * ## 原 kit 注释(原样保留)
 *
 * ★ 会阻止真实数据事故的闸门。
 * 视觉权重要够(浮层 shadow-2 + r-4 + danger 描边条),但不能吓退单用户部署:
 * - 它**只在添加第二个成员时**出现,单用户部署永远看不到;
 * - 标题写"需要先切换隔离档"而不是"错误";
 * - 三件事按 为什么拦 / 出路 / 代价 的顺序,代价给具体数字而不是"可能更耗内存";
 * - 提供"保持单用户"作为平级出路,不做成"取消"(取消读起来像放弃,保持是一个选择)。
 * 零 accent:这段内容是为了保护用户,不是展示品牌。
 *
 * @module @dshwar/design-system/screens/console/IsolationGate
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Select } from '../../components/Select.tsx'

export interface IsolationGateProps {
  open?: boolean
  /** 「保持单用户部署」—— 刻意不叫"取消" */
  onClose?: () => void
  /** 「切换到进程档并继续」 */
  onSwitch?: () => void
  memberCap?: number
  rssPerProcessMb?: number
}

/** 三条说明的色调,与 kit 的 `tone === 'danger' ? … : tone === 'warn' ? … : …` 一一对应。 */
type ReasonTone = 'danger' | 'neutral' | 'warn'

export function IsolationGate({
  open,
  onClose,
  onSwitch,
  memberCap = 39,
  rssPerProcessMb = 63,
}: IsolationGateProps): React.JSX.Element | null {
  if (!open) return null

  const reasons: readonly [string, ReasonTone, React.ReactNode][] = [
    [
      '为什么拦',
      'danger',
      <>
        逻辑隔离档下多成员<b style={{ fontWeight: 'var(--fw-medium)' }}>根本没有分隔</b>
        ：所有人的文件都会落进同一个目录 <CodeRef>anonymous/anonymous/</CodeRef>，
        <b style={{ fontWeight: 'var(--fw-medium)' }}>互相覆盖且没有任何报错</b>
        。这不是体验问题，是会静默发生的数据事故。
      </>,
    ],
    [
      '出路',
      'neutral',
      <>
        把 <CodeRef>isolation.level</CodeRef> 改成 <CodeRef>"process"</CodeRef> ——
        每位成员一个独立进程，文件按 principal 分隔。切换后本租户的成员上限为 {memberCap} 人。
      </>,
    ],
    [
      '代价',
      'warn',
      <>
        每进程常驻内存约{' '}
        <b style={{ fontWeight: 'var(--fw-medium)', fontFamily: 'var(--font-mono)' }}>
          {rssPerProcessMb} MB
        </b>
        。按当前 basis 推导，上限 {memberCap}{' '}
        人；再多需要加内存，机器不会因为界面上的数字变大而变大。
      </>,
    ],
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      /* @blockingModal —— 有意阻断的全屏模态:用户必须处理,不会让人以为声明带不存在。
         checks/no-fixed-layers.mjs 靠这个标记放行;没有标记的 fixed 一律报错。 */
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12,15,23,.40)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s-8)',
        zIndex: 40,
      }}
    >
      <div
        style={{
          width: 620,
          maxWidth: '100%',
          background: 'var(--surface-card)',
          borderRadius: 'var(--r-4)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ height: 4, background: 'var(--danger)' }} />
        <div style={{ padding: 'var(--s-8)', display: 'grid', gap: 'var(--s-6)' }}>
          <div style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'flex-start' }}>
            <span
              style={{
                width: 28,
                height: 28,
                flex: '0 0 auto',
                borderRadius: 'var(--r-1)',
                background: 'var(--danger-surface)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Icon
                name="shield-alert"
                size={15}
                tone="inherit"
                style={{ color: 'var(--danger)' }}
              />
            </span>
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <h2
                id="gate-title"
                style={{
                  margin: 0,
                  font: 'var(--fw-bold) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                  letterSpacing: 'var(--ls-title-2)',
                }}
              >
                添加第二位成员前需要先切换隔离档
              </h2>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}
              >
                当前 <CodeRef>isolation.level "logical"</CodeRef> · MEMBER CAP 1 人
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            {reasons.map(([label, tone, body]) => (
              <div
                key={label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '72px 1fr',
                  gap: 'var(--s-5)',
                  alignItems: 'start',
                }}
              >
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-caption)/20px var(--font-sans)',
                    textAlign: 'center',
                    borderRadius: 'var(--r-1)',
                    height: 20,
                    background:
                      tone === 'danger'
                        ? 'var(--danger-surface)'
                        : tone === 'warn'
                          ? 'var(--warn-surface)'
                          : 'var(--neutral-surface)',
                    color:
                      tone === 'danger'
                        ? 'var(--danger)'
                        : tone === 'warn'
                          ? 'var(--warn)'
                          : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                    color: 'var(--text-body)',
                  }}
                >
                  {body}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 'var(--s-4)',
              padding: 'var(--s-5)',
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--r-2)',
            }}
          >
            <Select
              label="切换到"
              value="process —— 每成员独立进程"
              options={['process —— 每成员独立进程']}
              mono
            />
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.55 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              切换需要重启工作台进程池，约 20 秒；期间已有会话会排队，不会丢失。
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
            <Button variant="primary" onClick={onSwitch}>
              切换到进程档并继续
            </Button>
            <Button variant="ghost" onClick={onClose}>
              保持单用户部署
            </Button>
            <span
              style={{
                marginLeft: 'auto',
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                color: 'var(--text-tertiary)',
              }}
            >
              <CodeRef copyable>E_ISOLATION_MEMBER_CAP · req_7c12de40b1</CodeRef>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
