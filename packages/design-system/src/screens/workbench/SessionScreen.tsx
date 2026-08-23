/**
 * 协作屏 —— 工作台的默认 tab。一列对话 + 输入框,右侧本次产物 / 工作区文件 / 我的配额。
 *
 * ## 与设计 kit 的差别:只换了取组件的方式
 *
 * kit 里第一行是 `const { Card, ... } = window.DSHWARDesignSystem_264a5f`,
 * 移植后从 `../../components/*.tsx` 逐个 import。本屏**没有**任何 JS 表达的交互态
 * (hover / active / focus 都不在这一层),因此不需要配套的 screens CSS 文件。
 *
 * 内联 `style` 原样保留 —— 屏幕层是一次性布局,做成类只会得到一堆用一次的类名。
 * 夹具数据(对话内容、产物清单、文件树、token 数)也原样保留,接真实 API 是后话。
 *
 * @module @dshwar/design-system/screens/workbench/SessionScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { DegradeNotice } from '../../components/DegradeNotice.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Select } from '../../components/Select.tsx'
import { Tag } from '../../components/Tag.tsx'
import { QueuedInputCard } from './OfflineState.tsx'
import type { OfflineMode } from './OfflineState.tsx'
import { ToolGroup } from './ToolCalls.tsx'

function Turn({
  who,
  meta,
  children,
}: {
  who: string
  meta?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const isUser = who === '周琳'
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--s-4)',
        paddingBottom: 'var(--s-6)',
        borderBottom: '1px solid var(--border-hairline)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
        <span
          style={{
            font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
            color: isUser ? 'var(--text-body)' : 'var(--text-secondary)',
          }}
        >
          {who}
        </span>
        {meta === undefined ? null : (
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
              color: 'var(--text-tertiary)',
            }}
          >
            {meta}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

const Para = ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
  <div
    style={{
      font: 'var(--fw-regular) var(--fs-body-lg)/var(--lh-body-lg) var(--font-sans)',
      color: 'var(--text-body)',
      maxWidth: '72ch',
    }}
  >
    {children}
  </div>
)

const QUEUED = [
  { at: '09:41', text: '把超配额那页的建议配额改成按近六个月峰值算。' },
  { at: '09:48', text: '再加一张各部门环比趋势的小图,放在第二页。' },
  { at: '10:03', text: '导出成 xlsx 时把「研发中台」置顶。' },
]

export interface SessionScreenProps {
  /** 当前工作区名,显示在标题行右侧的 mono 串上 */
  workspace: string
  /** `null` = 在线;两个离线态各自改写输入框的占位与可用性 */
  offline: OfflineMode | null
}

export function SessionScreen({ workspace, offline }: SessionScreenProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 'var(--s-8)',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <h1
            style={{
              margin: 0,
              color: 'var(--text-body)',
              font: 'var(--fw-bold) var(--fs-title-1)/var(--lh-title-1) var(--font-sans)',
              letterSpacing: 'var(--ls-title-1)',
            }}
          >
            月度报表生成
          </h1>
          <span style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
            <Tag tone="success" dot>
              运行中
            </Tag>
            <CodeRef copyable>run_9f3c21ab</CodeRef>
            <span style={{ color: 'var(--n-300)' }}>·</span>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                color: 'var(--text-tertiary)',
              }}
            >
              {workspace}
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'flex-end' }}>
          <Select
            value="claude-sonnet-4-5"
            options={['claude-sonnet-4-5', 'claude-haiku-4-5']}
            mono
            style={{ width: 208 }}
            onChange={() => {}}
          />
          <Button icon="square">停止</Button>
        </div>
      </div>
      <DegradeNotice from="opus-4-1" to="sonnet-4-5" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 300px',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          {offline === null ? null : <QueuedInputCard items={QUEUED} mode={offline} />}
          <Card pad="var(--s-8)">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <Turn who="周琳" meta="09:12">
                <Para>把 7 月的用量按部门拆开,产出一份对比 6 月的报表,重点标出超配额的部门。</Para>
              </Turn>
              <Turn who="月度报表生成" meta="09:12 · 48,201 tok">
                <ToolGroup
                  calls={[
                    {
                      kind: 'read',
                      tool: 'read_file',
                      path: 'usage/2026-07/by-department.csv',
                      ms: 42,
                    },
                    {
                      kind: 'read',
                      tool: 'read_file',
                      path: 'usage/2026-06/by-department.csv',
                      ms: 38,
                    },
                    {
                      kind: 'read',
                      tool: 'read_file',
                      path: 'config/department-quotas.yaml',
                      ms: 11,
                    },
                  ]}
                />
                <Para>
                  已读取 7 月用量明细(12 个部门,2,410 条运行记录)。6 月对比基线已对齐。
                  <br />
                  三个部门超出部门配额:研发中台 +18.4%、客服运营 +6.1%、财务共享 +2.3%。
                </Para>
                <ToolGroup
                  calls={[
                    {
                      kind: 'edit',
                      tool: 'edit_file',
                      path: 'reports/monthly/2026-07.md',
                      added: 128,
                      removed: 12,
                      ms: 96,
                    },
                    { kind: 'shell', tool: 'bash', path: 'reports/monthly', ms: 1840 },
                    { kind: 'artifact', tool: 'emit_artifact', path: '用量对比报表.xlsx', ms: 420 },
                    { kind: 'artifact', tool: 'emit_artifact', path: '分部门趋势.md', ms: 64 },
                  ]}
                />
                <Para>报表已生成,含分部门趋势与超配额明细两张表。</Para>
              </Turn>
              <Turn who="周琳" meta="09:26">
                <Para>把超配额的部分单独做一页,给出建议的新配额。</Para>
              </Turn>
              <Turn who="月度报表生成" meta="09:27 · 12,884 tok">
                <ToolGroup
                  failed
                  calls={[
                    { kind: 'read', tool: 'read_file', path: 'reports/monthly/2026-07.md', ms: 18 },
                    {
                      kind: 'net',
                      tool: 'http_get',
                      path: 'internal-api/quota-recommendations',
                      ms: 3040,
                    },
                    {
                      kind: 'edit',
                      tool: 'edit_file',
                      path: 'reports/monthly/2026-07.md',
                      added: 41,
                      removed: 3,
                      ms: 74,
                    },
                  ]}
                />
                <Para>
                  建议配额已按近三个月峰值给出。
                  <CodeRef tone="danger">E_UPSTREAM_TIMEOUT · req_7c12de40b1</CodeRef> ——
                  内网推荐服务未响应,该页的基线改用本地近三月数据。
                </Para>
              </Turn>
            </div>
          </Card>
          <div
            style={{
              border: '1px solid var(--border-control)',
              borderRadius: 'var(--r-3)',
              background: 'var(--surface-card)',
              padding: 'var(--s-5)',
              display: 'grid',
              gap: 'var(--s-5)',
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              disabled={offline === 'readonly'}
              placeholder={
                offline === 'readonly'
                  ? '仅查看态 —— Agent 无法推理。启用本地模型或恢复网络后可继续。'
                  : offline === 'local'
                    ? '离线 · 本地模型推理,速度与上下文低于云端'
                    : '向 Agent 说明下一步;引用产物用 @ 前缀'
              }
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                resize: 'none',
                background: 'transparent',
                font: 'var(--fw-regular) var(--fs-body-lg)/var(--lh-body-lg) var(--font-sans)',
                color: 'var(--text-body)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
              <IconButton icon="paperclip" label="附加文件" />
              <IconButton icon="at-sign" label="引用产物" />
              <span
                style={{
                  marginLeft: 'auto',
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                本次会话 61,085 tok
              </span>
              <Button variant="primary" icon="send" disabled={offline === 'readonly'}>
                发送
              </Button>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="本次产物">
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              {(
                [
                  ['用量对比报表.xlsx', '2.4 MB'],
                  ['分部门趋势.md', '18 KB'],
                  ['超配额明细.csv', '96 KB'],
                ] as const
              ).map(([n, s]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                  <Icon name="file-text" size={14} />
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-body)/1.4 var(--font-sans)',
                      flex: 1,
                    }}
                  >
                    {n}
                  </span>
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                      color: 'var(--text-tertiary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="工作区文件">
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              {(
                [
                  ['usage/', '24 个文件'],
                  ['reports/monthly/', '7 个文件'],
                  ['config/', '3 个文件'],
                ] as const
              ).map(([n, s]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                  <Icon name="folder" size={14} />
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-mono)/1.4 var(--font-mono)',
                      flex: 1,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {n}
                  </span>
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                      color: 'var(--text-tertiary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {s}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="我的配额">
            <QuotaBar used={61085} total={200000} note="平台容量 · 非承诺值" />
          </Card>
        </div>
      </div>
    </>
  )
}
