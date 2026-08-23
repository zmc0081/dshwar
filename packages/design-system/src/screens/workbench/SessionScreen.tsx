/**
 * 协作屏 —— 工作台的默认 tab。一列对话 + 输入框,右侧本次产物 / 工作区文件 / 我的配额。
 *
 * ## V0.9.0 Session 2:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)对话流、产物清单、文件树、token 数全部硬编码 —— 那是刻意的,
 * 那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `size` 收到的是已经人类化的 `'2.4 MB'`,
 * `usage` 是 `'61,085 tok'`,工作区那一列的计数是 `'24 个文件'`;
 * `status` 是一个枚举而不是一段 `<Tag>` JSX。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 * 换算(字节 → `'2.4 MB'`、ISO 时间 → `'09:12'`)是调用方的事。
 *
 * `draft` 也提了出去。它看起来像「输入框自己的事」,其实不是:**按下发送时要拿到
 * 这段文字的人是调用方**,组件把它锁在自己的 `useState` 里,调用方就只能去 DOM 里捞。
 * 现在这一屏**一个 `useState` 都不剩**。
 *
 * ## 🚨 缺陷一:靠显示名猜「谁是用户」
 *
 * kit 原版的 `Turn` 里写着 `const isUser = who === '周琳'` —— 用**说话人的显示名**
 * 去比一个字面量,比中了就按用户排版(text-body),没比中就按 agent 排版(text-secondary)。
 *
 * 后果不是「换个人名会错」这么轻:
 *
 * - 任何**不叫周琳**的用户,自己说的每一句都被排成 agent 的样子 ——
 *   「我说的」与「它说的」这条视觉分界**整屏消失**,而且不报任何错;
 * - 反过来,**会话标题恰好是「周琳」**时(agent 那一侧的 `who` 传的就是会话名),
 *   agent 的发言被排成用户的发言。
 *
 * 与产物屏那处同族:**界面用一个代理判据去断言一件事,而那个代理不是那件事。**
 * ⇒ 角色现在是显式数据(`role: 'user' | 'agent'`),`speaker` 退回它本来的职责 —— 只是个名字。
 *
 * ## 🚨 缺陷二:降级横幅无条件渲染
 *
 * `<DegradeNotice from="opus-4-1" to="sonnet-4-5" />` 原本挂在标题行下面,**没有任何条件**。
 * 也就是说这一屏对每一次会话都断言「本次由 opus-4-1 降级至 sonnet-4-5」——
 * 而降级是一个**平台真的做过或者没做过**的动作,不是装饰。
 *
 * 露馅的地方就在同一屏上:横幅说降级到了 `sonnet-4-5`,而模型下拉显示的是
 * `claude-sonnet-4-5`,`opus-4-1` 更是根本不在下拉的选项里。同一屏两处在说不一样的事。
 *
 * ⇒ `degrade: SessionDegrade | null`,`null` 时整条横幅不渲染。
 *
 * ## 🚨 缺陷三:「停止」按钮不看会话状态
 *
 * 这一条是**转换本身逼出来的**:kit 里 `status` 是写死的「运行中」,只有一个状态,
 * 所以恒可点的「停止」看不出问题。`status` 一旦成为数据,一个已完成 / 已失败的会话
 * 仍然给出一个可按的「停止」,按下去什么都不会发生 —— 控件宣称了一个它没有的能力。
 * ⇒ `disabled={status !== 'running'}`。
 *
 * ## ⚠️ 一处已知缺陷**没有**在这里修:`QueuedInputCard` 把 props 拷进 state
 *
 * `OfflineState.tsx` 里 `const [queue, setQueue] = useState(items)` —— `items` 之后再变,
 * 卡片不跟。断网期间新敲下的指令**不会出现在队列里**,而这张卡存在的全部理由
 * 就是「你可能已经忘了断网时写过什么」。同一处的「全部发送」按钮也没有 `onClick`。
 *
 * 两者都在 `OfflineState.tsx`,本次改动不碰那个文件。这里也**不用 `key` 去绕**:
 * 拿队列内容当 key 会在每次新指令到达时重挂组件,把用户刚刚逐条丢弃的结果一并复活 ——
 * 那是拿第二个错去盖第一个错。记下来,留给动那个文件的那一轮。
 *
 * ## 没有发明控件
 *
 * 右侧「本次产物」「工作区文件」两列在 kit 里就是纯展示(图标 + 名字 + 计数,没有按钮),
 * 转换不给它们加 onClick —— 提夹具是把已有的东西接出来,不是顺手长出新交互。
 *
 * 内联 `style` 原样保留 —— 屏幕层是一次性布局,做成类只会得到一堆用一次的类名。
 * 本屏**没有**任何 JS 表达的交互态(hover / active / focus 都不在这一层),
 * 因此不需要配套的 screens CSS 文件。
 *
 * @module @dshwar/design-system/screens/workbench/SessionScreen
 */
import type * as React from 'react'
import { Fragment } from 'react'
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
import type { OfflineMode, QueuedInput } from './OfflineState.tsx'
import { ToolGroup, type ToolCall } from './ToolCalls.tsx'

/**
 * 会话状态。**闭集**,与标题旁 `Tag` 的 tone 一一对应,并且决定「停止」能不能按。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的状态应该在**转换层**停下来报错,
 * 而不是在界面上显示成一个含糊的灰标签 —— 后者会让一个新增的服务端状态
 * 悄悄退化成「看起来正常」,顺带把「停止」永久禁掉而没人知道为什么。
 */
export type SessionStatus = 'running' | 'completed' | 'failed' | 'stopped'

/**
 * 一个回合是谁说的。**这是数据,不是从显示名推出来的。**
 * 见模块注释「缺陷一」—— 用名字猜角色会在两个方向上同时出错。
 */
export type SessionTurnRole = 'user' | 'agent'

/**
 * 正文里的一段。
 *
 * `error` 必须是**独立一段**,不能拼进 `text` 里:它要渲染成 mono danger 的
 * `CodeRef`,而 `CodeRef` 是可复制的 —— 用户排查时要把这串原样贴给运维。
 * 拼成普通文本就等于把「可以复制的错误码」降级成「一句看着像错误码的话」。
 */
export type SessionTurnSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'error'; readonly text: string }

/** 一个回合里的一块内容:一段正文,或一组折叠起来的工具调用。 */
export type SessionTurnBlock =
  | { readonly kind: 'prose'; readonly segments: readonly SessionTurnSegment[] }
  | {
      readonly kind: 'tools'
      readonly calls: readonly ToolCall[]
      /** 组内有失败项 —— 摘要行挂一枚 danger Tag。**必填**,不留 undefined 的歧义 */
      readonly failed: boolean
    }

/** 对话流里的一个回合。 */
export interface SessionTurn {
  readonly id: string
  readonly role: SessionTurnRole
  /** 说话人的显示名。**只用来显示** —— 谁是用户由 `role` 决定 */
  readonly speaker: string
  /** 已格式化的元信息,如 `'09:12'` / `'09:12 · 48,201 tok'`。`null` = 不显示 */
  readonly meta: string | null
  readonly blocks: readonly SessionTurnBlock[]
}

/** 右侧「本次产物」的一行。 */
export interface SessionArtifact {
  readonly id: string
  readonly name: string
  /** 已人类化的大小,如 `'2.4 MB'`。取不到时传 `'—'` */
  readonly size: string
}

/** 右侧「工作区文件」的一行。 */
export interface SessionWorkspaceEntry {
  /** 目录路径,mono,如 `'reports/monthly/'` */
  readonly path: string
  /** 已格式化的计数,如 `'7 个文件'`。**连量词一起给** —— 单复数与量词是语言问题,不是组件的事 */
  readonly count: string
}

/** 右侧「我的配额」。两个数都是原始数值 —— `QuotaBar` 自己要按它们算百分比与条宽。 */
export interface SessionQuota {
  readonly used: number
  readonly total: number
}

/** 本次运行的模型降级。存在即代表**真的降级过**,见模块注释「缺陷二」。 */
export interface SessionDegrade {
  readonly from: string
  readonly to: string
  /** 原因短语。`null` = 用 `DegradeNotice` 的默认值「容量受限」 */
  readonly reason: string | null
}

export interface SessionScreenProps {
  /** 会话标题,页面 h1 */
  readonly title: string
  /** 会话状态。决定标题旁的 Tag,也决定「停止」能不能按 */
  readonly status: SessionStatus
  /** 本次运行 id,mono 可复制 */
  readonly runId: string
  /** 当前工作区名,显示在标题行右侧的 mono 串上 */
  readonly workspace: string
  /** 当前模型名,mono */
  readonly model: string
  /** 可切换的模型。**必须包含 `model` 本身**,否则下拉显示空白 */
  readonly modelOptions: readonly string[]
  /** 本次运行的模型降级。`null` = 没降级,整条横幅不渲染 */
  readonly degrade: SessionDegrade | null
  /** `null` = 在线;两个离线态各自改写输入框的占位与可用性 */
  readonly offline: OfflineMode | null
  /** 离线期间排队的输入。在线时不渲染;空数组时卡片自己返回 `null` */
  readonly queuedInputs: readonly QueuedInput[]
  /** 对话流。空数组 = 这个会话还没说过话,渲染空态而不是伪造一段对话 */
  readonly turns: readonly SessionTurn[]
  /** 输入框当前内容。**由调用方持有** —— 按下发送时要拿到它的人是调用方 */
  readonly draft: string
  /** 已格式化的本次会话消耗,如 `'61,085 tok'`。`null` = 取不到,那一格留空 */
  readonly usage: string | null
  /** 本次运行产出的产物。空数组渲染空态 */
  readonly artifacts: readonly SessionArtifact[]
  /** 工作区里的目录。空数组渲染空态 */
  readonly files: readonly SessionWorkspaceEntry[]
  /** `null` = 这个工作区没有启用配额计量 —— 不是 0,也不是「未知」 */
  readonly quota: SessionQuota | null
  readonly onModelChange?: (next: string) => void
  readonly onStop?: () => void
  readonly onDraftChange?: (next: string) => void
  readonly onSend?: () => void
  readonly onAttachFile?: () => void
  readonly onMentionArtifact?: () => void
}

const STATUS_OF: Record<
  SessionStatus,
  { tone: 'success' | 'neutral' | 'danger'; dot: boolean; label: string }
> = {
  running: { tone: 'success', dot: true, label: '运行中' },
  completed: { tone: 'neutral', dot: false, label: '已完成' },
  failed: { tone: 'danger', dot: false, label: '已失败' },
  stopped: { tone: 'neutral', dot: false, label: '已停止' },
}

function Turn({
  role,
  speaker,
  meta,
  children,
}: {
  role: SessionTurnRole
  speaker: string
  meta: string | null
  children?: React.ReactNode
}): React.JSX.Element {
  // 🚨 kit 原版是 `who === '周琳'`。见模块注释「缺陷一」。
  const isUser = role === 'user'
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
          {speaker}
        </span>
        {meta === null ? null : (
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

/** 段落:文本 / 换行 / 错误引用三种段拼起来。文本段用 `Fragment` 包,不多出一层 DOM。 */
function Prose({ segments }: { segments: readonly SessionTurnSegment[] }): React.JSX.Element {
  return (
    <Para>
      {segments.map((seg, i) =>
        seg.kind === 'break' ? (
          <br key={i} />
        ) : seg.kind === 'error' ? (
          <CodeRef key={i} tone="danger">
            {seg.text}
          </CodeRef>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </Para>
  )
}

export function SessionScreen({
  title,
  status,
  runId,
  workspace,
  model,
  modelOptions,
  degrade,
  offline,
  queuedInputs,
  turns,
  draft,
  usage,
  artifacts,
  files,
  quota,
  onModelChange,
  onStop,
  onDraftChange,
  onSend,
  onAttachFile,
  onMentionArtifact,
}: SessionScreenProps): React.JSX.Element {
  const badge = STATUS_OF[status]
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
            {title}
          </h1>
          <span style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
            <Tag tone={badge.tone} dot={badge.dot}>
              {badge.label}
            </Tag>
            <CodeRef copyable>{runId}</CodeRef>
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
            value={model}
            options={[...modelOptions]}
            mono
            style={{ width: 208 }}
            onChange={(e) => onModelChange?.(e.target.value)}
          />
          {/* 🚨 kit 里这颗按钮恒可点。只有运行中的会话才停得下来,见模块注释「缺陷三」。 */}
          <Button icon="square" disabled={status !== 'running'} onClick={() => onStop?.()}>
            停止
          </Button>
        </div>
      </div>
      {degrade === null ? null : (
        <DegradeNotice
          from={degrade.from}
          to={degrade.to}
          // exactOptionalPropertyTypes 下「不传」与「传 undefined」不是一回事:
          // 缺省要靠**不传这个键**表达,才落得到 DegradeNotice 自己的默认值上。
          {...(degrade.reason === null ? {} : { reason: degrade.reason })}
        />
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 300px',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          {offline === null ? null : <QueuedInputCard items={[...queuedInputs]} mode={offline} />}
          <Card pad="var(--s-8)">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              {turns.length === 0 ? (
                <Empty text="这个会话还没有对话" />
              ) : (
                turns.map((turn) => (
                  <Turn key={turn.id} role={turn.role} speaker={turn.speaker} meta={turn.meta}>
                    {turn.blocks.map((block, i) =>
                      block.kind === 'tools' ? (
                        <ToolGroup key={i} calls={[...block.calls]} failed={block.failed} />
                      ) : (
                        <Prose key={i} segments={block.segments} />
                      ),
                    )}
                  </Turn>
                ))
              )}
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
              onChange={(e) => onDraftChange?.(e.target.value)}
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
              <IconButton icon="paperclip" label="附加文件" onClick={() => onAttachFile?.()} />
              <IconButton icon="at-sign" label="引用产物" onClick={() => onMentionArtifact?.()} />
              {/* 这个 span 即使没内容也要留着:`marginLeft: auto` 是把发送按钮
                  推到最右的那根撑杆,条件渲染整块会让按钮跟着左移。 */}
              <span
                style={{
                  marginLeft: 'auto',
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {usage === null ? null : `本次会话 ${usage}`}
              </span>
              <Button
                variant="primary"
                icon="send"
                disabled={offline === 'readonly'}
                onClick={() => onSend?.()}
              >
                发送
              </Button>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="本次产物">
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              {artifacts.length === 0 ? (
                <Empty text="本次运行还没有产出产物" />
              ) : (
                artifacts.map((a) => (
                  <div
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}
                  >
                    <Icon name="file-text" size={14} />
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-body)/1.4 var(--font-sans)',
                        flex: 1,
                      }}
                    >
                      {a.name}
                    </span>
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                        color: 'var(--text-tertiary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {a.size}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card title="工作区文件">
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              {files.length === 0 ? (
                <Empty text="工作区还没有文件" />
              ) : (
                files.map((f) => (
                  <div
                    key={f.path}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}
                  >
                    <Icon name="folder" size={14} />
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-mono)/1.4 var(--font-mono)',
                        flex: 1,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {f.path}
                    </span>
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                        color: 'var(--text-tertiary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {f.count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card title="我的配额">
            {quota === null ? (
              <Empty text="这个工作区没有启用配额计量" />
            ) : (
              <QuotaBar used={quota.used} total={quota.total} note="平台容量 · 非承诺值" />
            )}
          </Card>
        </div>
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
