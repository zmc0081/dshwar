/**
 * 数据表。表格是这个产品的主要载体,密度优先于留白。
 *
 * ## 与设计 kit 的差别:hover 走 CSS 伪类,不走 `useState`
 *
 * kit 里的原版用 `React.useState(-1)` 记住 hover 的行号,再在每行的 style 里
 * 三元判断底色。移植时换成 `.ds-table__row:hover` ——
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`,表格这里还多一条:
 * **每 hover 一行就整表 re-render**,行数一多看得见。
 *
 * 底色的优先级链(选中 > hover > 斑马 > 透明)原样保留,由 CSS 的源码顺序表达,
 * 见 `styles/components/table.css` 的注释。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 紧凑行 36px(运营后台默认)/ 44px。无外阴影、无斑马纹(斑马纹在 8 列以上才启用 n-025)。
 * 数字右对齐 + tabular-nums。选中行用 accent.surface —— 审计表例外,用 selectionTone="neutral"。
 *
 * @module @dshwar/design-system/components/Table
 */
import type * as React from 'react'

export interface TableColumn {
  key: string
  label: string
  /** 数字列一律 right */
  align?: 'left' | 'right'
  /** ID / 模型名 / token 数 / 错误码 → mono */
  mono?: boolean
  width?: string
}

export interface TableProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  columns: TableColumn[]
  /** 每行是一个 { [column.key]: ReactNode } 对象 */
  rows: Record<string, React.ReactNode>[]
  /** compact = 36px(运营后台默认)· default = 44px */
  density?: 'compact' | 'default'
  selectedIndex?: number
  /** accent = accent.surface 选中底 · neutral = n-100(审计表必须用 neutral) */
  selectionTone?: 'accent' | 'neutral'
  onRowClick?: (index: number, row: Record<string, React.ReactNode>) => void
}

/**
 * 单元格类名。
 *
 * ⚠️ 表头**不吃** `mono` —— kit 的 `cell(col, true)` 里表头字体是无条件的
 * caption / sans,`col.mono` 只在 `isHead === false` 的那条分支上生效。
 */
function cellClass(col: TableColumn, isHead: boolean): string {
  const base = isHead ? 'ds-table__head-cell' : 'ds-table__cell'
  const classes = [base]
  if (col.align === 'right') classes.push(`${base}--right`)
  if (!isHead && col.mono === true) classes.push('ds-table__cell--mono')
  return classes.join(' ')
}

/**
 * 列宽:按数据给的一次性布局,保留内联。
 *
 * 条件展开而不是直接写 `{ width: col.width }` —— `exactOptionalPropertyTypes`
 * 下把 `undefined` 显式赋给可选属性是类型错误。
 */
function cellStyle(col: TableColumn): React.CSSProperties {
  return col.width === undefined ? {} : { width: col.width }
}

export function Table({
  columns = [],
  rows = [],
  density = 'compact',
  selectedIndex = -1,
  selectionTone = 'accent',
  onRowClick,
  ...rest
}: TableProps): React.JSX.Element {
  const zebra = columns.length > 8

  const classes = ['ds-table']
  if (density === 'default') classes.push('ds-table--density-default')
  if (zebra) classes.push('ds-table--zebra')
  if (selectionTone === 'neutral') classes.push('ds-table--selection-neutral')
  if (onRowClick !== undefined) classes.push('ds-table--clickable')

  return (
    <div className={classes.join(' ')} {...rest}>
      <table className="ds-table__grid">
        <thead>
          <tr className="ds-table__head-row">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cellClass(c, true)} style={cellStyle(c)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="ds-table__row"
              aria-selected={i === selectedIndex}
              onClick={() => onRowClick?.(i, r)}
            >
              {columns.map((c) => (
                <td key={c.key} className={cellClass(c, false)} style={cellStyle(c)}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
