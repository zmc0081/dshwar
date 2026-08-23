/**
 * 运行记录屏。8 列表格 · 全 mono 标识列 · 失败详情给错误码与 requestId。
 *
 * ## 与设计 kit 的差别:两处,都不改任何数值
 *
 * 1. 首行的 `const { … } = window.DSHWARDesignSystem_264a5f` 换成 ES import。
 * 2. `cols` 补了 `TableColumn[]` 标注 —— 不标的话 `align: 'right'` 被推断成
 *    `string`,与 `'left' | 'right'` 不兼容。**只加标注,值一个没动。**
 *
 * 内联 `style={{}}` 原样保留:筛选区那条 `1fr 180px 180px auto` 是这一屏
 * 独有的一次性栅格。这一屏没有 hover / active / focus 的 JS 写法,
 * 因此没有需要换成伪类的东西。
 *
 * ## 表里的数据是演示夹具
 *
 * 行与失败详情全部硬编码,接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/workbench/RunsScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'

export function RunsScreen(): React.JSX.Element {
  const [sel, setSel] = useState(0)
  const act = (
    <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
      <IconButton icon="rotate-ccw" label="重跑" />
      <IconButton icon="more-horizontal" label="更多" />
    </span>
  )
  const cols: TableColumn[] = [
    { key: 'id', label: '运行 ID', mono: true },
    { key: 'agent', label: 'Agent' },
    { key: 'model', label: '模型', mono: true },
    { key: 'tok', label: 'tok', align: 'right', mono: true },
    { key: 'dur', label: '耗时', align: 'right', mono: true },
    { key: 'at', label: '开始时间', mono: true },
    { key: 'st', label: '状态' },
    { key: 'a', label: '', align: 'right', width: '72px' },
  ]
  const rows = [
    {
      id: 'run_9f3c21ab',
      agent: '月度报表生成',
      model: 'sonnet-4-5',
      tok: '48,201',
      dur: '2m 14s',
      at: '08-18 09:12',
      st: (
        <Tag tone="success" dot>
          完成
        </Tag>
      ),
      a: act,
    },
    {
      id: 'run_7c12de40',
      agent: '合同条款比对',
      model: 'sonnet-4-5',
      tok: '12,884',
      dur: '48s',
      at: '08-18 08:40',
      st: <Tag tone="warn">降级</Tag>,
      a: act,
    },
    {
      id: 'run_2b88af51',
      agent: '工单归类',
      model: 'haiku-4-5',
      tok: '3,902',
      dur: '11s',
      at: '08-17 22:03',
      st: <Tag tone="danger">失败</Tag>,
      a: act,
    },
    {
      id: 'run_51ea9c07',
      agent: '月度报表生成',
      model: 'opus-4-1',
      tok: '96,440',
      dur: '5m 02s',
      at: '08-17 18:20',
      st: <Tag tone="neutral">草稿</Tag>,
      a: act,
    },
    {
      id: 'run_a41b8c92',
      agent: '客服话术校对',
      model: 'haiku-4-5',
      tok: '7,118',
      dur: '19s',
      at: '08-17 14:55',
      st: (
        <Tag tone="success" dot>
          完成
        </Tag>
      ),
      a: act,
    },
  ]
  return (
    <>
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <h1
          style={{
            margin: 0,
            color: 'var(--text-body)',
            font: 'var(--fw-bold) var(--fs-title-1)/var(--lh-title-1) var(--font-sans)',
            letterSpacing: 'var(--ls-title-1)',
          }}
        >
          运行记录
        </h1>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
          }}
        >
          Agent 运行记录会保留 90 天，超出后仅保留聚合指标。
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 180px 180px auto',
          gap: 'var(--s-5)',
          alignItems: 'end',
        }}
      >
        <Input label="按运行 ID 或 Agent 筛选" placeholder="run_ / Agent 名称" mono />
        <Select
          label="状态"
          value="全部"
          options={['全部', '完成', '降级', '失败', '草稿']}
          onChange={() => {}}
        />
        <Select
          label="模型"
          value="全部"
          options={['全部', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1']}
          mono
          onChange={() => {}}
        />
        <Button icon="download">导出</Button>
      </div>
      <Table columns={cols} rows={rows} selectedIndex={sel} onRowClick={setSel} />
      <Card title="失败详情">
        <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
          <CodeRef copyable tone="danger">
            E_MODEL_UNAVAILABLE · req_9f3c21ab7e
          </CodeRef>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            run_2b88af51 · 上游返回容量不足，重试 3 次后终止。可重跑或改用已准入的其他模型。
          </span>
        </div>
      </Card>
    </>
  )
}
