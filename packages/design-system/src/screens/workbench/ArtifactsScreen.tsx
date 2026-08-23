/**
 * 产物屏。由 Agent 运行产出的文档与报表,按来源运行归档。
 *
 * 产物表 + 预览(mono 代码块)+ 来源溯源(全 mono)。
 *
 * ## V0.9.0 Session 2:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)行、预览、来源全部硬编码 —— 那是刻意的,
 * 那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `size` 收到的是已经人类化的
 * `'2.4 MB'`,`status` 是一个枚举而不是一段 `<Tag>` JSX。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 * 换算(字节 → `'2.4 MB'`、ISO 时间 → `'08-18 09:14'`)是调用方的事。
 *
 * ## 🚨 顺带修一处真缺陷:预览与来源**不跟随选中行**
 *
 * kit 原版里 `selectedIndex={sel}` 只给行加了底色,而右边两张卡的内容是
 * **常量** —— 选中第 5 行(未生成、大小 `—`)仍然显示第 2 行的
 * `分部门趋势.md` 与 `run_9f3c21ab`。
 *
 * 这不是「夹具没接」,是**界面在说一件与它展示的选中状态不一致的事**:
 * 用户点了第 5 行、看到第 5 行高亮、读到的却是另一个产物的溯源信息。
 * 与「假成功回执」同族 —— 系统给出的回执与它实际做到的事不一致。
 *
 * ⇒ 现在 `preview` 与 `provenance` 都由 `selectedIndex` 指向的那一行给出,
 * 由调用方负责保持一致;两者都可以是 `null`(未选中 / 取不到预览)。
 *
 * @module @dshwar/design-system/screens/workbench/ArtifactsScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'

/**
 * 产物的状态。**闭集**,与 `Tag` 的 tone 一一对应。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的状态应该在**转换层**停下来报错,
 * 而不是在界面上显示成一个含糊的灰标签 —— 后者会让一个新增的服务端状态
 * 悄悄退化成「看起来正常」。
 */
export type ArtifactStatus = 'completed' | 'degraded' | 'missing'

/** 表里的一行。字段都是**已经格式化好的展示串**。 */
export interface ArtifactRow {
  readonly id: string
  readonly name: string
  /** 扩展名或类型标识,如 `xlsx` / `md` / `csv`。 */
  readonly kind: string
  /** 已人类化的大小,如 `'2.4 MB'`。取不到时传 `'—'`。 */
  readonly size: string
  /** 来源运行 id。 */
  readonly runId: string
  /** 已格式化的生成时间,如 `'08-18 09:14'`。 */
  readonly createdAt: string
  readonly status: ArtifactStatus
  /** 这一行能不能下载。`missing` 的行应当传 `false`。 */
  readonly downloadable: boolean
}

/** 右侧「预览」卡的内容。 */
export interface ArtifactPreview {
  readonly fileName: string
  /**
   * 预览正文。**按行传**,不要传一整段带 `\n` 的串 ——
   * 组件用 `<br />` 分行,而 `white-space: pre` 在这一处会破坏卡片宽度约束。
   */
  readonly lines: readonly string[]
}

/** 右侧「来源」卡的内容。全部是 mono 展示串。 */
export interface ArtifactProvenance {
  readonly runId: string
  readonly model: string
  /** 已格式化的消耗,如 `'48,201 tok'`。 */
  readonly tokens: string
  readonly tenantId: string
}

export interface ArtifactsScreenProps {
  readonly rows: readonly ArtifactRow[]
  /** 选中行的下标。`-1` = 未选中。 */
  readonly selectedIndex: number
  /**
   * 选中行的预览。`null` = 没选中,或这个类型没有预览
   * (xlsx 就没有 —— 那时传 `null`,组件显示空态,**不要伪造一段内容**)。
   */
  readonly preview: ArtifactPreview | null
  /** 选中行的溯源。`null` = 没选中。 */
  readonly provenance: ArtifactProvenance | null
  /** 时间范围筛选的当前值与可选项。 */
  readonly range: string
  readonly rangeOptions: readonly string[]
  readonly onRangeChange?: (next: string) => void
  readonly onSelect?: (index: number) => void
  readonly onDownload?: (id: string) => void
  readonly onDownloadAll?: () => void
}

const TONE_OF: Record<ArtifactStatus, { tone: 'success' | 'warn' | 'danger'; label: string }> = {
  completed: { tone: 'success', label: '已完成' },
  degraded: { tone: 'warn', label: '部分降级' },
  missing: { tone: 'danger', label: '未生成' },
}

const COLUMNS: TableColumn[] = [
  { key: 'n', label: '产物' },
  { key: 'kind', label: '类型', mono: true },
  { key: 'size', label: '大小', align: 'right', mono: true },
  { key: 'run', label: '来源运行', mono: true },
  { key: 'at', label: '生成时间', mono: true },
  { key: 'st', label: '状态' },
  { key: 'a', label: '', align: 'right', width: '72px' },
]

export function ArtifactsScreen({
  rows,
  selectedIndex,
  preview,
  provenance,
  range,
  rangeOptions,
  onRangeChange,
  onSelect,
  onDownload,
  onDownloadAll,
}: ArtifactsScreenProps): React.JSX.Element {
  const tableRows = rows.map((row) => {
    const { tone, label } = TONE_OF[row.status]
    return {
      n: row.name,
      kind: row.kind,
      size: row.size,
      run: row.runId,
      at: row.createdAt,
      st: (
        <Tag tone={tone} dot={row.status === 'completed'}>
          {label}
        </Tag>
      ),
      // ⚠️ 每行**各自**的操作区。kit 原版是一个共享的 `act` 常量 ——
      //   于是没有任何一行的按钮知道自己属于哪一行,接不上 onClick。
      a: (
        <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <IconButton
            icon="download"
            label="下载"
            disabled={!row.downloadable}
            onClick={() => onDownload?.(row.id)}
          />
          <IconButton icon="more-horizontal" label="更多" />
        </span>
      ),
    }
  })

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
            value={range}
            options={[...rangeOptions]}
            style={{ width: 150 }}
            onChange={(e) => onRangeChange?.(e.target.value)}
          />
          <Button
            variant="primary"
            icon="download"
            disabled={rows.every((r) => !r.downloadable)}
            onClick={() => onDownloadAll?.()}
          >
            批量下载
          </Button>
        </div>
      </div>

      <Table
        columns={COLUMNS}
        rows={tableRows}
        selectedIndex={selectedIndex}
        onRowClick={(index) => onSelect?.(index)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
        <Card title="预览">
          {preview === null ? (
            <Empty text={selectedIndex < 0 ? '选一个产物看预览' : '这个类型没有预览'} />
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 'var(--s-4)',
                font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                <Icon name="file-text" size={15} />
                <b style={{ fontWeight: 'var(--fw-medium)' }}>{preview.fileName}</b>
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
                {preview.lines.map((line, i) => (
                  <span key={line + String(i)}>
                    {line}
                    {i < preview.lines.length - 1 ? <br /> : null}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="来源">
          {provenance === null ? (
            <Empty text="选一个产物看它的来源" />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '96px 1fr',
                gap: 'var(--s-4) var(--s-6)',
                font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              }}
            >
              <span style={{ color: 'var(--text-tertiary)' }}>运行</span>
              <CodeRef copyable>{provenance.runId}</CodeRef>
              <span style={{ color: 'var(--text-tertiary)' }}>模型</span>
              <CodeRef>{provenance.model}</CodeRef>
              <span style={{ color: 'var(--text-tertiary)' }}>消耗</span>
              <CodeRef>{provenance.tokens}</CodeRef>
              <span style={{ color: 'var(--text-tertiary)' }}>租户</span>
              <CodeRef>{provenance.tenantId}</CodeRef>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

/** 卡片里的空态。刻意朴素 —— 空不是错误,不该长得像错误。 */
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
