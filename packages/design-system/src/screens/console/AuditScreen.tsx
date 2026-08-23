/**
 * 审计屏。动作词原样输出、不本地化;一行是一条**只能追加、不能修改**的记录。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import ——
 *    见 `docs/DECISIONS/design-kit-adoption.md` 裁决 2 的第三笔账。
 * 2. 一次性布局的 `style={{}}` **原样保留**。守卫禁的是「用 JS 表达那些 CSS 伪类
 *    本来就能表达的状态」,不是内联布局本身;本屏没有任何 JS 承载的交互态,
 *    因此也没有对应的 `styles/screens/*.css`。
 *
 * ## V0.9.0 Session 3:夹具写死 → **受控组件**
 *
 * 五行记录、三个筛选器、选中行全部提成 props,`useState` 一个都不剩 ——
 * 选中哪一行、筛什么,都是**调用方的状态**(它要据此去取下一页、写进 URL、
 * 决定导出哪一批)。组件自己再记一份,就是同一件事有两个来源。
 *
 * **props 是表现层类型,不是 API 类型。** `at` 收到的是已经格式化好的展示串,
 * `before` / `after` 收到的是已经序列化、**已经脱敏**的展示串。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被控制台、工作台、将来的白牌前端复用,而它们的数据来源不一定相同。
 * 换算(ISO 时间 → 本地时区、`unknown` → 一段可读的变更体)是调用方的事。
 *
 * ⚠️ **脱敏尤其不能落在这一层**:硬规则 5 —— 凭据类操作只记 `describe` 层面的
 * 事实,不记值。设计系统压根看不见值,才没有把值渲染出去的可能。
 *
 * ## 详情卡**从选中行派生**,不是第二个 prop
 *
 * `ArtifactsScreen` 那边预览与来源是独立 props —— 它们要另外发一次请求才拿得到。
 * 而审计的 `before` / `after` 与列表在**同一个响应**里(契约的 `ListAuditResponse.data`),
 * 放进行里之后,「详情显示的是另一条记录」这个 bug 在结构上就不可能发生 ——
 * 而它正是 `ArtifactsScreen` 那一屏修掉的那个。
 *
 * ## 🚨 四处在 kit 里无害、接上真 API 就是伪证的地方
 *
 * **🚨 1. 请求 ID 是一个写死的常量。** 五行记录共用同一个串,而那个串服务端
 * 从来没生成过。用户把它抄进工单、运维拿它去 grep 网关日志 —— 什么都搜不到,
 * 于是这张工单从「一个 bug」变成「一个查不下去的 bug」。与「假成功回执」同族:
 * **界面给出的凭证,与系统实际记下的不是一回事。** ⇒ 现在来自 `row.requestId`。
 *
 * **🚨 2.「结果 ok」同样写死,而且契约里根本没有这个字段。** 不管选中哪一行,
 * 详情卡都说 ok —— 包括一次被拒的凭据轮换。没有数据源的字段只有两种活法:
 * 编一个,或者不显示。⇒ 换成契约真正带着的 `before` / `after`。
 * 变更前后是审计的正文,而「结果」是一个想象出来的摘要。
 *
 * **🚨 3. 来源 IP 全链路都没有数据源。** 契约 `AuditEntry` 的八个字段、
 * `@dshwar/audit` 的 `AuditRecord`,都没有 IP,网关也不记。⇒ 类型收成
 * `string | null`,取不到就显示 `—`。**不要**因为「空着难看」把 kit 里那几个
 * 10.x 的串搬回来:一个编出来的来源 IP,会在事故复盘时把人指向另一台机器。
 * 真要这一列,得先让服务端记 —— 那是契约的事,不是这一屏能补的。
 *
 * **🚨 4. `rows[sel]!` 在筛选变窄时会崩屏。** kit 里 `sel` 只可能是初值 1 或
 * `Table` 给回的行号,那个断言一直成立。而 rows 一旦来自筛选后的响应:
 * 选中第 5 行、再把范围收到「近 24 小时」,列表只剩 2 行而 `selectedIndex` 还是 4
 * —— 在 `undefined` 上取 `.action`,整屏白。⇒ 越界与未选中走**同一条路**:
 * 详情卡显示空态。空不是错误,不该长得像错误,更不该长得像崩溃。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 审计表禁用 accent 选中行 —— selectionTone="neutral"。
 *
 * @module @dshwar/design-system/screens/console/AuditScreen
 */
import type * as React from 'react'
import { AuditLine } from '../../components/AuditLine.tsx'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Input } from '../../components/Input.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { PageHead } from './Shell.tsx'

/**
 * 一条审计记录的**表现层形状**。字段与契约的 `AuditEntry` 一一对应,
 * 只是类型换成了展示串 —— 格式化、序列化、脱敏都在调用方完成。
 *
 * | 这里 | 契约(`packages/api-contract` 的 `AuditEntry`) |
 * | --- | --- |
 * | `id` | `id` —— 记录本身的标识,与 `requestId` **不是一个东西** |
 * | `at` | `at`(ISO)—— 这里收**已格式化**的展示串 |
 * | `action` | `action` —— 小写下划线原样,禁止本地化 |
 * | `actor` | `actor` |
 * | `target` | `target` |
 * | `before` / `after` | `before` / `after`(`unknown \| null`)—— 这里收展示串 |
 * | `requestId` | `requestId` |
 * | `sourceIp` | **契约里没有**,见模块注释 🚨 3 |
 */
export interface AuditRow {
  /** 记录 id。审计是只追加的,这个 id 是它在时间线上的稳定身份。 */
  readonly id: string
  /** 已格式化的时间串。kit 里显示的是 ISO 原文,格式化是调用方的事。 */
  readonly at: string
  /** 动作词,如 `branding.update`。**原样输出**,不本地化、不改大小写。 */
  readonly action: string
  readonly actor: string
  readonly target: string
  /**
   * 这次调用的请求 ID。**必填,而且必须是服务端真的给过的那个** ——
   * 它的唯一用途就是让人拿去和服务端日志对上号(见模块注释 🚨 1)。
   */
  readonly requestId: string
  /**
   * 变更前的展示串。`null` = **这一侧不存在**(创建类操作没有「之前」)。
   *
   * ⚠️ 不要用 `''` 或 `'{}'` 冒充 `null`:空对象的意思是「改成了空」,
   * 与「本来就没有」在审计里是两件事。
   */
  readonly before: string | null
  /** 变更后的展示串。`null` = 这一侧不存在(删除类操作没有「之后」)。 */
  readonly after: string | null
  /**
   * 来源 IP。**今天全链路都没有这个数据,所以只能传 `null`。**
   * 见模块注释 🚨 3 —— 编一个像 IP 的串比空着贵得多。
   */
  readonly sourceIp: string | null
}

export interface AuditScreenProps {
  /** 当前这一页记录。空数组 = 没有匹配项,走空态而不是错误态。 */
  readonly rows: readonly AuditRow[]
  /**
   * 选中行的下标。`-1` = 未选中;**越界也按未选中处理**(见模块注释 🚨 4)——
   * 筛选一变窄,上一次的下标就可能指向不存在的行。
   */
  readonly selectedIndex: number
  /** 「按对象或操作者筛选」的当前值。空串 = 没筛。 */
  readonly query: string
  /** 动作筛选的当前值。 */
  readonly actionFilter: string
  /**
   * 动作筛选的可选项。「全部」这类哨兵项由**调用方**放进来 ——
   * 设计系统不认识哪一项是哨兵,也不该认识:那是筛选语义,不是排版。
   */
  readonly actionOptions: readonly string[]
  /** 时间范围的当前值与可选项。同上,选项由调用方给。 */
  readonly range: string
  readonly rangeOptions: readonly string[]
  /** 选中某一行。下标是 `Table` 的语言,`id` 是数据的语言 —— 两个都给。 */
  readonly onSelect?: (index: number, id: string) => void
  readonly onQueryChange?: (next: string) => void
  readonly onActionFilterChange?: (next: string) => void
  readonly onRangeChange?: (next: string) => void
  readonly onExport?: () => void
}

const COLUMNS: TableColumn[] = [
  { key: 'at', label: '时间', mono: true },
  { key: 'action', label: '动作', mono: true },
  { key: 'actor', label: '操作者', mono: true },
  { key: 'target', label: '对象', mono: true },
  { key: 'ip', label: '来源 IP', align: 'right', mono: true },
]

export function AuditScreen({
  rows,
  selectedIndex,
  query,
  actionFilter,
  actionOptions,
  range,
  rangeOptions,
  onSelect,
  onQueryChange,
  onActionFilterChange,
  onRangeChange,
  onExport,
}: AuditScreenProps): React.JSX.Element {
  // 越界与未选中合成同一种情况 —— `noUncheckedIndexedAccess` 下索引访问本来就
  // 带出 undefined,这里不再用 `!` 把它断言掉,而是让它走空态(🚨 4)。
  const selected = selectedIndex < 0 ? null : (rows[selectedIndex] ?? null)

  const tableRows = rows.map((row) => ({
    at: row.at,
    action: row.action,
    actor: row.actor,
    target: row.target,
    // 没有来源 IP 的记录显示 `—`。这一列今天**全是** `—`,那是诚实的样子。
    ip: row.sourceIp === null ? '—' : row.sourceIp,
  }))

  return (
    <>
      <PageHead
        title="审计"
        sub="动作词原样输出，不本地化；记录保留 400 天"
        actions={
          <Button
            icon="download"
            // 零行时禁用:一个「导出成功」却是空的 CSV,与导出失败在文件管理器里
            // 长得一模一样 —— 用户会拿着它去证明「那天什么都没发生」。
            disabled={rows.length === 0}
            onClick={() => onExport?.()}
          >
            导出 CSV
          </Button>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 200px 200px',
          gap: 'var(--s-5)',
          alignItems: 'end',
        }}
      >
        <Input
          label="按对象或操作者筛选"
          placeholder="tnt_ / adm_ / svc_"
          mono
          value={query}
          onChange={(e) => onQueryChange?.(e.target.value)}
        />
        <Select
          label="动作"
          value={actionFilter}
          options={[...actionOptions]}
          onChange={(e) => onActionFilterChange?.(e.target.value)}
        />
        <Select
          label="时间范围"
          value={range}
          options={[...rangeOptions]}
          onChange={(e) => onRangeChange?.(e.target.value)}
        />
      </div>
      {rows.length === 0 ? (
        <Card>
          <Empty text="这段时间没有匹配的审计记录 —— 放宽筛选条件或时间范围再看一次。" />
        </Card>
      ) : (
        <>
          <Table
            columns={COLUMNS}
            rows={tableRows}
            selectedIndex={selectedIndex}
            selectionTone="neutral"
            onRowClick={(index) => {
              const row = rows[index]
              if (row !== undefined) onSelect?.(index, row.id)
            }}
          />
          <Card title="记录详情">
            {selected === null ? (
              <Empty text="选一条记录看它改了什么。" />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
                <AuditLine action={selected.action} actor={selected.actor} at={selected.at} />
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr',
                    gap: 'var(--s-4) var(--s-6)',
                    font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  }}
                >
                  <span style={{ color: 'var(--text-tertiary)' }}>对象</span>
                  <CodeRef copyable>{selected.target}</CodeRef>
                  <span style={{ color: 'var(--text-tertiary)' }}>请求 ID</span>
                  <CodeRef copyable>{selected.requestId}</CodeRef>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--s-5)',
                  }}
                >
                  <Change label="变更前" value={selected.before} absent="创建操作没有「之前」" />
                  <Change label="变更后" value={selected.after} absent="删除操作没有「之后」" />
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  )
}

/**
 * 变更体的一侧。
 *
 * ⚠️ 变更体**不套 `CodeRef`**:那个类是给随机短串用的(`word-break: keep-all`
 * + `user-select: all`),一段 JSON 放进去会横着撑出卡片。这里用可折行的 mono 块,
 * `pre-wrap` 保留调用方给的换行、同时**仍然折行** —— 与 `ArtifactsScreen`
 * 拒绝 `white-space: pre` 是同一条理由,只是那边选择了按行传。
 */
function Change({
  label,
  value,
  absent,
}: {
  label: string
  value: string | null
  absent: string
}): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          letterSpacing: '.06em',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </span>
      {value === null ? (
        <Empty text={absent} />
      ) : (
        <div
          style={{
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--r-2)',
            padding: 'var(--s-5)',
            font: 'var(--fw-regular) var(--fs-mono)/1.7 var(--font-mono)',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {value}
        </div>
      )}
    </div>
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
