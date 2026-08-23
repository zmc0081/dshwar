/**
 * 作业屏。长任务在服务端排队与执行,关掉客户端不会中断;重新打开时从服务端状态恢复。
 *
 * 两个导出:`AwayDigest`(你不在时的进展)与 `JobsScreen`(整屏)。
 * kit 里两者同在一个文件、同挂到 window,这里保持同一个文件、两个具名导出。
 *
 * ## V0.9.0 Session 2:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)行、摘要流水、失败详情全部硬编码 —— 那是刻意的,
 * 那一轮的纪律是机械转换。这一轮把它们提成 props,`useState` 一并去掉:
 * 选中行由调用方持有,组件不再有任何自己的状态。
 *
 * **props 是表现层类型,不是 API 类型。** `elapsed` 收到的是已经人类化的
 * `'6h 12m'`,`status` 是一个枚举而不是一段 `<Tag>` JSX。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 * 换算(毫秒 → `'6h 12m'`、ISO 时间 → `'昨天 21:30'`)是调用方的事。
 *
 * ## ★ 这一屏必须能说出「没实现」,而不是显示一张空表
 *
 * `/v1/jobs` 三条在契约里标着 `planned`,出厂网关回落 **501**
 * (见 `packages/api-contract/src/routes.ts` 的 `listJobs` / `createJob` / `getJob`;
 * 它们一度被标成 `implemented` 而实现根本不存在,于是出厂返回 404 ——
 * 那次的复盘在 `docs/DECISIONS/comment-implementation-mismatch.md`)。
 *
 * 于是这一屏有**两种没有行**的情况,它们在界面上必须分得开:
 *
 * | 情况                       | props                                 | 界面                   |
 * | -------------------------- | ------------------------------------- | ---------------------- |
 * | 服务端答了,一个作业都没有  | `unavailable === null` · `rows: []`   | 朴素空态「当前没有作业」 |
 * | 服务端**答不了这个问题**   | `unavailable !== null`                | 501 通栏说明,**不画表** |
 *
 * 把 501 画成空表,是替服务端回答一个它没回答的问题:用户会据此得出
 * 「我的作业都跑完了」或「我没提交过作业」,而真相是这个功能还不存在。
 * 与「假成功回执」同族 —— **界面说出的事,比系统实际知道的多。**
 *
 * ⚠️ 这也是为什么 `unavailable` 是一个独立的 prop,而不是 `rows.length === 0`
 * 的某种解读:两种状态在数据上恰好长得一样,只能由调用方显式区分。
 *
 * ## 🚨 顺带修一处真缺陷:失败详情**不跟随选中行**
 *
 * kit 原版里 `selectedIndex={sel}` 只给行加了底色,而「失败详情」卡的内容是
 * **常量**。更坏的是初始 `sel = 1` 恰好就是失败的那一行 `job_2b88af51`,
 * 于是第一眼看上去完全正确 —— 点第 1 行(`job_9f3c21ab`,运行中)或
 * 第 5 行(排队中,一步都没跑),卡里仍然是 `job_2b88af51` 的 `E_TOOL_DENIED`,
 * 说一个从没开始跑的作业「第 2 步请求写入 workspace/inbox/ 失败」。
 *
 * **默认值碰巧对**是这一处比产物屏更隐蔽的地方:缺陷只在用户点了别的行之后
 * 才暴露,而那时用户已经建立了「这张卡讲的是选中的作业」的预期。
 *
 * ⇒ 现在 `failure` 由 `selectedIndex` 指向的那一行给出,由调用方负责保持一致;
 * 选中的作业没失败(或没选中)时传 `null`,卡里显示空态,而不是别人的错误码。
 *
 * ## 与设计 kit 的差别:都不改任何数值与文案
 *
 * 1. 首行的 `const { … } = window.DSHWARDesignSystem_264a5f` 换成 ES import。
 * 2. `COLUMNS` 补了 `TableColumn[]` 标注 —— 不标的话 `align: 'right'` 被推断成
 *    `string`,与 `'left' | 'right'` 不兼容。
 * 3. 摘要顶部那四个计数、四条流水从 JSX 里的字面量提成 props;
 *    Session 1 给它们加的 `[string, string, string][]` 标注随之作废 ——
 *    元组是为了在 `noUncheckedIndexedAccess` 下解构不出 `undefined`,
 *    而具名字段本来就没有这个问题。
 * 4. 每行行尾的操作区改为**逐行构造**。原版是一个共享的 `act` 常量,
 *    于是没有任何一行的按钮知道自己属于哪一行,接不上 `onClick`。
 *
 * 内联 `style={{}}` 原样保留:全是一次性布局。这一屏没有 hover / active /
 * focus 的 JS 写法,因此没有需要换成伪类的东西。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 长任务跨重启恢复:用户关掉客户端、作业还在跑。
 *
 * ★ 所以这一屏的第一块不是队列表,而是「你不在时的进展」——
 *   让用户自己去翻运行记录对时间戳,等于把服务端已经知道的事推给用户重算。
 *   摘要按"上次打开"这个时间锚给出:完成了什么、失败了什么、还在跑什么。
 *
 * ★ 失败通知:**这一版不做推送**(无系统通知、无邮件、无 webhook)。
 *   只做界面内未读标记 + 本摘要。写明理由:推送需要常驻客户端、通知权限、
 *   以及每用户的通知偏好存储,这三样都还没定;先做一个"打开就看得到"的诚实版本,
 *   比先上一个只在某些平台生效、静默漏掉其余情况的推送更好。
 *   ——这是一个明确的取舍,不是遗漏。
 *
 * @module @dshwar/design-system/screens/workbench/JobsScreen
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
 * 摘要里的语义色档。**闭集**,与设计令牌一一对应。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的取值应该在**转换层**停下来报错,
 * 而不是在界面上退化成一个含糊的灰色 —— 后者会让一个新增的服务端状态
 * 悄悄变成「看起来正常」。
 */
export type DigestTone = 'success' | 'warn' | 'danger' | 'neutral'

/**
 * 收到的是档位名,不是色值 —— 色值由这张表在组件内给出。
 * 调用方传 `'var(--danger)'` 之类的原始令牌名等于让它决定视觉,那是设计系统的职责。
 */
const TONE_COLOR: Record<DigestTone, string> = {
  success: 'var(--success)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  neutral: 'var(--text-secondary)',
}

/** 摘要顶部的一个计数。 */
export interface AwayDigestStat {
  readonly label: string
  /** 已格式化的计数,如 `'2'`。 */
  readonly value: string
  readonly tone: DigestTone
}

/** 摘要流水里的一条。 */
export interface AwayDigestEntry {
  /** Lucide 图标名,如 `'circle-check'` / `'circle-x'` / `'loader'`。 */
  readonly icon: string
  readonly tone: DigestTone
  /** 一句话说明,已本地化。 */
  readonly text: string
  /** 右侧的时间或状态,mono,如 `'今天 02:14'` / `'进行中'`。 */
  readonly meta: string
}

export interface AwayDigestProps {
  /** 时间锚 = 上次打开的时刻,显示在卡片头部「自 {since}」 */
  readonly since: string
  /** 顶部计数。空数组 = 不画计数行,**而不是画四个 0**。 */
  readonly stats: readonly AwayDigestStat[]
  /** 流水。空数组 = 你不在的这段时间确实什么都没发生,显示朴素空态。 */
  readonly entries: readonly AwayDigestEntry[]
  readonly onViewFailures?: () => void
  readonly onMarkAllRead?: () => void
}

export function AwayDigest({
  since,
  stats,
  entries,
  onViewFailures,
  onMarkAllRead,
}: AwayDigestProps): React.JSX.Element {
  // 没有流水时两个按钮都 disabled:没有失败可看,也没有未读可标。
  // 让它们可点却什么都不发生,是另一种「界面说的比系统做的多」。
  const idle = entries.length === 0

  return (
    <Card
      title="你不在时的进展"
      action={
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            color: 'var(--text-tertiary)',
          }}
        >
          自 {since}
        </span>
      }
    >
      <div style={{ display: 'grid' }}>
        {stats.length === 0 ? null : (
          <div style={{ display: 'flex', gap: 'var(--s-6)', paddingBottom: 'var(--s-5)' }}>
            {stats.map((s) => (
              <span key={s.label} style={{ display: 'grid', gap: 2 }}>
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-sans)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    font: 'var(--fw-bold) var(--fs-title-2)/1 var(--font-sans)',
                    color: TONE_COLOR[s.tone],
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.value}
                </span>
              </span>
            ))}
          </div>
        )}
        {idle ? (
          <Empty text="你不在的这段时间没有变化。" />
        ) : (
          entries.map((e, i) => <DigestLine key={e.text + String(i)} entry={e} />)
        )}
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-4)',
            alignItems: 'center',
            paddingTop: 'var(--s-5)',
            borderTop: '1px solid var(--border-hairline)',
          }}
        >
          <Button size="compact" disabled={idle} onClick={() => onViewFailures?.()}>
            查看失败详情
          </Button>
          <Button size="compact" variant="ghost" disabled={idle} onClick={() => onMarkAllRead?.()}>
            全部标为已读
          </Button>
          <span
            style={{
              marginLeft: 'auto',
              font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
              color: 'var(--text-tertiary)',
            }}
          >
            本版不做推送通知（无系统通知 / 邮件 / webhook）——只在界面内标未读。
          </span>
        </div>
      </div>
    </Card>
  )
}

/** 摘要流水的一行。kit 里是组件内的 `line()` 闭包,提到模块级只为了别每次渲染重造。 */
function DigestLine({ entry }: { entry: AwayDigestEntry }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'center',
        padding: 'var(--s-4) 0',
        borderTop: '1px solid var(--border-hairline)',
      }}
    >
      <Icon name={entry.icon} size={14} tone="inherit" style={{ color: TONE_COLOR[entry.tone] }} />
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-body)/1.5 var(--font-sans)',
          color: 'var(--text-body)',
          flex: 1,
        }}
      >
        {entry.text}
      </span>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {entry.meta}
      </span>
    </div>
  )
}

/**
 * 作业的状态。**闭集**,与 `Tag` 的 tone 一一对应。
 *
 * ⚠️ 同 {@link DigestTone}:不设「未知」档。认不出的服务端状态该在转换层报错,
 * 而不是在表里显示成一个说不清的灰标签。
 */
export type JobStatus = 'running' | 'failed' | 'completed' | 'queued'

const STATUS_OF: Record<
  JobStatus,
  { tone: 'success' | 'warn' | 'danger' | 'neutral'; label: string; dot: boolean }
> = {
  running: { tone: 'warn', label: '运行中', dot: true },
  failed: { tone: 'danger', label: '失败', dot: false },
  completed: { tone: 'success', label: '完成', dot: true },
  queued: { tone: 'neutral', label: '排队中', dot: false },
}

/** 表里的一行。字段都是**已经格式化好的展示串**。 */
export interface JobRow {
  readonly id: string
  /** Agent 名,人读,如 `'合同条款比对'`。 */
  readonly agent: string
  /** 已格式化的步骤进度,如 `'14 / 22'`。 */
  readonly step: string
  /** 已人类化的已运行时长,如 `'6h 12m'`。还没开始跑传 `'—'`。 */
  readonly elapsed: string
  /** 已格式化的开始时间,如 `'昨天 21:30'`。还没开始跑传 `'—'`。 */
  readonly startedAt: string
  /** 跨重启恢复次数的展示串,如 `'2 次'`。没恢复过传 `'—'`。 */
  readonly resumed: string
  readonly status: JobStatus
  /** 这一行能不能重跑。运行中与排队中的作业应当传 `false`。 */
  readonly rerunnable: boolean
}

/**
 * 失败说明里的一段。**闭集**的两档:普通文字与机器串。
 *
 * 为什么不收一整句:句子里的 `job_2b88af51` 与 `workspace/inbox/` 是**机器串**,
 * 要走 {@link CodeRef}(mono、可选中、禁止本地化与大小写改写);
 * 而把整句做成「模板 + 槽位」是另一种谎 —— 那个模板只对 `E_TOOL_DENIED` 成立,
 * 换一个错误码句子结构就不一样了,套上去等于替别的错误码编造措辞。
 * 分段是唯一既保住排版、又不替谁编句式的形状。
 *
 * ⚠️ 不收 JSX。收 JSX 等于让调用方决定这一屏长什么样,而那正是设计系统的职责。
 */
export type JobFailureSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'ref'; readonly value: string }

/** 「失败详情」卡的内容。必须属于 `selectedIndex` 指的那一行。 */
export interface JobFailure {
  /** 错误码与 requestId 的展示串,如 `'E_TOOL_DENIED · req_2b88af51c3'`。 */
  readonly code: string
  /** 说明正文,按段给,见 {@link JobFailureSegment}。 */
  readonly detail: readonly JobFailureSegment[]
  /** 这条失败属于哪个作业 —— 两个按钮都要带着它跳。 */
  readonly jobId: string
}

/**
 * 端点不可用的说明。**只描述「服务端答不了」,不描述「没有数据」** ——
 * 后者是 `rows: []`,是完全不同的一件事。
 */
export interface JobsUnavailable {
  /** 端点标识,如 `'GET /v1/jobs'`。 */
  readonly endpoint: string
  /** 契约里登记的计划版本,如 `'0.9.0'`;还没定档时传 `null`。 */
  readonly plannedVersion: string | null
  /** 本次探测拿到的 requestId,可复制;拿不到传 `null`。 */
  readonly requestId: string | null
}

export interface JobsScreenProps {
  /**
   * 端点不可用时的说明。`null` = 端点可用 —— 此时 `rows` 为空就是**真的没有作业**。
   * 非 `null` 时整屏不画表、不画摘要,只给 501 通栏说明。见模块注释里的那张表。
   */
  readonly unavailable: JobsUnavailable | null
  readonly rows: readonly JobRow[]
  /** 选中行的下标。`-1` = 未选中。 */
  readonly selectedIndex: number
  /**
   * 「你不在时的进展」。`null` = 没有时间锚(第一次打开,不存在「上次」),
   * 这时不画这张卡 —— 不画一个自 `—` 起的摘要。
   */
  readonly digest: AwayDigestProps | null
  /**
   * 选中作业的失败详情。`null` = 没选中,或选中的作业没失败。
   *
   * ⚠️ 必须与 `selectedIndex` 指的是同一行,由调用方负责 —— 见模块注释里的 🚨。
   */
  readonly failure: JobFailure | null
  /** 工作区范围筛选的当前值与可选项。 */
  readonly scope: string
  readonly scopeOptions: readonly string[]
  readonly onScopeChange?: (next: string) => void
  readonly onSelect?: (index: number) => void
  readonly onRerun?: (id: string) => void
  readonly onExport?: () => void
  /** 「前往工作区设置」——带着失败作业的 id 跳。 */
  readonly onOpenWorkspaceSettings?: (jobId: string) => void
  /** 「查看该步骤的工具调用」 */
  readonly onViewToolCalls?: (jobId: string) => void
}

const COLUMNS: TableColumn[] = [
  { key: 'id', label: '作业 ID', mono: true },
  { key: 'agent', label: 'Agent' },
  { key: 'step', label: '步骤', align: 'right', mono: true },
  { key: 'el', label: '已运行', align: 'right', mono: true },
  { key: 'started', label: '开始', mono: true },
  { key: 'resumed', label: '跨重启', mono: true },
  { key: 'st', label: '状态' },
  { key: 'a', label: '', align: 'right', width: '72px' },
]

export function JobsScreen({
  unavailable,
  rows,
  selectedIndex,
  digest,
  failure,
  scope,
  scopeOptions,
  onScopeChange,
  onSelect,
  onRerun,
  onExport,
  onOpenWorkspaceSettings,
  onViewToolCalls,
}: JobsScreenProps): React.JSX.Element {
  const tableRows = rows.map((row) => {
    const { tone, label, dot } = STATUS_OF[row.status]
    return {
      id: row.id,
      agent: row.agent,
      step: row.step,
      el: row.elapsed,
      started: row.startedAt,
      resumed: row.resumed,
      st: (
        <Tag tone={tone} dot={dot}>
          {label}
        </Tag>
      ),
      // ⚠️ 每行**各自**的操作区。kit 原版是一个共享的 `act` 常量 ——
      //   于是没有任何一行的按钮知道自己属于哪一行,接不上 onClick。
      a: (
        <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <IconButton
            icon="rotate-ccw"
            label="重跑"
            disabled={!row.rerunnable}
            onClick={() => onRerun?.(row.id)}
          />
          <IconButton icon="more-horizontal" label="更多" />
        </span>
      ),
    }
  })

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
            作业
          </h1>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            长任务在服务端排队与执行，
            <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>
              关掉客户端不会中断
            </b>
            ；重新打开时从服务端状态恢复。
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'flex-end' }}>
          <Select
            value={scope}
            options={[...scopeOptions]}
            style={{ width: 150 }}
            onChange={(e) => onScopeChange?.(e.target.value)}
          />
          {/* 端点不可用、或一行都没有时导不出任何东西 —— 让它可点是假的可用性。 */}
          <Button
            icon="download"
            disabled={unavailable !== null || rows.length === 0}
            onClick={() => onExport?.()}
          >
            导出
          </Button>
        </div>
      </div>

      {unavailable === null ? (
        <>
          {digest === null ? null : <AwayDigest {...digest} />}

          {rows.length === 0 ? (
            <Card>
              <Empty text="当前没有作业。提交之后会出现在这里，关掉客户端也不会中断。" />
            </Card>
          ) : (
            <Table
              columns={COLUMNS}
              rows={tableRows}
              selectedIndex={selectedIndex}
              onRowClick={(index) => onSelect?.(index)}
            />
          )}

          <Card title="失败详情">
            {failure === null ? (
              <Empty text={selectedIndex < 0 ? '选一个作业看它的失败详情' : '这个作业没有失败'} />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
                <CodeRef copyable tone="danger">
                  {failure.code}
                </CodeRef>
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                    color: 'var(--text-secondary)',
                    maxWidth: '84ch',
                  }}
                >
                  {failure.detail.map((seg, i) =>
                    seg.kind === 'ref' ? (
                      <CodeRef key={seg.value + String(i)}>{seg.value}</CodeRef>
                    ) : (
                      <span key={seg.value + String(i)}>{seg.value}</span>
                    ),
                  )}
                </span>
                <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                  <Button size="compact" onClick={() => onOpenWorkspaceSettings?.(failure.jobId)}>
                    前往工作区设置
                  </Button>
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => onViewToolCalls?.(failure.jobId)}
                  >
                    查看该步骤的工具调用
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : (
        <NotImplementedNotice {...unavailable} />
      )}
    </>
  )
}

/**
 * 端点未实现的通栏说明。形制沿用 `QuotasScreen` / `WorkspaceSettingsScreen`
 * 的那一条(warn 底、mono 端点标识、零 accent)—— 它是平台在说话,不是品牌文案。
 *
 * ⚠️ 与那两屏的「未接线」有一处不同:那两屏的控件还在,只是 disabled;
 * 这一屏**连表都不画**。理由是那两屏的界面本身就是要展示的内容(策略项),
 * 而这一屏的内容全部来自不可用的那个端点 —— 画一张只有表头的空表,
 * 说的是「没有作业」,不是「问不到」。
 */
function NotImplementedNotice({
  endpoint,
  plannedVersion,
  requestId,
}: JobsUnavailable): React.JSX.Element {
  const parts = [endpoint, '501 NOT_IMPLEMENTED']
  if (requestId !== null) parts.push(requestId)

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'flex-start',
        padding: 'var(--s-5) var(--s-6)',
        borderRadius: 'var(--r-1)',
        background: 'var(--warn-surface)',
        border: '1px solid var(--warn)',
      }}
    >
      <Icon name="triangle-alert" size={15} tone="inherit" style={{ color: 'var(--warn)' }} />
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <span
          style={{
            font: 'var(--fw-medium) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--warn)',
          }}
        >
          作业端点尚未实现 —— 这一屏现在没有数据可显示
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '86ch',
          }}
        >
          {plannedVersion === null
            ? '契约已定，实现档期未定——作业的执行语义（排队、取消、与会话的关系）还没定下来，定不下来就给不出真实档期。'
            : `契约已定，实现计划在 v${plannedVersion}。`}
          这里刻意不画一张空表：空表说的是「你没有作业」，而真实情况是服务端还答不了这个问题——两件事必须分得开。
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
            color: 'var(--text-tertiary)',
          }}
        >
          <CodeRef copyable>{parts.join(' · ')}</CodeRef>
        </span>
      </div>
    </div>
  )
}

/**
 * 卡片里的空态。刻意朴素 —— 空不是错误,不该长得像错误。
 *
 * 与产物屏各留一份,没有抽成公共件:那是组件层的决定(要不要有 `EmptyState`、
 * 它的契约是什么),不在本次「把夹具提成 props」的纪律之内。
 */
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
