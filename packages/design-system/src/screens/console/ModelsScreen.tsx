/**
 * 控制台「模型准入」屏(组织级白名单)。
 *
 * 白名单表 + 降级策略卡 + 最近上游事件卡。
 *
 * ## V0.9.0 Session 3:从「夹具写死 + 本地 useState」改为**受控组件**
 *
 * 移植时(Session 1)三张面板的数据全是夹具,准入开关是一个模块内的
 * `useState<Record<ModelName, boolean>>` —— 那是刻意的,那一轮的纪律是机械转换。
 * 这一轮把它们提成 props,并把那份本地 state 交还给调用方:
 * **准入清单是要保存到服务端的东西**,它的唯一副本不能待在一个组件里。
 *
 * ## props 是表现层类型,不是 API 类型
 *
 * `contextWindow` 收到的是已经人类化的 `'200K'`,`price` 是已经按币种与精度
 * 格式化好的 `'112.00'`,`updatedAt` 是 `'08-18 09:14'` 而不是 ISO 串;
 * `availability` 是一个**枚举**而不是一段 `<Tag>` JSX。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 *
 * ## ⚠️ 数据字段一律**必填,且无默认值**
 *
 * 与 `./capacity.ts` 的 `CapacityReading` 同一条账(V0.5.0 D2):默认值在这里不是便利,
 * 它是**第二个事实源** —— 调用方漏传一个字段,界面照样显示一份像模像样的
 * 白名单,而没有任何东西会红。必填之后漏传是**编译错误**。
 *
 * ## 🚨 顺带修四处真缺陷
 *
 * ### 🚨 1. 写死的 requestId 是**假证据**
 *
 * kit 原版的两条上游事件带着 `req_9f3c21ab7e` 与 `req_7c12de40b1`,
 * 而 `CodeRef copyable` 就是为了让管理员**把它复制进工单**。
 * 在设计 kit 里这没问题;接上真实 API 之后,这两个串会变成
 * **服务端日志里根本不存在的 id** —— 客服照着它查,查不到任何东西,
 * 然后判定「用户记错了」。与「假成功回执」同族:系统给出的凭据与它真做过的事不符。
 * ⇒ 错误码、requestId、时间、模型、租户全部由 {@link UpstreamEvent} 传入。
 *
 * ### 🚨 2. 降级提示无条件渲染 —— 它在陈述一件没发生的事
 *
 * `<DegradeNotice from="opus-4-1" to="sonnet-4-5" />` 挂在屏顶,句式是
 * 「容量受限,**本次**由 X 降级至 Y」—— 那是对一次**已发生**的降级的陈述,
 * 而它每次打开这一屏都在说。⇒ 改成 `degrade: ModelDegradeEvent | null`,
 * `null` 时**整条不渲染**;没降级就什么都不说,不是说一句「暂无降级」。
 *
 * ### 🚨 3. 三个策略控件写死值 + `onChange={() => {}}`
 *
 * 「容量受限时」「降级目标」「展示降级提示」三个控件的值是字面量,
 * 回调是空函数。后果不是「点了没反应」这么轻:**界面呈现的策略与实际生效的策略无关** ——
 * 管理员看见「降级至次一档模型」,而服务端可能配的是「直接失败」。
 * ⇒ 三者都受控,值由 props 给,变更由 `on*Change` 交回。
 *
 * ### 🚨 4. 降级目标的候选与白名单无关
 *
 * kit 把候选写死成两个模型名。而契约的纪律是
 * **`fallbackModel` 配成清单外 → 拒绝**(见 `docs/GOVERNANCE.md` §3),
 * 于是那个下拉能选出一个**必然被服务端拒掉**的值。
 * ⇒ 候选从当前准入的行里派生,外加一个「不降级」(契约的 `fallbackModel: null`)。
 *
 * ⚠️ 还有一处更隐蔽的:`<select>` 的 `value` 不在 `options` 里时,浏览器
 * **显示第一项**,而不是留空。于是「刚被取消准入的降级目标」会让界面读出
 * 一个与实际策略不同的值 —— 同样是界面在说一件不真的事。
 * ⇒ 落在清单外的当前值会被补进候选,让它自己可见。
 *
 * ## `allowedModels: []` = 全部允许 —— 这个换算不能留到界面
 *
 * 契约的 `Policy.allowedModels` 是**空数组即全部允许**(准入是 opt-in,
 * 没配策略的租户默认放行)。若把 `allowedModels` 原样传进来、界面自己去
 * `includes()`,空清单会渲染成**一排全未勾选的复选框** —— 界面说「一个都不准」,
 * 服务端说「全都准」。⇒ 行上给的是 `allowed: boolean`,那条语义在转换层结清。
 *
 * ## 契约 `Policy` 的对应关系
 *
 * | 这里 | 契约 |
 * | --- | --- |
 * | `policy.policyId` | `id` |
 * | `policy.tenantId` | `tenantId` |
 * | `policy.updatedAt` | `updatedAt`(已格式化) |
 * | `rows[].allowed` | `allowedModels`(含「空 = 全部允许」的换算) |
 * | `fallbackModel` | `fallbackModel`(`null` = 不降级) |
 *
 * `policyId` / `tenantId` 显式展示,是为了让「白名单没生效」这类工单能指认到
 * **具体哪一条策略记录** —— 组织级白名单在契约上仍落在一条带 `tenantId` 的
 * `Policy` 上,看不见它的时候没人说得清自己改的是哪一条。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid),做成 CSS 类会产生
 * 几百个只用一次的类。本屏没有 hover / active / focus 的 JS 写法,
 * 所以没有需要转成伪类的东西,也就不需要 `styles/screens/modelsscreen.css`。
 *
 * @module @dshwar/design-system/screens/console/ModelsScreen
 */
import type * as React from 'react'
import { Fragment } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { DegradeNotice } from '../../components/DegradeNotice.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import { PageHead } from './Shell.tsx'

/**
 * 模型当前的可用性。**闭集**,与 `Tag` 的 tone 一一对应。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的状态应该在**转换层**停下来报错,
 * 而不是在界面上显示成一个含糊的灰标签 —— 后者会让一个新增的上游状态
 * 悄悄退化成「看起来正常」。
 */
export type ModelAvailability = 'available' | 'capacity-limited' | 'unavailable'

/** 白名单表里的一行。字段都是**已经格式化好的展示串**。 */
export interface ModelRow {
  /**
   * 模型标识串,如 `'claude-sonnet-4-5'`。
   *
   * 它同时是**展示值**(「模型」列 mono 直出)与**策略里的键** ——
   * 契约的 `allowedModels` / `fallbackModel` 存的就是这个串。
   * 刻意不拆成 id + 展示名:两者一旦分家,降级目标的比对就要跨一次映射,
   * 而那次映射错了没有任何东西会红。
   */
  readonly id: string
  /** 已人类化的上下文窗口,如 `'200K'`。 */
  readonly contextWindow: string
  /** 已格式化的单价(¥/Mtok),如 `'112.00'`。取不到时传 `'—'`。 */
  readonly price: string
  readonly availability: ModelAvailability
  /**
   * 这一行是否在准入清单里。
   *
   * ⚠️ 契约的 `allowedModels: []` 语义是**全部允许**,那条换算由调用方做完
   * 再落到这里 —— 见模块注释。
   */
  readonly allowed: boolean
}

/**
 * 容量受限时的处置。**闭集**。
 *
 * 清单写成 `as const` 数组再派生类型:运行时拿得到全集(下拉选项由它生成),
 * 而 `Record<CapacityStrategy, string>` 少一条就是编译错误 —— 两边不可能不同步。
 */
const CAPACITY_STRATEGY_IDS = ['fallback', 'queue', 'fail'] as const

export type CapacityStrategy = (typeof CAPACITY_STRATEGY_IDS)[number]

const STRATEGY_LABEL: Record<CapacityStrategy, string> = {
  fallback: '降级至次一档模型',
  queue: '排队等待',
  fail: '直接失败',
}

/** 契约 `Policy` 里那几个「这份白名单是谁、什么时候改的」的字段。 */
export interface ModelPolicyMeta {
  /** 契约 `Policy.id`。 */
  readonly policyId: string
  /** 契约 `Policy.tenantId`。 */
  readonly tenantId: string
  /** 已格式化的更新时间,如 `'08-18 09:14'`。 */
  readonly updatedAt: string
}

/**
 * 一次**已经发生**的降级。`null` 表示没发生 —— 那时整条提示不渲染。
 *
 * ⚠️ `reason` 必填,不走 `DegradeNotice` 的默认「容量受限」:
 * 降级的原因是**数据**(上游容量不足 / 预算到阈值 / 模型下线),
 * 给它一个默认值等于替服务端编一个理由。
 */
export interface ModelDegradeEvent {
  readonly from: string
  readonly to: string
  readonly reason: string
}

/** 「最近上游事件」卡里的一条。全部是已格式化的展示串。 */
export interface UpstreamEvent {
  /** 错误码,如 `'E_MODEL_UNAVAILABLE'`。原样展示,禁止本地化。 */
  readonly code: string
  /**
   * 🚨 **服务端真实的 requestId**,不是编的。
   *
   * 它带着 `copyable`,存在的理由就是被复制进工单 ——
   * 一个查不到的 id 比没有 id 更糟。详见模块注释的缺陷 1。
   */
  readonly requestId: string
  /** 已格式化的发生时间,如 `'2026-08-18T09:14Z'`。 */
  readonly at: string
  /** 涉及的模型标识串。 */
  readonly model: string
  /** 一句补充,如 `'上游返回容量不足'` / `'租户 acme-staging'`。 */
  readonly detail: string
  /**
   * 严重度。**闭集**,决定 `CodeRef` 的 tone。
   *
   * ⚠️ 只有两档,因为 `CodeRef` 的 tone 只区分两档 ——
   * 多定义的档位在这一屏无法呈现,那等于让调用方传一个不起作用的值。
   */
  readonly severity: 'error' | 'warn'
}

export interface ModelsScreenProps {
  /** 这份白名单是哪一条策略记录。 */
  readonly policy: ModelPolicyMeta
  /** 全部候选模型。空数组 → 表格位置渲染空态,**不是错误态**。 */
  readonly rows: readonly ModelRow[]
  /**
   * 容量受限时的处置。
   *
   * ⚠️ 与 {@link ModelsScreenProps.fallbackModel} 的一致性由调用方负责:
   * `'fallback'` 配上 `fallbackModel: null` 是矛盾态 —— 契约上那等于不降级
   * (没配 `fallbackModel` → 超阈值走 429),界面不替它圆场。
   */
  readonly capacityStrategy: CapacityStrategy
  /** 契约 `Policy.fallbackModel`。`null` = 不降级。 */
  readonly fallbackModel: string | null
  /** 是否在工作台内向员工展示降级提示。 */
  readonly notifyMembers: boolean
  /** 最近一次已发生的降级;`null` = 没发生,整条提示不渲染。 */
  readonly degrade: ModelDegradeEvent | null
  /** 最近的上游事件。空数组 → 卡片里渲染空态。 */
  readonly events: readonly UpstreamEvent[]
  /** 收到的是**变更后**的值。 */
  readonly onToggleModel?: (id: string, next: boolean) => void
  readonly onRowMenu?: (id: string) => void
  readonly onCapacityStrategyChange?: (next: CapacityStrategy) => void
  /** `null` = 选了「不降级」。 */
  readonly onFallbackModelChange?: (next: string | null) => void
  readonly onNotifyMembersChange?: (next: boolean) => void
  readonly onSyncCatalog?: () => void
  readonly onSave?: () => void
}

const TONE_OF: Record<
  ModelAvailability,
  { tone: 'success' | 'warn' | 'danger'; label: string; dot: boolean }
> = {
  available: { tone: 'success', label: '可用', dot: true },
  'capacity-limited': { tone: 'warn', label: '容量受限', dot: false },
  unavailable: { tone: 'danger', label: '不可用', dot: false },
}

const COLUMNS: TableColumn[] = [
  { key: 'on', label: '准入', width: '56px' },
  { key: 'name', label: '模型', mono: true },
  { key: 'ctx', label: '上下文', align: 'right', mono: true },
  { key: 'price', label: '单价 (¥/Mtok)', align: 'right', mono: true },
  { key: 'st', label: '状态' },
  { key: 'a', label: '', align: 'right', width: '40px' },
]

/** 「不降级」在下拉里的呈现值,对应契约的 `fallbackModel: null`。 */
const NO_FALLBACK = '不降级'

export function ModelsScreen({
  policy,
  rows,
  capacityStrategy,
  fallbackModel,
  notifyMembers,
  degrade,
  events,
  onToggleModel,
  onRowMenu,
  onCapacityStrategyChange,
  onFallbackModelChange,
  onNotifyMembersChange,
  onSyncCatalog,
  onSave,
}: ModelsScreenProps): React.JSX.Element {
  const tableRows = rows.map((row) => {
    const { tone, label, dot } = TONE_OF[row.availability]
    return {
      // ⚠️ 每行**各自**的控件。kit 原版的 `model()` 工厂虽然按行调用,
      //   复选框读的却是一份组件内的 `allow` state —— 于是没有任何一行的
      //   勾选状态属于调用方,保存时也就没有东西可保存。
      on: (
        <Checkbox
          checked={row.allowed}
          onChange={(next) => {
            onToggleModel?.(row.id, next)
          }}
        />
      ),
      name: row.id,
      ctx: row.contextWindow,
      price: row.price,
      st: (
        <Tag tone={tone} dot={dot}>
          {label}
        </Tag>
      ),
      a: (
        <IconButton
          icon="more-horizontal"
          label="更多"
          onClick={() => {
            onRowMenu?.(row.id)
          }}
        />
      ),
    }
  })

  const allowedIds = rows.filter((r) => r.allowed).map((r) => r.id)
  // ⚠️ 当前降级目标落在准入清单之外(刚被取消准入)时,把它补进候选。
  //   不补的话 `<select>` 会显示第一项,界面读出的策略与实际策略不同 ——
  //   而管理员看不出这是「候选里没有它」还是「它真的被改成了第一项」。
  const orphanFallback =
    fallbackModel !== null && !allowedIds.includes(fallbackModel) ? [fallbackModel] : []
  const fallbackOptions = [NO_FALLBACK, ...orphanFallback, ...allowedIds]

  return (
    <>
      <PageHead
        title="模型准入"
        sub={
          <span style={{ display: 'grid', gap: 'var(--s-2)' }}>
            <span>白名单对该组织下全部租户生效；租户可在此范围内自选默认模型</span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 'var(--s-3)',
                font: 'var(--fw-regular) var(--fs-caption)/var(--lh-caption) var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              策略 <CodeRef copyable>{policy.policyId}</CodeRef> · 租户{' '}
              <CodeRef>{policy.tenantId}</CodeRef> · 更新于 {policy.updatedAt}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              onClick={() => {
                onSyncCatalog?.()
              }}
            >
              同步上游目录
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onSave?.()
              }}
            >
              保存白名单
            </Button>
          </>
        }
      />

      {degrade === null ? null : (
        <DegradeNotice from={degrade.from} to={degrade.to} reason={degrade.reason} />
      )}

      {rows.length === 0 ? (
        <Empty text="上游目录里还没有模型。先「同步上游目录」，再决定准入哪些。" />
      ) : (
        <Table columns={COLUMNS} rows={tableRows} density="default" />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
        <Card title="降级策略">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <Select
              label="容量受限时"
              value={STRATEGY_LABEL[capacityStrategy]}
              options={CAPACITY_STRATEGY_IDS.map((id) => STRATEGY_LABEL[id])}
              onChange={(e) => {
                // `Select` 只收发文本,所以这里要把标签换回码。候选就是上一行
                // 那张表生成的,认不出只可能是表被改坏了 —— 那时**什么都不做**,
                // 而不是猜一个码交出去:一个猜出来的策略会被原样保存进契约。
                const next = CAPACITY_STRATEGY_IDS.find(
                  (id) => STRATEGY_LABEL[id] === e.target.value,
                )
                if (next !== undefined) onCapacityStrategyChange?.(next)
              }}
            />
            <Select
              label="降级目标"
              value={fallbackModel ?? NO_FALLBACK}
              options={fallbackOptions}
              mono
              onChange={(e) => {
                onFallbackModelChange?.(e.target.value === NO_FALLBACK ? null : e.target.value)
              }}
            />
            <Checkbox
              checked={notifyMembers}
              label="在工作台内向员工展示降级提示"
              onChange={(next) => {
                onNotifyMembersChange?.(next)
              }}
            />
          </div>
        </Card>

        <Card title="最近上游事件">
          {events.length === 0 ? (
            <Empty text="最近没有上游事件。" />
          ) : (
            <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
              {events.map((event, i) => (
                <Fragment key={`${event.requestId}·${event.code}`}>
                  {i === 0 ? null : (
                    <div style={{ height: 1, background: 'var(--border-hairline)' }} />
                  )}
                  <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                    <CodeRef copyable tone={event.severity === 'error' ? 'danger' : 'default'}>
                      {`${event.code} · ${event.requestId}`}
                    </CodeRef>
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-caption)/var(--lh-caption) var(--font-sans)',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {`${event.at} · ${event.model} · ${event.detail}`}
                    </span>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
        </Card>
      </div>
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
