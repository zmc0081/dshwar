/**
 * 用量看板的**转换层**:`UsageRecord[]` → `UsageScreenProps`。
 *
 * ## 这一屏与它的数据源不是同一个粒度 —— 差距要说出来,不能补上
 *
 * 契约的 `UsageRecord` 是 `@dshwar/metering` 的 `DailyUsageRow`,注释写得很明白:
 * **「按日 × 主体 × 模型」的聚合行**。而设计稿画的是一张「运行明细」表 ——
 * 它想要「运行次数」「单次均耗」,那是**按次**的量。
 *
 * 一条记录 ≠ 一次运行:一个人一天里跑十次同一个模型,落成的是**一行**。
 * ⇒ 于是 `runs` 这一列全部是 `'—'`。数记录条数会得到一个「看起来很像运行次数、
 * 而且量级也差不多」的数 —— 那正是本仓最贵的一种谎:管理员会拿它去对账,
 * 而它在业务上什么都不是。
 *
 * ## 屏上的字段 · 有没有来源 · 这里怎么做
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | `summary.tokens` | ✅ ∑`inputTokens` + ∑`outputTokens` | 千分位;附注拆出输入 / 输出两段 |
 * | 附注里的「上周期 / 环比」 | ❌ | **不写**。`api.usage()` 不带账期参数,取不到另一个账期的数 |
 * | `summary.cost` | ✅ ∑`cost.amountMinor` | 按 `cost.currencyExponent` 换算并带币种代码;**有算不出来的行就显示 `'—'`** |
 * | `summary.runs` | ❌ | `'—'`,附注说明为什么 |
 * | `summary.perRun` | ❌(它 = 消耗 ÷ 运行次数) | `'—'` —— 被除数缺了,商就不存在 |
 * | `rows.key` | ✅ | 模型维度取 `provider/model`,租户维度取 `tenantId` |
 * | `rows.runs` | ❌ | `'—'`,同上 |
 * | `rows.share` | ✅ | 合计为 0 时 `'—'`,不写 `0.0%`(见下) |
 * | `rows.cost` | ✅ | **整数**算完再拼小数点,不进浮点;这一组里有一格算不出来就整组 `'—'` |
 * | `trend` | ✅ 按 `date` × 维度键聚合 | 某天某维度没有记录 = 那天真的是 0,填 0 |
 * | `currency` | ✅ | 混币**抛**,不求和;一行都没算出钱来时是 `null`(没有金额就没有币种) |
 * | `range` / `rangeOptions` | ⚠️ 只有「这批数据实际覆盖的日期范围」 | 单选项 = 实际范围;不列做不到的「近 7 天」 |
 * | `tenant` / `tenantOptions` | ✅ 数据里的 distinct | 过滤**真的生效**(在这一层做) |
 * | `period`(空态里写作「计费周期」) | ❌ | `'—'`,见下「⚠️ 账期」 |
 * | `requestId` | ⚠️ 契约里有,`ConsoleApi.usage()` 丢掉了 | 由宿主传;今天只能是 `null` |
 * | 维度「部门」 | ❌ | **抛**,见下 |
 *
 * ## ⚠️ 账期:`period` 传 `'—'`,而真实的日期范围放进「时间范围」
 *
 * 空态那句 hint 写的是「计费周期 {period}」。而我们手里只有**这批记录覆盖了哪些天**
 * —— 那不是账期:一个 8 月账期若 1–5 号没人用,数据的第一天是 6 号。
 * 把 `2026-08-06 至 2026-08-27` 挂在「计费周期」后面,读的人会得出
 * 「这个账期到 27 号为止」的结论,而他正拿着它对账。
 *
 * ⇒ 同一个事实**换一个名实相符的位置说**:它作为「时间范围」下拉的当前值出现,
 * 那个标签说的正好就是它的含义。事实保住了,错误的标签没有被喂数。
 *
 * ## ✅ 换算比例已经有来源了(V0.9.0 Session 5.5)
 *
 * 这里曾经写死 `÷ 100`,理由是契约注释说「以最小货币单位计(**分**)」。
 * 而 ISO 4217 的指数**不都是 2**:JPY 是 0(1 円 = 1 minor unit),KWD 是 3 ——
 * 真收到 JPY 的行,那一版会把 100 円显示成 `1.00`。
 *
 * ⚠️ 同一时期 `view/overview.ts` 自带了一张 11 条的币种表,于是**同一个前端里
 * 有两个事实源**,对 JPY 的答案已经不一样。
 *
 * ⇒ 指数现在随金额一起从契约来(`cost.currencyExponent`),
 * 而服务端的指数与它的价格出自同一段配置 —— 不存在分家的路径。
 * 那张表已删除,`check-guards.mjs` 有一条守卫钉住「谁也不许再自带一张」。
 *
 * ## ⚠️ 「部门」维度没有数据来源 —— 认出来就抛
 *
 * `UsageRecord` 里只有 `subjectId` / `tenantId` / `provider` / `model`,
 * **没有部门**。部门归属要么来自 SCIM 的身份镜像,要么来自租户侧的映射,
 * 两者今天都不在这个端点里。
 *
 * 三条路只有一条是诚实的:
 *
 * | 做法 | 后果 |
 * | --- | --- |
 * | 拿 `subjectId` 的某段当部门 | 编的,而且看起来像真的 |
 * | 返回零行 | 界面说「这个周期还没有用量」—— 数据就在手里,这是**说了个假话** |
 * | **抛** | 界面停下,人看得见 |
 *
 * ⇒ {@link toUsageProps} 在 `dimension === 'department'` 时抛。
 * 宿主可以读 {@link USAGE_DIMENSIONS_WITH_SOURCE} 来避开它。
 *
 * ⚠️ 但下拉框今天仍然列着三档 —— `UsageScreen` 把 `USAGE_DIMENSIONS` 写死在自己
 * 内部,宿主删不掉那一项。**这是设计系统那边的一处待修**(选项该是 prop),
 * 记在这里而不是在这一层用一个静默的降级把它盖住。
 *
 * @module @dshwar/console-web/view/usage
 */
import { readCost, type Cost } from '@dshwar/metering'
import type { UsageChartGroup } from '@dshwar/design-system/screens/console/UsageChart'
import type {
  UsageBarDensity,
  UsageDimension,
  UsageRow,
  UsageScreenProps,
  UsageSummary,
} from '@dshwar/design-system/screens/console/UsageScreen'
import type { UsageRecord } from '../api.ts'

/**
 * 取不到时的占位。
 *
 * ⚠️ 与 `0` 严格分开:`'0'` 是「这一格真的是零」,`'—'` 是「这一格没有来源」。
 * 合成一个之后,读的人无从知道自己看的是事实还是空白 —— 而两者的行动完全不同
 * (前者去查为什么没消耗,后者去查为什么没数据)。
 */
const NOT_AVAILABLE = '—'

/** 租户筛选里的「不过滤」档。它不是一个租户 id,所以要有名字,不能靠空串。 */
export const ALL_TENANTS = '全部租户'

/**
 * 有数据来源的分组维度。
 *
 * 宿主可以拿它去决定下拉里显示哪几档 —— 而不是等用户点到「部门」再吃一个异常。
 * ⚠️ 今天 `UsageScreen` 的下拉不吃这个清单(选项写死在屏幕内部),见模块注释。
 */
export const USAGE_DIMENSIONS_WITH_SOURCE: readonly UsageDimension[] = ['model', 'tenant']

/**
 * 界面状态的**初值**,不是兜底默认值。
 *
 * 区别在什么时候生效:兜底在**漏传时**悄悄生效,于是漏传不会有任何症状;
 * 初值必须被宿主显式取用一次,漏传是编译错误。
 * ⇒ {@link UsageViewInput} 的四个状态字段全部必填。
 */
export const INITIAL_USAGE_VIEW_STATE: {
  readonly dimension: UsageDimension
  readonly tenant: string
  readonly seriesLimit: number
  readonly barDensity: UsageBarDensity
} = { dimension: 'model', tenant: ALL_TENANTS, seriesLimit: 6, barDensity: 'regular' }

/**
 * 「这一格不计费」的显示串。
 *
 * ⚠️ **它是一个词,不是一个数。** 显示 `0.00` 会让「部署方不收这笔钱」
 * 与「这笔钱是零」长得一样,而后者在账面上是一句更强的话。
 */
const UNBILLED = '不计费'

/**
 * 某天某维度**没有记录**时,趋势图那一格填什么。
 *
 * ⚠️ 这个 `0` 看起来像被禁的那种「服务端数字的兜底默认」,它不是。
 * 判据是**缺的是什么**:`memberCount ?? 0` 兜掉的是一个**存在却没取到**的事实;
 * 这里缺的是一条记录,而这张表在账期内是完备的 —— 没有记录的含义就是
 * 那天那个维度**没有消耗**。0 在这里是读得出来的事实,不是占位。
 *
 * ⇒ 反过来也不能传「缺值」:`UsageChart` 收到短的 `values` 会抛,而它抛得对 ——
 * 少画一根柱子在图上读起来正好是 0,两者不能靠肉眼分辨。
 */
const NO_RECORD_MEANS_ZERO = 0

/** ISO 8601 日期(`YYYY-MM-DD`)。契约声明的是 `z.iso.date()`。 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 字典序比较。
 *
 * 与 `MeteringStore.query` 的定序口径同款(UTF-16 码元序),理由也一样:
 * **两处只有用同一种比较才可能给出同一个顺序**。`localeCompare` 依赖 ICU 与
 * 语言环境,同一份数据在两台机器上能排出两种顺序,而那种差异没有任何东西会报。
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 千分位。
 *
 * ⚠️ 刻意不用 `toLocaleString('en-US')`:那个 locale 是猜的(这是一个中文控制台),
 * 而它「恰好」与 zh-CN 的分组规则相同 —— **恰好相同不是理由**,是一个等着某天
 * 换 locale 时才显形的假设。手写分组没有语言环境依赖,两台机器上逐字符一致。
 *
 * @param value 整数。非有限数是调用方拼错了(token 数来自契约的 `int().min(0)`),抛。
 */
export function groupDigits(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`千分位只接受有限数,收到 ${value} —— 上游给了一个非数,先查那里`)
  }
  const negative = value < 0
  const grouped = Math.abs(Math.trunc(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? `-${grouped}` : grouped
}

/**
 * 最小货币单位(分)→ 给人读的金额串,如 `1840275160` → `'18,402,751.60'`。
 *
 * ⚠️ **全程整数运算**,不走 `minor / 100` 的浮点:分是整数,而 `.toFixed(2)`
 * 在大数上依赖二进制浮点的舍入 —— 一个会在某个数量级上差一分的账目,
 * 比一个明显算错的账目更难被发现。
 *
 * ⚠️ 不带币种符号:符号 / 代码由调用点决定(表头带一次,指标卡各带一次),
 * 在这里拼死会让明细表的每一格都重复一遍币种。
 *
 * ## 🚨 指数**由契约给**,这里不认识任何币种
 *
 * 换算比例曾经写死 100,而 ISO 4217 的指数不都是 2:JPY 是 0(1 円 = 1 minor),
 * KWD 是 3。写死 100 的话,100 円会显示成 `1.00` —— 一个**看起来完全正常**的错数。
 *
 * ⚠️ 修法**不是**在这里放一张币种表:那是第二个事实源,与服务端的计价口径
 * 迟早分家,而分家的表现同样是账目差 100 倍,只是那时没人知道该信哪一边。
 * 指数与金额一起从 `cost` 里来,而服务端的指数与它的价格出自同一段配置。
 *
 * @param currencyExponent 契约给的指数。`0` → 没有小数部分(整数直接显示)
 * @throws 非整数或负数金额 —— 契约声明的是 `int().min(0)`,两者都意味着上游违约,
 *   而负数在这里会被 `%` 与 `trunc` 拆成 `-1.-50` 这种读不出来的串。
 * @throws 指数不在 0–4 —— 那是契约声明的范围,越界意味着上游违约
 */
export function formatMinorUnits(minorUnits: number, currencyExponent: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) {
    throw new RangeError(
      `成本必须是最小货币单位的非负整数,收到 ${minorUnits} —— 契约声明 amountMinor 是 int().min(0)`,
    )
  }
  if (!Number.isInteger(currencyExponent) || currencyExponent < 0 || currencyExponent > 4) {
    throw new RangeError(
      `币种指数必须是 0–4 的整数,收到 ${currencyExponent} —— 契约声明 currencyExponent 是 int().min(0).max(4)。\n` +
        '⚠️ 不要在这里回落到 2:那正是这个字段存在的原因(JPY 是 0,KWD 是 3)。',
    )
  }
  const divisor = 10 ** currencyExponent
  const major = Math.trunc(minorUnits / divisor)
  // 指数 0 的币种没有小数部分 —— 给日元补一个 `.00` 是在编一个不存在的精度。
  if (currencyExponent === 0) return groupDigits(major)
  const minor = minorUnits % divisor
  return `${groupDigits(major)}.${String(minor).padStart(currencyExponent, '0')}`
}

/**
 * 一批成本的汇总 —— **三种情况分开数**,不合并成一个金额。
 *
 * 这是本文件对「语义折叠」那个洞的落点:`unpriced`(算不出来)与
 * `unbilled`(不收费)各有一个计数,于是「合计能不能算」这件事**有答案**,
 * 而不是靠一个 0 蒙混过去。
 */
export interface CostRollup {
  /** 已算出来的那部分之和(最小货币单位)。 */
  readonly minor: number
  /** 有几格是算出来的。 */
  readonly priced: number
  /** 有几格**算不出来**(模型没配价)。> 0 时合计不成立。 */
  readonly unpriced: number
  /** 有几格是**不收费**的。它们对合计的贡献是真的 0。 */
  readonly unbilled: number
  /** 币种;没有任何 `priced` 时为 `null`。 */
  readonly currency: string | null
  /** 指数;没有任何 `priced` 时为 `null`。 */
  readonly currencyExponent: number | null
}

/**
 * 汇总一批成本。
 *
 * @throws 混币,或同一币种给了两个不同的指数。后者尤其要抛:
 *   那意味着服务端中途改过计价配置,而两段数据的金额**不在同一个刻度上** ——
 *   相加得到的数没有意义,却与正常的数长得一模一样。
 */
export function rollupCost(costs: readonly Cost[]): CostRollup {
  let minor = 0
  let priced = 0
  let unpriced = 0
  let unbilled = 0
  const currencies = new Set<string>()
  const exponents = new Set<number>()

  for (const cost of costs) {
    switch (cost.kind) {
      case 'priced':
        minor += cost.amountMinor
        priced += 1
        currencies.add(cost.currency)
        exponents.add(cost.currencyExponent)
        break
      case 'unpriced':
        unpriced += 1
        break
      case 'unbilled':
        unbilled += 1
        break
    }
  }

  if (currencies.size > 1) {
    throw new Error(
      `这批用量记录里有 ${currencies.size} 种货币(${[...currencies].sort(byCodeUnit).join(' / ')})——\n` +
        '混币求和得到的数没有意义,而它看起来和别的数一样正常。\n' +
        '请按币种分开取数再分别渲染,不要在这里挑一个当代表。',
    )
  }
  if (exponents.size > 1) {
    throw new Error(
      `同一种货币给了 ${exponents.size} 个不同的指数(${[...exponents].sort((a, b) => a - b).join(' / ')})——\n` +
        '两段数据的金额不在同一个刻度上,相加得到的数没有意义。\n' +
        '这通常意味着服务端中途改过 governance.pricing 的 currencyExponent。',
    )
  }

  return {
    minor,
    priced,
    unpriced,
    unbilled,
    currency: [...currencies][0] ?? null,
    currencyExponent: [...exponents][0] ?? null,
  }
}

/**
 * 一批成本该显示成什么。
 *
 * | 情况 | 显示 | 为什么 |
 * | --- | --- | --- |
 * | 有算不出来的 | `'—'` | **合计不成立**。给一个「只算了一部分」的数是最糟的:它看起来是全部 |
 * | 全部不计费 | `'不计费'` | 一个词,不是 `0.00` |
 * | 一格都没有 | `'—'` | 没有数据不是 0 |
 * | 其余 | 金额 | 按契约给的指数换算 |
 *
 * ⚠️ 第一行是这个 Session 的核心:宁可显示 `'—'`,也不给一个**看起来像钱**的数。
 * 与 `billing-local` 遇到没配价的模型时拒绝出票是同一条纪律。
 */
export function formatCost(rollup: CostRollup): string {
  if (rollup.unpriced > 0) return NOT_AVAILABLE
  if (rollup.priced === 0) return rollup.unbilled > 0 ? UNBILLED : NOT_AVAILABLE
  // priced > 0 时 currencyExponent 必然非空(它们在同一个分支里被写入)——
  // 但 `noUncheckedIndexedAccess` 与可空类型下要显式收窄,不用断言。
  const exponent = rollup.currencyExponent
  if (exponent === null) throw new Error('不可达:有 priced 却没有指数')
  return formatMinorUnits(rollup.minor, exponent)
}

/**
 * 占比,如 `'46.2%'`。
 *
 * ⚠️ `total === 0` 给 `'—'` 而不是 `'0.0%'`:0/0 没有值,而 `0.0%` 是一个
 * **断言**(「这一组一点都没占」)。全体合计为 0 时每一组都是 0,
 * 那时正确的说法是「占比无从谈起」。与 `median([])` 返 NaN 同族 ——
 * 退化输入让计算失去意义,而失去意义的那一刻不该长得像一个正常结果。
 */
export function formatShare(part: number, total: number): string {
  if (total === 0) return NOT_AVAILABLE
  return `${(Math.round((part / total) * 1000) / 10).toFixed(1)}%`
}

/**
 * 「这一维没有数据来源」的那个错误。**一处措辞,两个抛点共用。**
 *
 * 两个抛点各有各的职责,不是重复:{@link dimensionKey} 守的是逐条记录的转换,
 * {@link toUsageProps} 入口那一处守的是**记录一条都没有**的情况(见那里的注释)。
 */
function noSourceFor(dimension: UsageDimension): Error {
  return new Error(
    `按「${dimension}」分组没有数据来源 —— UsageRecord 只带 subjectId / tenantId / provider / model。\n` +
      '(今天唯一这样的维度是「部门」:部门归属来自 SCIM 身份镜像或租户侧映射,两者都不在 /v1/admin/usage 里。)\n' +
      '拿 subjectId 拆一段当部门是在编;返回零行等于告诉管理员「这个周期没有用量」,而数据就在手里。\n' +
      '请先让契约把这一维带上,或用 USAGE_DIMENSIONS_WITH_SOURCE 避开它。',
  )
}

/**
 * 一条记录落在哪个维度键上。
 *
 * ⚠️ 模型维度用 **`provider/model`** 而不是裸 `model`:`@dshwar/metering` 的
 * 价格表键就是 `provider/model` —— 两个 provider 下的同名模型是**两个单价**,
 * 合成一行会把两笔不同单价的账加在一起,而那一行看起来完全正常。
 *
 * @throws 「部门」维度没有来源(见模块注释);以及契约新增维度时的穷尽性兜底。
 */
export function dimensionKey(record: UsageRecord, dimension: UsageDimension): string {
  switch (dimension) {
    case 'model':
      return `${record.provider}/${record.model}`
    case 'tenant':
      return record.tenantId
    case 'department':
      throw noSourceFor(dimension)
    default: {
      // 穷尽性检查:设计系统给 UsageDimension 加档时**这里编译不过**,
      // 而不是运行时退化成「模型」—— 后者会让新维度悄悄显示成另一个维度的数据。
      const never: never = dimension
      throw new Error(`认不出的分组维度:${String(never)}`)
    }
  }
}

/** 一个维度键上的累计。中间形态,不出这个模块。 */
interface Aggregate {
  readonly key: string
  inputTokens: number
  outputTokens: number
  /**
   * 这一组里每一格的成本,**原样收着**。
   *
   * ⚠️ 不在这里边加边求和:一旦加成一个 number,「其中三格算不出来」这件事
   * 就没地方放了 —— 那正是这个字段原来的形状,也正是本 Session 要拆的东西。
   */
  costs: Cost[]
}

function totalTokensOf(a: Aggregate): number {
  return a.inputTokens + a.outputTokens
}

/**
 * 校验并原样返回日期。
 *
 * ⚠️ 这不是形式主义:下面的排序与 X 轴标签**都建立在「字典序 = 时间序」上**,
 * 而那条等式只对定长的 `YYYY-MM-DD` 成立。收到 `2026-8-1` 时,排序会把它排到
 * `2026-12-31` 后面,标签会切出 `-1`,而两处都不会报错。
 *
 * ⚠️ 全程不碰 `new Date(date)`:它把裸日期按 **UTC** 解析,再按本地时区显示 ——
 * 东八区看到的 `2026-08-01` 会变成 `07-31`。整整一天的用量记到前一天,
 * 而屏幕上看起来完全正常。
 */
function assertIsoDate(date: string): string {
  if (!ISO_DATE.test(date)) {
    throw new RangeError(
      `用量记录的日期不是 YYYY-MM-DD:"${date}" —— 本屏的排序与标签都依赖定长 ISO 日期`,
    )
  }
  return date
}

/**
 * 这批记录覆盖的日期范围,如 `'2026-08-01 至 2026-08-31'`。
 *
 * ⚠️ 它**不是账期**(见模块注释)。只有一天时直接给那一天 ——
 * `'2026-08-01 至 2026-08-01'` 读起来像出了什么错。
 */
export function dataRangeOf(records: readonly UsageRecord[]): string {
  let min: string | undefined
  let max: string | undefined
  for (const record of records) {
    const date = assertIsoDate(record.date)
    if (min === undefined || date < min) min = date
    if (max === undefined || date > max) max = date
  }
  if (min === undefined || max === undefined) return NOT_AVAILABLE
  return min === max ? min : `${min} 至 ${max}`
}

/**
 * 这批记录的币种 —— **只看算出了钱的那些行**。
 *
 * ⚠️ 返回 `null` 而不是 `'—'`:没有任何一行算出钱来时,这批数据**没有币种**,
 * 而不是「币种是一个横杠」。表头据此显示成「成本」而不是「成本 (—)」。
 *
 * ⚠️ 一把 Admin Key 只覆盖一个租户、一个部署的价格表只有一个 `currency`,
 * 所以混币在今天意味着**中途改过计价配置** —— 那正是该有人看一眼的时候,
 * 于是它由 {@link rollupCost} 抛出,不在这里挑一个当代表。
 */
export function currencyOf(records: readonly UsageRecord[]): string | null {
  return rollupCost(records.map((r) => readCost(r.cost))).currency
}

/**
 * 成本指标卡的**值**。带币种代码,或者一个说明性的词。
 *
 * 与 {@link formatCost} 的分工:那个出的是纯金额串(表格里每格都带币种会很吵),
 * 这里是指标卡,币种要露出来。
 */
function costMetricValue(rollup: CostRollup): string {
  const formatted = formatCost(rollup)
  // ⚠️ 判据是「**这个串是不是一个金额**」,不是「有没有 priced 的行」。
  //   按后者写会拼出 `CNY —` —— 一个既说了币种、又说算不出来的串。
  //   (这不是假想:本文件第一版就是那么写的,由 test/cost.test.ts 当场抓到。)
  const isAmount = rollup.unpriced === 0 && rollup.priced > 0 && rollup.currency !== null
  return isAmount ? `${rollup.currency} ${formatted}` : formatted
}

/**
 * 成本指标卡的**附注** —— 「为什么这一格不是一个数」要说出来。
 *
 * ⚠️ 一个光秃秃的 `'—'` 会被读成「系统没算」,而真相是「有几行算不出来」,
 * 那是一句**可以行动**的话:去把那些模型配上价。
 */
function costMetricNote(rollup: CostRollup, recordCount: number): string {
  const scope = `${groupDigits(recordCount)} 条日聚合记录`
  if (rollup.unpriced > 0) {
    return `有 ${groupDigits(rollup.unpriced)} 格没配价,合计算不出来 · ${scope}`
  }
  if (rollup.priced === 0 && rollup.unbilled > 0) {
    return `这些模型部署方声明了不计费 · ${scope}`
  }
  return `估算 · ${scope}`
}

/** 宿主传进来的东西:一批记录 + 四个界面状态 + 若干回调。 */
export interface UsageViewInput {
  /** `api.usage()` 的返回。**不做分页拼接** —— 那是宿主的事。 */
  readonly records: readonly UsageRecord[]

  /**
   * 当前分组维度。
   *
   * ⚠️ `'department'` 会抛(没有来源,见模块注释)。
   */
  readonly dimension: UsageDimension
  /**
   * 租户筛选的当前值。{@link ALL_TENANTS} = 不过滤。
   *
   * ⚠️ 过滤**在这一层真的执行**,不是摆设 —— 屏幕上的下拉换了值,表格就该跟着变。
   * 一个选了不生效的筛选器,比一个禁用的筛选器更糟(沉默的拒绝 vs 说出来的拒绝)。
   */
  readonly tenant: string
  /** 趋势图画前几条序列。界面状态,由宿主持有。 */
  readonly seriesLimit: number
  /** 柱宽档。界面状态,由宿主持有。 */
  readonly barDensity: UsageBarDensity

  /**
   * 这批数字来自哪次请求。
   *
   * ⚠️ **今天只能传 `null`。** 契约的 `ListUsageResponse` 是带 `requestId` 的,
   * 而 `ConsoleApi.usage()` 只取了 `.data` —— 那个 id 在 `api.ts` 里就被丢了。
   * 想让页脚显示它,修法是放宽 `ConsoleApi.usage()` 的返回,
   * **不是**在这里生成一个 —— 一个服务端日志里查不到的 id 是伪造的凭据。
   */
  readonly requestId: string | null

  readonly onDimensionChange?: (next: UsageDimension) => void
  readonly onTenantChange?: (next: string) => void
  readonly onSeriesLimitChange?: (next: number) => void
  readonly onBarDensityChange?: (next: UsageBarDensity) => void
  readonly onDrillDown?: (id: string) => void
  readonly onExportCsv?: () => void
  readonly onBillingPreview?: () => void
}

/**
 * `UsageRecord[]` → 整屏的 props。
 *
 * @throws 维度是「部门」· 混币 · 日期不是 ISO —— 三者都是「继续画下去就会显示
 *   一个错的数」,在这里停下比在屏幕上悄悄错掉好。
 */
export function toUsageProps(input: UsageViewInput): UsageScreenProps {
  const { records } = input

  // ★ 维度有没有来源在**进入循环之前**判,不指望 dimensionKey 在循环里替我们抛。
  //
  // ⚠️ 判据必须在入口,因为那个循环可能跑**零次**:租户筛选把记录全滤掉之后
  //   (或者这个租户本来就没有用量),「部门」维度一条记录都不过 ——
  //   于是那个 throw 一次都不执行,屏幕安静地画出「这个周期还没有用量」。
  //   而那句话正是这一维不能返回零行的理由:它是**假的**,数据只是分不出组。
  //
  //   与 CLAUDE.md 那条「遍历零个元素的循环等于没有断言」同形:
  //   判据写在循环体里,零次时它与「判过且通过」在输出上一模一样。
  if (!USAGE_DIMENSIONS_WITH_SOURCE.includes(input.dimension)) throw noSourceFor(input.dimension)

  // ⚠️ 租户选项从**全量**记录里取,不是从过滤后的取。从过滤后的取的话,
  //   选中某个租户之后下拉里就只剩它自己 —— 用户再也切不回去。
  const tenantOptions = [
    ALL_TENANTS,
    ...[...new Set(records.map((r) => r.tenantId))].sort(byCodeUnit),
  ]

  const visible =
    input.tenant === ALL_TENANTS ? records : records.filter((r) => r.tenantId === input.tenant)

  // 币种在**过滤后**判:两个租户各用各的币种时,分开看每一个都是自洽的,
  // 而合起来看才是混币。反过来在过滤前判会把一个本可以正常显示的租户也拦下。
  const currency = currencyOf(visible)

  // ---- 按维度键聚合 ----
  const byKey = new Map<string, Aggregate>()
  for (const record of visible) {
    const key = dimensionKey(record, input.dimension)
    const found = byKey.get(key)
    const aggregate = found ?? { key, inputTokens: 0, outputTokens: 0, costs: [] }
    aggregate.inputTokens += record.inputTokens
    aggregate.outputTokens += record.outputTokens
    // ★ 唯一入口:线上是扁平形状,非法组合在这里抛,不猜。
    aggregate.costs.push(readCost(record.cost))
    if (found === undefined) byKey.set(key, aggregate)
  }

  // 消耗多的排前面;同分按键名排。**同分的兜底比较不能省** ——
  // 少了它,两个消耗相同的模型的先后取决于服务端这次的返回顺序,
  // 于是刷新一次表格就换一次序,而没有任何东西变了。
  const aggregates = [...byKey.values()].sort(
    (a, b) => totalTokensOf(b) - totalTokensOf(a) || byCodeUnit(a.key, b.key),
  )

  const totalInput = aggregates.reduce((sum, a) => sum + a.inputTokens, 0)
  const totalOutput = aggregates.reduce((sum, a) => sum + a.outputTokens, 0)
  const totalCost = rollupCost(aggregates.flatMap((a) => a.costs))
  const totalTokens = totalInput + totalOutput

  const rows: UsageRow[] = aggregates.map((a) => ({
    // ⚠️ id 就是维度键本身 —— 它在这一屏内唯一(聚合的键就是它),
    //   而且是一个**拿得去查**的标识。编一个 `row_1` 会让下钻回调收到一个
    //   除了这次渲染之外什么都对不上的串。
    id: a.key,
    key: a.key,
    // ⚠️ 见模块注释:一条记录是「日 × 主体 × 模型」的聚合,不是一次运行。
    runs: NOT_AVAILABLE,
    inputTokens: groupDigits(a.inputTokens),
    outputTokens: groupDigits(a.outputTokens),
    totalTokens: groupDigits(totalTokensOf(a)),
    share: formatShare(totalTokensOf(a), totalTokens),
    // 这一组里只要有一格算不出来,整组的合计就不成立 —— 显示 '—' 而不是
    // 「已算出来的那部分」。后者最糟:它看起来是全部。
    cost: formatCost(rollupCost(a.costs)),
  }))

  // ---- 趋势:X 轴 = 日期,序列 = 维度键(与表格同序)----
  const dates = [...new Set(visible.map((r) => assertIsoDate(r.date)))].sort(byCodeUnit)
  // 同一年时标签收成 `MM-DD`(X 轴上二三十个刻度,年份重复二三十遍);
  // 跨年时留全 —— 那时 `08-01` 到底是哪一年是读图的关键信息。
  const sameYear = new Set(dates.map((d) => d.slice(0, 4))).size <= 1

  // 键用 NUL 分隔:模型名与租户 id 里可能出现 `|` `/` `-`,而 NUL 不会。
  // 用一个可能出现在数据里的分隔符,后果是两个不同的格子悄悄合成一格。
  const byDateKey = new Map<string, number>()
  for (const record of visible) {
    const cell = `${record.date}\u0000${dimensionKey(record, input.dimension)}`
    byDateKey.set(cell, (byDateKey.get(cell) ?? 0) + record.inputTokens + record.outputTokens)
  }

  const series = aggregates.map((a) => a.key)
  const trend: UsageChartGroup[] = dates.map((date) => ({
    label: sameYear ? date.slice(5) : date,
    // ⚠️ 每个序列都要有值,**一个都不能少** —— 见 NO_RECORD_MEANS_ZERO。
    values: series.map((key) => byDateKey.get(`${date}\u0000${key}`) ?? NO_RECORD_MEANS_ZERO),
  }))

  // ⚠️ **一条记录都没有时,合计不是 0,是「不知道」。**
  //   与文件顶上 NOT_AVAILABLE 那条是同一个判据:`0` 断言「这个周期没消耗」,
  //   而事实只是「这批数据里没有行」—— 那可能是筛选筛空的,也可能是还没同步过来。
  //   反过来「有记录、但 token 全是 0」是**真的 0**,照常显示 0。
  //
  //   这两种今天都会走空态(空态由 `rows.length === 0` 推出),卡片根本不渲染。
  //   仍然写对它,是因为「哪些字段在空态下不渲染」是**屏幕的实现细节** ——
  //   把正确性押在别人的渲染分支上,等于给自己留一个改一行就会显形的错。
  const hasData = visible.length > 0

  const summary: UsageSummary = {
    tokens: {
      value: hasData ? groupDigits(totalTokens) : NOT_AVAILABLE,
      // 「上周期 / 环比」不在这里 —— 没有第二个账期的数(见模块注释)。
      note: hasData
        ? `tok · 输入 ${groupDigits(totalInput)} · 输出 ${groupDigits(totalOutput)}`
        : '',
    },
    cost: {
      // 币种用契约给的三字母代码,**不映射成 ¥ / $**:一张自带的映射表是第二个
      // 事实源,而它对没收录的币种要么崩、要么标错一个看起来很正常的符号。
      //
      // 🚨 有算不出来的行时,这一格是 '—' 而不是「已算出来的那部分」——
      //    后者是一个**看起来是全部**的数,而它少了几行谁也不知道。
      value: hasData ? costMetricValue(totalCost) : NOT_AVAILABLE,
      note: hasData ? costMetricNote(totalCost, visible.length) : '',
    },
    // ⚠️ 两个 '—' 是刻意留白。填上会让人以为运行级记账已经能用了 ——
    //   而它要等 /v1/jobs 那一层的按次记录。
    runs: { value: NOT_AVAILABLE, note: '按日聚合,数不出运行次数' },
    perRun: { value: NOT_AVAILABLE, note: '没有运行次数,除不出均值' },
  }

  // 「时间范围」= 这批数据实际覆盖的日期范围,**只有一个选项**。
  // ⚠️ `/v1/admin/usage` 今天不接受范围参数 —— 列出「近 7 天 / 近 30 天」
  //   等于给用户几个点了不算数的选项,而被吞掉的操作比禁用的控件更糟。
  //   于是也不接 `onRangeChange`:一个永远不会有第二个值的选择器不需要回调。
  const range = dataRangeOf(records)

  return {
    dimension: input.dimension,
    summary,
    trend,
    series,
    seriesLimit: input.seriesLimit,
    barDensity: input.barDensity,
    rows,
    currency,
    range,
    rangeOptions: [range],
    tenant: input.tenant,
    tenantOptions,
    // ⚠️ 账期没有来源 —— 真实的日期范围在上面的「时间范围」里,那个标签才对得上。
    period: NOT_AVAILABLE,
    requestId: input.requestId,
    // `exactOptionalPropertyTypes` 下不能把 undefined 赋给可选属性 ——
    // 没传的回调要**整个键不出现**,而不是出现一个值为 undefined 的键。
    ...(input.onDimensionChange === undefined
      ? {}
      : { onDimensionChange: input.onDimensionChange }),
    ...(input.onTenantChange === undefined ? {} : { onTenantChange: input.onTenantChange }),
    ...(input.onSeriesLimitChange === undefined
      ? {}
      : { onSeriesLimitChange: input.onSeriesLimitChange }),
    ...(input.onBarDensityChange === undefined
      ? {}
      : { onBarDensityChange: input.onBarDensityChange }),
    ...(input.onDrillDown === undefined ? {} : { onDrillDown: input.onDrillDown }),
    ...(input.onExportCsv === undefined ? {} : { onExportCsv: input.onExportCsv }),
    ...(input.onBillingPreview === undefined ? {} : { onBillingPreview: input.onBillingPreview }),
  }
}
