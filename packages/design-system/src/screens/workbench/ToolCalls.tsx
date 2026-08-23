/**
 * 工具调用折叠组。一次 agent 回合里的中间步骤折叠成一行摘要,展开可见
 * 「调用了哪个工具、作用于哪个路径」。
 *
 * ## 与设计 kit 的差别:hover 走 CSS 伪类,不走 `useState`
 *
 * kit 原版用 `React.useState(false)` 记住摘要行的 hover,再在它的 style 里
 * 三元判断底色。移植时换成 `.ds-toolgroup__summary:hover`,
 * 见 `styles/screens/toolcalls.css` —— 理由见
 * `docs/DECISIONS/design-kit-adoption.md`。
 *
 * 展开/收起的 `open` **仍是 React 状态**:那是内容的显隐,不是交互态,
 * 伪类表达不了它。其余内联 `style` 原样保留 —— 屏幕层的一次性布局做成类
 * 只会产生一堆用一次的类名。
 *
 * ## 原 kit 注释(原样保留)
 *
 * Agent 干活会产生大量中间步骤。两个极端都不行:
 * 全展开 —— 一次运行几十个工具调用,正文被淹没,用户读不到 agent 到底说了什么;
 * 全隐藏 —— "agent 改了我的文件"变成不可审计,出了事无法回溯。
 * 所以折叠成一行摘要,可展开到"调用了哪个工具、作用于哪个路径"。
 *
 * ★ 不展示 shell 命令原文。
 * 策略预授权决定哪些工具可用(工作区设置页配置),运行时不再逐次弹审批。
 * 在这个前提下展示命令原文,就把"agent 执行了什么"变成了"用户能看到系统内部"——
 * 用户读到的是一串他无权也无从判断的实现细节,而真正该看的
 * (动了哪个路径、改了多少)反而被埋在里面。展示到工具名 + 路径即可。
 * 这也不是能力不足:命令原文在服务端审计里有,那是给管理员的,不是给这一屏的。
 *
 * 配色刻意零 accent、零语义色:
 * 这段是执行日志,不是状态。增删行数用 mono n-700 而不是绿/红 ——
 * danger 在这套语言里意味着"失败",用它标"删了 3 行"会读成出错。
 *
 * @module @dshwar/design-system/screens/workbench/ToolCalls
 */
import type * as React from 'react'
import { useState } from 'react'
import { Icon } from '../../components/Icon.tsx'
import { Tag } from '../../components/Tag.tsx'

/** 工具调用的类别。决定图标、摘要动词与计数单位。 */
export type ToolCallKind = 'read' | 'write' | 'edit' | 'shell' | 'net' | 'artifact'

export interface ToolCall {
  kind: ToolCallKind
  /** 工具名,原样输出(`read_file` / `bash` / `emit_artifact`) */
  tool: string
  /** 作用于哪个路径 —— 这一屏显示到此为止,不展示命令原文 */
  path: string
  /** 文件改动行数,与 `removed` 成对出现;两者都缺则不显示计数 */
  added?: number
  removed?: number
  /** 耗时毫秒 */
  ms?: number
}

const KIND: Record<ToolCallKind, { icon: string; verb: string }> = {
  read: { icon: 'file-search', verb: '读取' },
  write: { icon: 'file-plus', verb: '写入' },
  edit: { icon: 'file-pen', verb: '修改' },
  shell: { icon: 'terminal', verb: '执行' },
  net: { icon: 'globe', verb: '请求' },
  artifact: { icon: 'package', verb: '生成' },
}

function ToolRow({ call }: { call: ToolCall }): React.JSX.Element {
  // kit 的 `KIND[call.kind] || KIND.read` 原样保留:`kind` 在类型上已收成
  // 联合,但运行时数据来自 API,表外的值仍会到达这里。
  const k = KIND[call.kind] || KIND.read
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-4)',
        height: 28,
        padding: '0 var(--s-5)',
        borderTop: '1px solid var(--border-hairline)',
      }}
    >
      <Icon name={k.icon} size={13} />
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          color: 'var(--text-secondary)',
          flex: '0 0 auto',
        }}
      >
        {call.tool}
      </span>
      <span style={{ color: 'var(--n-300)' }}>·</span>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          color: 'var(--text-tertiary)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          direction: 'rtl',
          textAlign: 'left',
        }}
        title={call.path}
      >
        {call.path}
      </span>
      {/* 文件改动内联计数。mono + tabular-nums,不上色。 */}
      {call.added !== undefined || call.removed !== undefined ? (
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            flex: '0 0 auto',
          }}
        >
          +{call.added ?? 0} −{call.removed ?? 0}
        </span>
      ) : null}
      {call.ms !== undefined ? (
        <span
          style={{
            width: 52,
            textAlign: 'right',
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
            flex: '0 0 auto',
          }}
        >
          {call.ms} ms
        </span>
      ) : null}
    </div>
  )
}

/* 摘要句:按 kind 归类计数 ——「读取 3 个文件 · 生成 2 个产物」。
   不写"执行了 7 个工具调用":那是实现视角,用户关心的是动了什么。 */
function summarize(calls: ToolCall[]): string {
  const unit: Record<ToolCallKind, string> = {
    read: '个文件',
    write: '个文件',
    edit: '个文件',
    shell: '条命令',
    net: '个外部服务',
    artifact: '个产物',
  }
  const order: ToolCallKind[] = ['read', 'edit', 'write', 'shell', 'net', 'artifact']
  const n: Partial<Record<ToolCallKind, number>> = {}
  for (const c of calls) n[c.kind] = (n[c.kind] || 0) + 1
  return order
    .filter((k) => n[k])
    .map((k) => `${KIND[k].verb}${' '}${n[k]} ${unit[k]}`)
    .join(' · ')
}

export interface ToolGroupProps {
  calls?: ToolCall[]
  /** 组内有失败项 —— 摘要行挂一枚 danger Tag */
  failed?: boolean
  /** 初始展开 */
  defaultOpen?: boolean
}

export function ToolGroup({
  calls = [],
  failed,
  defaultOpen = false,
}: ToolGroupProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const hasShell = calls.some((c) => c.kind === 'shell')
  const ms = calls.reduce((a, c) => a + (c.ms || 0), 0)
  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-2)',
        background: 'var(--surface-subtle)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="ds-toolgroup__summary"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-4)',
          width: '100%',
          height: 32,
          padding: '0 var(--s-5)',
          textAlign: 'left',
          cursor: 'pointer',
          border: 'none',
        }}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-label)/1 var(--font-sans)',
            color: 'var(--text-secondary)',
          }}
        >
          {summarize(calls)}
        </span>
        {failed === true ? <Tag tone="danger">1 项失败</Tag> : null}
        <span
          style={{
            marginLeft: 'auto',
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {calls.length} 次 · {(ms / 1000).toFixed(1)}s
        </span>
      </button>
      {open ? (
        <div>
          {calls.map((c, i) => (
            <ToolRow key={i} call={c} />
          ))}
          {hasShell ? (
            <div
              style={{
                display: 'flex',
                gap: 'var(--s-4)',
                alignItems: 'flex-start',
                padding: 'var(--s-4) var(--s-5)',
                borderTop: '1px solid var(--border-hairline)',
                background: 'var(--surface-card)',
              }}
            >
              <Icon name="info" size={13} />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                命令原文不在这里显示。可用的工具与路径由工作区设置里的预授权策略决定;这一屏显示的是
                <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)' }}>
                  动了哪个路径
                </b>
                。完整命令记在服务端审计里,面向管理员。
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export { summarize as summarizeToolCalls }
