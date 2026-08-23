/**
 * 离线两态。`OfflineBanner`(降级横幅)+ `QueuedInputCard`(排队输入,不自动发出)。
 *
 * kit 里两者同在一个文件、连同 `MODES` 一起挂到 window(名为 `OFFLINE_MODES`),
 * 这里保持同一个文件、三个具名导出 —— `MODES` 对外仍叫 `OFFLINE_MODES`。
 *
 * ## 与设计 kit 的差别:两处,都不改任何数值与文案
 *
 * 1. 首行的 `const { … } = window.DSHWARDesignSystem_264a5f` 换成 ES import。
 * 2. `MODES` 补了 `Record<OfflineMode, OfflineModeSpec>` 标注 —— 不标的话
 *    `tone` 被推断成 `string`,传给 `Tag` 的 `'success' | 'warn' | …` 不兼容。
 *
 * ⚠️ `OfflineBanner` 里 `if (!m) return null` 这条兜底**原样留着**,尽管
 * 类型上 `MODES[mode]` 取不出 `undefined`。类型只管得住本包内部的调用方,
 * 而 `mode` 的实际来源是运行时的连接状态判定 —— 兜底删掉等于把一个
 * 「传了表外的值就整块消失」换成「整块崩掉」。
 *
 * ⚠️ `QueuedInputCard` 的 `queue` state **不能**换成 CSS 伪类:它是队列内容
 * 本身(逐条丢弃会真的改数据),不是 hover / active / focus 那类样式态。
 *
 * 内联 `style={{}}` 原样保留:全是一次性布局。这一屏没有 hover / active /
 * focus 的 JS 写法,因此没有需要换成伪类的东西。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 离线不是错误,是降级运行模式。断网时仍可用:历史会话、产物、工作区文件、本地工具执行。
 * Agent 推理需要本地模型(Ollama)。
 *
 * ★ 两种离线态视觉上必须分开 —— 它们对用户的意义完全不同:
 *   'local'  本地模型可用   → **降级但能干活**:warn 语义色,说明降级了什么(模型、速度、上下文)
 *   'readonly' 本地模型不可用 → **只能看**:neutral 语义色 + 明确说出"agent 无法推理",
 *                             并且输入区整体禁用(不是让人敲完才发现发不出去)
 * 为什么 readonly 用 neutral 而不是 danger:danger 在这套语言里意味着失败。
 * 断网不是失败,是环境。用 danger 会让用户以为出了故障去排查,而他该做的是等网或开本地模型。
 *
 * @module @dshwar/design-system/screens/workbench/OfflineState
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Tag } from '../../components/Tag.tsx'

/** local = 本地模型可用(降级但能干活)· readonly = 本地模型不可用(只能看) */
export type OfflineMode = 'local' | 'readonly'

export interface OfflineModeSpec {
  /** warn = 降级但能干活 · neutral = 只能看。**不用 danger**,理由见模块注释 */
  tone: 'warn' | 'neutral'
  /** Lucide 图标名 */
  icon: string
  /** 右侧 mono Tag 的文字 */
  tag: string
  /** 横幅标题 */
  title: string
  /** 横幅正文:说明降级了什么、还剩什么可用 */
  body: string
}

const MODES: Record<OfflineMode, OfflineModeSpec> = {
  local: {
    tone: 'warn',
    icon: 'wifi-off',
    tag: '离线 · 本地模型',
    title: '已离线 —— 改用本地模型继续',
    body: 'Agent 推理已切到本地 ollama（qwen2.5:14b）。历史会话、产物、工作区文件与本地工具执行均正常。上下文窗口与速度低于云端模型，长任务可能被截断。',
  },
  readonly: {
    tone: 'neutral',
    icon: 'cloud-off',
    tag: '离线 · 仅查看',
    title: '已离线 —— Agent 暂不可用',
    body: '本工作区未启用本地模型，因此 agent 无法推理。历史会话、产物与工作区文件仍可读，本地工具执行仍可用。恢复网络，或在工作区设置里启用本地模型。',
  },
}

export { MODES as OFFLINE_MODES }

export interface OfflineBannerProps {
  mode: OfflineMode
}

export function OfflineBanner({ mode }: OfflineBannerProps): React.JSX.Element | null {
  const m = MODES[mode]
  if (!m) return null
  const warn = m.tone === 'warn'
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'flex-start',
        padding: 'var(--s-5) var(--s-6)',
        borderRadius: 'var(--r-1)',
        background: warn ? 'var(--warn-surface)' : 'var(--neutral-surface)',
        border: `1px solid ${warn ? 'var(--warn)' : 'var(--border-control)'}`,
      }}
    >
      <Icon
        name={m.icon}
        size={15}
        tone="inherit"
        style={{ color: warn ? 'var(--warn)' : 'var(--text-secondary)' }}
      />
      <div style={{ display: 'grid', gap: 'var(--s-3)', flex: 1 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-4)',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              font: 'var(--fw-medium) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: warn ? 'var(--warn)' : 'var(--text-body)',
            }}
          >
            {m.title}
          </span>
          <Tag tone={m.tone} mono>
            {m.tag}
          </Tag>
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '84ch',
          }}
        >
          {m.body}
        </span>
      </div>
      {mode === 'readonly' ? <Button size="compact">工作区设置</Button> : null}
    </div>
  )
}

/** 队列里的一条:断网期间敲下的指令原文 + 敲下的时刻。 */
export interface QueuedInput {
  /** 时刻,mono caption,列宽固定 44px */
  at: string
  /** 指令原文。**原样列出** —— 用户要靠它重新认出自己写过什么 */
  text: string
}

export interface QueuedInputCardProps {
  /** 排队的输入;空数组时整块不渲染 */
  items?: QueuedInput[]
  /** readonly 下发送按钮禁用,队列保留到恢复连接 */
  mode: OfflineMode
}

/* ★ 已排队但没发出去的输入:**保留,恢复后一次性确认,不自动发出。**
   自动发出的风险是用户已经忘了自己敲过什么 —— 断网期间敲的三条指令在恢复时
   同时开跑,agent 按十分钟前的意图改文件,用户看到的是"它自己动了"。
   逐条确认的风险是恢复网络后要点三次,而且每次都要重新读一遍。
   折中:**整批一次确认,但把原文和时间戳完整列出来**,让用户重新读到自己写过什么,
   一次点发送;不想发的逐条丢弃。门槛落在"你还认这些指令吗",只花一次点击。
   队列上限 5 条并写明:无上限的队列会变成一个用户看不见的待办堆。 */
export function QueuedInputCard({
  items = [],
  mode,
}: QueuedInputCardProps): React.JSX.Element | null {
  const [queue, setQueue] = useState(items)
  if (!queue.length) return null
  return (
    <Card
      title={`离线期间排队的输入 · ${queue.length} 条`}
      action={
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            color: 'var(--text-tertiary)',
          }}
        >
          上限 5 条
        </span>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '80ch',
          }}
        >
          这些指令
          <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>不会自动发出</b>
          。恢复连接后请先读一遍——你可能已经忘了断网时写过什么，而 agent 会按它们改文件。
        </span>
        <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
          {queue.map((q, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 'var(--s-5)',
                alignItems: 'flex-start',
                padding: 'var(--s-5)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--r-2)',
                background: 'var(--surface-subtle)',
              }}
            >
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                  flex: '0 0 auto',
                  width: 44,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {q.at}
              </span>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  color: 'var(--text-body)',
                  flex: 1,
                }}
              >
                {q.text}
              </span>
              <IconButton
                icon="trash-2"
                label="丢弃这条"
                onClick={() => setQueue(queue.filter((_, k) => k !== i))}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
          <Button variant="primary" icon="send" disabled={mode === 'readonly'}>
            全部发送（{queue.length} 条）
          </Button>
          <Button variant="ghost" onClick={() => setQueue([])}>
            全部丢弃
          </Button>
          {mode === 'readonly' ? (
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              仅查看态下无法发送——队列会保留到恢复连接。
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
