/**
 * 运行记录屏。8 列表格 · 全 mono 标识列 · 失败详情给错误码与 requestId。
 *
 * ## 与设计 kit 的差别:两处,都不改任何数值
 *
 * 1. 首行的 `const { … } = window.DSHWARDesignSystem_264a5f` 换成 ES import。
 * 2. 列定义补了 `TableColumn[]` 标注 —— 不标的话 `align: 'right'` 被推断成
 *    `string`,与 `'left' | 'right'` 不兼容。**只加标注,值一个没动。**
 *
 * 内联 `style={{}}` 原样保留:筛选区那条 `1fr 180px 180px auto` 是这一屏
 * 独有的一次性栅格。这一屏没有 hover / active / focus 的 JS 写法,
 * 因此没有需要换成伪类的东西。
 *
 * ## V0.9.0 Session 2:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)行、筛选值、失败详情全部硬编码 —— 那是刻意的,
 * 那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `tokens` 收到的是已经带千分位的
 * `'48,201'`,`duration` 是 `'2m 14s'`,`startedAt` 是 `'08-18 09:12'`;
 * `status` 是一个枚举而不是一段 `<Tag>` JSX。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 * 换算(毫秒 → `'2m 14s'`、ISO 时间 → `'08-18 09:12'`)是调用方的事。
 *
 * 选中行也一并交出去了。这一屏改完**一个 `useState` 都不剩** ——
 * 它没有「只有它自己关心」的瞬时状态:选中哪一行、筛选成什么样,
 * 决定的是右下那张卡显示谁、以及导出导的是哪一批,调用方必须知道。
 *
 * ## 🚨 缺陷一:失败详情**不跟随选中行**,而且卡片自己跟自己对不上
 *
 * kit 原版 `sel` 初值是 `0`,即第一行 `run_9f3c21ab`、状态**完成**;
 * 而下面那张「失败详情」卡是**常量**,恒显示一条 `E_MODEL_UNAVAILABLE`。
 * 于是界面同时说着两件互相矛盾的事:选中的这次运行完成了,以及它失败了。
 *
 * 更能说明问题的是卡片**内部**就对不上:错误码那行的 requestId 是
 * `req_9f3c21ab7e`(尾号取自**完成**的 `run_9f3c21ab`),而下面一行正文
 * 写的是 `run_2b88af51`(第三行,失败)。两个标识各自硬编码,谁也不管谁。
 *
 * 与「假成功回执」同族 —— 系统给出的回执与它实际做到的事不一致。
 * 这一屏的代价还更直接:用户会拿着那个 requestId 去找支持,
 * 而那个 id 指向的是另一次运行。
 *
 * ⇒ 现在 `failure` 说的就是 `selectedIndex` 指向的那一行,`null` = 没选中
 * 或这次运行没失败 —— 那时显示空态,**不显示一条陈旧的错误**。
 * 并且 `RunFailure` 里**不带运行 id**:它由选中的那一行给出。
 * 同一个标识由两处各给一份,迟早对不上,kit 原版就是现成的例子。
 *
 * ## 🚨 缺陷二:五行的操作区共用同一个 `act` 常量
 *
 * 原版把 `<IconButton icon="rotate-ccw" label="重跑" />` 提成一个常量,
 * 五行共享同一份 JSX。于是**没有任何一行的按钮知道自己属于哪一行** ——
 * 「重跑」接不上 onClick,不是忘了接,是接了也不知道该重跑谁。
 * 现在按行构造,`onRerun` 收到的是这一行的 `id`。
 *
 * ## 🚨 缺陷三:两个筛选器 `onChange={() => {}}` 静默吞掉选择
 *
 * 受控 `<select>` 配一个空 onChange,等于用户选了「失败」、下拉**弹回「全部」**,
 * 什么也没发生,也没有任何提示。这不是「还没接」——「还没接」是不给 onChange,
 * 那时 `Select` 按契约退化成只展示;给一个吞掉的 onChange 是界面接收了一次
 * 交互然后假装无事发生。现在三个筛选值全部由调用方持有。
 *
 * @module @dshwar/design-system/screens/workbench/RunsScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'

/**
 * 一次运行的状态。**闭集**,与 `Tag` 的 tone 一一对应。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的状态应该在**转换层**停下来报错,
 * 而不是在界面上显示成一个含糊的灰标签 —— 后者会让一个新增的服务端状态
 * 悄悄退化成「看起来正常」。
 */
/**
 * 一次运行的状态。
 *
 * ⚠️ **`running` 与 `idle` 是 V0.9.0 Session 2 接真实 API 时补的**,
 * 而不是设计侧遗漏 —— 设计稿画的是**已经跑完**的历史,所以只有终态。
 *
 * 接上 `/v1/sessions` 之后发现契约的 `Session.status` 只有
 * `'idle' | 'running'` 两个值,与这里的四个终态**几乎不重叠**。
 * 硬映射会说谎:把 `running` 显示成「草稿」,是对着一个正在跑的会话
 * 说它还没开始 —— 与「假成功回执」同族。
 *
 * ⇒ 补两个成员,让词表能表达 API 真的会给出的东西。
 * 终态四个留着:`/v1/jobs` 落地之后按轮次的记录会用到它们。
 */
export type RunStatus = 'completed' | 'degraded' | 'failed' | 'draft' | 'running' | 'idle'

/** 表里的一行。字段都是**已经格式化好的展示串**。 */
export interface RunRow {
  /** 运行 id,原样展示(mono 列)—— 禁止本地化、禁止改写大小写。 */
  readonly id: string
  /** 发起这次运行的 Agent 名。 */
  readonly agent: string
  /** 模型标识,如 `'sonnet-4-5'`。 */
  readonly model: string
  /** 已带千分位的 token 数,如 `'48,201'`。取不到时传 `'—'`。 */
  readonly tokens: string
  /** 已人类化的耗时,如 `'2m 14s'` / `'48s'`。 */
  readonly duration: string
  /** 已格式化的开始时间,如 `'08-18 09:12'`。 */
  readonly startedAt: string
  readonly status: RunStatus
}

/**
 * 「失败详情」卡的内容。
 *
 * ⚠️ **刻意不含运行 id** —— 见模块注释缺陷一:这张卡说的就是 `selectedIndex`
 * 指向的那一行,id 从那一行取,不在这里再给一份。
 */
export interface RunFailure {
  /** 错误码,如 `'E_MODEL_UNAVAILABLE'`。原样展示。 */
  readonly code: string
  /** 请求 id —— 用户会拿它去找支持,必须与选中的那次运行是同一次。 */
  readonly requestId: string
  /** 已本地化的说明文案。 */
  readonly message: string
}

export interface RunsScreenProps {
  readonly rows: readonly RunRow[]
  /** 选中行的下标。`-1` = 未选中;越界同样按未选中处理。 */
  readonly selectedIndex: number
  /**
   * 选中那一行的失败详情。`null` = 没选中,或这次运行没失败
   * (完成 / 降级 / 草稿都传 `null`,组件显示空态,**不要留着上一条错误**)。
   */
  readonly failure: RunFailure | null
  /** 按运行 ID 或 Agent 筛选的当前输入值。 */
  readonly query: string
  /**
   * 状态与模型两个下拉的当前值与可选项。
   *
   * 这里是**裸串**而不是枚举,与 `RunRow.status` 的闭集是两回事:
   * 行的状态来自服务端,认不出就该报错;而下拉的选项是部署侧的清单
   * (准入模型按租户不同,「全部」这一档也只是筛选器的约定),它是数据。
   */
  readonly status: string
  readonly statusOptions: readonly string[]
  readonly model: string
  readonly modelOptions: readonly string[]
  /** 省略即为只展示 —— 这一屏的筛选值一律由调用方持有,组件不留副本。 */
  readonly onQueryChange?: (next: string) => void
  readonly onStatusChange?: (next: string) => void
  readonly onModelChange?: (next: string) => void
  readonly onSelect?: (index: number) => void
  /** 重跑某一行。收到的是**这一行**的运行 id。 */
  readonly onRerun?: (id: string) => void
  readonly onExport?: () => void
}

const TONE_OF: Record<
  RunStatus,
  { tone: 'success' | 'warn' | 'danger' | 'neutral'; label: string }
> = {
  completed: { tone: 'success', label: '完成' },
  degraded: { tone: 'warn', label: '降级' },
  failed: { tone: 'danger', label: '失败' },
  draft: { tone: 'neutral', label: '草稿' },
  // ⚠️ 进行中用 warn 而不是 neutral —— 它需要与「草稿」在视觉上分开:
  //   两者都不是终态,但一个在耗资源、一个没有。
  running: { tone: 'warn', label: '进行中' },
  idle: { tone: 'neutral', label: '空闲' },
}

const COLS: TableColumn[] = [
  { key: 'id', label: '运行 ID', mono: true },
  { key: 'agent', label: 'Agent' },
  { key: 'model', label: '模型', mono: true },
  { key: 'tok', label: 'tok', align: 'right', mono: true },
  { key: 'dur', label: '耗时', align: 'right', mono: true },
  { key: 'at', label: '开始时间', mono: true },
  { key: 'st', label: '状态' },
  { key: 'a', label: '', align: 'right', width: '72px' },
]

export function RunsScreen({
  rows,
  selectedIndex,
  failure,
  query,
  status,
  statusOptions,
  model,
  modelOptions,
  onQueryChange,
  onStatusChange,
  onModelChange,
  onSelect,
  onRerun,
  onExport,
}: RunsScreenProps): React.JSX.Element {
  // 选中的那一行。`-1` 与越界都收敛成 `null` —— `noUncheckedIndexedAccess` 下
  // `rows[selectedIndex]` 本来就是 `RunRow | undefined`,不用另写边界判断。
  const selected = rows[selectedIndex] ?? null

  const tableRows = rows.map((row) => {
    const { tone, label } = TONE_OF[row.status]
    return {
      id: row.id,
      agent: row.agent,
      model: row.model,
      tok: row.tokens,
      dur: row.duration,
      at: row.startedAt,
      st: (
        <Tag tone={tone} dot={row.status === 'completed'}>
          {label}
        </Tag>
      ),
      // ⚠️ 每行**各自**的操作区。kit 原版是一个共享的 `act` 常量 ——
      //   于是没有任何一行的按钮知道自己属于哪一行,接不上 onClick。
      a: (
        <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <IconButton icon="rotate-ccw" label="重跑" onClick={() => onRerun?.(row.id)} />
          <IconButton icon="more-horizontal" label="更多" />
        </span>
      ),
    }
  })

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
        <Input
          label="按运行 ID 或 Agent 筛选"
          placeholder="run_ / Agent 名称"
          mono
          value={query}
          onChange={(e) => onQueryChange?.(e.target.value)}
        />
        <Select
          label="状态"
          value={status}
          options={[...statusOptions]}
          onChange={(e) => onStatusChange?.(e.target.value)}
        />
        <Select
          label="模型"
          value={model}
          options={[...modelOptions]}
          mono
          onChange={(e) => onModelChange?.(e.target.value)}
        />
        {/* 一行都没有时导出会产出一个空文件 —— 那也是一种「做了但什么都没做」的回执。 */}
        <Button icon="download" disabled={rows.length === 0} onClick={() => onExport?.()}>
          导出
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty text="没有符合条件的运行记录" />
      ) : (
        <Table
          columns={COLS}
          rows={tableRows}
          selectedIndex={selectedIndex}
          onRowClick={(index) => onSelect?.(index)}
        />
      )}

      <Card title="失败详情">
        {failure === null || selected === null ? (
          <Empty text={selected === null ? '选一条运行看它的失败详情' : '这次运行没有失败'} />
        ) : (
          <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
            {/*
              ⚠️ 错误码与 requestId 在 **JS 里**拼成一个串再传给 `CodeRef`。
              `CodeRef` 的复制取的是 `String(children)`,传两段子节点的话
              那是个数组,复制出来会变成 `E_MODEL_UNAVAILABLE, · ,req_…` ——
              看到的与复制到的不一致,而这个串的用途就是被粘贴出去。
            */}
            <CodeRef copyable tone="danger">
              {`${failure.code} · ${failure.requestId}`}
            </CodeRef>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                color: 'var(--text-secondary)',
              }}
            >
              {selected.id} · {failure.message}
            </span>
          </div>
        )}
      </Card>
    </>
  )
}

/** 空态。刻意朴素 —— 空不是错误,不该长得像错误。 */
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
