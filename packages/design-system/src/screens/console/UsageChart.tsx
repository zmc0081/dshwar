/**
 * 用量分组柱状图 + 图例。序列上限由柱宽决定,超限时先出一条「换表格」的提示。
 *
 * ## 与设计 kit 的差别:只有 `window` 全局换成了 ES import
 *
 * 这一屏没有 JS 承载的交互态。柱子的填充是**按数据算出来的一次性样式**
 * (点阵是 radial-gradient,尺寸随 `barWidth` 与数值变),保持内联 ——
 * 做成类反而要为每个序列 × 每个高度生成一条规则。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 图表序列规则(tokens/chart.css):
 * 细柱状(柱宽 ≤8px)上限 4 · 常规(≥12px)上限 6
 * 第二编码通道 = 点阵 d1.5px / s3px / 相位固定 (1.5,1.5),不用斜纹
 * s2→s3 与 s5→s6 只有 2.71:1 → 必须同时靠形态或标注区分
 * 已配置态只换 s1 为 accent.solid,s2–s6 保持中性
 *
 * @module @dshwar/design-system/screens/console/UsageChart
 */
import type * as React from 'react'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'

interface SeriesSpec {
  /** chart.css 的序列色 token */
  tone: string
  /** 第二编码通道:实心 or 点阵 */
  fill: 'solid' | 'dot'
  /** 图例里标出的中性档位,读图时的第三个线索 */
  step: string
}

const SERIES: readonly SeriesSpec[] = [
  { tone: 'var(--chart-1)', fill: 'solid', step: 'n-900' },
  { tone: 'var(--chart-2)', fill: 'solid', step: 'n-600' },
  { tone: 'var(--chart-3)', fill: 'solid', step: 'n-300' },
  { tone: 'var(--chart-4)', fill: 'dot', step: 'n-900' },
  { tone: 'var(--chart-5)', fill: 'dot', step: 'n-600' },
  { tone: 'var(--chart-6)', fill: 'dot', step: 'n-300' },
]
const LIGHT = 2 // index of the n-300 tone within each triplet

/**
 * `SERIES` 的下标访问。
 *
 * `noUncheckedIndexedAccess` 下数组下标是 `T | undefined`,必须收窄。
 * 越界是编程错误(调用方保证 `i < cap ≤ SERIES.length`),所以抛 ——
 * 与 kit 里读 `undefined.fill` 抛 TypeError 是同一种失败,只是消息可读。
 */
function seriesAt(i: number): SeriesSpec {
  const s = SERIES[i]
  if (s === undefined) throw new RangeError(`序列下标 ${i} 越界(共 ${SERIES.length} 条)`)
  return s
}

function fillStyle(i: number): React.CSSProperties {
  const s = seriesAt(i)
  const light = i % 3 === LIGHT
  const base: React.CSSProperties = { borderRadius: 2 }
  if (s.fill === 'dot') {
    base.background = `radial-gradient(circle at 1.5px 1.5px, ${s.tone} 0 0.75px, transparent 0.76px) 0 0/3px 3px, var(--surface-card)`
  } else {
    base.background = s.tone
  }
  if (light) {
    base.outline = '1px solid var(--chart-stroke-light)'
    base.outlineOffset = '-1px'
  }
  return base
}

export interface UsageSwatchProps {
  /** 序列下标,决定色与填充形态 */
  i: number
  /** 边长 px,默认 12 */
  size?: number
}

/** 图例色块。与柱子共用同一个 `fillStyle`,形态因此不会两处分家。 */
export function UsageSwatch({ i, size = 12 }: UsageSwatchProps): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        flex: '0 0 auto',
        ...fillStyle(i),
      }}
    />
  )
}

export interface UsageChartGroup {
  /** X 轴刻度标签(mono) */
  label: string
  /** 每个序列一个值,顺序与 `series` 对应 */
  values: number[]
}

export interface UsageChartProps {
  groups: UsageChartGroup[]
  /** 序列名,顺序与每组 `values` 对应 */
  series: string[]
  /** 柱宽 px。≤8 视为细柱(序列上限 4),否则常规(上限 6) */
  barWidth: number
}

export function UsageChart({ groups, series, barWidth }: UsageChartProps): React.JSX.Element {
  const narrow = barWidth <= 8
  const cap = narrow ? 4 : 6
  const shown = Math.min(series.length, cap)
  const over = series.length > cap
  const max = Math.max(...groups.flatMap((g) => g.values.slice(0, shown)))
  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {over ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-4)',
            alignItems: 'flex-start',
            padding: 'var(--s-4) var(--s-5)',
            borderRadius: 'var(--r-1)',
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-default)',
          }}
        >
          <Icon name="table-2" size={14} />
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            柱宽 <CodeRef>{barWidth}px</CodeRef> 下序列上限 {cap}，当前 {series.length}{' '}
            个维度。已只画前 {shown} 个 —— 剩下的请换
            <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>表格</b>或
            <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>分面小图</b>
            ，不硬塞。
          </span>
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--s-5)',
          height: 208,
          padding: '0 var(--s-2)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        {groups.map((g) => (
          <div key={g.label} style={{ display: 'grid', gap: 'var(--s-3)', justifyItems: 'center' }}>
            <span style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 176 }}>
              {g.values.slice(0, shown).map((v, i) => {
                // `shown ≤ series.length`,所以这里取得到;收窄是 noUncheckedIndexedAccess 的要求。
                const name = series[i]
                return (
                  <span
                    key={i}
                    title={
                      name === undefined ? undefined : `${name} · ${v.toLocaleString('en-US')} tok`
                    }
                    style={{
                      width: barWidth,
                      height: Math.max(6, Math.round((v / max) * 172)),
                      ...fillStyle(i),
                    }}
                  />
                )
              })}
            </span>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                color: 'var(--text-tertiary)',
                whiteSpace: 'nowrap',
              }}
            >
              {g.label}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-6)', flexWrap: 'wrap' }}>
        {series.slice(0, shown).map((s, i) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
            <UsageSwatch i={i} />
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                color: 'var(--text-secondary)',
              }}
            >
              {s}
            </span>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                color: 'var(--text-tertiary)',
              }}
            >
              {seriesAt(i).step}
              {seriesAt(i).fill === 'dot' ? ' · 点阵' : ''}
            </span>
          </span>
        ))}
      </div>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
          color: 'var(--text-tertiary)',
        }}
      >
        相邻序列 s2→s3 与 s5→s6 仅 2.71:1 —— 图例的形态标注（实心 / 点阵 /
        描边）是它们的第二区分通道，不要只靠颜色读图。
      </span>
    </div>
  )
}
