/**
 * 审计屏。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import ——
 *    见 `docs/DECISIONS/design-kit-adoption.md` 裁决 2 的第三笔账。
 * 2. 一次性布局的 `style={{}}` **原样保留**。守卫禁的是「用 JS 表达那些 CSS 伪类
 *    本来就能表达的状态」,不是内联布局本身;本屏没有任何 hover / active / focus
 *    的 JS 状态,因此也没有对应的 `styles/screens/*.css`。
 * 3. 表格行与筛选项是 kit 里的演示夹具,原样保留 —— 接真实 API 是后面 Session 的事。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 审计表禁用 accent 选中行 —— selectionTone="neutral"。
 *
 * @module @dshwar/design-system/screens/console/AuditScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { AuditLine } from '../../components/AuditLine.tsx'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Input } from '../../components/Input.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { PageHead } from './Shell.tsx'

/**
 * 一条审计记录(演示夹具的形状)。
 *
 * ⚠️ 写成 `type` 而不是 `interface` 是必需的:只有类型别名拿得到**隐式索引签名**,
 * 而 `Table` 的 `rows` 要的是 `Record<string, React.ReactNode>[]`。
 * 换成 `interface` 这里会立刻不可赋值。
 */
type AuditRow = {
  at: string
  action: string
  actor: string
  target: string
  ip: string
}

export function AuditScreen(): React.JSX.Element {
  const [sel, setSel] = useState(1)
  const cols: TableColumn[] = [
    { key: 'at', label: '时间', mono: true },
    { key: 'action', label: '动作', mono: true },
    { key: 'actor', label: '操作者', mono: true },
    { key: 'target', label: '对象', mono: true },
    { key: 'ip', label: '来源 IP', align: 'right', mono: true },
  ]
  const rows: AuditRow[] = [
    {
      at: '2026-08-18T09:14Z',
      action: 'branding.update',
      actor: 'adm_71c2',
      target: 'org_acme',
      ip: '10.2.44.81',
    },
    {
      at: '2026-08-18T08:52Z',
      action: 'tenant.quota.update',
      actor: 'adm_71c2',
      target: 'tnt_9f3c21',
      ip: '10.2.44.81',
    },
    {
      at: '2026-08-18T07:31Z',
      action: 'model.allowlist.update',
      actor: 'adm_0c4a',
      target: 'org_acme',
      ip: '10.2.51.19',
    },
    {
      at: '2026-08-17T22:03Z',
      action: 'credential.rotate',
      actor: 'svc_ci',
      target: 'tnt_2b88af',
      ip: '10.9.7.4',
    },
    {
      at: '2026-08-17T18:20Z',
      action: 'tenant.quarantine.set',
      actor: 'adm_0c4a',
      target: 'tnt_51ea9c',
      ip: '10.2.51.19',
    },
  ]
  // kit 原文是 `rows[sel].action`。`noUncheckedIndexedAccess` 下索引访问会带出
  // undefined,而 `sel` 只可能是 useState 的初值 1 或 Table 给回的行号 ——
  // 两者都在界内。断言一次,取值与结果都不变。
  const row = rows[sel]!

  return (
    <>
      <PageHead
        title="审计"
        sub="动作词原样输出，不本地化；记录保留 400 天"
        actions={<Button icon="download">导出 CSV</Button>}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 200px 200px',
          gap: 'var(--s-5)',
          alignItems: 'end',
        }}
      >
        <Input label="按对象或操作者筛选" placeholder="tnt_ / adm_ / svc_" mono />
        <Select
          label="动作"
          value="全部"
          options={['全部', 'branding.update', 'tenant.quota.update', 'credential.rotate']}
          onChange={() => {}}
        />
        <Select
          label="时间范围"
          value="近 7 天"
          options={['近 24 小时', '近 7 天', '近 30 天']}
          onChange={() => {}}
        />
      </div>
      <Table
        columns={cols}
        rows={rows}
        selectedIndex={sel}
        selectionTone="neutral"
        onRowClick={setSel}
      />
      <Card title="记录详情">
        <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
          <AuditLine action={row.action} actor={row.actor} at={row.at} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              gap: 'var(--s-4) var(--s-6)',
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>对象</span>
            <CodeRef copyable>{row.target}</CodeRef>
            <span style={{ color: 'var(--text-tertiary)' }}>请求 ID</span>
            <CodeRef copyable>req_9f3c21ab7e</CodeRef>
            <span style={{ color: 'var(--text-tertiary)' }}>结果</span>
            <CodeRef>ok</CodeRef>
          </div>
        </div>
      </Card>
    </>
  )
}
