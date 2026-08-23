/**
 * 用量看板：四张指标卡 + 消耗趋势图 + 按维度明细表;空状态走 `EmptyState`。
 *
 * ## 与设计 kit 的差别:只有 `window` 全局换成了 ES import
 *
 * 这一屏的 `useState` 全是**真状态**(看哪个维度、细柱还是常规、几个维度),
 * 不是交互态,所以原样保留 —— 守卫禁的是用 JS 表达 CSS 伪类本来就能表达的东西。
 * 样式同样全部保持内联,屏幕里的 `style={{}}` 多是一次性布局。
 *
 * 屏内的夹具数据(7 天序列、6 行明细)原样保留,接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/console/UsageScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Metric } from '../../components/Metric.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { EmptyState } from './TenantsScreen.tsx'
import { PageHead } from './Shell.tsx'
import { UsageChart } from './UsageChart.tsx'

/** 可分组的三个维度。表头是否 mono 取决于它 —— 「部门」是中文名,不 mono。 */
type DimKey = '模型' | '租户' | '部门'

const DIMS: Record<DimKey, string[]> = {
  模型: [
    'sonnet-4-5',
    'haiku-4-5',
    'opus-4-1',
    'sonnet-4-5-thinking',
    'haiku-4-5-batch',
    'opus-4-1-batch',
  ],
  租户: [
    'acme-prod',
    'acme-staging',
    'ops-internal',
    'finance-shared',
    'legal-review',
    'lab-sandbox',
  ],
  部门: ['研发中台', '客服运营', '财务共享', '法务', '销售', '人力'],
}

/**
 * `e.target.value` 的静态类型是 `string`,而 `setDim` 要 `DimKey`。
 *
 * 这里显式收窄而不是断言:options 就是 `Object.keys(DIMS)`,值落不到集合外,
 * 但那是**运行时**的保证,不是类型系统看得见的保证。
 */
function isDimKey(v: string): v is DimKey {
  return Object.prototype.hasOwnProperty.call(DIMS, v)
}

const SERIES_DATA: readonly (readonly [string, number[]])[] = [
  ['08-15', [412000, 208000, 96000, 61000, 38000, 21000]],
  ['08-16', [388000, 231000, 88000, 54000, 41000, 18000]],
  ['08-17', [441000, 196000, 104000, 72000, 33000, 25000]],
  ['08-18', [502000, 244000, 121000, 66000, 47000, 29000]],
  ['08-19', [468000, 218000, 99000, 58000, 44000, 23000]],
  ['08-20', [523000, 259000, 132000, 81000, 51000, 31000]],
  ['08-21', [486000, 227000, 113000, 69000, 39000, 26000]],
]

/** 明细表一行的六个数:运行 / 输入 / 输出 / 合计 / 占比 / 成本。 */
type UsageRowNums = readonly [string, string, string, string, string, string]

export interface UsageScreenProps {
  /** 空状态开关(顶栏的「有数据 / 空状态」分段控件) */
  empty?: boolean
}

export function UsageScreen({ empty }: UsageScreenProps): React.JSX.Element {
  const [dim, setDim] = useState<DimKey>('模型')
  const [dense, setDense] = useState(true)
  const [count, setCount] = useState(6)
  const series = DIMS[dim].slice(0, count)
  const groups = SERIES_DATA.map(([label, values]) => ({ label, values }))
  const cols: TableColumn[] = [
    { key: 'k', label: dim, mono: dim !== '部门' },
    { key: 'runs', label: '运行', align: 'right', mono: true },
    { key: 'in', label: '输入 (tok)', align: 'right', mono: true },
    { key: 'out', label: '输出 (tok)', align: 'right', mono: true },
    { key: 'tot', label: '合计 (tok)', align: 'right', mono: true },
    { key: 'share', label: '占比', align: 'right', mono: true },
    { key: 'cost', label: '成本 (¥)', align: 'right', mono: true },
    { key: 'a', label: '', align: 'right', width: '40px' },
  ]
  const nums: readonly UsageRowNums[] = [
    ['3,220', '2,412,905', '807,441', '3,220,346', '46.2%', '18,204.51'],
    ['1,884', '1,183,440', '399,102', '1,582,542', '22.7%', '6,092.18'],
    ['612', '598,102', '155,880', '753,982', '10.8%', '9,441.07'],
    ['404', '401,771', '98,220', '499,991', '7.2%', '2,118.44'],
    ['288', '271,088', '62,410', '333,498', '4.8%', '1,402.66'],
    ['166', '141,320', '38,902', '180,222', '2.6%', '744.09'],
  ]
  const rows: Record<string, React.ReactNode>[] = series.map((k, i) => {
    // `series` 最多 6 项,与 `nums` 等长;收窄是 noUncheckedIndexedAccess 的要求。
    const n = nums[i]
    if (n === undefined) throw new RangeError(`明细行 ${i} 没有对应的数字(共 ${nums.length} 行)`)
    return {
      k,
      runs: n[0],
      in: n[1],
      out: n[2],
      tot: n[3],
      share: n[4],
      cost: n[5],
      a: <IconButton icon="chevron-right" label="下钻" />,
    }
  })
  return (
    <>
      <PageHead
        title="用量看板"
        sub="按租户 / 时间 / 模型分组的 token 消耗与成本 · 数据延迟 ≤ 5 分钟"
        actions={
          <>
            <Button icon="download" disabled={empty}>
              导出 CSV
            </Button>
            <Button variant="primary" icon="file-text" disabled={empty}>
              生成账单预览
            </Button>
          </>
        }
      />

      {empty ? (
        <EmptyState
          icon="bar-chart-3"
          title="这个周期还没有用量"
          body="Agent 每次运行都会记账。第一次运行结束后，这里会按租户、模型、部门三个维度出现消耗与成本。"
          hint="计费周期 2026-08-01 至 2026-08-31 · 0 次运行"
        />
      ) : (
        <>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-5)' }}
          >
            <Card>
              <Metric label="本周期消耗" value="6.97M" sub="tok · 上周期 6.12M · +13.9%" />
            </Card>
            <Card>
              <Metric label="成本" value="¥ 18,402,751.60" sub="未含税 · 按日结算" />
            </Card>
            <Card>
              <Metric label="运行次数" value="6,574" sub="失败 41 · 0.62%" />
            </Card>
            <Card>
              <Metric label="单次均耗" value="1,060" tone="muted" sub="tok / run · 中位数 742" />
            </Card>
          </div>

          <Card
            title="消耗趋势"
            action={
              <span style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
                <Select
                  value={dim}
                  options={Object.keys(DIMS)}
                  onChange={(e) => {
                    const next = e.target.value
                    if (isDimKey(next)) setDim(next)
                  }}
                  style={{ width: 120 }}
                />
                <Button
                  size="compact"
                  variant={dense ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setDense(true)
                  }}
                >
                  细柱 6px
                </Button>
                <Button
                  size="compact"
                  variant={!dense ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setDense(false)
                  }}
                >
                  常规 12px
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    setCount(count === 6 ? 4 : 6)
                  }}
                >
                  {count} 维度
                </Button>
              </span>
            }
            pad="var(--s-8)"
          >
            <UsageChart groups={groups} series={series} barWidth={dense ? 6 : 12} />
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
                按{dim}明细
              </h2>
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  gap: 'var(--s-5)',
                  alignItems: 'end',
                }}
              >
                <Select
                  label="时间范围"
                  value="近 7 天"
                  options={['近 24 小时', '近 7 天', '近 30 天', '本计费周期']}
                  onChange={() => {}}
                  style={{ width: 150 }}
                />
                <Select
                  label="租户"
                  value="全部"
                  options={['全部', 'acme-prod', 'acme-staging']}
                  onChange={() => {}}
                  style={{ width: 150 }}
                />
              </span>
            </div>
            <Table columns={cols} rows={rows} />
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
                color: 'var(--text-tertiary)',
              }}
            >
              成本按上游单价 × 用量估算，非最终账单 · 汇率与税费在账单阶段结算 ·{' '}
              <CodeRef copyable>req_a41b8c92f0</CodeRef>
            </span>
          </div>
        </>
      )}
    </>
  )
}
