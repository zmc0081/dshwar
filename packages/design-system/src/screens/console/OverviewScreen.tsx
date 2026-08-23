/**
 * 控制台「租户用量总览」屏。
 *
 * ## V0.9.0 Session 3:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)副标题、四个指标、降级提示、配额条、整张租户表全部硬编码 ——
 * 那是刻意的,那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `usage` 收到的是已经加过千位分隔的
 * `'1,284,905'`,`status` 是一个枚举而不是一段 `<Tag>` JSX。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 * 换算(token 数 → `'2.56M'`、分 → `'¥ 38,204'`)是调用方的事。
 *
 * ⚠️ **配额条是唯一的例外,它收原始数字。** {@link QuotaBar} 要按 `used / total`
 * 算条的长度与目标线的位置 —— 那是几何,不是文本,给它一个 `'2.56M'` 画不出来。
 * 「已格式化」这条纪律管的是**给人读的字**,不管**用来算布局的数**。
 *
 * ## 🚨 三处真缺陷,都是「界面说出的事,比系统实际知道的多」
 *
 * ### 1. 降级提示无条件渲染
 *
 * kit 里 `<DegradeNotice from="opus-4-1" to="sonnet-4-5" />` 是常量,
 * 于是总览页**永远**在说「容量受限,本次由 opus-4-1 降级至 sonnet-4-5」——
 * 包括这一刻一次降级都没发生的时候。
 *
 * 一条恒为真的告警不只是「没用」:它是一句**具体的、可被追查的假陈述**。
 * 管理员会照着它去查 opus-4-1 的容量、去问为什么账单里没有 opus 的量,
 * 而那件事从来没发生过。与「假成功回执」同族。
 * ⇒ `degrade` 可以是 `null`,`null` 时这一条根本不渲染。
 *
 * ### 2. 「查看全部 24 个」按钮做的是「打开第一个租户」
 *
 * 原版这个按钮的 `onClick` 调的是 `onOpenTenant(0)` —— 按钮上写着「全部」,
 * 点下去到的是 `acme-prod` 一个租户的详情页。同样是回执与实际动作不一致,
 * 只不过这次的「回执」是按钮上那行字。
 * ⇒ 拆成两个 handler:{@link OverviewScreenProps.onViewAllTenants} 与
 * {@link OverviewScreenProps.onOpenTenant}。
 *
 * ### 3. 表格的高亮行写死在第 0 行
 *
 * 原版给 `Table` 传的是一个常量下标,于是第一行**永远**呈选中底色。
 * 它读起来像「当前租户是 acme-prod」,而实际上没有任何东西被选中 ——
 * 那只是排序的结果。换一种排序,它会指着另一个租户说同样的话。
 * ⇒ 提成必填 prop,`-1` = 不高亮任何一行。
 *
 * ## ⚠️ 两处写死的数,不算缺陷但同样得是 props
 *
 * - 副标题里的「数据延迟 ≤ 5 分钟」是一句 **SLA 口径**。设计系统不知道真实延迟,
 *   写死等于替平台承诺一个它没承诺过的数;取不到就传 `null`,**少说一句话**。
 * - 「计费周期 2026-08-01 至 2026-08-31」写死之后,这一屏到了九月仍然显示八月 ——
 *   而它下面那些数字是九月的。
 *
 * ## ⚠️ 指标与配额条说的是同一组数,一致性由调用方保证
 *
 * `metrics.monthlyUsage`(`'2.56M'` / `'配额 4.00M · 64%'`)与 `quota`
 * (`used` / `total`)是同一件事的两种表达。组件不替调用方换算 ——
 * 换算就要在设计系统里实现数字缩写与本地化,而那是宿主的事。
 * 与产物屏「预览必须属于选中行」同一条约束:**由调用方负责保持一致**。
 *
 * ## 「平台容量」卡与 `capacity.ts` 的 `CapacityReading` **不是一回事**
 *
 * 名字撞了,东西不同:这张卡是**本月 token 配额**(用量 / 额度),
 * 而 `CapacityReading` 是**隔离档下的进程与成员上限**(`maxProcesses` /
 * `memberCap` / `rssPerProcessMb`)。一个按 token 算、一个按内存算,
 * 硬套成同一个类型会造出一个既不是配额也不是容量的四不像。
 * 这一屏因此**不** import `./capacity.ts`。
 *
 * ## 与设计 kit 的差别(移植时的三处机械转换,原样保留)
 *
 * 1. 首行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. `PageHead` 在 kit 里由 `Shell.jsx` 挂到 window,移植后从 `./Shell.tsx` 引 ——
 *    它的定义位置没变,只是取用方式从全局变成模块导入。
 * 3. `COLUMNS` 标注 {@link TableColumn}:不标的话 `align: 'right'` 会被推宽成
 *    `string`,与 `TableColumn` 的字面量联合对不上。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid / flex),
 * 做成 CSS 类会产生几百个只用一次的类。`check-guards.mjs` 的
 * 「前端不得用 JS 承载 hover / active / focus」刻意**不**禁 `style={{}}` 本身,
 * 禁的是用 JS 表达 CSS 伪类本来就能表达的状态 —— 本屏没有那类写法。
 *
 * @module @dshwar/design-system/screens/console/OverviewScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { DegradeNotice } from '../../components/DegradeNotice.tsx'
import { Metric } from '../../components/Metric.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import { PageHead } from './Shell.tsx'

/** 计费周期的两端。都是**已格式化**的日期串,如 `'2026-08-01'`。 */
export interface OverviewPeriod {
  readonly start: string
  readonly end: string
}

/** 一个指标卡的内容。 */
export interface OverviewMetric {
  /** 主数值,**已格式化**,如 `'2.56M'` / `'¥ 38,204'`。 */
  readonly value: string
  /**
   * 附注,已格式化,如 `'配额 4.00M · 64%'`。
   *
   * 给不出时传 `null` —— **不要传 `'—'`**:附注不是表格里的一列,
   * 缺了就不显示这一行,而不是显示一行「这里应该有个数但没有」。
   */
  readonly note: string | null
}

/**
 * 顶部四个指标。**具名字段而不是数组** —— 数组少一个元素只是少一格,
 * 具名少一个字段是**编译错误**。
 *
 * 标签文案(「本月消耗」这些)留在组件里:那是设计文案,不是数据。
 */
export interface OverviewMetrics {
  readonly monthlyUsage: OverviewMetric
  readonly activeTenants: OverviewMetric
  readonly agentRuns: OverviewMetric
  /** 预估账单。渲染成 muted —— 它是估算值,不是承诺值,不该与前三个一样重。 */
  readonly estimatedBill: OverviewMetric
}

/** 本次生效的模型降级。 */
export interface OverviewDegrade {
  /** 原模型名,如 `'opus-4-1'`。 */
  readonly from: string
  /** 实际用上的模型名,如 `'sonnet-4-5'`。 */
  readonly to: string
  /**
   * 原因短语,如 `'容量受限'`。**必填。**
   *
   * {@link DegradeNotice} 自带一个「容量受限」的默认值,而降级理由是
   * 平台对自己行为的解释:让它悄悄回落到默认,等于替平台编一个
   * 它从没给过的理由 —— 而那个理由看上去与真的一模一样。
   */
  readonly reason: string
}

/**
 * 「平台容量」卡上那条配额条的三个数。
 *
 * ⚠️ **这三个是原始数字,不是展示串** —— 理由见模块注释里的那条例外。
 */
export interface OverviewQuota {
  /** 已用量。 */
  readonly used: number
  /** 平台容量。**非承诺值**,条上的附注会这么写。 */
  readonly total: number
  /**
   * 客户自设的配额目标线;没设过传 `null` —— 条上就**不画**那根线,
   * 而不是把它画在 100% 处冒充「目标就是用满」。
   */
  readonly target: number | null
}

/**
 * 租户在总览表里的状态。**闭集**,与 `Tag` 的 tone 一一对应。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的服务端状态应该在**转换层**停下来报错,
 * 而不是在表里显示成一个含糊的灰标签 —— 后者会让一个新增的服务端状态
 * 悄悄退化成「看起来正常」。
 */
export type OverviewTenantStatus = 'running' | 'near-quota' | 'suspended' | 'pending-approval'

const STATUS_OF: Record<
  OverviewTenantStatus,
  { tone: 'success' | 'warn' | 'neutral'; label: string; dot: boolean }
> = {
  running: { tone: 'success', label: '运行中', dot: true },
  'near-quota': { tone: 'warn', label: '接近配额', dot: false },
  suspended: { tone: 'neutral', label: '已停用', dot: false },
  'pending-approval': { tone: 'warn', label: '待审批', dot: false },
}

/** 总览表里的一行。字段都是**已经格式化好的展示串**。 */
export interface OverviewTenantRow {
  /**
   * 租户 id。行点击带着**它**跳,不带行号 ——
   * 行号是这一次排序的产物,而 id 不随排序变。
   */
  readonly id: string
  /** 租户名,如 `'acme-prod'`。 */
  readonly name: string
  /** 默认模型名,如 `'sonnet-4-5'`。 */
  readonly defaultModel: string
  /** 本月用量,已加千位分隔,如 `'1,284,905'`。 */
  readonly usage: string
  /** 配额占比,已格式化,如 `'64.2%'`。没设配额时传 `'—'`,**不是 `'0%'`**。 */
  readonly quotaShare: string
  readonly status: OverviewTenantStatus
}

export interface OverviewScreenProps {
  /** 这一屏的数字属于哪个计费周期。 */
  readonly period: OverviewPeriod
  /**
   * 数据新鲜度口径,如 `'数据延迟 ≤ 5 分钟'`。
   *
   * 取不到传 `null` —— 那时副标题少说这一句,**而不是退回一个写死的「≤ 5 分钟」**。
   */
  readonly freshness: string | null
  readonly metrics: OverviewMetrics
  /** 本次生效的模型降级;`null` = 没有降级,这一条不渲染。见模块注释 🚨 1。 */
  readonly degrade: OverviewDegrade | null
  readonly quota: OverviewQuota
  /** 总览表里要展示的租户。空数组 = 一个租户都没有,显示朴素空态。 */
  readonly rows: readonly OverviewTenantRow[]
  /**
   * 高亮哪一行。`-1` = 不高亮。
   *
   * 总览表**没有**「选中」语义(点一行就跳走了),这个下标通常用来标出
   * 顶栏那个「当前租户」。写死成 0 的后果见模块注释 🚨 3。
   */
  readonly selectedIndex: number
  /**
   * 租户总数的展示串,如 `'24'`,用于「查看全部 N 个」。
   *
   * 与 `rows.length` 是两回事:`rows` 是全表的**前几行**,总数通常更大。
   * 但反过来有一条硬含义 —— **非空列表的前几行不可能是空的**:
   * `rows` 为空就意味着一个租户都没有,那时这个串应当是 `'0'`。
   * 「查看全部」的禁用态就据此判断。
   */
  readonly tenantTotal: string
  /** 打开某个租户的详情。参数是租户 id,不是行号。 */
  readonly onOpenTenant?: (id: string) => void
  /** 去租户列表屏。**不是**「打开第一个租户」—— 见模块注释 🚨 2。 */
  readonly onViewAllTenants?: () => void
  readonly onExportUsage?: () => void
  readonly onCreateTenant?: () => void
}

const COLUMNS: TableColumn[] = [
  { key: 't', label: '租户' },
  { key: 'm', label: '默认模型', mono: true },
  { key: 'u', label: '本月用量 (tok)', align: 'right', mono: true },
  { key: 'q', label: '配额占比', align: 'right', mono: true },
  { key: 's', label: '状态' },
]

export function OverviewScreen({
  period,
  freshness,
  metrics,
  degrade,
  quota,
  rows,
  selectedIndex,
  tenantTotal,
  onOpenTenant,
  onViewAllTenants,
  onExportUsage,
  onCreateTenant,
}: OverviewScreenProps): React.JSX.Element {
  const cycle = `计费周期 ${period.start} 至 ${period.end}`

  const tableRows = rows.map((row) => {
    const { tone, label, dot } = STATUS_OF[row.status]
    return {
      t: row.name,
      m: row.defaultModel,
      u: row.usage,
      q: row.quotaShare,
      s: (
        <Tag tone={tone} dot={dot}>
          {label}
        </Tag>
      ),
    }
  })

  return (
    <>
      <PageHead
        title="租户用量总览"
        sub={freshness === null ? cycle : `${cycle} · ${freshness}`}
        actions={
          <>
            <Button icon="download" onClick={() => onExportUsage?.()}>
              导出用量
            </Button>
            <Button variant="primary" icon="plus" onClick={() => onCreateTenant?.()}>
              创建租户
            </Button>
          </>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-5)' }}>
        <MetricCard label="本月消耗" metric={metrics.monthlyUsage} tone="default" />
        <MetricCard label="活跃租户" metric={metrics.activeTenants} tone="default" />
        <MetricCard label="Agent 运行" metric={metrics.agentRuns} tone="default" />
        <MetricCard label="预估账单" metric={metrics.estimatedBill} tone="muted" />
      </div>
      {/* 没有降级就什么都不说 —— 一条恒为真的告警是假陈述,见模块注释 🚨 1。 */}
      {degrade === null ? null : (
        <DegradeNotice from={degrade.from} to={degrade.to} reason={degrade.reason} />
      )}
      <Card title="平台容量" pad="var(--s-6)">
        <QuotaBar
          used={quota.used}
          total={quota.total}
          // `exactOptionalPropertyTypes` 下不能把 `undefined` 显式赋给 `target?: number`,
          // 所以「没有目标线」用条件展开表达,而不是传一个假的 0。
          {...(quota.target === null ? {} : { target: quota.target })}
        />
      </Card>
      <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2
            style={{
              margin: 0,
              color: 'var(--text-body)',
              font: 'var(--fw-semi) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
              letterSpacing: 'var(--ls-title-2)',
            }}
          >
            租户
          </h2>
          {/* `rows` 是全表的前几行,空 ⇒ 一个租户都没有(见 `tenantTotal` 的说明)。
              那时没有「全部」可看 —— 让它可点却跳到一张空列表,
              是另一种「界面说的比系统做的多」。 */}
          <Button
            variant="ghost"
            size="compact"
            disabled={rows.length === 0}
            onClick={() => onViewAllTenants?.()}
          >
            查看全部 {tenantTotal} 个
          </Button>
        </div>
        {rows.length === 0 ? (
          <Card>
            <Empty text="还没有租户。创建第一个租户之后，它的用量会出现在这里。" />
          </Card>
        ) : (
          <Table
            columns={COLUMNS}
            rows={tableRows}
            selectedIndex={selectedIndex}
            onRowClick={(index) => {
              // `noUncheckedIndexedAccess` 下这是 `OverviewTenantRow | undefined`。
              // 取不到就什么都不做:宁可不跳,也不要跳到一个猜出来的租户。
              const row = rows[index]
              if (row !== undefined) onOpenTenant?.(row.id)
            }}
          />
        )}
      </div>
    </>
  )
}

/**
 * 一张指标卡。
 *
 * 抽出来只为了 `note === null` 那一处:`exactOptionalPropertyTypes` 下
 * 不能把 `undefined` 显式赋给 `sub?: string`,得条件展开 ——
 * 而在四张卡的 JSX 里各写一遍会把布局淹掉。
 */
function MetricCard({
  label,
  metric,
  tone,
}: {
  label: string
  metric: OverviewMetric
  tone: 'default' | 'muted'
}): React.JSX.Element {
  return (
    <Card>
      <Metric
        label={label}
        value={metric.value}
        tone={tone}
        {...(metric.note === null ? {} : { sub: metric.note })}
      />
    </Card>
  )
}

/**
 * 卡片里的空态。刻意朴素 —— 空不是错误,不该长得像错误。
 *
 * 与产物屏、作业屏各留一份,没有抽成公共件:那是组件层的决定
 * (要不要有 `EmptyState`、它的契约是什么),不在本次「把夹具提成 props」的纪律之内。
 */
function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <span
      style={{
        font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
        color: 'var(--text-tertiary)',
      }}
    >
      {text}
    </span>
  )
}
