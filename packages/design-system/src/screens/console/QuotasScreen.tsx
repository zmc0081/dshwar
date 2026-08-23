/**
 * 控制台「配额与模型准入」屏(按租户)。
 *
 * ## 原 kit 注释(原样保留)
 *
 * ★ 策略执行层尚未接线:后端策略端点回落 501。这是刻意的 —— 接上会让策略被保存、
 * 被显示、却从不被查询,那比 501 危险得多。因此这一屏画成「即将可用」:
 * 所有会写入策略的控件 disabled,并逐项标「当前不生效」。
 * 通栏说明落在平台区域(零 accent、mono 标识、r-1 直角),不是品牌文案。
 *
 * ## V0.9.0 Session 3:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)租户、模型三行、预算数字、端点标识全是夹具 —— 那是刻意的,
 * 那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `price` 收到的是已按币种与精度格式化好的
 * `'112.00'`,`contextWindow` 是 `'200K'`,`periodStart` 是 `'08-01'` 而不是 ISO 串;
 * `availability` / `overBudget` 是**枚举**而不是一段 `<Tag>` JSX。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 *
 * ⚠️ **两个例外:`tokenUsed` 与 `tokenLimit` 收数字。** 它们不是展示串,
 * 是 {@link QuotaBar} 那条**几何的操作数**(填充宽度 = used / total)。
 * 把它们改成 `'1,284,905'`,组件就得反解析回数字 —— 那才是真的把格式化推给了组件。
 *
 * ## ⚠️ 数据字段一律**必填,且无默认值**
 *
 * 与 `./capacity.ts` 的 `CapacityReading` 同一条账(V0.5.0 D2)。
 * 这一屏原来的默认值是 `policyState = 'set'` —— **它是三档里最宽松的那一档**:
 * 调用方漏传,界面就显示「已配清单 · 按清单放行」,一个从没配过策略的租户
 * 看起来治理良好,而没有任何东西会红。必填之后漏传是**编译错误**。
 *
 * ## ★ 「不接上」的边界:哪些是 501,哪些不是
 *
 * | 这一屏的东西 | 端点 | 这一版怎么做 |
 * | --- | --- | --- |
 * | 准入清单、预算、超预算行为、并发 | 策略端点 **501** | 只读呈现,控件 disabled,不给 `on*Change` |
 * | 配额读数(已用 / 上限 / 周期) | `GET /v1/admin/subjects/{id}/quota` **已实现** | 如实展示真数 |
 * | 选租户、行内「更多」 | 纯读操作 | 受控,回调可选 |
 *
 * 混在一起会让「不生效」这个标签失去意义 —— 全屏都标不生效,管理员就学会无视它,
 * 而配额那一块的数字是**真的**。
 *
 * ## 🚨 顺带抓到的七处真缺陷
 *
 * ### 🚨 1. 三态的「裁决」与已上线的 model-router **正好相反**
 *
 * kit 写死:`allowlist: absent` → 一律拒绝(`E_POLICY_UNSET`),
 * `allowlist: []` → 全部拒绝(`E_POLICY_EMPTY_DENY`),配的理由是「缺席不等于放行」。
 *
 * 而仓库里真正在跑的那一份说的是反话,三处一致:
 *
 * | 出处 | 原文 |
 * | --- | --- |
 * | `packages/model-router/src/index.ts` | 没配策略 → `{ kind: 'allow' }`,注释写着「没配策略 = 不治理,原样放行(opt-in)」 |
 * | 同上 | `policy.allowedModels.length === 0 \|\| includes(model)` —— 空清单恒真 |
 * | `docs/GOVERNANCE.md` §3 | 「准入是 opt-in:没配策略的租户默认放行」·「`allowedModels: []` = 全部允许(契约语义)」 |
 * | `packages/model-router/test` | 单测标题就叫「空清单 = 全部允许(契约语义)」 |
 *
 * 方向是最坏的那一种:界面告诉管理员**这个租户一律拒绝**,他据此认为已封锁、
 * 不再管它;而运行时**每个模型都放行**。这不是「显示得不准」,是一条
 * 关于安全性质的**假回执** —— 与「复制没成功却说成功了」同族,只是代价大得多。
 *
 * ⇒ 裁决**不再由这一屏编**:{@link QuotasScreenProps.enforcement} 是必填 prop。
 * 而在策略端点 501 期间,唯一诚实的取值是 `'not-enforced'` ——
 * 一个没人执行的配置,它的裁决不是「拒绝」也不是「放行」,是**没有裁决**。
 * 这一手法沿用 `WorkspaceSettingsScreen` 的先例:不确定就如实标,
 * 不要画一个看起来定了的界面。
 *
 * ⚠️ **这里不替谁改口径。** 设计说「缺席不等于放行」,实现说「缺席即放行,
 * 且默认封锁会让治理变成仪式」—— 两边都写下了理由,该由人裁一次,
 * 不该由一个转换 PR 顺手选一边。这段注释是留给那次裁决的证据。
 *
 * ### 🚨 2. `E_POLICY_UNSET` / `E_POLICY_EMPTY_DENY` 是编出来的错误码
 *
 * 全仓 grep 这两个串,**除本文件外 0 处**。而它们挂着 `copyable` ——
 * 那个按钮存在的理由就是被复制进工单。客服拿着一个服务端从未发出过的码去查,
 * 查不到任何东西,然后判定「用户记错了」。
 * ⇒ {@link QuotasScreenProps.enforcementCode},`null` = 这一态没有对应错误码。
 *
 * ### 🚨 3. `req_2b88af51c3` 写死 —— 同一族的假证据
 *
 * 端点标识那一行同样带 `copyable`。设计 kit 里无所谓;接上真实网关之后,
 * 每个管理员复制到的都是同一个日志里不存在的 id。
 * ⇒ 整条证据改由 {@link PolicyEndpointProbe} 给;`requestId` 可以是 `null`,
 * 那时**这一行不编一个** —— 没有 id 比一个假 id 好。
 *
 * ### 🚨 4. `allowlist: [2 models]` 里的 `2` 与表里勾了几个无关
 *
 * 它是字面量。清单改成 5 个,那一行还写 2 —— 而它长得像一份机器读数。
 * ⇒ 由行派生。
 *
 * ### 🚨 5. `tokenLimit: null` 走不了 {@link QuotaBar}
 *
 * 契约里 `null` = **不限**,既不是 0,也不是「没配」。而 `QuotaBar` 的
 * `total` 只收数字,`total = 0` 时它算出 `0.0%`,渲染成
 * `1,284,905 / 0 tok · 0.0%` —— 读作「额度用尽」或「没配额」,与真相相反。
 * ⇒ `tokenLimit === null` 时**整条不画**,改成一行读数:没有分母就没有百分比。
 *
 * ### 🚨 6. 配额是**按主体**的,而这一屏按租户选
 *
 * 契约的 `Quota` 第一个字段就是 `subjectId`。kit 把一条 `QuotaBar` 摆在
 * 租户下拉底下,不标是谁的 —— 管理员只会把它读成整个租户的总量,
 * 而且**没有任何线索能让他发现读错了**。⇒ `subjectId` 与计费周期一起显式展示。
 * 顺带:一个不带周期的「已用 128 万」无法判断是多是少,契约给了
 * `periodStart` / `periodEnd`,没有理由不显示。
 *
 * ### 🚨 7. `CodeRef copyable` 复制出来的串**与屏幕上显示的不一样**
 *
 * `CodeRef` 复制的是 `String(children)`。kit 那一行的 children 是**数组**
 * (`'GET /v1/tenants/'`、`'{id}'`、`'/policy · 501 · …'` 三段),
 * 而 `String` 对数组会**在片段之间插逗号** —— 屏幕上是
 * `GET /v1/tenants/{id}/policy`,粘贴进工单是 `GET /v1/tenants/,{id},/policy`。
 *
 * 与缺陷 3 是同一族的下一层:那一层是「id 是编的」,这一层是
 * **「id 是真的,但复制按钮交出去的不是它」**。一个人不会怀疑复制按钮,
 * 只会觉得自己粘错了。⇒ 证据行先 {@link evidenceLine} 拼成一个字符串再传。
 *
 * ## 契约 `Quota` 的对应关系
 *
 * | 这里 | 契约 |
 * | --- | --- |
 * | `quota.subjectId` | `subjectId` |
 * | `quota.tokenLimit` | `tokenLimit`(`null` = 不限) |
 * | `quota.tokenUsed` | `tokenUsed` |
 * | `quota.periodStart` / `periodEnd` | 同名(已格式化) |
 * | `quota.alertAt` | **契约里没有** —— 见 {@link QuotaReading.alertAt} |
 *
 * ## 其余变化
 *
 * 1. 行的类型直接用 `./ModelsScreen.tsx` 导出的 {@link ModelRow} ——
 *    组织级白名单与租户级准入是**同一套策略的两个视角**,行的形状本就该是同一个。
 *    再定义一遍等于给同一件事留两份定义,而它们会各自漂移。
 *    (`ModelsScreen` 的 tone 映射是模块私有的,只能在这里再写一份 ——
 *    `Record<ModelAvailability, …>` 保证它少一档就是编译错误。)
 * 2. 演示开关 `empty?: boolean` 删掉:空态由**数据**决定,不由开关决定。
 *    一个能把界面切成空的 prop,与它要展示的那个空状态没有任何关系。
 * 3. 演示用的「切换策略态」按钮组删掉:它让界面显示一个与租户实际策略不符的状态,
 *    正是本文件其余部分在防的那件事。宿主要演示,自己拿着 state 传不同的值即可 ——
 *    这一屏受控之后,那本来就是宿主的能力。
 * 4. `onChange={() => {}}` 一律删掉:`Input` / `Select` / `Checkbox` 省略 `onChange`
 *    即受控只读(见各组件注释),空函数只是一个看起来会响应的假回调。
 * 5. {@link Frozen} 从「定义了没人用」变成真的用上 —— 两张卡的
 *    `action={<Frozen />}` 就是它原本要封装的那枚「当前不生效」。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid / flex),
 * 做成 CSS 类会产生几百个只用一次的类。本屏没有 hover / active / focus 的
 * JS 写法,所以没有需要转成伪类的东西。
 *
 * @module @dshwar/design-system/screens/console/QuotasScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import type { ModelAvailability, ModelRow } from './ModelsScreen.tsx'
import { PageHead } from './Shell.tsx'
import { EmptyState } from './TenantsScreen.tsx'

/**
 * 一次**真实发生过**的策略端点探测。
 *
 * 🚨 `requestId` 必须是服务端回的那个,不是编的 —— 见模块注释缺陷 3。
 * 拿不到就传 `null`:界面少一行,总好过给出一条查不到的线索。
 */
export interface PolicyEndpointProbe {
  /** 探的是哪一条,如 `'GET /v1/tenants/{id}/policy'`。原样展示。 */
  readonly endpoint: string
  /** 服务端回的状态码。 */
  readonly status: number
  /** 服务端回的错误码,如 `'NOT_IMPLEMENTED'`。原样展示,禁止本地化。 */
  readonly code: string
  /** 服务端回的 requestId;`null` = 没回。 */
  readonly requestId: string | null
}

/**
 * 租户策略的**配置形状**。闭集。
 *
 * ⚠️ 它只说「配了没有、配成什么样」,**不说会被怎么执行** ——
 * 执行是 {@link PolicyEnforcement} 的事,两者在本仓曾经是矛盾的
 * (见模块注释缺陷 1)。把它们合成一个枚举,正是那处矛盾能存在的原因。
 *
 * ⚠️ 不要加「未知」档。认不出的形状应该在**转换层**停下来报错,
 * 而不是在界面上显示成一个含糊的灰标签。
 */
export type PolicyState = 'unset' | 'empty' | 'set'

/**
 * 执行层拿这份配置**会做什么**。闭集。
 *
 * - `not-enforced` —— 没有任何东西在执行它。策略端点 501 期间只能是这个值。
 * - `deny-all` / `allow-all` / `allowlist-only` —— 执行层接线后的三种裁决。
 *
 * ⚠️ 这一屏**算不出**它,所以它是 prop。算它需要知道 model-router 的语义,
 * 而那份语义与本屏原来写死的正好相反 —— 见模块注释缺陷 1。
 */
export type PolicyEnforcement = 'not-enforced' | 'deny-all' | 'allow-all' | 'allowlist-only'

/** 超预算时的处置。**闭集**。 */
const OVER_BUDGET_ACTIONS = ['downgrade', 'pause', 'warn'] as const

/**
 * 清单写成 `as const` 数组再派生类型:运行时拿得到全集(下拉选项由它生成),
 * 而 `Record<OverBudgetAction, string>` 少一条就是编译错误 —— 两边不可能不同步。
 */
export type OverBudgetAction = (typeof OVER_BUDGET_ACTIONS)[number]

/**
 * 一条配额读数。**字段与契约的 `Quota` 一一对应**,只是类型是表现层的。
 *
 * ⚠️ 这是本屏唯一**真的**那块数据:配额端点已实现,策略端点没有。
 */
export interface QuotaReading {
  /**
   * 这条配额是**谁的**。契约的 `Quota.subjectId`。
   *
   * 🚨 必须显示 —— 见模块注释缺陷 6:租户屏上一个不标主体的数,
   * 会被读成整个租户的总量,而管理员没有任何线索发现自己读错了。
   */
  readonly subjectId: string
  /**
   * 本周期的 token 上限。
   *
   * ⚠️ **`null` = 不限**,不是 0,也不是「没配」。三者在界面上必须长得不一样,
   * 见模块注释缺陷 5。
   */
  readonly tokenLimit: number | null
  /** 本周期已消耗。 */
  readonly tokenUsed: number
  /**
   * 客户自设的告警线(绝对 token 数),画在条上 —— 那是这条上唯一允许 accent 的元素。
   *
   * ⚠️ **契约的 `Quota` 里今天没有这个字段。** 拿不到就传 `null`,那时不画线;
   * 不要拿「上限的 90%」凑一个出来 —— 一条没人设过的线,画上去就成了一个承诺。
   */
  readonly alertAt: number | null
  /** 计费周期起,已格式化,如 `'08-01'`。 */
  readonly periodStart: string
  /** 计费周期止,已格式化,如 `'08-31'`。 */
  readonly periodEnd: string
}

/**
 * 预算与超预算行为的**当前配置**。
 *
 * ⚠️ 整块都由策略端点承载,而它 501 —— 所以这里的每一项都是只读呈现,
 * 一个 `on*Change` 都不给。给了就等于说「改得动」。
 */
export interface BudgetPolicy {
  /** 单次运行的 token 上限,已格式化,如 `'200,000'`;不限时传 `'不限'`。 */
  readonly perRunTokenLimit: string
  readonly overBudget: OverBudgetAction
  /** 降级目标的模型标识串;`null` = 没设。 */
  readonly downgradeTo: string | null
  /** 并发上限,已格式化,如 `'8'`。 */
  readonly concurrencyLimit: string
}

export interface QuotasScreenProps {
  /**
   * 可选的租户 id 列表。空数组 → 整屏空态,**不是错误态**。
   *
   * 传的就是 id 本身:`Select` 只认字符串,而 kit 里显示的 `acme-prod`
   * 本来就是 id。拆成 id + 展示名会多一次映射,而那次映射错了没有东西会红。
   */
  readonly tenants: readonly string[]
  /** 当前查看的租户;`null` = 没有租户 / 还没选 → 空态。 */
  readonly selectedTenantId: string | null
  /** 该租户策略的配置形状。 */
  readonly policyState: PolicyState
  /**
   * 执行层拿这份配置会做什么。
   *
   * ⚠️ 与 {@link QuotasScreenProps.policyState} 的一致性由调用方负责 ——
   * 这一屏不替它圆场,因为圆场就是缺陷 1 的成因。
   */
  readonly enforcement: PolicyEnforcement
  /**
   * 这一态对应的服务端错误码,原样展示;`null` = 没有对应错误码。
   *
   * 🚨 只填**服务端真的会发**的码 —— 它带 `copyable`,见模块注释缺陷 2。
   * 这里刻意不给示例:kit 那两个串正是编出来的,举它们当例子等于把它们再种回来。
   * 拿不准的时候填 `null`,少一枚码比多一枚查不到的码好。
   */
  readonly enforcementCode: string | null
  /** 策略端点的探测结果;`null` = 没探过,那时通栏说明不带证据行。 */
  readonly policyProbe: PolicyEndpointProbe | null
  /** 上游目录里的模型。空数组 → 表格位置渲染空态,**不是错误态**。 */
  readonly models: readonly ModelRow[]
  /** 该租户的配额读数;`null` = 没有可显示的配额。 */
  readonly quota: QuotaReading | null
  readonly budget: BudgetPolicy
  readonly onTenantChange?: (tenantId: string) => void
  /** 行内「更多」。省略则该按钮 disabled —— 没人接的按钮不该看起来能按。 */
  readonly onModelMenu?: (modelId: string) => void
  readonly onCreateTenant?: () => void
}

/** 与 `ModelsScreen` 的 tone 映射同形;那一份是模块私有的,只能各写一份。 */
const AVAILABILITY: Record<
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
  { key: 'state', label: '上游状态' },
  { key: 'a', label: '', align: 'right', width: '40px' },
]

const OVER_BUDGET_LABEL: Record<OverBudgetAction, string> = {
  downgrade: '降级至指定模型',
  pause: '暂停 Agent',
  warn: '仅告警',
}

/** 降级目标没设时下拉里的呈现值,对应 `downgradeTo: null`。 */
const NO_DOWNGRADE = '未设定'

/** 还没选租户时下拉里的呈现值,对应 `selectedTenantId: null`。 */
const NO_TENANT = '未选择租户'

/** 与 {@link QuotaBar} 内部同一套写法 —— 同一个数不该在两处格出两个样子。 */
function fmtTokens(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * 🚨 证据行**拼成一个字符串**再交给 `CodeRef`,不要拆成多个子节点。
 *
 * `CodeRef` 复制的是 `String(children)`:children 一旦是数组,
 * `String` 会**在每个片段之间插逗号**。于是屏幕上显示
 * `GET /v1/… · 501 · req_x`,粘贴出来是 `GET /v1/…,{id},/policy · 501 · req_x` ——
 * 见模块注释缺陷 7。
 */
function evidenceLine(probe: PolicyEndpointProbe): string {
  const head = `${probe.endpoint} · ${probe.status}`
  return probe.requestId === null ? head : `${head} · ${probe.requestId}`
}

function NotWiredNotice({ probe }: { probe: PolicyEndpointProbe | null }): React.JSX.Element {
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
          策略执行层尚未接线 —— 本屏配置当前不生效
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '86ch',
          }}
        >
          {probe === null ? (
            '策略端点尚未接线。'
          ) : (
            <>
              策略端点回落 <CodeRef tone="danger">{`${probe.status} ${probe.code}`}</CodeRef>。
            </>
          )}
          这是刻意的：接上执行层之前先开放保存，会让策略被保存、被显示、却从不被查询——那比一个如实报错的端点
          危险得多。在执行层落地前，这些控件只读。
        </span>
        {probe === null ? null : (
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
              color: 'var(--text-tertiary)',
            }}
          >
            {/* 🚨 证据行有两处要小心:requestId 拿不到就不出现(缺陷 3),
                以及**整串必须是一个字符串子节点**(缺陷 7)。 */}
            <CodeRef copyable>{evidenceLine(probe)}</CodeRef>
            {probe.requestId === null ? ' —— 服务端没回 request id' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * 一个配置形状的描述。
 *
 * ⚠️ 这里**只描述形状**,一个字都不说执行结果 —— 原版把两者写在同一张表里,
 * 于是一处写错就同时错在两个语义上(模块注释缺陷 1)。
 *
 * `tone` 与 {@link Tag} 的 `tone` 是同一套取值 —— 这里写成字面量联合而不是
 * `TagProps['tone']`,因为后者是可选属性、带 `undefined`,而
 * `exactOptionalPropertyTypes` 下把 `undefined` 显式传给可选 prop 会报错。
 */
interface PolicyStateSpec {
  label: string
  tone: 'success' | 'warn' | 'danger' | 'neutral' | 'accent'
  /**
   * mono 读数。`allowlist: [n models]` 里的 n 由行派生,不写死(缺陷 4)。
   *
   * ⚠️ 传进来的是**勾选数**。只有 `set` 态用它 —— 那一态下勾选数就是清单长度;
   * 另外两态的读数里根本没有数字,正是因为它们的清单长度与勾选数无关。
   */
  code: (admittedCount: number) => string
  why: string
}

/* 三态：未配置 / 显式空清单 / 已配清单。三者在契约上是不同的东西，
   界面必须让它们看起来不同 —— 而它们各自被怎么执行，由 enforcement 说。 */
const POLICY_STATES: Record<PolicyState, PolicyStateSpec> = {
  unset: {
    label: '未配置',
    tone: 'warn',
    code: () => 'allowlist: absent',
    why: '该租户没有准入策略记录。形状是「没有」，不是「空的」 —— 两者在契约里是不同的东西，被执行的方式也不同。',
  },
  empty: {
    label: '显式空清单',
    tone: 'danger',
    code: () => 'allowlist: []',
    why: '有人显式写下了一份空清单。同样是「清单里没有模型」，但这是一个决定，不是一个遗漏：记录里查得到是谁、什么时候写的。',
  },
  set: {
    label: '已配清单',
    tone: 'success',
    code: (n) => `allowlist: [${n} models]`,
    why: '清单里有具体的模型。清单内外分别怎么处理，由执行层定。',
  },
}

/** 裁决的呈现。`not-enforced` 刻意不用 danger —— 它不是错误,是「还没有人在管」。 */
const ENFORCEMENTS: Record<PolicyEnforcement, { label: string; color: string }> = {
  'not-enforced': { label: '当前无人执行', color: 'var(--text-tertiary)' },
  'deny-all': { label: '一律拒绝', color: 'var(--danger)' },
  'allow-all': { label: '全部放行', color: 'var(--danger)' },
  'allowlist-only': { label: '按清单放行', color: 'var(--text-body)' },
}

function PolicyStateBar({
  state,
  admittedCount,
  enforcement,
  enforcementCode,
}: {
  state: PolicyState
  admittedCount: number
  enforcement: PolicyEnforcement
  enforcementCode: string | null
}): React.JSX.Element {
  const s = POLICY_STATES[state]
  const e = ENFORCEMENTS[enforcement]
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--s-4)',
        padding: 'var(--s-5) var(--s-6)',
        background: 'var(--surface-subtle)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-5)',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            letterSpacing: '.06em',
            color: 'var(--text-tertiary)',
          }}
        >
          POLICY STATE
        </span>
        <Tag tone={s.tone}>{s.label}</Tag>
        <CodeRef>{s.code(admittedCount)}</CodeRef>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <Icon name="arrow-right" size={13} />
          <span
            style={{
              font: 'var(--fw-medium) var(--fs-body)/1 var(--font-sans)',
              color: e.color,
            }}
          >
            {e.label}
          </span>
        </span>
        {enforcementCode === null ? null : (
          <CodeRef copyable tone="danger">
            {enforcementCode}
          </CodeRef>
        )}
      </div>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
          color: 'var(--text-secondary)',
          maxWidth: '84ch',
        }}
      >
        {s.why}
      </span>
    </div>
  )
}

/**
 * 「冻结控件」封装:控件本体 + 一枚「当前不生效」的 neutral Tag。
 *
 * 不传 `children` 就只剩那枚 Tag —— 两张卡的 `action` 用的正是这个形态。
 */
export function Frozen({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-3)' }}>
      {children}
      <Tag tone="neutral">当前不生效</Tag>
    </span>
  )
}

/** 卡片 / 表格位置的空态。刻意朴素 —— 空不是错误,不该长得像错误。 */
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

/**
 * 🚨 `tokenLimit: null` 的读数。**没有分母,所以没有条,也没有百分比。**
 *
 * 画一条 `used / 0` 的进度条会读成「额度用尽」,而真相是「不限」—— 见模块注释缺陷 5。
 */
function UnlimitedUsage({ used }: { used: string }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <span
        style={{
          font: 'var(--fw-medium) var(--fs-title-2)/1 var(--font-mono)',
          color: 'var(--text-body)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {used} tok
      </span>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
          color: 'var(--text-tertiary)',
        }}
      >
        本周期已用 · 上限不限（tokenLimit: null）· 无分母，故不画进度条
      </span>
    </div>
  )
}

export function QuotasScreen({
  tenants,
  selectedTenantId,
  policyState,
  enforcement,
  enforcementCode,
  policyProbe,
  models,
  quota,
  budget,
  onTenantChange,
  onModelMenu,
  onCreateTenant,
}: QuotasScreenProps): React.JSX.Element {
  const admitted = models.filter((m) => m.allowed)

  const tableRows: Record<string, React.ReactNode>[] = models.map((m) => {
    const a = AVAILABILITY[m.availability]
    return {
      // 策略端点 501 —— 勾选是策略写入,一律 disabled;省略 onChange 即受控只读。
      on: <Checkbox checked={m.allowed} disabled />,
      name: m.id,
      ctx: m.contextWindow,
      price: m.price,
      state: (
        <Tag tone={a.tone} dot={a.dot}>
          {a.label}
        </Tag>
      ),
      // ⚠️ 每行**各自**的操作按钮。kit 原版整表共用一个常量 ——
      //   于是没有任何一行的按钮知道自己属于哪一行,接不上 onClick。
      a: (
        <IconButton
          icon="more-horizontal"
          label="更多"
          disabled={onModelMenu === undefined}
          onClick={() => onModelMenu?.(m.id)}
        />
      ),
    }
  })

  // ⚠️ `<select>` 的 value 不在 options 里时,浏览器**显示第一项**而不是留空。
  //    两处都会中招,而后果都是「界面读出一个不是当前值的值」:
  //    ① 没选租户时,下拉会显示第一个租户 —— 而下面的空态正说着「先选一个租户」;
  //    ② 降级目标落在准入清单外时,下拉会显示清单里的第一个模型。
  //    ⇒ 两处都把当前值补进候选,让它自己可见。
  const tenantValue = selectedTenantId ?? NO_TENANT
  const tenantOptions = tenants.includes(tenantValue) ? [...tenants] : [tenantValue, ...tenants]

  const downgradeValue = budget.downgradeTo ?? NO_DOWNGRADE
  const downgradeNames = admitted.map((m) => m.id)
  const downgradeOptions = downgradeNames.includes(downgradeValue)
    ? downgradeNames
    : [downgradeValue, ...downgradeNames]

  const notWiredHint =
    policyProbe === null
      ? '策略执行层尚未接线'
      : `策略执行层尚未接线 · 端点回落 ${policyProbe.status}`

  return (
    <>
      <PageHead
        title="配额与模型准入"
        sub="按租户配置：可用模型清单 · token 预算 · 超预算降级目标 · 并发上限"
        actions={
          <>
            <Button disabled>放弃更改</Button>
            <Button variant="primary" disabled>
              保存策略
            </Button>
          </>
        }
      />
      <NotWiredNotice probe={policyProbe} />

      {tenants.length === 0 ? null : (
        <div
          style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s-5)', flexWrap: 'wrap' }}
        >
          <Select
            label="租户"
            value={tenantValue}
            options={tenantOptions}
            onChange={(e) => {
              // 占位项不是一个租户 —— 按 `tenants` 判,而不是按占位串比,
              // 免得一个恰好同名的租户被吞掉。
              const next = e.target.value
              if (!tenants.includes(next)) return
              onTenantChange?.(next)
            }}
            style={{ width: 200 }}
          />
        </div>
      )}

      {selectedTenantId === null ? (
        <EmptyState
          icon="boxes"
          title={tenants.length === 0 ? '还没有租户可配' : '先选一个租户'}
          body={
            tenants.length === 0
              ? '模型准入与预算按租户配置。先创建租户，再回到这一屏设定策略。'
              : '准入清单、预算与超预算行为都是按租户的 —— 选一个租户才有可显示的策略。'
          }
          action={
            tenants.length === 0 ? (
              <Button
                variant="primary"
                icon="plus"
                disabled={onCreateTenant === undefined}
                onClick={() => onCreateTenant?.()}
              >
                创建租户
              </Button>
            ) : null
          }
          hint={notWiredHint}
        />
      ) : (
        <>
          <PolicyStateBar
            state={policyState}
            admittedCount={admitted.length}
            enforcement={enforcement}
            enforcementCode={enforcementCode}
          />

          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-5)' }}>
              <h2
                style={{
                  margin: 0,
                  color: 'var(--text-body)',
                  whiteSpace: 'nowrap',
                  font: 'var(--fw-semi) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                  letterSpacing: 'var(--ls-title-2)',
                }}
              >
                模型准入清单
              </h2>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {/* 只陈述**这张表自己**。清单会被怎么执行,上面那条已经说过一次,
                    这里再说一遍就多一个会漂移的副本。
                    ⚠️ 数的是「勾了几个」,不是「清单里有几条」—— 契约的
                    `allowedModels: []` 语义是全部允许(换算由调用方做完,见
                    `ModelRow.allowed`),那时勾选数与清单长度**本来就不相等**,
                    写成「清单内 N 个」会和上面的 `allowlist: []` 当场打架。 */}
                {policyState === 'unset'
                  ? '该租户没有策略记录：下方是上游目录，勾选状态由调用方按契约语义换算而来。'
                  : `已勾选 ${admitted.length} 个，共 ${models.length} 个候选。`}
              </span>
            </div>
            {models.length === 0 ? (
              <Empty text="上游目录里还没有模型。同步一次目录，或先在「模型」屏确认上游连通。" />
            ) : (
              <Table columns={COLUMNS} rows={tableRows} density="default" />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
            <Card title="token 预算" action={<Frozen />}>
              {quota === null ? (
                <Empty text="这个租户还没有可显示的配额。" />
              ) : (
                <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
                  {/* 🚨 主体与周期:少了任何一个,下面那个数都读不出在说什么 —— 缺陷 6。 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--s-4)',
                      flexWrap: 'wrap',
                      font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    <CodeRef copyable>{quota.subjectId}</CodeRef>
                    <span>
                      计费周期 {quota.periodStart} → {quota.periodEnd}
                    </span>
                  </div>
                  {quota.tokenLimit === null ? (
                    <UnlimitedUsage used={fmtTokens(quota.tokenUsed)} />
                  ) : (
                    <QuotaBar
                      used={quota.tokenUsed}
                      total={quota.tokenLimit}
                      // 告警线没设就不画 —— `exactOptionalPropertyTypes` 下不能显式传 undefined。
                      {...(quota.alertAt === null ? {} : { target: quota.alertAt })}
                    />
                  )}
                  <div
                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-5)' }}
                  >
                    {quota.tokenLimit === null ? (
                      <Input label="月度预算" value="不限" disabled />
                    ) : (
                      <Input
                        label="月度预算"
                        value={fmtTokens(quota.tokenLimit)}
                        suffix="tok"
                        disabled
                      />
                    )}
                    <Input
                      label="单次运行上限"
                      value={budget.perRunTokenLimit}
                      suffix="tok"
                      disabled
                    />
                  </div>
                </div>
              )}
            </Card>

            <Card title="超预算行为" action={<Frozen />}>
              <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
                <Select
                  label="超出预算时"
                  value={OVER_BUDGET_LABEL[budget.overBudget]}
                  options={OVER_BUDGET_ACTIONS.map((k) => OVER_BUDGET_LABEL[k])}
                  disabled
                />
                <Select
                  label="降级目标"
                  value={downgradeValue}
                  options={downgradeOptions}
                  mono
                  disabled
                />
                <Input label="并发上限" value={budget.concurrencyLimit} suffix="并发" disabled />
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  降级目标必须在准入清单内。
                  {admitted.length === 0
                    ? '当前清单里一个模型都没有，降级无处可去——执行层接线后这里会拒绝保存。'
                    : ''}
                </span>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  )
}
