/**
 * 模型准入屏的**转换层**:契约 `Policy` → `ModelsScreenProps`。
 *
 * ## 先说结论:这一屏只有五分之一有来源
 *
 * `GET /v1/admin/policies` 给的 `Policy` 一共五个字段
 * (`id` / `tenantId` / `allowedModels` / `fallbackModel` / `updatedAt`),
 * 而 `ModelsScreen` 要的是一张**上游模型目录表**(每行还要上下文窗口、单价、
 * 可用性)、一份**降级策略**、一条**已发生的降级**、一列**上游事件**。
 * 两边的差距不是「字段名不同」,是**大部分东西契约里根本没有**。
 *
 * ⚠️ 已经把 `sdk/typescript/src/generated/schema.ts` 的全部 21 条 path 数过一遍:
 * 没有模型目录端点,没有 `contextWindow`,没有价格,没有上游事件流。
 * 下表里的 ❌ 是**数出来的**,不是估的。
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | `policy.policyId` | ✅ `Policy.id` | 原样 |
 * | `policy.tenantId` | ✅ `Policy.tenantId` | 原样 |
 * | `policy.updatedAt` | ✅ `Policy.updatedAt` | 本地时区格式化成 `'08-18 09:14'` |
 * | `rows[].id` | ⚠️ 只有目录才给得全 | 由调用方传 `catalog`;没有目录端点,今天只能是 `[]` |
 * | `rows[].allowed` | ✅ `allowedModels` | **空 = 全部允许**,换算在这一层结清(见下) |
 * | `rows[].contextWindow` | ❌ | `'—'` |
 * | `rows[].price` | ❌ | `'—'` |
 * | `rows[].availability` | ❌ | **不猜,必填** —— 由 `catalog` 带进来(见下) |
 * | `capacityStrategy` | ⚠️ 间接 | 由 `fallbackModel` 空不空派生,不是编的(见下) |
 * | `fallbackModel` | ✅ `Policy.fallbackModel` | 原样,`null` 不合并 |
 * | `notifyMembers` | ❌ | 必填参数 —— 让这次编造发生在**调用点**,不藏在默认值里 |
 * | `degrade` | ❌ | `null` → 整条提示不渲染 |
 * | `events` | ❌ | `[]` → 卡片里渲染空态 |
 *
 * ## 🚨 `/v1/admin/policies` **只有 GET**
 *
 * 没有 PUT / POST / PATCH(实测 `schema.ts:211`,除 `get` 外全是 `never`)。
 * 于是这一屏的每一个交互 —— 勾准入、改降级目标、换策略、开提示、点「保存白名单」
 * —— **都没有写入口可调**。
 *
 * ⇒ 所以 `on*` 全部是**可选**参数,且**默认一个都不传**。
 * `Checkbox` 与 `Select` 都是纯受控的(组件内没有 `useState`,实测过),
 * 不传回调时它们**动都不动** —— 界面如实表现为只读。
 *
 * ⚠️ **这比「能点但存不下」好得多。** 一个点得动、点完还回弹或者干脆不回弹、
 * 而服务端一无所知的开关,属于「假成功回执」那一族:管理员以为白名单改好了,
 * 然后带着一份错误的认知去排查「为什么员工还能用那个模型」。
 * 调用方自己维护草稿态时**可以**传回调,但那时它有责任知道保存按钮通向哪里。
 *
 * ## 🚨 `allowedModels: []` = 全部允许 —— 这条换算必须死在这一层
 *
 * 契约语义(`docs/GOVERNANCE.md` §3):准入是 opt-in,没配策略的租户默认放行,
 * **空清单 = 全部允许**;清单外 → 403。
 *
 * 把 `allowedModels` 原样递给界面、让界面自己 `includes()`,空清单会渲染成
 * **一排全未勾选的复选框** —— 界面说「一个都不准」,服务端说「全都准」。
 * 意思**正好反过来**,而且看起来完全正常。⇒ 见 {@link isAllowed}。
 *
 * ## `capacityStrategy` 是派生的,不是编的
 *
 * 屏上那个下拉有三档(降级 / 排队 / 直接失败),契约里**一个对应字段都没有**。
 * 但契约把同一件事表达在了 `fallbackModel` 上:
 * 「没配 `fallbackModel` → 超阈值也不降级(走 429)」。429 就是失败。
 *
 * ⇒ `fallbackModel !== null` → `'fallback'`;`=== null` → `'fail'`。
 * 这是**如实翻译契约里唯一的那处表达**,不是给一个没来源的字段挑一档。
 * 顺带把屏幕注释点名的那个矛盾态(`'fallback'` + `fallbackModel: null`)
 * 在构造上消掉了 —— 两者由同一个字段派生,不可能不一致。
 *
 * ⚠️ **`'queue'` 在契约里没有任何表达,因此永远产生不出来。** 而下拉里有它:
 * 管理员选中「排队等待」后,`onCapacityStrategyChange` 会收到一个
 * **没有字段可以存放的值**。这是真缺口,不是本层能补的 ——
 * 补法是契约先加字段。
 *
 * ⚠️ 还有一处措辞落差:屏上写「**容量**受限时」,而契约里的降级触发条件是
 * **预算水位到阈值**(默认 80%)。两者不是一回事。这一层只能如实映射存在的
 * 那个字段,不替谁圆场。
 *
 * ## `degrade` / `events` 将来从哪来(写下来,免得下次又从头找)
 *
 * 不是「永远没有」,是**今天没有**:契约已经规定降级要三处留痕 ——
 * 响应头 `x-dshwar-model-downgraded`、会话里存裁决后的模型、审计
 * `model.downgraded`(`before` / `after` 都在)。
 *
 * ⚠️ **但今天不能拿 `GET /v1/admin/audit` 去凑。** 两个理由:
 * 一是审计流是**管理动作**的流水,不是上游事件流,拿它冒充是类别错误;
 * 二是 `AuditEntry.before` / `after` 的契约类型是 `unknown | null`,
 * 从里面掏 `from` / `to` 得先猜一个形状,而猜错了不会有任何东西变红。
 * ⇒ 等审计条目的载荷在契约里定型,再单独写一个 `view/degrade.ts`。
 *
 * @module @dshwar/console-web/view/models
 */
import type {
  CapacityStrategy,
  ModelAvailability,
  ModelPolicyMeta,
  ModelRow,
  ModelsScreenProps,
} from '@dshwar/design-system/screens/console/ModelsScreen'
import type { Policy } from '../api.ts'

/**
 * 「取不到」的展示串。
 *
 * ⚠️ 与 `'0'` / `'0K'` 严格分开。一个真的 0 元模型显示 `'0.00'`,
 * 而取不到单价显示 `'—'` —— 合并的后果是管理员按「免费」去做预算。
 */
const UNKNOWN = '—'

/**
 * 上游目录里的一个模型。
 *
 * ⚠️ **这个类型没有 API 来源。** 契约里没有模型目录端点(那正是屏上
 * 「同步上游目录」按钮今天点不动的原因)。它存在是为了把接口先划出来:
 * 目录端点落地时,只有 `toModelsProps` 的调用点要改,这一层不用动。
 *
 * ⇒ 今天正确的传法是 `catalog: []`,屏上渲染空态
 * (「上游目录里还没有模型。先『同步上游目录』,再决定准入哪些。」)——
 * 那句话说的**正好就是实情**。
 */
export interface ModelCatalogEntry {
  /** 模型标识串,如 `'deepseek/deepseek-chat'`。它同时是策略里的键。 */
  readonly id: string
  /** 已人类化的上下文窗口(如 `'200K'`)。取不到传 `null` → 屏上 `'—'`。 */
  readonly contextWindow: string | null
  /** 已格式化的单价(¥/Mtok)。取不到传 `null` → 屏上 `'—'`。 */
  readonly price: string | null
  /**
   * 🚨 **必填,而且没有默认值。**
   *
   * `ModelAvailability` 是闭集(可用 / 容量受限 / 不可用),**三档都长得像正常值**。
   * 在这里给任何一档兜底都是在替上游宣称一件没核实过的事:
   * 给 `'available'` 会让每一行都挂上绿点「可用」——「假成功回执」那一族;
   * 给 `'unavailable'` 会让管理员以为出了故障,跑去开工单。
   *
   * ⇒ 没有健康检查来源时,**不要造这一行**(把它排除在 `catalog` 之外),
   * 而不是造一行再随手填一档。
   */
  readonly availability: ModelAvailability
}

/** {@link toModelsProps} 的入参。 */
export interface ModelsInput {
  /** 要展示的那一条策略。用 {@link pickPolicy} 从 `api.policies()` 里挑。 */
  readonly policy: Policy
  /**
   * 上游模型目录。**必填** —— 今天唯一诚实的值是 `[]`。
   *
   * ⚠️ 刻意不给默认值:一个 `catalog = []` 的默认参数会让「这一屏是空的」
   * 变成一件**没人做过决定**的事。必填之后,每个调用点都要亲手写一次 `[]`,
   * 那一下就是提醒。同一条纪律见 `ModelsScreen` 的「数据字段一律必填」。
   */
  readonly catalog: readonly ModelCatalogEntry[]
  /**
   * 🚨 是否在工作台内向员工展示降级提示。**契约里没有这个字段。**
   *
   * 必填的理由与 `catalog` 相同,而且更硬:布尔值没有 `'—'` 这种「说不知道」
   * 的表达,`false` 在屏上与「明确配置为不提示」**一模一样**。
   * 默认成 `false`,等于这一层替每个租户宣称了一句「我们不告知员工」。
   * ⇒ 让这次编造发生在调用点,至少它是看得见的。
   *
   * ⚠️ 而且它**存不下去**:没有写端点,改完即丢。
   */
  readonly notifyMembers: boolean
  /** 收到的是**变更后**的值。不传 → 复选框不动(见模块注释)。 */
  readonly onToggleModel?: (id: string, next: boolean) => void
  readonly onRowMenu?: (id: string) => void
  /** ⚠️ 可能收到 `'queue'` —— 契约里没有它的存放处,见模块注释。 */
  readonly onCapacityStrategyChange?: (next: CapacityStrategy) => void
  /** `null` = 选了「不降级」。 */
  readonly onFallbackModelChange?: (next: string | null) => void
  readonly onNotifyMembersChange?: (next: boolean) => void
  readonly onSyncCatalog?: () => void
  readonly onSave?: () => void
}

/**
 * 从 `api.policies()` 的列表里挑出某个租户的策略。
 *
 * ⚠️ **不要写 `policies[0]`。** 列表顺序不是契约的一部分(`ListPoliciesResponse`
 * 没有承诺任何排序),取第一条会在多租户下**静默展示别人的策略** ——
 * 而屏上会照样印出一个 `tenantId`,看起来一切正常。
 * 这与 CLAUDE.md 第七节「一把钥匙不得横跨租户」是同一件事的界面侧。
 *
 * @returns 找不到时返回 `null`。**不要用一个占位 `Policy` 去凑** ——
 *   屏上的 `policyId` 带着 `copyable`,存在的理由就是被复制进工单,
 *   而一个编出来的 id 会让客服查不到任何东西,然后判定「用户记错了」。
 *   没有策略记录时该做的是渲染另一种状态(契约语义上那是「全部允许」),
 *   不是渲染一条不存在的策略。
 */
export function pickPolicy(policies: readonly Policy[], tenantId: string): Policy | null {
  return policies.find((p) => p.tenantId === tenantId) ?? null
}

/**
 * 某个模型在这条策略下是否准入。
 *
 * 🚨 **`allowedModels: []` = 全部允许。** 契约里准入是 opt-in,没配策略的租户
 * 默认放行(`docs/GOVERNANCE.md` §3)。把空清单当成「一个都不准」会让界面
 * 与服务端说出**完全相反**的两句话,而且是那种看起来毫无异常的相反。
 */
export function isAllowed(policy: Policy, modelId: string): boolean {
  if (policy.allowedModels.length === 0) return true
  return policy.allowedModels.includes(modelId)
}

/**
 * 这条策略里**确实出现过**的模型标识。
 *
 * 用途:目录端点还没有,但白名单里的那几个 id 是**真数据**,不该被丢掉。
 * 调用方一旦有了可用性来源(哪怕只是一次探活),就能拿这个清单拼出最小目录。
 *
 * ⚠️ **空数组不代表「没有模型」**,代表「这条策略没点名任何模型」——
 * 而按上面那条语义,那恰恰是**全部允许**。两者含义相反,别把这个返回值
 * 直接当成目录用。
 */
export function policyModelIds(policy: Policy): readonly string[] {
  const ids = [...policy.allowedModels]
  // 降级目标也是一个真实出现过的 id。它可能落在清单外(契约说那种配置会被
  // 拒绝,但被拒绝的配置照样读得出来),所以去重后补进来 —— 屏幕正是靠它
  // 把「孤儿降级目标」显示出来的。
  if (policy.fallbackModel !== null && !ids.includes(policy.fallbackModel)) {
    ids.push(policy.fallbackModel)
  }
  return ids
}

/**
 * 可用性收窄。**认不出就抛,不回落。**
 *
 * 与 `view/capacity.ts` 的 `toIsolation` 同一条纪律:闭集的三档在屏上分别是
 * 绿点「可用」、黄标「容量受限」、红标「不可用」——**任何一档都长得像正常值**。
 * 回落到 `'available'` 会让一个上游新增的状态(比如「已弃用」「限流中」)
 * 悄悄显示成「可用」,而管理员照着它把模型放进白名单。
 *
 * ⚠️ 屏幕那边刻意**没有**「未知」档,理由写在 `ModelsScreen.tsx` 的
 * `ModelAvailability` 注释里:含糊的灰标签会把「没接上」伪装成「看起来正常」。
 * 那条设计决定只有在这里真的抛出来时才成立。
 *
 * @param raw 目录端点将来给的状态串。今天没有调用方 —— 它是给那一天准备的。
 * @throws 当 `raw` 不是已知三档之一。
 */
export function toAvailability(raw: string): ModelAvailability {
  if (raw === 'available' || raw === 'capacity-limited' || raw === 'unavailable') return raw
  throw new Error(
    `认不出的模型可用性 "${raw}" —— 界面只认 available / capacity-limited / unavailable 三档。\n` +
      '回落到任一档都是在猜,而三档在屏上都长得像正常值:猜成 available 会让\n' +
      '一个新状态显示成绿点「可用」,管理员会照着它把模型放进准入清单。\n' +
      '请先在 view/models.ts 里补上这一档到三档的映射,或给屏幕加一档。',
  )
}

/** 目录里的一项 + 这条策略 → 表里的一行。 */
export function toRow(policy: Policy, entry: ModelCatalogEntry): ModelRow {
  return {
    id: entry.id,
    // ⚠️ `?? UNKNOWN` 在这里是**允许**的:入参已经用 `null` 明确表达了
    //    「取不到」,这一步只是把它翻成展示串,不是在补一个服务端没给的数。
    //    与 CLAUDE.md 禁的「服务端数字上的兜底默认值」不是一回事 ——
    //    那条禁的是**造出第二个事实源**,而 `'—'` 不主张任何事实。
    contextWindow: entry.contextWindow ?? UNKNOWN,
    price: entry.price ?? UNKNOWN,
    availability: entry.availability,
    allowed: isAllowed(policy, entry.id),
  }
}

/** 契约 `Policy` 里那几个「这份白名单是谁、什么时候改的」的字段。 */
export function toPolicyMeta(policy: Policy): ModelPolicyMeta {
  return {
    policyId: policy.id,
    tenantId: policy.tenantId,
    updatedAt: shortTime(policy.updatedAt),
  }
}

/**
 * 容量受限时的处置 —— 由 `fallbackModel` 空不空派生。
 *
 * 见模块注释:这是契约里对同一件事的唯一表达,不是给一个没来源的字段挑一档。
 * `'queue'` 无表达,因此这个函数**永远不会返回它**。
 */
export function toCapacityStrategy(policy: Policy): CapacityStrategy {
  return policy.fallbackModel === null ? 'fail' : 'fallback'
}

/** 组装整屏的 props。 */
export function toModelsProps(input: ModelsInput): ModelsScreenProps {
  const { policy } = input
  return {
    policy: toPolicyMeta(policy),
    rows: input.catalog.map((entry) => toRow(policy, entry)),
    capacityStrategy: toCapacityStrategy(policy),
    // ★ 原样传递,**绝不 `?? ''` 也绝不 `?? 某个模型`**。
    //   `null` 在这里是一个有明确含义的值(不降级),不是「缺失」——
    //   与 `view/branding.ts` 的 `primaryColor: null` 是同一族区分。
    //   合并掉的后果:屏上读出一个模型名,而服务端的策略是超阈值直接 429。
    fallbackModel: policy.fallbackModel,
    notifyMembers: input.notifyMembers,
    // ⚠️ 没有降级事件来源 → `null` → 整条提示不渲染。
    //    这一条是 `ModelsScreen` 点名修过的缺陷:无条件渲染那句
    //    「本次由 X 降级至 Y」等于**每次打开都在陈述一件没发生的事**。
    //    传一个编出来的事件会把那个缺陷原样还回去。
    degrade: null,
    // ⚠️ 没有上游事件流 → `[]` → 卡片里渲染空态。
    //    尤其不能编 `requestId`:它带着 `copyable`,是要被复制进工单的,
    //    而一个服务端日志里不存在的 id 比没有 id 更糟。
    events: [],
    ...(input.onToggleModel === undefined ? {} : { onToggleModel: input.onToggleModel }),
    ...(input.onRowMenu === undefined ? {} : { onRowMenu: input.onRowMenu }),
    ...(input.onCapacityStrategyChange === undefined
      ? {}
      : { onCapacityStrategyChange: input.onCapacityStrategyChange }),
    ...(input.onFallbackModelChange === undefined
      ? {}
      : { onFallbackModelChange: input.onFallbackModelChange }),
    ...(input.onNotifyMembersChange === undefined
      ? {}
      : { onNotifyMembersChange: input.onNotifyMembersChange }),
    ...(input.onSyncCatalog === undefined ? {} : { onSyncCatalog: input.onSyncCatalog }),
    ...(input.onSave === undefined ? {} : { onSave: input.onSave }),
  }
}

/**
 * ISO 时间戳 → `'08-18 09:14'`(本地时区)。
 *
 * ⚠️ **按本地时区渲染,不切字符串。** 服务端给的是 UTC 的 ISO 串,
 * 而管理员读的是「这份白名单我什么时候改的」—— 那是本地时间。
 * `iso.slice(5, 16)` 会在跨时区时差出几个小时,而那种错**看起来完全正常**。
 *
 * ⚠️ 不用 `toLocaleString()`:它随运行环境的 locale 变,同一份数据在开发机
 * 与 CI 上会渲染成两个样子,快照测试因此随机红。
 *
 * ⚠️ **这与 `workbench-web/src/format.ts` 的 `shortTime` 同形。**
 * `console-web` 今天没有 `format.ts`,而本轮只允许动这一个文件(邻居模块
 * 正在并发写)。两份实现分家的那天,表现是两个前端把同一个时间戳渲染成
 * 不同样子 —— 一个 D2 家族的第二事实源。⇒ 建 `console-web/src/format.ts`
 * 时把它**搬**过去,不要抄第三份。刻意不导出,免得它先变成事实上的公共 API。
 */
function shortTime(iso: string): string {
  if (iso === '') return UNKNOWN
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return UNKNOWN
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}
