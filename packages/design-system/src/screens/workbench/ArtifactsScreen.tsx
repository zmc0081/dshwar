/**
 * 产物屏。由 Agent 运行产出的文档与报表,按来源运行归档。
 *
 * 产物表 + 预览(mono 代码块)+ 来源溯源(全 mono)。
 *
 * ## 与设计 kit 的差别:两处,都不改任何数值
 *
 * 1. 首行的 `const { … } = window.DSHWARDesignSystem_264a5f` 换成 ES import。
 *    kit 里屏幕文件是浏览器直接跑 Babel 的 `<script>`,组件靠一个全局对象递过去;
 *    这里是打包进 `@dshwar/design-system` 的源码,走正常模块解析。
 * 2. `cols` 补了 `TableColumn[]` 标注 —— 不标的话 `align: 'right'` 被推断成
 *    `string`,与 `'left' | 'right'` 不兼容。**只加标注,值一个没动。**
 *
 * ## 内联 `style={{}}` 原样保留
 *
 * 这一屏的内联全是**一次性布局**(某一处的 grid / gap / 字体),做成 CSS 类
 * 会产生一批只用一次的类名。守卫禁的是「用 JS 表达 CSS 伪类本来就能表达的
 * 状态」(hover / active / focus),而这一屏没有那种写法 —— 交互只有
 * `onRowClick` 这一条,它是选中而不是样式态。
 *
 * ## 表里的数据是演示夹具
 *
 * 行、预览内容、来源字段全部硬编码,接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/workbench/ArtifactsScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'

export function ArtifactsScreen(): React.JSX.Element {
  const [sel, setSel] = useState(1)
  const act = (
    <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
      <IconButton icon="download" label="下载" />
      <IconButton icon="more-horizontal" label="更多" />
    </span>
  )
  const cols: TableColumn[] = [
    { key: 'n', label: '产物' },
    { key: 'kind', label: '类型', mono: true },
    { key: 'size', label: '大小', align: 'right', mono: true },
    { key: 'run', label: '来源运行', mono: true },
    { key: 'at', label: '生成时间', mono: true },
    { key: 'st', label: '状态' },
    { key: 'a', label: '', align: 'right', width: '72px' },
  ]
  const rows = [
    {
      n: '用量对比报表',
      kind: 'xlsx',
      size: '2.4 MB',
      run: 'run_9f3c21ab',
      at: '08-18 09:14',
      st: (
        <Tag tone="success" dot>
          已完成
        </Tag>
      ),
      a: act,
    },
    {
      n: '分部门趋势',
      kind: 'md',
      size: '18 KB',
      run: 'run_9f3c21ab',
      at: '08-18 09:14',
      st: (
        <Tag tone="success" dot>
          已完成
        </Tag>
      ),
      a: act,
    },
    {
      n: '超配额明细',
      kind: 'csv',
      size: '96 KB',
      run: 'run_9f3c21ab',
      at: '08-18 09:14',
      st: (
        <Tag tone="success" dot>
          已完成
        </Tag>
      ),
      a: act,
    },
    {
      n: '合同差异摘要',
      kind: 'md',
      size: '11 KB',
      run: 'run_7c12de40',
      at: '08-18 08:41',
      st: <Tag tone="warn">部分降级</Tag>,
      a: act,
    },
    {
      n: '工单归类结果',
      kind: 'csv',
      size: '—',
      run: 'run_2b88af51',
      at: '08-17 22:03',
      st: <Tag tone="danger">未生成</Tag>,
      a: act,
    },
  ]
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <h1
            style={{
              margin: 0,
              color: 'var(--text-body)',
              font: 'var(--fw-bold) var(--fs-title-1)/var(--lh-title-1) var(--font-sans)',
              letterSpacing: 'var(--ls-title-1)',
            }}
          >
            产物
          </h1>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            由 Agent 运行产出的文档与报表，按来源运行归档。
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'flex-end' }}>
          <Select
            value="近 7 天"
            options={['近 24 小时', '近 7 天', '近 30 天']}
            style={{ width: 150 }}
            onChange={() => {}}
          />
          <Button variant="primary" icon="download">
            批量下载
          </Button>
        </div>
      </div>
      <Table columns={cols} rows={rows} selectedIndex={sel} onRowClick={setSel} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
        <Card title="预览">
          <div
            style={{
              display: 'grid',
              gap: 'var(--s-4)',
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
              <Icon name="file-text" size={15} />
              <b style={{ fontWeight: 'var(--fw-medium)' }}>分部门趋势.md</b>
            </span>
            <div
              style={{
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--r-2)',
                padding: 'var(--s-5)',
                font: 'var(--fw-regular) var(--fs-mono)/1.7 var(--font-mono)',
                color: 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              ## 7 月分部门用量
              <br />
              研发中台 1,284,905 tok +18.4%
              <br />
              客服运营 903,771 tok +6.1%
              <br />
              财务共享 312,440 tok +2.3%
            </div>
          </div>
        </Card>
        <Card title="来源">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '96px 1fr',
              gap: 'var(--s-4) var(--s-6)',
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>运行</span>
            <CodeRef copyable>run_9f3c21ab</CodeRef>
            <span style={{ color: 'var(--text-tertiary)' }}>模型</span>
            <CodeRef>claude-sonnet-4-5</CodeRef>
            <span style={{ color: 'var(--text-tertiary)' }}>消耗</span>
            <CodeRef>48,201 tok</CodeRef>
            <span style={{ color: 'var(--text-tertiary)' }}>租户</span>
            <CodeRef>tnt_9f3c21</CodeRef>
          </div>
        </Card>
      </div>
    </>
  )
}
