/**
 * 控制台「租户用量总览」屏。
 *
 * ## 与设计 kit 的差别:三处,全是机械转换
 *
 * 1. 首行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. `PageHead` 在 kit 里由 `Shell.jsx` 挂到 window,移植后从 `./Shell.tsx` 引 ——
 *    它的定义位置没变,只是取用方式从全局变成模块导入。
 * 3. `cols` 标注 {@link TableColumn}:不标的话 `align: 'right'` 会被推宽成 `string`,
 *    与 `TableColumn` 的字面量联合对不上。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid / flex),
 * 做成 CSS 类会产生几百个只用一次的类。`check-guards.mjs` 的
 * 「前端不得用 JS 承载 hover / active / focus」刻意**不**禁 `style={{}}` 本身,
 * 禁的是用 JS 表达 CSS 伪类本来就能表达的状态 —— 本屏没有那类写法。
 *
 * ## 表格与指标里的是设计 kit 的夹具数据
 *
 * 原样保留。接真实 API 是后面 Session 的事,这一轮只做移植。
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

export interface OverviewScreenProps {
  /** 打开某个租户的详情;参数是租户在表格里的行号 */
  onOpenTenant: (index: number) => void
}

export function OverviewScreen({ onOpenTenant }: OverviewScreenProps): React.JSX.Element {
  const cols: TableColumn[] = [
    { key: 't', label: '租户' },
    { key: 'm', label: '默认模型', mono: true },
    { key: 'u', label: '本月用量 (tok)', align: 'right', mono: true },
    { key: 'q', label: '配额占比', align: 'right', mono: true },
    { key: 's', label: '状态' },
  ]
  const rows: Record<string, React.ReactNode>[] = [
    {
      t: 'acme-prod',
      m: 'sonnet-4-5',
      u: '1,284,905',
      q: '64.2%',
      s: (
        <Tag tone="success" dot>
          运行中
        </Tag>
      ),
    },
    {
      t: 'acme-staging',
      m: 'haiku-4-5',
      u: '312,440',
      q: '92.7%',
      s: <Tag tone="warn">接近配额</Tag>,
    },
    {
      t: 'lab-sandbox',
      m: 'opus-4-1',
      u: '58,102',
      q: '11.6%',
      s: <Tag tone="neutral">已停用</Tag>,
    },
    {
      t: 'ops-internal',
      m: 'sonnet-4-5',
      u: '903,771',
      q: '45.1%',
      s: <Tag tone="warn">待审批</Tag>,
    },
  ]
  return (
    <>
      <PageHead
        title="租户用量总览"
        sub="计费周期 2026-08-01 至 2026-08-31 · 数据延迟 ≤ 5 分钟"
        actions={
          <>
            <Button icon="download">导出用量</Button>
            <Button variant="primary" icon="plus">
              创建租户
            </Button>
          </>
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-5)' }}>
        <Card>
          <Metric label="本月消耗" value="2.56M" sub="配额 4.00M · 64%" />
        </Card>
        <Card>
          <Metric label="活跃租户" value="18" sub="共 24 个 · 6 个已停用" />
        </Card>
        <Card>
          <Metric label="Agent 运行" value="9,412" sub="失败 41 · 0.44%" />
        </Card>
        <Card>
          <Metric label="预估账单" value="¥ 38,204" tone="muted" sub="未含税 · 按日结算" />
        </Card>
      </div>
      <DegradeNotice from="opus-4-1" to="sonnet-4-5" />
      <Card title="平台容量" pad="var(--s-6)">
        <QuotaBar used={2560000} total={4000000} target={3600000} />
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
          <Button variant="ghost" size="compact" onClick={() => onOpenTenant(0)}>
            查看全部 24 个
          </Button>
        </div>
        <Table columns={cols} rows={rows} selectedIndex={0} onRowClick={onOpenTenant} />
      </div>
    </>
  )
}
