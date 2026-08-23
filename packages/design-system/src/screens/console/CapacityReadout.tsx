/**
 * 容量读数条。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. 内联 `style={{}}` 原样保留 —— 本屏没有任何交互态,没有要转成伪类的东西。
 * 3. `Readout` 与 kit 一样是模块内私有的:kit 只把 `CapacityReadout` 挂上 window。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 06 · 容量数字属不可替换内容。三个数字常驻可见:管理员据此买服务器。
 * 形态刻意与卡片相反:n-025 底 + 上下 1px n-100 细线 + r-1,通栏,全 mono。
 * 零 accent,零圆角感 —— 它必须读作系统读数,不是品牌区域。
 *
 * @module @dshwar/design-system/screens/console/CapacityReadout
 */
import type * as React from 'react'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'

interface ReadoutProps {
  label: string
  /** kit 里既传字符串(「逻辑档」)也传数字(进程数),两种都要收 */
  value: string | number
  unit?: string
  note: string
}

function Readout({ label, value, unit, note }: ReadoutProps): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-2)', minWidth: 132 }}>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          letterSpacing: '.06em',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-3)' }}>
        <span
          style={{
            font: 'var(--fw-medium) var(--fs-title-2)/1 var(--font-mono)',
            color: 'var(--text-body)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        {unit ? (
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
              color: 'var(--text-secondary)',
            }}
          >
            {unit}
          </span>
        ) : null}
      </span>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1.4 var(--font-mono)',
          color: 'var(--text-tertiary)',
        }}
      >
        {note}
      </span>
    </div>
  )
}

export interface CapacityReadoutProps {
  /** `isolation.level` —— 逻辑档下 MEMBER CAP 恒为 1 */
  isolation?: 'logical' | 'process'
  maxProcesses?: number
  memberCap?: number
  rssPerProcessMb?: number
  totalMb?: number
}

export function CapacityReadout({
  isolation = 'logical',
  maxProcesses = 39,
  memberCap = 39,
  rssPerProcessMb = 63,
  totalMb = 2560,
}: CapacityReadoutProps): React.JSX.Element {
  return (
    <section
      aria-label="容量基线"
      style={{
        background: 'var(--surface-subtle)',
        borderTop: '1px solid var(--border-hairline)',
        borderBottom: '1px solid var(--border-hairline)',
        borderRadius: 'var(--r-1)',
        padding: 'var(--s-5) var(--s-6)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--s-10)',
        flexWrap: 'wrap',
      }}
    >
      <Readout
        label="ISOLATION"
        value={isolation === 'logical' ? '逻辑档' : '进程档'}
        note={`isolation.level "${isolation}"`}
      />
      <Readout
        label="MAX PROCESSES"
        value={maxProcesses}
        note={`deriveMaxProcesses · basis ${totalMb} MB`}
      />
      <Readout
        label="MEMBER CAP"
        value={isolation === 'logical' ? 1 : memberCap}
        unit="人"
        note={`rssPerProcess ${rssPerProcessMb} MB`}
      />
      <div style={{ marginLeft: 'auto', display: 'grid', gap: 'var(--s-2)', maxWidth: 268 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-3)',
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            letterSpacing: '.06em',
            color: 'var(--text-tertiary)',
          }}
        >
          <Icon name="server" size={12} />
          PLATFORM READOUT
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.55 var(--font-sans)',
            color: 'var(--text-tertiary)',
          }}
        >
          由服务端 <CodeRef>deriveMaxProcesses</CodeRef> 算出，是购置服务器的依据。平台值 ·
          非承诺值。
        </span>
      </div>
    </section>
  )
}
