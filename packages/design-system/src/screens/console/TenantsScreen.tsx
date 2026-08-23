/**
 * 租户列表屏：筛选条 + 容量读数 + 表格 + 分页;空状态走 `EmptyState`。
 *
 * ## 与设计 kit 的差别:只有 `window` 全局换成了 ES import
 *
 * 这一屏没有 JS 承载的交互态(选中行是真状态,由 `Table` 的 `selectedIndex` 表达),
 * 所以样式全部保持内联 —— 屏幕里的 `style={{}}` 多是一次性布局,
 * 做成类会产生几百个只用一次的类。
 *
 * 屏内的夹具数据(6 行租户、筛选项)原样保留,接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/console/TenantsScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { QuarantineBanner } from '../../components/QuarantineBanner.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import { CapacityReadout } from './CapacityReadout.tsx'
import { PageHead } from './Shell.tsx'

export interface EmptyStateProps {
  /** Lucide 图标名,置于 40×40 的 n-025 方块内 */
  icon: string
  /** title-3 17/700 */
  title: string
  /** 正文,body / n-700;最宽 460px */
  body: React.ReactNode
  /** 主操作,通常是 primary Button;省略则不渲染 */
  action?: React.ReactNode
  /** 补充说明,mono caption / n-600 */
  hint?: React.ReactNode
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  hint,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-3)',
        background: 'var(--surface-card)',
        padding: 'var(--s-11) var(--s-8)',
        display: 'grid',
        gap: 'var(--s-5)',
        justifyItems: 'center',
        textAlign: 'center',
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--r-2)',
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-hairline)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Icon name={icon} size={18} />
      </span>
      <div style={{ display: 'grid', gap: 'var(--s-3)', maxWidth: 460 }}>
        <span
          style={{
            font: 'var(--fw-bold) var(--fs-title-3)/var(--lh-title-3) var(--font-sans)',
            color: 'var(--text-body)',
          }}
        >
          {title}
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
          }}
        >
          {body}
        </span>
      </div>
      {action}
      {hint ? (
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-mono)',
            color: 'var(--text-tertiary)',
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export interface TenantsScreenProps {
  /** 空状态开关(顶栏的「有数据 / 空状态」分段控件) */
  empty?: boolean
  /** 透传给 CapacityReadout —— 逻辑档的 MEMBER CAP 是 1 人 */
  isolation?: 'logical' | 'process'
  /**
   * 打开某一行租户。
   *
   * ⚠️ kit 里这个回调**只在签名上存在**:表格的 `onRowClick` 只 `setSel(i)`,
   * 没有调用它。原样保留(不在移植里改行为),接线是后面 Session 的事。
   */
  onOpenTenant?: (index: number) => void
}

export function TenantsScreen({ empty, isolation }: TenantsScreenProps): React.JSX.Element {
  const [sel, setSel] = useState(0)
  const act = (
    <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
      <IconButton icon="pencil" label="编辑" />
      <IconButton icon="more-horizontal" label="更多" />
    </span>
  )
  const cols: TableColumn[] = [
    { key: 'name', label: '租户' },
    { key: 'id', label: '租户 ID', mono: true },
    { key: 'members', label: '成员', align: 'right', mono: true },
    { key: 'model', label: '默认模型', mono: true },
    { key: 'used', label: '本月用量 (tok)', align: 'right', mono: true },
    { key: 'quota', label: '预算占比', align: 'right', mono: true },
    { key: 'state', label: '状态' },
    { key: 'a', label: '', align: 'right', width: '72px' },
  ]
  const rows: Record<string, React.ReactNode>[] = [
    {
      name: 'acme-prod',
      id: 'tnt_9f3c21',
      members: '18',
      model: 'sonnet-4-5',
      used: '1,284,905',
      quota: '64.2%',
      state: (
        <Tag tone="success" dot>
          运行中
        </Tag>
      ),
      a: act,
    },
    {
      name: 'acme-staging',
      id: 'tnt_7c12de',
      members: '6',
      model: 'haiku-4-5',
      used: '312,440',
      quota: '92.7%',
      state: <Tag tone="warn">接近预算</Tag>,
      a: act,
    },
    {
      name: 'lab-sandbox',
      id: 'tnt_2b88af',
      members: '3',
      model: 'opus-4-1',
      used: '58,102',
      quota: '11.6%',
      state: <Tag tone="neutral">已停用</Tag>,
      a: act,
    },
    {
      name: 'ops-internal',
      id: 'tnt_51ea9c',
      members: '9',
      model: 'sonnet-4-5',
      used: '903,771',
      quota: '45.1%',
      state: <Tag tone="warn">待审批</Tag>,
      a: act,
    },
    {
      name: 'finance-shared',
      id: 'tnt_a41b8c',
      members: '4',
      model: 'sonnet-4-5',
      used: '221,088',
      quota: '22.1%',
      state: (
        <Tag tone="success" dot>
          运行中
        </Tag>
      ),
      a: act,
    },
    {
      name: 'legal-review',
      id: 'tnt_c9d0e1',
      members: '2',
      model: 'haiku-4-5',
      used: '41,320',
      quota: '8.3%',
      state: <Tag tone="danger">隔离</Tag>,
      a: act,
    },
  ]
  return (
    <>
      <PageHead
        title="租户"
        sub={empty ? '还没有租户' : '共 24 个 · 18 个运行中 · 计费周期 2026-08-01 至 2026-08-31'}
        actions={
          <>
            <Button icon="download" disabled={empty}>
              导出用量
            </Button>
            <Button variant="primary" icon="plus">
              创建租户
            </Button>
          </>
        }
      />
      {/* isolation 省略时不显式传 undefined —— exactOptionalPropertyTypes 下
          「没传」与「传了 undefined」是两回事,后者进不去可选属性。
          效果与 kit 一致:由 CapacityReadout 自己的默认值兜底。 */}
      <CapacityReadout {...(isolation === undefined ? {} : { isolation })} />
      {/* kit 原样保留:两个分支都是 null,渲染上等于什么都不做。 */}
      {!empty && isolation === 'process' ? null : null}
      {!empty ? (
        <QuarantineBanner message="租户 legal-review 处于隔离档，出站请求已阻断。" />
      ) : null}
      {empty ? (
        <EmptyState
          icon="building-2"
          title="还没有租户"
          body="租户是配额、模型准入与账单的边界。创建第一个租户后，成员会从贵方 IdP 同步进来。"
          action={
            <Button variant="primary" icon="plus">
              创建租户
            </Button>
          }
          hint="当前容量基线：逻辑档 · MEMBER CAP 1 人"
        />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
              gap: 'var(--s-5)',
              alignItems: 'end',
            }}
          >
            <Input label="按名称或租户 ID 筛选" placeholder="acme- / tnt_" mono />
            <Select
              label="状态"
              value="全部"
              options={['全部', '运行中', '接近预算', '已停用', '隔离', '待审批']}
              onChange={() => {}}
            />
            <Select
              label="默认模型"
              value="全部"
              options={['全部', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1']}
              mono
              onChange={() => {}}
            />
          </div>
          <Table
            columns={cols}
            rows={rows}
            selectedIndex={sel}
            onRowClick={(i) => {
              setSel(i)
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-5)' }}>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                color: 'var(--text-tertiary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              1–6 / 24
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-3)' }}>
              <Button size="compact" variant="ghost" icon="chevron-left">
                上一页
              </Button>
              <Button size="compact" variant="ghost">
                下一页
              </Button>
            </span>
          </div>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
              color: 'var(--text-tertiary)',
            }}
          >
            上次同步 2026-08-21T09:14Z · <CodeRef copyable>req_9f3c21ab7e</CodeRef>
          </span>
        </>
      )}
    </>
  )
}
