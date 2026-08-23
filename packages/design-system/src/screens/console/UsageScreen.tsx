/**
 * 用量看板:四张指标卡 + 消耗趋势图 + 按维度明细表;零行时走 `EmptyState`。
 *
 * ## V0.9.0 Session 3:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)四张卡的数字、7 天序列、6 行明细、页脚的 requestId
 * 全部硬编码 —— 那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** 契约的 `UsageRecord` 是**逐条明细**
 * (`subjectId` / `tenantId` / `date` / `provider` / `model` / `inputTokens` /
 * `outputTokens` / `costMinorUnits` / `currency`),而这一屏展示的是**聚合之后**的东西:
 *
 * | 屏上的字段 | 从 `UsageRecord` 怎么来 |
 * | --- | --- |
 * | `UsageRow.key` | 按 `dimension` 取 `model` / `tenantId` / 部门映射 |
 * | `UsageRow.runs` | 该组的记录条数,已千分位 |
 * | `UsageRow.inputTokens` / `outputTokens` | ∑ 对应字段,已千分位 |
 * | `UsageRow.share` | 该组合计 ÷ 全体合计,已成 `'46.2%'` |
 * | `UsageRow.cost` | ∑`costMinorUnits` ÷ 100,按 `currency` 格式化 |
 * | `UsageScreenProps.period` | 计费周期,由 `date` 的范围推出 |
 *
 * 聚合与格式化都是**调用方**的事,理由与 `ArtifactsScreen` 同:
 * `@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主以及将来的白牌前端复用,而它们的数据来源不一定相同。
 *
 * ⚠️ **一个例外:`trend` 里的 `values` 是裸数字。** 柱高是几何量,
 * `'412,000'` 画不出高度来。判据不是「数字一律格式化」,而是
 * **凡当作文字显示的数都已格式化** —— 喂给几何的这一处不是文字。
 *
 * ## 三个 `useState` 全部提成 props
 *
 * 原注释说 `dim` / `dense` / `count` 是「真状态」。这句话是对的,而且正是
 * 它们不该留在这一屏的理由:**真状态意味着有人要为它负责**。换维度要重新聚合
 * (那是一次请求),而请求由宿主发;柱宽决定图表画几条序列(细柱上限 4、
 * 常规 6),一个私有的开关能**静默地少画两条数据**而宿主毫不知情。
 *
 * ## 🚨 修的几处真缺陷
 *
 * | 缺陷 | 为什么算缺陷 |
 * | --- | --- |
 * | `empty?: boolean` 演示开关 | 空态与数据是**两个事实源**,可以互相矛盾 |
 * | 两个筛选 `Select` 是死的 | `value` 写死 + `onChange={() => {}}`,吞掉用户的每一次选择 |
 * | `req_a41b8c92f0` 写死 | 接上真 API 就是**伪造的证据** |
 * | 表头 `成本 (¥)` 写死 | 而 `UsageRecord` 每条都带 `currency` |
 * | 空态 hint 里的「0 次运行」 | 屏幕替服务端断言了一个它数不出来的数 |
 * | 下钻按钮不知道自己是哪一行 | 于是接不上 `onClick` |
 *
 * ### 🚨 `empty` 开关:第二个事实源
 *
 * `empty={true}` 而 `rows` 有六行 —— 界面说「这个周期还没有用量」,数据就在手里;
 * 反过来 `empty={false}` 而 `rows` 为空 —— 一张有表头、没有任何行、
 * 也**没有任何解释**的表。两种都不需要谁犯错,只需要两个 prop 不同步。
 *
 * ⇒ 空态现在由 `rows.length === 0` 推出,**结构上不可能与数据不一致**。
 * 这与 `capacity.ts` 里那笔 D2 老账是同一条判据:能对不上的两个来源,
 * 迟早会对不上。
 *
 * ### 🚨 `requestId`:写死的 id 是伪造的证据
 *
 * 在设计 kit 里 `req_a41b8c92f0` 无害 —— 那里没有服务端。接上真 API 之后
 * 它变成一件**看起来可核对、实际核对不了**的东西:用户把它贴进工单,
 * 而服务端日志里根本没有这个 id,于是排查从「查这次请求」变成「查为什么查不到」。
 * 与「假成功回执」同族 —— 系统给出的凭据与它实际做过的事不一致。
 *
 * ⇒ 提成 `requestId: string | null`。`null` 时**整段不显示**,
 * 而不是显示一个占位串:一个说不出处的界面,好过一个说错出处的界面。
 *
 * ## 与设计 kit 的差别:样式仍然全部内联
 *
 * 屏幕里的 `style={{}}` 多是一次性布局,没有要转成伪类的交互态,原样保留。
 *
 * @module @dshwar/design-system/screens/console/UsageScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Metric } from '../../components/Metric.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { EmptyState } from './TenantsScreen.tsx'
import { PageHead } from './Shell.tsx'
import { UsageChart, type UsageChartGroup } from './UsageChart.tsx'

/**
 * 可分组的三个维度。**闭集**。
 *
 * ⚠️ 不要加「未知」档。认不出的维度应当在**转换层**停下来报错,
 * 而不是在这里退化成「模型」—— 后者会让一个新增的服务端维度悄悄显示成
 * 另一个维度的数据,而表头看起来完全正常。
 *
 * 写成 `as const` 数组再派生类型,是因为下拉框要**按顺序**列出它们:
 * TS 的类型联合在运行时不存在,拿不到顺序,也数不出个数。
 */
export const USAGE_DIMENSIONS = ['model', 'tenant', 'department'] as const

export type UsageDimension = (typeof USAGE_DIMENSIONS)[number]

/** 柱宽档位。**闭集**,两个档位对应图表自己的两条序列上限(4 / 6)。 */
export type UsageBarDensity = 'thin' | 'regular'

const BAR_WIDTH: Record<UsageBarDensity, number> = { thin: 6, regular: 12 }

/**
 * 每个维度的表头文案与字体。
 *
 * `mono` 不是排版偏好:mono 是留给**机器串**的。模型名与租户 id 要逐字符核对,
 * 部门名是人写的中文,等宽反而更难读。
 */
const DIMENSION_META: Record<UsageDimension, { readonly label: string; readonly mono: boolean }> = {
  model: { label: '模型', mono: true },
  tenant: { label: '租户', mono: true },
  department: { label: '部门', mono: false },
}

/**
 * 下拉框给回来的是**标签**,而 `onDimensionChange` 要的是维度 id。
 *
 * 这里查表反查而不是断言:options 就是这三个标签,值落不到集合外,
 * 但那是**运行时**的保证,不是类型系统看得见的保证。查不到就什么都不做 ——
 * 把一个认不出的标签硬塞成某一档,正是上面那条「不要加未知档」要防的事。
 */
function dimensionOfLabel(label: string): UsageDimension | undefined {
  return USAGE_DIMENSIONS.find((id) => DIMENSION_META[id].label === label)
}

/** 「N 维度」按钮在这两档之间来回,与图表自身的序列上限(细柱 4 / 常规 6)对齐。 */
const SERIES_LIMIT_WIDE = 6
const SERIES_LIMIT_NARROW = 4

/**
 * 一张指标卡的两段文本。**标签是固定 UI 文案,不由调用方给** ——
 * 四张卡各是什么指标是这一屏的设计,不是数据。
 */
export interface UsageMetricValue {
  /** 已人类化的数值,如 `'6.97M'` / `'¥ 18,402,751.60'`。 */
  readonly value: string
  /** 附注,mono caption,如 `'tok · 上周期 6.12M · +13.9%'`。取不到时传 `''`。 */
  readonly note: string
}

/**
 * 顶部四张指标卡。
 *
 * ⚠️ **四个字段全必填,没有默认值。** 默认值在这里是第二个事实源:
 * 漏传一个,界面照样显示一个像模像样的数,而没有任何东西会红。
 * 必填之后漏传是**编译错误** —— 那是最早、最响的一种失败。
 */
export interface UsageSummary {
  /** 本周期 token 消耗。 */
  readonly tokens: UsageMetricValue
  /** 本周期成本。数值自带货币符号(由调用方格式化)。 */
  readonly cost: UsageMetricValue
  /** 运行次数。 */
  readonly runs: UsageMetricValue
  /** 单次均耗。平台读数,刻意 muted —— 它是估算,不是承诺值。 */
  readonly perRun: UsageMetricValue
}

/** 明细表的一行。数值字段都是**已经格式化好的展示串**。 */
export interface UsageRow {
  /** 稳定 id —— 下钻按钮靠它知道自己属于哪一行。 */
  readonly id: string
  /** 维度值,如 `'sonnet-4-5'` / `'研发中台'`。 */
  readonly key: string
  /** 运行次数,已千分位。 */
  readonly runs: string
  /** 输入 token,已千分位。 */
  readonly inputTokens: string
  /** 输出 token,已千分位。 */
  readonly outputTokens: string
  /** 合计 token,已千分位。 */
  readonly totalTokens: string
  /** 占全体的比例,如 `'46.2%'`。 */
  readonly share: string
  /** 成本,已按 `currency` 格式化,如 `'18,204.51'`。 */
  readonly cost: string
}

export interface UsageScreenProps {
  /** 当前分组维度。 */
  readonly dimension: UsageDimension
  readonly onDimensionChange?: (next: UsageDimension) => void

  /** 顶部四张指标卡。 */
  readonly summary: UsageSummary

  /**
   * 趋势图的分组(一组 = X 轴上的一个刻度)。空数组 = 这个范围内没有点,
   * 那时**不画图**,给一句空态。
   *
   * ⚠️ 不要因为「反正没数据」就照画:`UsageChart` 取 `Math.max(...values)`,
   * 空集合给回 `-Infinity`,每根柱子的高度于是是 `NaN` —— 屏幕上是一张
   * **坏掉的图**,而不是一张空图。空不是错误,不该长得像错误。
   */
  readonly trend: readonly UsageChartGroup[]
  /** 序列名,顺序与每组 `values` 对应。 */
  readonly series: readonly string[]
  /** 画前几条序列。与图表**自身**的上限(细柱 4 / 常规 6)是两回事。 */
  readonly seriesLimit: number
  readonly onSeriesLimitChange?: (next: number) => void
  readonly barDensity: UsageBarDensity
  readonly onBarDensityChange?: (next: UsageBarDensity) => void

  /** 明细表的行。**零行 = 空态**,不需要另一个开关来说这件事。 */
  readonly rows: readonly UsageRow[]
  /**
   * 成本列的货币,如 `'¥'` / `'USD'`,原样进表头。
   *
   * ⚠️ 一张表里只能有一种货币 —— 混币求和得到的是一个**没有意义的数**,
   * 而它看起来和别的数一样正常。筛掉或分开聚合是调用方的事。
   */
  readonly currency: string
  readonly onDrillDown?: (id: string) => void

  /** 时间范围筛选的当前值与可选项。 */
  readonly range: string
  readonly rangeOptions: readonly string[]
  readonly onRangeChange?: (next: string) => void
  /** 租户筛选的当前值与可选项(含「全部」)。 */
  readonly tenant: string
  readonly tenantOptions: readonly string[]
  readonly onTenantChange?: (next: string) => void

  /** 已格式化的计费周期,如 `'2026-08-01 至 2026-08-31'`。空态里作为唯一线索。 */
  readonly period: string
  /**
   * 这批数字来自哪次请求。`null` = 没有可追溯的请求(例如本地缓存回放),
   * 那时**不显示**这一段。
   */
  readonly requestId: string | null

  readonly onExportCsv?: () => void
  readonly onBillingPreview?: () => void
}

export function UsageScreen({
  dimension,
  onDimensionChange,
  summary,
  trend,
  series,
  seriesLimit,
  onSeriesLimitChange,
  barDensity,
  onBarDensityChange,
  rows,
  currency,
  onDrillDown,
  range,
  rangeOptions,
  onRangeChange,
  tenant,
  tenantOptions,
  onTenantChange,
  period,
  requestId,
  onExportCsv,
  onBillingPreview,
}: UsageScreenProps): React.JSX.Element {
  const meta = DIMENSION_META[dimension]
  const isEmpty = rows.length === 0
  const shownSeries = series.slice(0, seriesLimit)
  const hasTrend = trend.length > 0 && shownSeries.length > 0

  const columns: TableColumn[] = [
    { key: 'k', label: meta.label, mono: meta.mono },
    { key: 'runs', label: '运行', align: 'right', mono: true },
    { key: 'in', label: '输入 (tok)', align: 'right', mono: true },
    { key: 'out', label: '输出 (tok)', align: 'right', mono: true },
    { key: 'tot', label: '合计 (tok)', align: 'right', mono: true },
    { key: 'share', label: '占比', align: 'right', mono: true },
    { key: 'cost', label: `成本 (${currency})`, align: 'right', mono: true },
    { key: 'a', label: '', align: 'right', width: '40px' },
  ]

  const tableRows: Record<string, React.ReactNode>[] = rows.map((row) => ({
    k: row.key,
    runs: row.runs,
    in: row.inputTokens,
    out: row.outputTokens,
    tot: row.totalTokens,
    share: row.share,
    cost: row.cost,
    // ⚠️ 每行**各自**的下钻按钮。kit 里这个按钮既没有 onClick,也无从知道
    //   自己属于哪一行 —— 于是它接不上任何东西。
    //   `label` 也带上维度值:图标按钮没有可见文字,六个都叫「下钻」的话,
    //   读屏用户听到的是六个一模一样的按钮。
    a: (
      <IconButton
        icon="chevron-right"
        label={`下钻 ${row.key}`}
        onClick={() => onDrillDown?.(row.id)}
      />
    ),
  }))

  return (
    <>
      <PageHead
        title="用量看板"
        sub="按租户 / 时间 / 模型分组的 token 消耗与成本 · 数据延迟 ≤ 5 分钟"
        actions={
          <>
            <Button icon="download" disabled={isEmpty} onClick={() => onExportCsv?.()}>
              导出 CSV
            </Button>
            <Button
              variant="primary"
              icon="file-text"
              disabled={isEmpty}
              onClick={() => onBillingPreview?.()}
            >
              生成账单预览
            </Button>
          </>
        }
      />

      {isEmpty ? (
        <EmptyState
          icon="bar-chart-3"
          title="这个周期还没有用量"
          body="Agent 每次运行都会记账。第一次运行结束后，这里会按租户、模型、部门三个维度出现消耗与成本。"
          // 🚨 kit 原文是「计费周期 … · 0 次运行」。那句「0 次运行」删掉了:
          //    用量表为空只说明**这个周期没有用量记录**,不等于运行了 0 次 ——
          //    在产出用量之前就失败的运行根本不进这张表。屏幕替服务端断言了一个
          //    它数不出来的数,而管理员会拿它去对账。
          hint={`计费周期 ${period}`}
        />
      ) : (
        <>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-5)' }}
          >
            <Card>
              <Metric label="本周期消耗" value={summary.tokens.value} sub={summary.tokens.note} />
            </Card>
            <Card>
              <Metric label="成本" value={summary.cost.value} sub={summary.cost.note} />
            </Card>
            <Card>
              <Metric label="运行次数" value={summary.runs.value} sub={summary.runs.note} />
            </Card>
            <Card>
              <Metric
                label="单次均耗"
                value={summary.perRun.value}
                tone="muted"
                sub={summary.perRun.note}
              />
            </Card>
          </div>

          <Card
            title="消耗趋势"
            action={
              <span style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
                <Select
                  value={meta.label}
                  options={USAGE_DIMENSIONS.map((id) => DIMENSION_META[id].label)}
                  onChange={(e) => {
                    const next = dimensionOfLabel(e.target.value)
                    if (next !== undefined) onDimensionChange?.(next)
                  }}
                  style={{ width: 120 }}
                />
                <Button
                  size="compact"
                  variant={barDensity === 'thin' ? 'secondary' : 'ghost'}
                  onClick={() => onBarDensityChange?.('thin')}
                >
                  细柱 {BAR_WIDTH.thin}px
                </Button>
                <Button
                  size="compact"
                  variant={barDensity === 'regular' ? 'secondary' : 'ghost'}
                  onClick={() => onBarDensityChange?.('regular')}
                >
                  常规 {BAR_WIDTH.regular}px
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() =>
                    onSeriesLimitChange?.(
                      seriesLimit === SERIES_LIMIT_WIDE ? SERIES_LIMIT_NARROW : SERIES_LIMIT_WIDE,
                    )
                  }
                >
                  {seriesLimit} 维度
                </Button>
              </span>
            }
            pad="var(--s-8)"
          >
            {hasTrend ? (
              <UsageChart
                groups={[...trend]}
                series={shownSeries}
                barWidth={BAR_WIDTH[barDensity]}
              />
            ) : (
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                这个范围内没有可画的点。
              </span>
            )}
          </Card>

          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 'var(--s-5)',
                flexWrap: 'wrap',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  color: 'var(--text-body)',
                  whiteSpace: 'nowrap',
                  font: 'var(--fw-semi) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                  letterSpacing: 'var(--ls-title-2)',
                }}
              >
                按{meta.label}明细
              </h2>
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  gap: 'var(--s-5)',
                  alignItems: 'end',
                }}
              >
                {/* 🚨 kit 里这两个下拉的 value 写死、onChange 是空函数 ——
                    用户选「近 30 天」,控件立刻弹回「近 7 天」,而没有任何东西
                    说明发生了什么。**被吞掉的操作比被禁用的控件更糟**:
                    禁用是说出来的拒绝,吞掉是沉默的拒绝。 */}
                <Select
                  label="时间范围"
                  value={range}
                  options={[...rangeOptions]}
                  onChange={(e) => onRangeChange?.(e.target.value)}
                  style={{ width: 150 }}
                />
                <Select
                  label="租户"
                  value={tenant}
                  options={[...tenantOptions]}
                  onChange={(e) => onTenantChange?.(e.target.value)}
                  style={{ width: 150 }}
                />
              </span>
            </div>
            <Table columns={columns} rows={tableRows} />
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
                color: 'var(--text-tertiary)',
              }}
            >
              成本按上游单价 × 用量估算，非最终账单 · 汇率与税费在账单阶段结算
              {requestId === null ? null : (
                <>
                  {' · '}
                  <CodeRef copyable>{requestId}</CodeRef>
                </>
              )}
            </span>
          </div>
        </>
      )}
    </>
  )
}
