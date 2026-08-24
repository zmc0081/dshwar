/**
 * 总览屏的**转换层**:`ConsoleCapacity` + `UsageRecord[]` + `Subject[]` → `OverviewScreenProps`。
 *
 * ## 结论先说:这一屏大半的字段在 Admin 面**没有来源**
 *
 * `OverviewScreen` 画的是一个**运营方看多个租户**的面板:计费周期、活跃租户数、
 * Agent 运行次数、租户表、平台 token 容量。而 `/v1/admin/*` 今天能给的是
 * **一个租户内部**的用量明细、成员镜像与进程容量。
 *
 * 两者的落差不是「还没接」,是**这一面看不到那些东西**:
 *
 * > Admin API Key **按租户签发,一把钥匙不得横跨租户**(CLAUDE.md 第七节)。
 *
 * ⇒ 拿这把钥匙问「平台上有几个租户」,答案在结构上就取不到 ——
 * 无论 `Subject[]` 里出现多少个 `tenantId`,那都只是**这一把钥匙看得见的那部分**。
 * 跨租户的清单属于控制平面(`dshwar-console`,M4),不属于运行时 Admin API。
 *
 * ## 屏上的字段 · 有来源吗 · 这里怎么做
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | `period.start` / `period.end` | ❌ 计费周期是订阅概念,Admin 面没有 | 两端都是 `'—'`,**不写死日期**,见下 |
 * | `freshness` | ❌ 没有任何端点声明数据延迟口径 | `null` —— 副标题少说这一句 |
 * | `metrics.monthlyUsage.value` | ⚠️ 只有「所给记录的合计」 | `inputTokens + outputTokens` 求和,见「本月」那一节 |
 * | `metrics.monthlyUsage.note` | ❌ 没有租户级 token 额度 | `null` —— 附注整行不显示 |
 * | `metrics.activeTenants` | ❌ 租户清单取不到(见上) | `'—'` |
 * | `metrics.agentRuns` | ❌ 运行/作业级记录不存在(`/v1/jobs` 是 planned) | `'—'` |
 * | `metrics.estimatedBill` | ✅ `costMinorUnits` + `currency` | 单一币种才合计,见 {@link toEstimatedBill} |
 * | `degrade` | ❌ 没有降级**事件**流 | `null` —— 这一条根本不渲染 |
 * | `quota.used` | ✅ 与 `monthlyUsage` 同一个和 | 同上求和 |
 * | `quota.total` | ❌ 没有租户级 token 容量 | 🚨 哨兵 `0`,见 {@link toQuota} |
 * | `quota.target` | ❌ 没有「客户自设目标线」这个字段 | `null` —— 条上不画那根线 |
 * | `rows` | ❌ 每一列都缺来源,状态列尤其 | `[]`,见「租户表」那一节 |
 * | `selectedIndex` | — 这一屏没有「选中」语义 | `-1` = 不高亮 |
 * | `tenantTotal` | ❌ 同 `activeTenants` | `'—'`,**不是 `'0'`**,见下 |
 *
 * ## ⚠️ 计费周期:`'—'` 而不是一个像样的日期
 *
 * 契约里唯一带周期的是 `Quota.periodStart` / `periodEnd`,而它是**按主体**的
 * 配额周期 —— 「这个人的额度从哪天算到哪天」,不是「这张账单结的是哪个月」。
 * 两者今天可能恰好重合,而重合不是同一件事:改一次配额起算日,前者动、后者不动。
 *
 * 更别提从 `UsageRecord.date` 取 min/max —— 那是**返回了哪些行**,
 * 而 `/v1/admin/usage` 只有 `limit` / `cursor` / `sort`,**没有日期过滤**。
 * 把一页数据的首尾两天说成计费周期,是拿分页参数冒充商业契约。
 *
 * ⇒ 两端都留 `'—'`。副标题于是读作「计费周期 — 至 —」——
 * 难看,但它说的是真话:**这一面不知道账期**。
 *
 * ## ⚠️ 「本月消耗」这个标签,与我们能求的和并不严格相等
 *
 * 标签「本月消耗」写在组件里(那是设计文案,不是数据)。而 `/v1/admin/usage`
 * 没有日期过滤 —— 传进来的是**调用方取到的那些行**,可能是一页,也可能是全部。
 *
 * 这里不替调用方裁剪:按 `date` 过滤「当月」要先定义月首,而月首正是上面
 * 那个取不到的账期。裁一刀等于**发明一个周期边界**,比不裁更糟。
 *
 * ⇒ 求和求的是「给进来的这些记录」,而屏上的账期是 `'—'` ——
 * 两处凑在一起至少不自相矛盾:没有一个假日期去坐实「本月」这两个字。
 * **调用方有义务只把该屏周期内的记录传进来。**
 *
 * ## ⚠️ 空数组不是「取不到」,所以合计为 0 时如实显示 0
 *
 * `usage: []` 是一次**成功返回的空列表** —— 计量记录是可加的事实,
 * 没有记录就是没有用量。取不到的情形(请求失败)根本不会走到这个函数:
 * 那时调用方渲染的是错误态。
 *
 * ⇒ 合计 0 显示 `'0'`,不显示 `'—'`。这与「0 字节文件 vs 读不到大小」是同一族区分,
 * 结论方向相反 —— 因为这里的 0 有确定含义。
 *
 * ## ⚠️ 租户表:`[]`,因为**状态列没有任何诚实的取值**
 *
 * 假设放宽一步,按 `tenantId` 把 `UsageRecord[]` 聚起来当行:
 *
 * | 列 | 拿什么填 |
 * | --- | --- |
 * | 租户名 | ❌ 只有 `tenantId`,没有名字 |
 * | 默认模型 | ❌ `Policy` 给的是 `allowedModels` / `fallbackModel`,都不是「默认」 |
 * | 本月用量 | ✅ 能聚 |
 * | 配额占比 | ❌ 没有租户级额度,分母不存在 |
 * | 状态 | 🚨 **闭集四档,没有一档为真** |
 *
 * `OverviewTenantStatus` 的四档(运行中 / 接近配额 / 已停用 / 待审批)**每一档都是一句断言**,
 * 而屏幕的类型注释明确禁止加「未知」档 —— 认不出的状态该在转换层停下来,
 * 不该在表里退化成一个含糊的灰标签。我们这里比「认不出」更彻底:**根本没有来源**。
 * 随便挑一档 = 对着每一个租户说一句我们不知道真假的话。
 *
 * ⇒ 一行都不给。这一屏因此显示朴素空态。
 *
 * 🚨 **空态的文案是错的,而它不归这个文件管。** `OverviewScreen` 的空态写着
 * 「还没有租户。创建第一个租户之后,它的用量会出现在这里。」——
 * 而真相是「这一面看不到租户清单」。两句话在界面上长得一样,
 * 含义相反:前者会让管理员以为自己的 24 个租户没了。
 * ⇒ 需要屏幕层区分「空」与「不可见」(多一个 `emptyReason`),本次只改这一个文件,记在这里。
 *
 * ## ⚠️ `tenantTotal` 传 `'—'`,刻意偏离屏幕注释里写的 `'0'`
 *
 * `OverviewScreenProps.tenantTotal` 的注释说:`rows` 为空就意味着一个租户都没有,
 * 那时应当传 `'0'`。**那个推理的前提在这一面不成立** ——
 * 我们的 `rows` 为空是因为**看不见**,不是因为**没有**。
 *
 * `'0'` 是一句计数断言(「全部 0 个」),`'—'` 是一句「不知道」。后者才是真的。
 * 「查看全部」按钮的禁用由 `rows.length === 0` 决定,不看这个串,所以不影响行为。
 *
 * ## ⚠️ 两个入参一个字段都没用上 —— 这是结论,不是遗漏
 *
 * | 入参 | 它能回答什么 | 为什么这一屏用不上 |
 * | --- | --- | --- |
 * | `capacity` | 进程上限 / 成员上限 / 每进程内存 | 「平台容量」卡问的是**本月 token 配额**,与进程内存不是一回事 —— 屏幕注释点名禁止硬套(那会造出一个既不是配额也不是容量的四不像) |
 * | `subjects` | 成员数、谁被停用、成员归属哪个租户 | 这一屏没有成员位;而按 `tenantId` 去数租户,数出来的是**这把钥匙看得见的那些**,不是平台上的租户数 |
 *
 * 它们留在签名里是**为了让这个结论在代码里有位置**:删掉参数,这段说明就没有落点,
 * 下一个人会重新推一遍,并且很可能推出「拿 memberCount 填活跃租户」。
 *
 * ## 这个模块**没有**闭集收窄,而那不是省掉了
 *
 * 本仓的纪律是:认不出的服务端枚举值必须在转换层**抛**,不得退化成某一档
 * (见 `view/capacity.ts` 的 `toIsolation`)。这里一个收窄都没有,
 * 因为唯一需要收窄的地方(租户状态)**连来源都没有**。
 * ⇒ `rows` 将来接上真实来源时,配套的 `toTenantStatus` 必须是抛错式的,
 * 不要顺手写一个 `default: return 'running'`。
 *
 * @module @dshwar/console-web/view/overview
 */
import type { ConsoleCapacity } from '@dshwar/console-contract'
import type {
  OverviewMetric,
  OverviewQuota,
  OverviewScreenProps,
  OverviewTenantRow,
} from '@dshwar/design-system/screens/console/OverviewScreen'
import type { Subject, UsageRecord } from '../api.ts'

/**
 * 「这一格没有来源」的占位。
 *
 * ⚠️ 与 `null` 不是一回事:这一屏里 `null` 的含义是**这一行/这一条不渲染**
 * (`OverviewMetric.note`、`degrade`、`quota.target` 都是那个语义)。
 * 该显示一格却填不出来时用 `'—'`,该整条消失时用 `null`,两者不可互换。
 */
const UNKNOWN = '—'

/** 不高亮任何一行。`OverviewScreenProps.selectedIndex` 的「什么都没选」取值。 */
const NO_SELECTION = -1

/**
 * 租户表的空清单。
 *
 * 单独具名而不是就地写 `[]`,是为了让「这里为什么是空的」有个挂注释的地方 ——
 * 一个裸 `[]` 读起来像「暂时还没填」,而它其实是一个**结论**(见模块注释)。
 */
const NO_TENANT_ROWS: readonly OverviewTenantRow[] = []

/**
 * 租户级 token 容量 —— **契约里没有这个数**。
 *
 * `ConsoleCapacity` 给的是进程数与内存(按 MB 算),不是 token 额度;
 * `Quota.tokenLimit` 是**按主体**的,且 `null` 表示「不限」而不是「未配置」——
 * 把若干主体的额度加起来当平台容量,会把「有人不限额」悄悄算成 0。
 *
 * ⇒ 给 `0`,与 `view/capacity.ts` 的 `TOTAL_MB_UNKNOWN` 同一处理:**不编一个数**。
 * 编出来的容量会被管理员当成扩容依据。
 */
const TOKEN_CAPACITY_UNKNOWN = 0

/**
 * 合计算不出来时,配额条的已用量。
 *
 * 只有一种情形走到它:{@link sumOf} 判定合计已经离开安全整数区间。
 * 那时指标卡显示 `'—'`,条上也不该显示一个**丢了精度的**数 —— 两者一致地什么都不说。
 */
const TOKENS_UNSTATABLE = 0

/**
 * 紧凑单位表,从大到小。
 *
 * 与表格里的千分位(`thousands`)分工:指标卡要一眼看出量级(`'2.56M'`),
 * 表格要能逐位核对(`'1,284,905'`)。
 */
const COMPACT_UNITS: readonly (readonly [number, string])[] = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'K'],
]

/**
 * ISO 4217 的最小货币单位指数。
 *
 * 🚨 **不能一律除以 100。** JPY 与 KRW 没有小数位 —— 把 38204 日元当成
 * 「382.04」会把账单说小 100 倍,而那个数**看起来完全正常**。
 * 这正是本仓最贵的那一类错:算错的表现不是崩溃,是一个像模像样的数字。
 *
 * ⚠️ 认不出的币种走 `undefined` 分支({@link formatMoney} 返回 `null` → 屏上 `'—'`),
 * **不假设 2**。三位小数的 KWD / BHD / OMR 等刻意不列:列进来需要有人逐个核对,
 * 而一个没核对过的条目与猜一个 2 没有区别。要支持它们时,连着单测一起加。
 */
const MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  SGD: 2,
  AUD: 2,
  CAD: 2,
  CHF: 2,
  JPY: 0,
  KRW: 0,
}

/** 这一屏的全部输入。字段的取舍与「用不上的那两个」见模块注释。 */
export interface OverviewInput {
  /**
   * `/v1/admin/capacity`。
   *
   * ⚠️ **这一屏一个字段都不用它** —— 见模块注释末尾那张表。
   * 留在签名里是为了让那个结论有落点,不是为了将来某天顺手接上。
   */
  readonly capacity: ConsoleCapacity
  /**
   * `/v1/admin/usage` 返回的行。
   *
   * ⚠️ **调用方必须只传该屏周期内的记录。** 这一层不裁剪 —— 裁剪要先定义月首,
   * 而月首正是取不到的那个账期(见模块注释)。
   */
  readonly usage: readonly UsageRecord[]
  /**
   * `/v1/admin/subjects`。
   *
   * ⚠️ 同 `capacity`,这一屏用不上;尤其**不要**拿它去数租户。
   */
  readonly subjects: readonly Subject[]
  readonly onOpenTenant?: (id: string) => void
  readonly onViewAllTenants?: () => void
  readonly onExportUsage?: () => void
  readonly onCreateTenant?: () => void
}

/**
 * 按字段求和,越界即认输。
 *
 * ⚠️ **每加一笔就查一次安全整数**,而不是加完再查:超过 2^53 之后加法会
 * **静默取整**,末几位丢掉而结果照样是个 `number`。契约允许单条记录
 * 大到 `9007199254740991`,两条就能撑爆 —— 那不是理论边界。
 *
 * @returns 合计;一旦离开安全整数区间返回 `null`。**不返回一个近似值** ——
 *   近似的账单数字比缺失的账单数字贵得多:后者会被追问,前者会被入账。
 */
export function sumOf(
  usage: readonly UsageRecord[],
  pick: (record: UsageRecord) => number,
): number | null {
  let total = 0
  for (const record of usage) {
    total += pick(record)
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}

/**
 * 输入 + 输出 token 的合计。
 *
 * 指标卡「本月消耗」与「平台容量」条上的 `used` **必须是同一个数** ——
 * 屏幕注释把一致性明确交给了调用方。所以只在这里算一次,两处共用。
 */
export function sumTokens(usage: readonly UsageRecord[]): number | null {
  return sumOf(usage, (record) => record.inputTokens + record.outputTokens)
}

/**
 * 千分位。`48201` → `'48,201'`。
 *
 * ⚠️ 不用 `toLocaleString()` —— 它随运行环境的 locale 变,
 * 于是同一份数据在开发机与 CI 上渲染成两个样子,而快照断言会随机红。
 *
 * ⚠️ 与 `workbench-web/src/format.ts` 的同名函数**重复了一份**。
 * console-web 今天还没有 `format.ts`,而跨前端包共用格式化需要一个真正的公共包
 * (设计系统不收这类逻辑 —— 它的屏幕收的是已格式化的串)。先各留一份;
 * 抽的时候连单测一起搬,不要只搬实现。
 */
export function thousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * token 数 → 指标卡上的紧凑写法,如 `2_560_000` → `'2.56M'`。
 *
 * 入参按构造是**非负安全整数**({@link sumTokens} 之外的取值都被它挡成 `null`,
 * 而契约给 `inputTokens` / `outputTokens` 的下界是 0),所以这里不再加防御分支 ——
 * 一个永远不会进的 `if` 与没有这个 `if` 等价,却会让读的人以为它在挡什么。
 */
export function compactTokens(n: number): string {
  for (const [scale, suffix] of COMPACT_UNITS) {
    // 两位小数是显示约定:'2.56M' 比 '3M' 保留了可比性,又不假装精确到个位。
    if (n >= scale) return `${(n / scale).toFixed(2)}${suffix}`
  }
  return thousands(n)
}

/**
 * 最小货币单位 → 展示串,如 `(38204, 'CNY')` → `'CNY 382.04'`。
 *
 * ⚠️ **用 ISO 代码而不是符号。** `¥` 同时是 CNY 与 JPY 的符号,而两者的小数位
 * 差一个数量级 —— 一个既认不出币种、金额又差 100 倍的账单数字,
 * 是「看起来正常的错数」的完美形态。
 *
 * @param minorUnits 最小单位金额。契约的下界是 0,故不处理负数。
 * @returns 展示串;**币种不在 {@link MINOR_UNIT_EXPONENT} 里时返回 `null`** ——
 *   由调用方渲染成 `'—'`,而不是在这里假设两位小数。
 */
export function formatMoney(minorUnits: number, currency: string): string | null {
  const code = currency.toUpperCase()
  const exponent = MINOR_UNIT_EXPONENT[code]
  if (exponent === undefined) return null
  if (exponent === 0) return `${code} ${thousands(minorUnits)}`
  const divisor = 10 ** exponent
  const major = Math.trunc(minorUnits / divisor)
  const minor = minorUnits % divisor
  return `${code} ${thousands(major)}.${String(minor).padStart(exponent, '0')}`
}

/**
 * 「预估账单」指标卡。
 *
 * 这是这一屏**唯一**有真来源的钱数:`UsageRecord.costMinorUnits` + `currency`。
 *
 * ⚠️ 它是**计量成本的合计**,不含订阅费、折扣与税 —— 所以「预估」两个字站得住,
 * 但它也不是账单。屏幕把这一格渲染成 muted,正是这个意思。
 *
 * 🚨 **多币种不合计。** 把 CNY 与 USD 的分加在一起得到的数没有单位,
 * 而它会被渲染成某一种货币 —— 那不是精度问题,是一句**假陈述**。
 * 这时显示 `'—'`,附注说明为什么(附注是对数据的陈述,不是编出来的数据)。
 *
 * ⚠️ 币种大小写在契约里没有约束(只约束长度为 3),故统一按大写比对与查表:
 * `'cny'` 与 `'CNY'` 是同一个币种,判成「多币种」才是错的。
 */
export function toEstimatedBill(usage: readonly UsageRecord[]): OverviewMetric {
  // 不用 `new Set(...)` 取第一个元素:那样要么写一个 `[...set][0]` 的
  // `| undefined` 分支(在 size===1 时永远不进,又是一个假装在挡什么的 if),
  // 要么断言。逐条比一次,币种与「是否混合」一起得出,没有不可达分支。
  let currency: string | null = null
  let mixed = false
  for (const record of usage) {
    const code = record.currency.toUpperCase()
    if (currency === null) currency = code
    else if (currency !== code) mixed = true
  }

  // 一条记录都没有 ⇒ 连币种都不知道。这里的 `'—'` 与「合计为 0」不同:
  // 0 元账单要先知道是 0 **什么**元,而我们连单位都没有。
  if (currency === null) return { value: UNKNOWN, note: null }
  if (mixed) return { value: UNKNOWN, note: '多币种 · 未合计' }

  const minorUnits = sumOf(usage, (record) => record.costMinorUnits)
  if (minorUnits === null) return { value: UNKNOWN, note: '合计超出可精确表示的范围' }

  const money = formatMoney(minorUnits, currency)
  if (money === null) return { value: UNKNOWN, note: `未知币种 ${currency} 的最小单位` }
  return { value: money, note: null }
}

/**
 * 「平台容量」卡上那条配额条。
 *
 * 🚨 **`total` 是哨兵 `0`,而 `QuotaBar` 会把它渲染成「0.0%」。**
 * 组件里是 `pct = total ? used / total : 0` —— 于是一个已经烧掉 128 万 token 的租户,
 * 条上写着 `1,284,905 / 0 tok` 和 `0.0%`。那个百分比是**假的**。
 *
 * 三个选项里这是最不坏的一个:
 *
 * | 选项 | 后果 |
 * | --- | --- |
 * | `total = used` | 条上恒为 **100%** —— 对每个租户说一句「配额已满」 |
 * | `used = 0, total = 0` | 内部自洽,但**丢掉了我们真的知道的那个数**,还与上面的指标卡对不上 |
 * | ✅ `used` 如实、`total = 0` | 「1,284,905 / 0」是个**看得见的矛盾**,会被人问 |
 *
 * 选第三个的理由很具体:屏幕注释要求指标卡与配额条**说同一组数**。
 * 把 `used` 也抹成 0 会让两处直接打架,而那种不一致比一个刺眼的 `/ 0` 更难查。
 * **一个看得见的矛盾好过一个自洽的谎。**
 *
 * ⇒ 真正的修法在组件层:`QuotaBar` 需要能表达「容量未知」(`total: number | null`,
 * 未知时不画百分比也不画填充)。本次只改这一个文件,记在这里。
 *
 * @param tokens {@link sumTokens} 的结果;`null` = 合计越界,见 {@link TOKENS_UNSTATABLE}
 */
export function toQuota(tokens: number | null): OverviewQuota {
  return {
    used: tokens === null ? TOKENS_UNSTATABLE : tokens,
    total: TOKEN_CAPACITY_UNKNOWN,
    // 没有「客户自设目标线」这个来源。传 `null` 让条上不画那根线 ——
    // 画在 100% 处冒充「目标就是用满」是另一句没人说过的话。
    target: null,
  }
}

/**
 * 组装整屏的 props。
 *
 * 每一个 `'—'` / `null` / `[]` 都在模块注释的表里有一行说明。
 * ⚠️ **加字段时先在那张表里加一行**:一个没有出处的值,与一个编出来的值,
 * 在屏幕上长得一模一样。
 */
export function toOverviewProps(input: OverviewInput): OverviewScreenProps {
  const tokens = sumTokens(input.usage)

  return {
    // ⚠️ 不写死日期。计费周期在 Admin 面没有来源 —— 见模块注释。
    period: { start: UNKNOWN, end: UNKNOWN },
    // ⚠️ 没有任何端点声明「数据延迟 ≤ N 分钟」。`null` ⇒ 副标题少说这一句,
    //   而不是替平台承诺一个它没承诺过的 SLA。
    freshness: null,
    metrics: {
      monthlyUsage: {
        value: tokens === null ? UNKNOWN : compactTokens(tokens),
        // 附注原本写「配额 4.00M · 64%」—— 分母不存在,整行不显示。
        note: null,
      },
      // ⚠️ 按租户签发的 Admin Key 看不到跨租户清单,这个数在结构上取不到。
      activeTenants: { value: UNKNOWN, note: null },
      // ⚠️ 运行/作业级记录不存在(`/v1/jobs` 是 planned),没有任何东西可数。
      agentRuns: { value: UNKNOWN, note: null },
      estimatedBill: toEstimatedBill(input.usage),
    },
    // ⚠️ 没有降级**事件**流。`Policy.fallbackModel` 是**配置**(「降级时用哪个」),
    //   拿它当「本次发生了降级」就是原样复刻屏幕注释里 🚨 1 那条恒为真的告警。
    degrade: null,
    quota: toQuota(tokens),
    // ⚠️ 状态列的四档没有一档为真 —— 见模块注释「租户表」。
    rows: NO_TENANT_ROWS,
    selectedIndex: NO_SELECTION,
    // ⚠️ `'—'` 而不是 `'0'`:后者是一句计数断言,而我们是看不见,不是没有。
    tenantTotal: UNKNOWN,
    // `exactOptionalPropertyTypes` 下不能把 `undefined` 显式赋给可选属性,
    // 所以「没传」用条件展开表达。
    ...(input.onOpenTenant === undefined ? {} : { onOpenTenant: input.onOpenTenant }),
    ...(input.onViewAllTenants === undefined ? {} : { onViewAllTenants: input.onViewAllTenants }),
    ...(input.onExportUsage === undefined ? {} : { onExportUsage: input.onExportUsage }),
    ...(input.onCreateTenant === undefined ? {} : { onCreateTenant: input.onCreateTenant }),
  }
}
