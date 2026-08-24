/**
 * 审计屏的**转换层**:`AuditEntry[]` → `AuditScreenProps`。
 *
 * ## 这一层守的那条线
 *
 * `@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 —— 同一批屏
 * 要被控制台、工作台、将来的白牌前端复用,而它们的数据来源不一定相同。
 * 于是 `AuditScreen` 收的是**表现层**类型:`at` 是已经格式化好的展示串,
 * `before` / `after` 是已经序列化好的展示串。那一跳就是这个文件。
 *
 * 第二个理由更实在:**这一层能被单测**,而挂 React 树的断言不能(本仓刻意
 * 不引 jsdom + testing-library)。于是「界面对不对」被拆成「数据变成什么样」
 * (在这里验,纯函数)与「长什么样」(实测台在真实浏览器里看)。
 *
 * ## 🚨 屏上有、契约里没有的东西,一律留白
 *
 * `AuditEntry` 只有八个字段:`id` / `at` / `actor` / `action` / `target` /
 * `before` / `after` / `requestId`。**没有「结果」,也没有「来源 IP」。**
 * `AuditScreen` 的模块注释里 🚨 2、🚨 3 记的就是这两笔:设计 kit 里它们是
 * 写死的常量,接上真 API 之后每一行都会变成伪证。
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | 时间 | ✅ `at`(ISO) | {@link auditTime} —— **本地时区**,带年、带秒,见下 |
 * | 动作 | ✅ `action` | 原样,不本地化、不改大小写 |
 * | 操作者 / 对象 | ✅ `actor` / `target` | 原样 |
 * | 请求 ID | ✅ `requestId` | 原样。它的唯一用途是拿去和网关日志对号 |
 * | 变更前 / 后 | ✅ `before` / `after` | JSON 序列化;`null` 原样传(见下) |
 * | **来源 IP** | ❌ **全链路都没有** | 恒 `null` → 屏上整列 `—`,那是诚实的样子 |
 * | **结果(ok/失败)** | ❌ 契约里没有这个字段 | 屏上已经删掉了这一项,这里也不补 |
 * | 动作可选项 | ⚠️ 契约里 `action` 是自由 `string`,没有枚举 | {@link actionOptionsOf} 从**本页数据**里现取 |
 * | 时间范围 / 关键词 | ⚠️ `/v1/admin/audit` **不收任何筛选参数** | 客户端在**已取回的这一页内**筛,见下 |
 * | 导出 CSV | ❌ 没有导出端点 | 只透传回调,这一层不造文件 |
 * | 翻页 | ⚠️ `ListAuditResponse.nextCursor` 被 `ConsoleApi.audit()` 丢掉了 | 永远只有第一页 |
 *
 * ⚠️ **最后三行合起来是一个必须说清的落差**:屏上那三个筛选器看起来在查
 * 「近 30 天的审计」,实际查的是「**服务端给回来的这一页里**近 30 天的那些」。
 * 一页里若只有近两小时的记录,选「近 30 天」也只会显示那两小时 —— 而界面
 * 长得跟「30 天内只发生过这些事」一模一样。这一层没法补上它:补的办法是让
 * 契约收 `since` / `action` / `cursor` 参数,那是服务端的事。
 *
 * ## ⚠️ 时间为什么要带年、还要带秒
 *
 * 屏头写着「记录保留 400 天」—— **超过一年**。`08-18` 这种月-日格式在 400 天
 * 的窗口里会撞车:两条相隔一年的记录显示成同一个串,而排查的人正是靠这一列
 * 定位「事故发生在哪一天」。秒同理:同一分钟内的两次调用(比如一次批量改配额)
 * 挤成同一个时间戳之后,顺序只能靠行序猜。
 *
 * ⚠️ 一律按**本地时区**渲染。服务端给的是 UTC 的 ISO 串,而看的人问的是
 * 「这事是我们几点做的」。直接切字符串(`iso.slice(0, 19)`)会在跨时区时
 * 差出几个小时,而那种错**看起来完全正常**。
 *
 * ## ⚠️ 脱敏**不在这里做**,而且刻意不做
 *
 * `AuditScreen` 的注释说 `before` / `after` 收的是「已经脱敏的展示串」。
 * 那个保证的落点是**服务端的 `@dshwar/audit`** —— 契约写明「凭据类操作只记录
 * `describe` 层面的事实,不记录值」(硬规则 5)。
 *
 * 这里**不再加一道浏览器端的打码**,两个理由:
 *
 * 1. **来不及了。** 值一旦出现在响应里,它已经过了网线、进了浏览器的网络面板、
 *    可能还进了中间的日志。渲染前打码挡不住任何一样,只挡住了**看见它的人**。
 * 2. **一个漏掉一个字段的打码器,和一个覆盖全部字段的打码器,长得一模一样。**
 *    它会变成关于「什么算敏感」的第二个来源,而这类第二来源正是本仓反复在拆的东西。
 *
 * ⇒ 真在这里看见了凭据值,那是 `@dshwar/audit` 的缺陷,该去那里修。
 *
 * @module @dshwar/console-web/view/audit
 */
import type { AuditRow, AuditScreenProps } from '@dshwar/design-system/screens/console/AuditScreen'
import type { AuditEntry } from '../api.ts'

/**
 * 动作筛选的哨兵项。
 *
 * `AuditScreen` 刻意不认识哪一项是哨兵(「那是筛选语义,不是排版」),
 * 于是判定它的逻辑必须在这一层,而且**只能有一处** —— 导出成常量而不是
 * 在两个地方各写一遍字面量,是为了让「改了文案却漏改比较」这件事不可能发生。
 */
export const ALL_ACTIONS = '全部动作'

/** 时间范围的可选项。**闭集** —— 认不出的值在 {@link rangeWindowMs} 里抛。 */
export const RANGE_OPTIONS = ['近 24 小时', '近 7 天', '近 30 天'] as const

export type Range = (typeof RANGE_OPTIONS)[number]

/** 默认范围。7 天:比 24 小时能看到一次完整的工作周,又不至于一屏几千行。 */
export const DEFAULT_RANGE: Range = '近 7 天'

const HOUR_MS = 60 * 60 * 1000

const RANGE_MS: Readonly<Record<Range, number>> = {
  '近 24 小时': 24 * HOUR_MS,
  '近 7 天': 7 * 24 * HOUR_MS,
  '近 30 天': 30 * 24 * HOUR_MS,
}

/**
 * 来源 IP 的取值。
 *
 * ⚠️ **契约的 `AuditEntry`、`@dshwar/audit` 的 `AuditRecord`、网关的记录点,
 * 三处都没有 IP。** 于是这里恒为 `null`,屏上那一列今天**整列都是 `—`**。
 *
 * 给它一个具名常量而不是在 {@link toRow} 里写个裸 `null`,是为了让下一个
 * 「这列怎么是空的」的人能顺着名字读到理由,而不是以为自己接漏了字段 ——
 * 与 `view/capacity.ts` 的 `TOTAL_MB_UNKNOWN` 同一手法。
 *
 * 🚨 **不要**因为「空着难看」把设计 kit 里那几个 `10.x.x.x` 搬回来。
 * 一个编出来的来源 IP,会在事故复盘时把人指向另一台机器 —— 那时它不再是
 * 一个难看的空格,而是几个小时的错误方向。真要这一列,先让服务端记。
 */
const SOURCE_IP_UNAVAILABLE = null

/**
 * 时间范围 → 窗口毫秒数。
 *
 * ⚠️ **认不出就抛,不回落。** 回落到任一档都会让界面显示一份**看起来正常**
 * 的列表 —— 而人正拿着它判断「那段时间到底发生了什么」。一个悄悄按 24 小时
 * 筛出来的结果,与一个真的按 30 天筛出来的结果,在屏上没有任何区别。
 *
 * (这与 `view/capacity.ts` 的 `toIsolation` 是同一条纪律。`action` 那边
 * **不抛**:契约里它是自由 `string`,本来就是开集,认不出只意味着筛不中。)
 *
 * @throws 当 `range` 不在 {@link RANGE_OPTIONS} 里
 */
export function rangeWindowMs(range: string): number {
  if (!isRange(range)) {
    throw new Error(
      `认不出的时间范围 "${range}" —— 界面只认 ${RANGE_OPTIONS.join(' / ')}。\n` +
        '回落到任一档都是在猜,而猜错的表现是一份看起来完全正常的审计列表,\n' +
        '排查的人会据此判断「那段时间没发生过别的事」。请先在 view/audit.ts 里补上这一档。',
    )
  }
  return RANGE_MS[range]
}

function isRange(value: string): value is Range {
  return (RANGE_OPTIONS as readonly string[]).includes(value)
}

/**
 * ISO 时间戳 → `'2026-08-18 09:14:32'`(本地时区)。
 *
 * 为什么带年带秒、为什么必须走 `Date` 而不是切字符串,见模块注释。
 *
 * @param iso ISO 8601 串。解析不了 → `'—'`
 *
 * ⚠️ 解析不了时返回 `'—'` 而不是抛:一条时间戳畸形的记录仍然是一条**发生过的
 * 记录**,它的操作者、对象、变更体都还有取证价值。为了一个坏字段让整屏打不开,
 * 等于用一条记录的瑕疵换掉整本账。畸形本身在屏上是看得见的(那一格是 `—`)。
 */
export function auditTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  const two = (n: number): string => String(n).padStart(2, '0')
  const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  const time = `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
  return `${date} ${time}`
}

/**
 * `before` / `after`(`unknown`)→ 变更体的展示串。
 *
 * ⚠️ **`null` 原样传下去,不要换成 `''` 或 `'{}'`。** 屏上这两者是不同的空态
 * 文案(「创建操作没有『之前』」/「删除操作没有『之后』」),而 `{}` 的意思是
 * **「改成了空」** —— 在审计里那是一次真实发生的清空动作,与「本来就没有这一侧」
 * 是两件事。合并它们等于把一次清空记成了一次创建。
 *
 * ⚠️ **字符串也走 `JSON.stringify`,于是会带引号。** 看起来啰嗦,但它保住了
 * `"5"` 与 `5` 的区别 —— 审计是取证材料,类型变化本身可能就是要查的那个 bug。
 * 为了好看把引号去掉,等于在证物上做美化。
 *
 * 不加 `try / catch`:这里的值全都来自 `JSON.parse` 的结果,构造上不可能有环,
 * 也不可能有 `BigInt` / 函数。加一个永远进不去的 catch 分支,与没有分支等价,
 * 但它会让人以为这里已经想过异常了。
 */
export function toChangeText(value: unknown): string | null {
  // `undefined` 与 `null` 走同一条路:JSON 里没有 undefined,能出现它只可能是
  // 服务端漏了这个必填字段 —— 那种情况下同样是「这一侧没有值」,而不是空对象。
  if (value === null || value === undefined) return null
  return JSON.stringify(value, null, 2)
}

/** 一条审计记录 → 表里的一行。 */
export function toRow(entry: AuditEntry): AuditRow {
  return {
    id: entry.id,
    at: auditTime(entry.at),
    // ⚠️ 动作词原样输出。翻译成中文会让它与服务端日志、告警规则里的串对不上,
    //    而这一列存在的意义就是能拿去 grep。
    action: entry.action,
    actor: entry.actor,
    target: entry.target,
    // ⚠️ 服务端真的给过的那一个。与 `entry.id` **不是一个东西**:
    //    id 是这条记录的身份,requestId 是产生它的那次调用的身份。
    requestId: entry.requestId,
    before: toChangeText(entry.before),
    after: toChangeText(entry.after),
    sourceIp: SOURCE_IP_UNAVAILABLE,
  }
}

/**
 * 动作筛选的可选项:哨兵 + **本页数据里真实出现过的**动作词。
 *
 * ⚠️ 这不是「系统能产生的全部动作」,而是「这一页里有的动作」——
 * 契约把 `action` 定义成自由 `string`,压根没有可枚举的清单。两者的差别在
 * 一页数据里看不出来,所以在这里写明:选项少了一个,不代表那件事没发生过。
 *
 * ⚠️ **必须从未筛选的集合里取。** 传筛选后的结果进来,选中某个动作之后
 * 选项列表就会塌成只剩那一个 —— 于是再也回不到「全部」,而那是个用户
 * 只能靠刷新页面逃出来的死角。
 *
 * 排序用默认的 `sort()`(按 UTF-16 码位),**不用 `localeCompare`**:
 * 后者随运行环境的 locale 变,同一份数据在开发机与 CI 上会排出两个顺序。
 */
export function actionOptionsOf(entries: readonly AuditEntry[]): readonly string[] {
  const seen = new Set<string>()
  for (const entry of entries) seen.add(entry.action)
  return [ALL_ACTIONS, ...[...seen].sort()]
}

/**
 * 关键词是否命中。
 *
 * ⚠️ **只比 `target` 与 `actor`** —— 输入框的标签就是「按对象或操作者筛选」。
 * 顺手把 `action` 也算进去会让标签变成一句错话,而用户会据此以为
 * 「搜 target 搜不到 = 没有这条记录」。要筛动作,右边有专门的下拉。
 */
export function matchesQuery(entry: AuditEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return entry.target.toLowerCase().includes(needle) || entry.actor.toLowerCase().includes(needle)
}

/** 动作是否命中。哨兵项放行全部。 */
export function matchesAction(entry: AuditEntry, actionFilter: string): boolean {
  return actionFilter === ALL_ACTIONS || entry.action === actionFilter
}

/**
 * 记录是否落在窗口内。
 *
 * @param windowMs 已经由 {@link rangeWindowMs} 收窄过的毫秒数
 * @param now 「现在」**由调用方传进来**,这一层不碰 `Date.now()` ——
 *   否则这个函数就不是纯函数,断言得跟着挂钟走。
 *
 * ⚠️ **时间戳解析不了的记录一律留下,不筛掉。** 审计是只追加的取证材料,
 * 让一条记录**静默消失**比让它出现在错误的时间桶里贵得多:后者在屏上看得见
 * (那一格是 `—`),前者什么痕迹都不留,而人正拿这份列表证明「那天没发生过什么」。
 *
 * ⚠️ 只设下界,不设上界。时钟偏移导致的「未来」时间戳同样留下 —— 理由同上。
 */
export function withinWindow(entry: AuditEntry, windowMs: number, now: Date): boolean {
  const at = new Date(entry.at).getTime()
  if (Number.isNaN(at)) return true
  return at >= now.getTime() - windowMs
}

/**
 * 三个筛选器一起过一遍。
 *
 * ⚠️ 范围**在循环外收窄一次**,不在回调里逐条收:`entries` 为空时回调一次都
 * 不跑,认不出的 `range` 就永远抛不出来 —— 那正是 CLAUDE.md 里「零次断言与
 * 全部通过在输出上没有区别」的那一族。空列表恰恰是最容易出现的状态。
 */
export function filterEntries(input: {
  entries: readonly AuditEntry[]
  query: string
  actionFilter: string
  range: string
  now: Date
}): readonly AuditEntry[] {
  const windowMs = rangeWindowMs(input.range)
  return input.entries.filter(
    (entry) =>
      matchesQuery(entry, input.query) &&
      matchesAction(entry, input.actionFilter) &&
      withinWindow(entry, windowMs, input.now),
  )
}

/**
 * 组装整屏的 props。
 *
 * ## 选中态按 **id** 传,不按下标
 *
 * `AuditScreen` 收的是 `selectedIndex`,而这一层同时负责**筛选** ——
 * 于是调用方手里的下标指向的是「上一次筛选结果里的第几行」,筛选条件一变
 * 就可能指到另一条记录,或者指到空气(`AuditScreen` 的 🚨 4 记的就是后者)。
 *
 * ⇒ 这里收 `selectedId`,下标现算。好处不是少写一行:**「选中的是另一条记录」
 * 这个 bug 在结构上不可能发生了**,而它是同族里最难发现的一个 —— 屏上有一条
 * 正常的记录,只是不是你点的那条。
 *
 * 记录被筛掉时 `findIndex` 返回 `-1`,正好是 `AuditScreen` 约定的「未选中」,
 * 详情卡走空态。空不是错误,不该长得像错误。
 *
 * @param input.now 「现在」由调用方传,理由见 {@link withinWindow}
 */
export function toAuditProps(input: {
  entries: readonly AuditEntry[]
  now: Date
  selectedId?: string | null
  query?: string
  actionFilter?: string
  range?: string
  onSelect?: (index: number, id: string) => void
  onQueryChange?: (next: string) => void
  onActionFilterChange?: (next: string) => void
  onRangeChange?: (next: string) => void
  onExport?: () => void
}): AuditScreenProps {
  const query = input.query ?? ''
  const actionFilter = input.actionFilter ?? ALL_ACTIONS
  const range = input.range ?? DEFAULT_RANGE
  const rows = filterEntries({
    entries: input.entries,
    query,
    actionFilter,
    range,
    now: input.now,
  }).map(toRow)

  const selectedId = input.selectedId ?? null
  const selectedIndex = selectedId === null ? -1 : rows.findIndex((row) => row.id === selectedId)

  return {
    rows,
    selectedIndex,
    query,
    actionFilter,
    // ★ 从**未筛选**的 entries 里取 —— 见 actionOptionsOf 的第二条 ⚠️。
    actionOptions: actionOptionsOf(input.entries),
    range,
    rangeOptions: RANGE_OPTIONS,
    // exactOptionalPropertyTypes:可选回调没给就**整个键不出现**,
    // 而不是出现一个值为 undefined 的键 —— 后者在这个开关下是类型错误。
    ...(input.onSelect === undefined ? {} : { onSelect: input.onSelect }),
    ...(input.onQueryChange === undefined ? {} : { onQueryChange: input.onQueryChange }),
    ...(input.onActionFilterChange === undefined
      ? {}
      : { onActionFilterChange: input.onActionFilterChange }),
    ...(input.onRangeChange === undefined ? {} : { onRangeChange: input.onRangeChange }),
    ...(input.onExport === undefined ? {} : { onExport: input.onExport }),
  }
}
