/**
 * 「配额与模型准入」屏的**转换层**:`Quota` + `Policy[]` → `QuotasScreenProps`。
 *
 * ## 这一屏有两块数据,只有一块是真的
 *
 * | 块 | 端点 | 这一版的真相 |
 * | --- | --- | --- |
 * | 配额读数(已用 / 上限 / 周期) | `GET /v1/admin/subjects/{id}/quota` | **已实现**,数是真的 |
 * | 准入清单 / 预算 / 超预算行为 / 并发 | 策略面 | 读**可能** 501;写**根本不存在** |
 *
 * 混着接的后果不是「显示得不准」:一屏全标「不生效」,管理员就学会无视那枚标签,
 * 而配额那块的数字是真的、会被照着做决定。⇒ 两块在这里就分开处理,一处不合并。
 *
 * ## ⚠️ 「策略执行层零接线」这句话要说准 —— 本仓里它指的**不是**这一屏
 *
 * 逐处核过,三件事各不相同,别混:
 *
 * | 东西 | 实情 | 证据 |
 * | --- | --- | --- |
 * | 工作区策略执行器 | **真的零接线** → `/v1/workspaces/{id}/policy` 刻意回落 501 | `gateway/src/server.ts` 那句「刻意不传 `policies`」;`createPolicyEnforcer` 全仓只有导出与单测两个调用点 |
 * | 租户级模型准入(model-router) | **接了线**,在 `createAgent` 入口裁决 | `gateway/src/server.ts` 里 `modelRouter.resolve(...)`,deny 直接拦住这次运行 |
 * | 配额耗尽 | **接了线**,`quota_exhausted` → 429 | `packages/policy/src/index.ts` 的 `decide`,网关把 `policyService` 挂在 `quota` 上 |
 *
 * ⇒ 于是 `GET /v1/admin/policies` 在**出厂装配**里是通的(`modelPolicies` 一直传),
 * 501 只出现在没接策略存储的部署上。两条路都得走通,所以入参收的是
 * `MaybeImplemented<Policy[]>` 而不是 `Policy[]` —— 501 是**一个值**,不是一次失败。
 *
 * ⚠️ 而**写入口在契约里一条都没有**(`/v1/admin/policies` 只读,写留给控制平面)。
 * 所以屏上那些 disabled 的控件在这一版是**永久正确**的,不是「暂时」。
 *
 * ## ⚠️ 屏上的字段 | 有来源吗 | 这里怎么做
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | `tenants` | ⚠️ 不在本模块这两个数据源里 | 由调用方传。**刻意不从 `Policy[]` 推** —— 见 {@link QuotasInput.tenants} |
 * | `selectedTenantId` | ⚠️ 调用方的选择 | 原样传;落在 `tenants` 外由屏自己补进候选 |
 * | `policyState` | ⚠️ 501 时没有来源 | 读通 → 按记录形状三分;501 → `'unset'`(三档里断言最弱的一档),见 {@link toPolicyState} |
 * | `enforcement` | ❌ **本层算不出** | 必填入参。501 时只接受 `'not-enforced'`,否则**抛** |
 * | `enforcementCode` | ❌ 同上 | 必填入参。`'not-enforced'` 时必须是 `null` —— 没人执行就没有拒绝码 |
 * | `policyProbe` | ⚠️ 一半真 | `requestId` 是服务端回的;`endpoint`/`status`/`code` 见各常量注释 |
 * | `models[]` | ❌ **没有模型目录端点** | 目录由调用方传(今天是 `[]`);`allowed` 由 `allowedModels` 换算 |
 * | `models[].contextWindow` / `price` / `availability` | ❌ | 不在本层编 —— 它们随目录一起来,没有目录就没有行 |
 * | `quota.subjectId` / `tokenUsed` | ✅ 契约 `Quota` | 原样 |
 * | `quota.tokenLimit` | ✅ | 原样,`null` = **不限**。一处 `?? 0` 都没有 |
 * | `quota.periodStart` / `periodEnd` | ✅ | 格式化成 `'08-01'`,**按 UTC**,见 {@link periodLabel} |
 * | `quota.alertAt` | ❌ 契约 `Quota` 里没有这个字段 | `null` → 不画告警线。不拿「上限的 90%」凑 |
 * | `budget.perRunTokenLimit` | ❌ | `'—'` |
 * | `budget.overBudget` | ⚠️ 只能由 `fallbackModel` 推 | 见 {@link toBudget} |
 * | `budget.downgradeTo` | ✅ `Policy.fallbackModel` | 原样,`null` 不兜底 |
 * | `budget.concurrencyLimit` | ❌ | `'—'`。⚠️ **不要拿 `Capacity.maxProcesses` 充数** —— 那是整个部署的进程上限,不是这个租户的并发上限,两者数量级都不同 |
 *
 * ## ⚠️ 两条来自上游的截断,本层修不了,但要写下来
 *
 * 1. `ConsoleApi.policies()` 只取**第一页**(`nextCursor` 被丢掉)。多于一页时,
 *    「清单里没有这个租户」与「这个租户没有记录」在这一层**长得一模一样**。
 * 2. `asMaybeImplemented` 只留了 `plannedVersion` 与 `requestId`,把
 *    `DshwarApiError.code` 丢了;而 `PolicyEndpointProbe` 又没有位置放
 *    `plannedVersion`。⇒ 一进一出,屏上少掉「哪个版本会实现」这条真信息。
 *
 * @module @dshwar/console-web/view/quotas
 */
import type { ModelRow } from '@dshwar/design-system/screens/console/ModelsScreen'
import type {
  BudgetPolicy,
  PolicyEndpointProbe,
  PolicyEnforcement,
  PolicyState,
  QuotaReading,
  QuotasScreenProps,
} from '@dshwar/design-system/screens/console/QuotasScreen'
import type { MaybeImplemented, NotImplemented, Policy, Quota } from '../api.ts'

/**
 * 拿不到时的占位。**只用在展示串上** —— 数字字段一律不许有占位,
 * 那是「第二个事实源」的入口。
 */
const NO_SOURCE = '—'

/**
 * 被探的那一条。**写真实路径**,不写设计 kit 里那条虚构的
 * `GET /v1/tenants/{id}/policy`(全仓不存在)。
 *
 * 它带 `copyable`:管理员会把这一行粘进工单,而运维要拿它去 grep 网关日志。
 * 粘进去一条不存在的路径,查出来的是零条,然后结论是「用户记错了」。
 *
 * ⚠️ 不带分页 query —— `client.policies()` 会拼 `?limit=…`,但那是这次调用的
 * 参数,不是端点标识。工单里要的是后者。
 */
const POLICY_ENDPOINT = 'GET /v1/admin/policies'

/**
 * 501。**不是从响应里读的,是 {@link NotImplemented} 这个类型的定义**。
 *
 * `asMaybeImplemented` 的原话是「只认 501」:它只在 `error.status === 501` 时
 * 造出这个值,别的状态码原样抛出去。⇒ 拿到 `kind: 'not-implemented'` 就等于
 * 拿到了 501,这不是猜。
 */
const NOT_IMPLEMENTED_STATUS = 501

/**
 * 501 对应的服务端错误码。
 *
 * ⚠️ **这一个是推导,不是观测** —— 值得单独说清,因为屏上它带 `copyable`。
 *
 * 推导的依据是契约里那条双射:`gateway/src/errors.ts` 的 `STATUS_BY_CODE` 中
 * 映射到 501 的码**有且只有** `not_implemented`,而 `asMaybeImplemented` 只认 501。
 * 于是在本仓,「501」与「not_implemented」是同一件事的两种写法。
 *
 * 🚨 它仍会在一种情况下与真相分家:某个中间层(反代 / CDN / 更早版本的网关)
 * 吐一个带 JSON 体、`code` 却不是 `not_implemented` 的 501。
 * ⇒ **真正的修法是让 `asMaybeImplemented` 把 `code` 一起带出来**(那要改 `api.ts`,
 * 本轮不动它)。改的那天,把这个常量删掉,直接用响应里的码。
 */
const NOT_IMPLEMENTED_CODE = 'not_implemented'

/**
 * 告警线。**契约的 `Quota` 里没有这个字段** —— 五个字段是
 * `subjectId` / `tokenLimit` / `tokenUsed` / `periodStart` / `periodEnd`,没有第六个。
 *
 * `null` = 不画那条线。⚠️ 不要拿「上限的 90%」凑一条出来:
 * 一条没人设过的线画上去就成了一个承诺 —— 管理员会以为用到九成时有人会告诉他。
 */
const ALERT_AT_NO_SOURCE = null

/** 目录里的一条模型。**没有 `allowed`** —— 那是策略换算的结果,由本模块填。 */
export type ModelCatalogEntry = Omit<ModelRow, 'allowed'>

export interface QuotasInput {
  /**
   * 可选的租户 id。
   *
   * ⚠️ **刻意不从 `Policy[]` 推。** 推的话,策略端点 501 时租户清单会变成空,
   * 屏上退成「还没有租户可配」—— 而那句话是假的(读不到 ≠ 没有),
   * 更要紧的是配额那块**真数**被一起藏掉了:屏幕把配额卡挂在「选中了租户」这个
   * 分支下面。⇒ 谁知道租户就由谁传(Admin Key 按租户签发,通常就是那一个)。
   */
  readonly tenants: readonly string[]
  /** 当前查看的租户;`null` = 没选 → 屏上是空态,不是错误态。 */
  readonly selectedTenantId: string | null
  /**
   * 策略读取结果。**501 是一个值,不是一次失败** —— 用 `asMaybeImplemented` 包住
   * `api.policies()` 拿到它。失败该让人重试,没实现重试一万次也一样。
   */
  readonly policies: MaybeImplemented<readonly Policy[]>
  /**
   * 该主体的配额;`null` = 没读到 / 没有。
   *
   * ⚠️ **配额按主体,而这一屏按租户选** —— 契约里没有「租户级配额」这种东西。
   * 挑哪个主体由调用方定,屏上会把 `subjectId` 显示出来(那是 `QuotasScreen`
   * 缺陷 6 的落点)。
   *
   * ⚠️ 本层**无法**校验这条配额属不属于选中的租户:`Quota` 里没有 `tenantId`。
   */
  readonly quota: Quota | null
  /**
   * 上游模型目录。
   *
   * ⚠️ **今天没有任何端点给它** —— `ConsoleApi` 九条里没有模型目录,
   * 于是调用方传 `[]`,表格位置显示空态。空态不是错误态。
   *
   * 传进来的条目里没有 `allowed`:那一位由 `allowedModels` 换算,
   * 而「空清单 = 全部允许」这条契约语义只在这里结清一次(见 {@link toModelRows})。
   */
  readonly catalog: readonly ModelCatalogEntry[]
  /**
   * 执行层拿这份配置**会做什么**。
   *
   * 🚨 **本模块不替你算它,而且这是刻意的。** 算它需要在一处本仓**尚未裁决**的
   * 矛盾里选边:设计 kit 说「缺席不等于放行」,而跑在生产路径上的 model-router
   * 三处一致地说「没配策略 = 原样放行,空清单 = 全部允许」
   * (`packages/model-router/src/index.ts` · `docs/GOVERNANCE.md` §3 · 它的单测)。
   * `QuotasScreen` 的模块注释把这处矛盾原样留着,并写明**不该由一个转换 PR 顺手选一边**。
   * 本模块是那个转换 PR。⇒ 必填入参,由人裁一次。
   *
   * ⚠️ `policies` 是 501 时,唯一诚实的取值是 `'not-enforced'` —— 一个读不到的
   * 记录,谁也没在执行它。传别的会**抛**,不会被悄悄改掉。
   */
  readonly enforcement: PolicyEnforcement
  /**
   * 这一态对应的服务端错误码;`null` = 这一态没有对应错误码。
   *
   * 🚨 只填**服务端真的会发**的码 —— 它带 `copyable`,会被粘进工单。
   * 本仓真实存在的两个是 `model_not_allowed`(model-router 拒绝)与
   * `quota_exhausted`(配额耗尽 → 429)。拿不准就填 `null`:
   * 少一枚码,好过多一枚客服查不到的码。
   */
  readonly enforcementCode: string | null
  readonly onTenantChange?: (tenantId: string) => void
  readonly onModelMenu?: (modelId: string) => void
  readonly onCreateTenant?: () => void
}

/**
 * 501 → 屏上那条证据行。
 *
 * ⚠️ `requestId` **原样传,拿不到就 `null`** —— 屏幕那时会少一行,并明说
 * 「服务端没回 request id」。编一个 id 出来的代价见 `QuotasScreen` 缺陷 3:
 * 每个管理员复制到的都是同一个日志里不存在的串。
 */
export function toPolicyProbe(probe: NotImplemented): PolicyEndpointProbe {
  return {
    endpoint: POLICY_ENDPOINT,
    status: NOT_IMPLEMENTED_STATUS,
    code: NOT_IMPLEMENTED_CODE,
    requestId: probe.requestId,
  }
}

/**
 * 取**执行层会用的那一条**策略。
 *
 * ⚠️ 用 `find` 取第一条,是为了与 `InMemoryPolicyStore.byTenant` 同一条规则 ——
 * 它也是 `find`。一个租户若有多条记录,界面必须显示**生效的那一条**;
 * 显示别的一条会让管理员看着 A、运行时跑着 B,而两者都「看起来正常」。
 */
function policyOf(policies: readonly Policy[], tenantId: string | null): Policy | undefined {
  if (tenantId === null) return undefined
  return policies.find((p) => p.tenantId === tenantId)
}

/**
 * 策略记录的**形状**三分。
 *
 * ⚠️ 这里只说形状,一个字都不说会被怎么执行 —— 执行是 `enforcement` 的事。
 * 两者曾经被写在同一个枚举里,那正是 `QuotasScreen` 缺陷 1 能存在的原因。
 *
 * ⚠️ `allowedModels: []` 在这里是 `'empty'`(**显式空清单**,一个决定),
 * 而不是「什么都不允许」—— 后者是把契约语义**反过来**读。
 * 「空 = 全部允许」那条语义落在勾选位上,见 {@link toModelRows}。
 */
export function toPolicyState(policy: Policy | undefined): PolicyState {
  if (policy === undefined) return 'unset'
  return policy.allowedModels.length === 0 ? 'empty' : 'set'
}

/**
 * 目录 + 策略 → 表格的行。
 *
 * ## 这里结清「空清单 = 全部允许」
 *
 * 契约的 `allowedModels: []` 语义是**全部允许**(准入是 opt-in)。若把清单原样
 * 交给界面去 `includes()`,空清单会渲染成一排**全未勾选**的复选框 ——
 * 界面说「一个都不准」,运行时说「全都准」,方向正好相反。
 *
 * ## ⚠️ 没有策略记录时**不给行**
 *
 * `policy === undefined`(没记录,或端点 501)时,每一行的勾选位都是未知的,
 * 而复选框**没有第三档**:全不勾是「一个都不准」的断言,全勾是「全放行」的断言。
 * 两者恰好就是缺陷 1 那处未裁决的矛盾的两个答案。⇒ 一行都不给,表格显示空态。
 *
 * @throws 当策略清单里有目录覆盖不到的模型 —— 见下。
 *
 * 🚨 **为什么覆盖不全要抛,而不是少画几行。** 屏上那行 `allowlist: [n models]`
 * 里的 n 是**由行派生的**(勾选数),而 `set` 态默认「勾选数 = 清单长度」。
 * 目录缺了三条,那一行就写 `allowlist: [0 models]` —— 一份长得像机器读数的假读数,
 * 说这个租户的准入清单是空的。它与 `view/capacity.ts` 里那个认不出的隔离档同族:
 * 退化的表现是**一个看起来完全正常的数字**,而管理员会照着它做决定。
 *
 * ⇒ 让它响亮地停下来。今天不会触发:调用方传的目录是 `[]`,而出厂网关的
 * `governance.modelPolicies` 默认没配、这一层拿到的是空列表。这条抛守的是
 * 「有人配了策略、而目录端点还没有」的那一天。
 */
export function toModelRows(
  catalog: readonly ModelCatalogEntry[],
  policy: Policy | undefined,
): ModelRow[] {
  if (policy === undefined) return []

  const allowed = policy.allowedModels
  // ★ 契约语义:空清单 = 全部允许。这一行是它在前端唯一的落点。
  if (allowed.length === 0) return catalog.map((m) => ({ ...m, allowed: true }))

  const missing = allowed.filter((id) => !catalog.some((m) => m.id === id))
  if (missing.length > 0) {
    throw new Error(
      `策略 ${policy.id} 的准入清单里有 ${missing.length} 个模型不在目录里:${missing.join(' · ')}\n` +
        '屏上的 `allowlist: [n models]` 是由表格行数出来的,少了这些行,那个 n 会小于真实清单长度 ——\n' +
        '而它长得像一份机器读数,管理员会照着它判断这个租户被放开了多少。\n' +
        '要么把目录补全(调用方的 catalog 必须覆盖 allowedModels),要么先加一条模型目录端点。',
    )
  }
  return catalog.map((m) => ({ ...m, allowed: allowed.includes(m.id) }))
}

/**
 * ISO 时间戳 → `'08-01'`。
 *
 * ⚠️ **按 UTC 渲染,不按本地时区** —— 与 `workbench-web/src/format.ts` 的
 * `shortTime` 刻意相反,理由也刚好相反:那里渲染的是「我什么时候跑的这个」,
 * 是用户的本地事件;而计费周期是**服务端的账期边界**,它不属于任何读者的时区。
 * 按本地时区渲染会把 `2026-08-01T00:00:00Z` 的账期在西半球显示成 `07-31` ——
 * 一个八月的账期写着七月,而那看起来完全正常。
 *
 * 解析不了 → `'—'`。**不猜**,也不把原串直出(屏上那一格是等宽小字,
 * 一条 ISO 串会撑破它,而且读者会以为那就是设计)。
 */
export function periodLabel(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return NO_SOURCE
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`
}

/**
 * 契约 `Quota` → 屏上的配额读数。**本屏唯一一块真数据。**
 *
 * ⚠️ `tokenLimit` 与 `tokenUsed` 原样传数字,**一处兜底都没有**:
 * - `tokenLimit: null` = **不限**,不是 0,也不是「没配」。屏幕据此改画一行读数
 *   而不是进度条 —— 一条 `used / 0` 的条会算出 `0.0%`,读作「额度用尽」,与真相相反。
 * - `tokenUsed` 若来自服务端就一定有值;给它写 `?? 0` 等于新增第二个事实源,
 *   而那个源永远显示「还没用过」。
 */
export function toQuotaReading(quota: Quota): QuotaReading {
  return {
    subjectId: quota.subjectId,
    tokenLimit: quota.tokenLimit,
    tokenUsed: quota.tokenUsed,
    alertAt: ALERT_AT_NO_SOURCE,
    periodStart: periodLabel(quota.periodStart),
    periodEnd: periodLabel(quota.periodEnd),
  }
}

/**
 * 预算卡。**四个字段里只有一个有来源。**
 *
 * | 字段 | 来源 |
 * | --- | --- |
 * | `downgradeTo` | ✅ `Policy.fallbackModel`,原样 |
 * | `overBudget` | ⚠️ 由 `fallbackModel` 推,见下 |
 * | `perRunTokenLimit` | ❌ 契约里没有「单次运行上限」 |
 * | `concurrencyLimit` | ❌ 契约里没有租户级并发上限 |
 *
 * ## ⚠️ `overBudget` 是三档闭集,而没有一档正好叫「拒绝」
 *
 * 服务端真正做的事有两种,都查得到出处:
 *
 * - 配了 `fallbackModel` → 预算用到阈值时**换成降级目标**,并落审计
 *   (`packages/model-router/src/index.ts`,降级必须可见是红线)⇒ `'downgrade'`,契约支撑。
 * - 没配 → model-router 的原话是「null = 直接拒绝(走 policy 的 429)」,
 *   而 `@dshwar/policy` 的 `decide` 确实回 `deny / quota_exhausted` ⇒ agent 跑不动。
 *
 * 三档标签是设计 kit 的词表:`'warn'`(仅告警)会说假话 —— 超了还能继续跑;
 * `'downgrade'` 在没有降级目标时也是假的。`'pause'`(暂停 Agent)是唯一
 * **不说假话**的那一档,尽管它也不精确(真实是这一周期内的请求被 429 拒绝)。
 * ⇒ 选 `'pause'`,并把这段写下来,免得下一个人以为它有确切来源。
 *
 * ⚠️ `perRunTokenLimit` / `concurrencyLimit` 一律 `'—'`。
 * **尤其不要拿 `Capacity.maxProcesses` 当并发上限**:那是整个部署的进程数上限
 * (逻辑档下它甚至是 `null`),不是这个租户的并发额度。借过来填,数字会看起来
 * 很合理,而它回答的是另一个问题。
 */
export function toBudget(policy: Policy | undefined): BudgetPolicy {
  // 「没有记录」与「记录里没设降级目标」在这一格上是同一件事(下拉显示「未设定」),
  // 而两者的区别已经由 policyState 单独说过一次 —— 不在这里再说第二遍。
  const fallback = policy?.fallbackModel ?? null
  return {
    perRunTokenLimit: NO_SOURCE,
    overBudget: fallback === null ? 'pause' : 'downgrade',
    downgradeTo: fallback,
    concurrencyLimit: NO_SOURCE,
  }
}

/**
 * 裁决与实情的一致性检查。**不一致就抛,不悄悄改。**
 *
 * ⚠️ 为什么不「501 时把 enforcement 改成 `not-enforced'` 就完事」:
 * 悄悄改掉调用方给的值,会让一个写错的调用点**永远看起来是对的**。
 * 这一层是转换层 —— 认不出、对不上的东西在这里停下来,是它存在的理由。
 */
function assertEnforcementHonest(
  policies: MaybeImplemented<readonly Policy[]>,
  enforcement: PolicyEnforcement,
  enforcementCode: string | null,
): void {
  if (policies.kind === 'not-implemented' && enforcement !== 'not-enforced') {
    throw new Error(
      `策略端点回落 ${NOT_IMPLEMENTED_STATUS},而调用方给的裁决是 "${enforcement}"。\n` +
        '一条读不到的策略记录没有裁决 —— 它既不是「一律拒绝」也不是「全部放行」。\n' +
        '这两个值都会让屏上出现一句关于安全性质的、没有任何东西在背书的断言。\n' +
        `501 期间唯一诚实的取值是 "not-enforced"。`,
    )
  }
  if (enforcement === 'not-enforced' && enforcementCode !== null) {
    throw new Error(
      `裁决是 "not-enforced"(当前无人执行),却带着错误码 "${enforcementCode}"。\n` +
        '没人执行就没有拒绝,没有拒绝就没有码。而那枚码在屏上带 copyable ——\n' +
        '它会被粘进工单,然后客服拿着一个服务端从未发出过的串去查。',
    )
  }
}

/**
 * 组装整屏的 props。**纯函数** —— 不碰 DOM、不碰网络、不认识 React。
 *
 * @throws 当 `enforcement` / `enforcementCode` 与策略端点的实情对不上
 *   (见 {@link assertEnforcementHonest}),或目录覆盖不了准入清单
 *   (见 {@link toModelRows})。两处都是「宁可响亮地停下,也不给一个看起来正常的值」。
 */
export function toQuotasProps(input: QuotasInput): QuotasScreenProps {
  const policies = input.policies
  assertEnforcementHonest(policies, input.enforcement, input.enforcementCode)

  // 501 时 `policy` 是 undefined,但含义与「读通了、这个租户没有记录」不同 ——
  // 差别由 `policyProbe` 与屏顶那条通栏说明承担,不由这个变量承担。
  const policy =
    policies.kind === 'ok' ? policyOf(policies.value, input.selectedTenantId) : undefined

  return {
    tenants: input.tenants,
    selectedTenantId: input.selectedTenantId,
    // ⚠️ 501 时三档都没有来源,这里取**断言最弱**的那一档:
    //   'empty' 与 'set' 都在声称「有一条记录,并且它长这样」,那是我们没有的东西;
    //   'unset' 只说「没有(拿到)准入策略记录」。
    //   顺带一条旁证:本仓里这条端点回落 501 的唯一原因是部署没接策略存储
    //   (`gateway/src/admin/routes.ts` 的 `if (modelPolicies === undefined)`),
    //   而没有存储就没有任何租户有记录。⚠️ 那是对实现的推断,不是响应里的信息 ——
    //   换成一个自己回 501 的反代,这条旁证就不成立,而「最弱断言」那条理由仍然成立。
    policyState: policies.kind === 'ok' ? toPolicyState(policy) : 'unset',
    enforcement: input.enforcement,
    enforcementCode: input.enforcementCode,
    // 读通时**没有探测结果**:那时屏顶通栏会退成「策略端点尚未接线。」
    // 🚨 而那句话在读通的部署上是错的 —— 准确的说法是「没有写入口」。
    //    通栏本身是无条件渲染的(`<NotWiredNotice probe={policyProbe} />`),
    //    本层给不出第二种措辞。这是 QuotasScreen 的一处待修,不在这里遮:
    //    遮的办法只有编一个探测结果出来,那比一句措辞不准的提示贵得多。
    policyProbe: policies.kind === 'not-implemented' ? toPolicyProbe(policies) : null,
    models: toModelRows(input.catalog, policy),
    quota: input.quota === null ? null : toQuotaReading(input.quota),
    budget: toBudget(policy),
    // `exactOptionalPropertyTypes` 下不能把 undefined 显式传给可选 prop;
    // 而屏幕正是靠「有没有这个回调」决定按钮 disabled 不 disabled ——
    // 没人接的按钮不该看起来能按。
    ...(input.onTenantChange === undefined ? {} : { onTenantChange: input.onTenantChange }),
    ...(input.onModelMenu === undefined ? {} : { onModelMenu: input.onModelMenu }),
    ...(input.onCreateTenant === undefined ? {} : { onCreateTenant: input.onCreateTenant }),
  }
}
