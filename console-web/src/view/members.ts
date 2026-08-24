/**
 * 「成员与权限」屏的**转换层**:`Subject[]` + `ConsoleCapacity` → `MembersScreenProps`。
 *
 * ## 这一层守的那条线
 *
 * `@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 —— 它要能被三个宿主
 * (远端 Web / 本地 sidecar / Tauri)与将来的白牌前端复用,而它们的数据来源不一定相同。
 * 于是「ISO 时间戳 → `'08-21T09:14Z'`」「`active: boolean` → `MemberStatus`」这些换算
 * 全部落在调用方,也就是这里。
 *
 * 第二个理由更实在:**这一层能被单测**,而挂 React 树的断言不能(本仓刻意不引
 * jsdom + testing-library)。于是「界面对不对」被拆成「数据变成什么样」(在这里验)
 * 与「长什么样」(实测台在真实浏览器里看)。
 *
 * ## 🚨 屏上的字段 × 契约里的来源(逐条,含**没有来源**的那些)
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | `rows[].id` | ✅ `Subject.id` | 原样。契约里**没有邮箱字段**,这条约束构造上满足 |
 * | `rows[].displayName` | ✅ `Subject.displayName`(可空) | 原样传 `null`,**不拿 id 顶替** |
 * | `rows[].roles` | ✅ `Subject.roles` | 原样传数组,**不取第一个** —— 取第一个会让权限复核看漏兼任 |
 * | `rows[].syncedAt` | ✅ `Subject.updatedAt` | 格式化成 UTC 的 `'08-21T09:14Z'`,见 {@link utcStamp} |
 * | `rows[].lastActiveAt` | ❌ **契约里没有这个字段** | 一律 `null`(屏上显示 `—`)。**禁止拿 `updatedAt` 冒充**,见下 |
 * | `rows[].status` | ⚠️ 只有 `active: boolean`,而枚举有三档 | 只产出 `active` / `disabled`;`idp-removed` **推不出来,不猜** |
 * | `selectedIndex` | ❌ 界面状态 | 调用方持有,默认 `-1`(未选中) |
 * | `totalCount` | ⚠️ 只有**本页**的条数 | `subjects.length`。**不用 `capacity.memberCount`**,见下 |
 * | `capacity` | ✅ `/v1/admin/capacity` | 走 {@link toCapacityReading} —— D2 要求的唯一构造点 |
 * | `query` / `role` / `status` | ❌ 界面状态 | 调用方持有;筛选在这里做,组件不留副本 |
 * | `roleOptions` | ✅ 从 `Subject.roles` 归并 | 见 {@link roleOptionsOf}。**不写死一份角色清单** —— 角色名由客户的 IdP 定义 |
 * | `statusOptions` | ⚠️ 部署侧的清单 | 只列**本版真能产出的两档**,见 {@link STATUS_OPTIONS} |
 * | `lastSyncedAt` | ❌ **没有同步运行的记录** | 一律 `null`,理由见下(⚠️ 这一档本身也不精确) |
 * | `requestId` | ⚠️ 契约里有,**但被 `ConsoleApi` 收窄掉了** | 必填入参;今天只能传 `null`,见下 |
 * | `idp` | ❌ **契约里没有 IdP 连接端点** | 必填入参;今天只能传 `null` —— 而那会触发一处屏幕缺陷,见下 |
 * | 各 `on*` 回调 | ❌ 宿主行为 | 原样透传,不给默认实现 |
 *
 * ## 🚨 `lastActiveAt` 一律 `null` —— 禁止拿 `updatedAt` 冒充
 *
 * `updatedAt` 是**镜像被同步的时间**,而同步是定时跑的。拿它当「最近活动」的后果是:
 * 一个三个月没登录的人,每 15 分钟被刷成「刚刚活动过」。误差的方向是**把休眠说成活跃**,
 * 而这一列正是用来找「谁该被回收席位」的 —— 按它做的决定会一个都做不出来。
 *
 * 真来源在用量/审计侧(`/v1/admin/usage`、`/v1/admin/audit`),那是**另外两次调用**,
 * 不在这一屏的输入里。要接就把它们加进 `toMembersProps` 的入参,不要在这里猜。
 *
 * ## 🚨 `lastSyncedAt` 一律 `null`,而 `null` 在屏上显示成「从未同步」
 *
 * 手边唯一沾边的数是 `max(updatedAt)`,而**那答的是另一个问题**:
 * 「名单里最近一条变更是什么时候」。一次没改动任何人的同步不会抬高它 ——
 * 于是管理员点「立即同步」之后时间纹丝不动,看起来像坏了。
 *
 * 更要紧的是纪律上的一致:上一段刚说过 `updatedAt` 不能代表**行级**的活跃,
 * 那么它的最大值同样不能代表**运行级**的同步时刻 —— 同一个字段,同一种越界。
 *
 * ⚠️ **`null` 本身也不精确**:屏上会写「从未同步」,而我们手里明明有同步来的成员。
 * 这不是可以在前端消掉的误差 —— 正确的修法是契约里补一个同步运行的资源
 * (`lastSyncedAt` / `lastSyncStatus`),不是在这里换一个算法。
 * ⚠️ 今天它**根本渲染不到**:计数行在 `idp !== null` 的分支里(见下一节)。
 *
 * ## 🚨 `requestId`:契约里有,被 `ConsoleApi.listSubjects` 收窄掉了
 *
 * `ListSubjectsResponse` 的三个必填字段是 `data` / `nextCursor` / `requestId`,
 * 而 `console-web/src/api.ts` 的 `listSubjects` 返回 `(await client.listSubjects()).data` ——
 * 后两个在那一行就没了。所以**这一层拿不到它,调用方也拿不到**。
 *
 * ⇒ 做成**必填入参**而不是在这里写死 `null`:必填逼着每个构造点写出
 * `requestId: null` 这一行,那是看得见的;写死则是看不见的。真要接上,
 * 该改的是 `ConsoleApi.listSubjects` 的返回形状,不是这里。
 *
 * ⚠️ 拿不到就传 `null`,屏幕会**整段不渲染**。**不要凑一个 id** ——
 * 用户会把它抄进工单,而服务端日志里查无此请求,支持侧只能回「查不到」。
 *
 * ## 🚨 `idp: null` 会让屏幕把**已经取到的成员藏起来**(屏幕缺陷,不在本文件)
 *
 * `MembersScreen` 里 `connected = idp !== null`,而筛选条 + 表格 + 计数行整块
 * 都在 `connected ? … : <EmptyState "还没有同步到成员" />` 的真分支里。
 *
 * 于是:契约今天**没有任何 IdP 连接端点**(`openapi.json` 里没有 idp/scim 相关的 path),
 * `idp` 唯一诚实的值是 `null` —— 而那会让一屏真实的成员被换成一句
 * 「还没有同步到成员」。名单在手里,界面说没有。
 *
 * ⚠️ **不要在这里编一个 `IdpConnection` 去绕开它。** 编出来的三个字段各自更糟:
 * `provider` 是瞎写;`secretConfigured: false` 是对一个**凭据**的断言,而我们根本不知道
 * (硬规则 5 的语义是 configured / source / writable 三选一,没有「不知道」这一档);
 * `syncInterval` 会渲染成一个**能选能改**的下拉,而它背后什么都没有 ——
 * 屏幕自己的注释就写着这条(「会让人以为这个设置已经在生效」)。
 *
 * ⇒ 正确的修法在 `MembersScreen.tsx`:空态该由 `rows.length === 0` 决定,
 * IdP 连接卡该独立地显示「未配置」。本文件只负责**不掩盖**这件事。
 *
 * ## ⚠️ `totalCount` 用 `subjects.length`,**不要**用 `capacity.memberCount`
 *
 * 两者数的不是同一批人。`gateway/src/server.ts` 里:
 *
 * ```ts
 * memberCount: async (tenantId) => (await subjects.list({ tenantId, active: true })).length
 * ```
 *
 * ——**只数启用的**。而这张表连已停用的一起列。拿它当分母会渲染出「4 / 2」这种读数,
 * 而看到的人只会以为是渲染 bug,不会想到是两个口径。
 *
 * ⚠️ `subjects.length` 自己也有一处不准:`GET /v1/admin/subjects` 是**分页**的
 * (`limit` 默认 50,配 `nextCursor`),而 `ConsoleApi.listSubjects` 把 `nextCursor` 丢了 ——
 * 于是这一层**无从知道后面还有没有人**。今天的分母是「已经取到的人数」,
 * 在成员超过一页时会偏小。补法同样在 `api.ts`,不在这里。
 *
 * @module @dshwar/console-web/view/members
 */
import type { ConsoleCapacity } from '@dshwar/console-contract'
import type {
  IdpConnection,
  MemberRow,
  MemberStatus,
  MembersScreenProps,
} from '@dshwar/design-system/screens/console/MembersScreen'
import type { Subject } from '../api.ts'
import { toCapacityReading } from './capacity.ts'

/**
 * 「不筛角色」的哨兵值。
 *
 * ⚠️ 它是**筛选器的约定**,不是一个角色名 —— 与 `roleOptionsOf` 归并出来的真实角色
 * 混在同一个下拉里,靠这个常量区分。所以判等要用这个常量,不要在调用点手写字面量:
 * 手写的那处一旦与这里差一个字,筛选就变成「找一个叫『全部角色』的角色」,
 * 结果是空表 —— 而空表与「确实没人」在屏上一模一样。
 */
export const ALL_ROLES = '全部角色'

/** 「不筛状态」的哨兵值。理由同 {@link ALL_ROLES}。 */
export const ALL_STATUSES = '全部状态'

/**
 * 状态枚举 → 下拉里的中文标签。
 *
 * ⚠️ **这份标签与 `MembersScreen` 里 `TONE_OF` 的 `label` 必须逐字一致** ——
 * 那边是表格「状态」列的显示文本,这边是筛选下拉的选项文本。设计系统没有把
 * `TONE_OF` 导出(它是渲染细节),所以这里是**一份手工副本**:两边对不上时,
 * 用户会看到下拉写着「停用」而表里写着「已停用」,以为是两种不同的状态。
 *
 * 写成 `Record<MemberStatus, string>` 而不是散落的字面量,是为了让**加档位**这件事
 * 在这里编译不过:`MemberStatus` 多一个成员,这张表少一条就是错。
 */
const STATUS_LABEL: Readonly<Record<MemberStatus, string>> = {
  active: '已启用',
  disabled: '已停用',
  'idp-removed': 'IdP 已移除',
}

/**
 * 本版**真能从契约推出来**的状态档。
 *
 * ⚠️ `idp-removed` 不在其中,而且**刻意不进 {@link STATUS_OPTIONS}**。
 * 理由不是省事:一个永远筛不出任何人的选项,会被读成「查过了,没有被移除的人」——
 * 那正是最贵的一类谎(让人相信一个功能在工作)。它今天不工作,那就别摆出来。
 *
 * 要让它工作,得让镜像侧记下「SCIM 收到过 DELETE」这件事 ——
 * `active: false` 分不出「IdP 里没这个人了」与「这个人被停用了」,
 * 而两者的处置完全不同(前者启用了下次同步就会被改回去)。
 */
const PRODUCIBLE_STATUSES: readonly MemberStatus[] = ['active', 'disabled']

/**
 * 状态筛选的可选项。第一项是「全部」。
 *
 * 类型是 `readonly string[]` 而不是字面量联合 —— 屏幕那边收的就是裸串:
 * 行的状态是闭集(认不出要报错),而**下拉的选项是数据**(这套部署的清单)。
 * 两者刻意不是同一个东西,见 `MembersScreenProps.role` 的注释。
 */
export const STATUS_OPTIONS: readonly string[] = [
  ALL_STATUSES,
  ...PRODUCIBLE_STATUSES.map((status) => STATUS_LABEL[status]),
]

/** 已解析的状态筛选:要么不筛,要么筛某一个确定的档。 */
type StatusFilter =
  { readonly kind: 'all' } | { readonly kind: 'one'; readonly status: MemberStatus }

/**
 * 把下拉的中文标签解回枚举。
 *
 * ⚠️ **认不出就抛。** 一个拼错的筛选值若被当成「不筛」,用户选了「已停用」却看到全部人;
 * 若被当成「筛一个谁都不是的档」,用户看到空表。两种退化在屏上都**像是正常工作**,
 * 而它们说的是相反的话。抛出来至少会让人看见。
 *
 * ⚠️ 认得出但本版产不出的档(`IdP 已移除`)**不抛**,如实筛成零行 ——
 * 那是调用方自己扩了选项清单的后果,不是拼写错误。两者的修法不同,所以不合并。
 */
function resolveStatusFilter(label: string): StatusFilter {
  if (label === ALL_STATUSES) return { kind: 'all' }
  for (const status of Object.keys(STATUS_LABEL) as MemberStatus[]) {
    if (STATUS_LABEL[status] === label) return { kind: 'one', status }
  }
  throw new Error(
    `认不出的状态筛选值 "${label}" —— 可选项见 view/members.ts 的 STATUS_OPTIONS。\n` +
      '这里不回落:当成「不筛」会让用户选了「已停用」却看到全部人,\n' +
      '当成「筛一个不存在的档」会给他一张空表,而两者在屏上都像是正常工作。',
  )
}

/**
 * ISO 时间戳 → `'08-21T09:14Z'`(**UTC**)。
 *
 * ⚠️ **必须是真 UTC,不能是本地时间加个 `Z`。** 这一列是 mono 列,与服务端日志、
 * 审计记录对着看的 —— `Z` 是一个明确的断言。带 `Z` 却给本地时间,在东八区会差 8 小时,
 * 而那种错**看起来完全正常**(格式对、数字合理、只是指向另一个时刻)。
 *
 * 所以走 `Date.toISOString()`(它按定义输出 UTC),而不是切输入串:
 * 切串在输入带偏移量(`+08:00`)时会原样搬走那个本地读数。
 *
 * ⚠️ 与 `workbench-web/src/format.ts` 的 `shortTime` 刻意不同 —— 那边渲染**本地**时间,
 * 因为工作台答的是「我什么时候跑的这个」。这里答的是「这条镜像与日志里的哪一行对齐」。
 * 两者都对,合并成一个才是错。
 *
 * @param iso 契约保证是 `…Z` 形状;解析不了返回 `'—'`(取不到,不是某个时刻)
 */
export function utcStamp(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  // '2026-08-21T09:14:00.000Z'.slice(5, 16) === '08-21T09:14'
  return `${at.toISOString().slice(5, 16)}Z`
}

/**
 * `Subject.active` → 屏上的状态。
 *
 * ⚠️ **只产出两档。** `MemberStatus` 的第三档 `idp-removed` 从一个 boolean 里推不出来 ——
 * 「IdP 里已经没有这个人」与「这个人还在、只是被停用」是两件事,SCIM 的 `DELETE`
 * 与 `active: false` 也是两条不同的路。镜像侧不另记这件事,这里就分不出来。
 *
 * ⚠️ **分不出时不猜。** 猜的方向只有两个,而两个都会造成真实的误操作:
 * 把在职的人显示成「已移除」,复核的人会去 IdP 里找一个不存在的问题;
 * 反过来,一个已经离职的人显示成「已停用」,席位就一直占着。
 *
 * 写成 `switch` + `never` 而不是三元,是为了让契约把 `active` 放宽成枚举那天
 * **这里编译不过**,而不是安静地把新值折进 `disabled`。
 */
export function toStatus(active: Subject['active']): MemberStatus {
  switch (active) {
    case true:
      return 'active'
    case false:
      return 'disabled'
    default: {
      const never: never = active
      throw new Error(
        `认不出的 Subject.active 值:${String(never)} —— 契约放宽过它的类型。\n` +
          '请先在 view/members.ts 里决定这个新值对应哪一档,不要让它折进 disabled。',
      )
    }
  }
}

/**
 * 一位成员变成表里的一行。
 *
 * ⚠️ `id` 取的是 `Subject.id`,而契约明写它「必须是 IdP 的不可变主键
 * (OIDC sub / SCIM id / 目录 object id),**不得使用邮箱**」。这里**不做形状校验**,
 * 两条理由:
 *
 * 1. `Subject` 里根本没有邮箱字段 —— 这一层不可能「塞错」,约束是**构造上**满足的;
 * 2. 真要拦一个违规的服务端,拦点在 SCIM 写入侧。在渲染时抛,后果是**一个人的
 *    脏数据让整份名单看不见** —— 那与「界面把人藏起来」是同一种伤害。
 *
 * ⚠️ `tenantId` / `createdAt` 不在 `MemberRow` 里,不是漏了:租户在控制台的上下文里
 * 已知,而「加入时间」这屏从来不展示。要显示就给 `MemberRow` 加字段。
 */
export function toRow(subject: Subject): MemberRow {
  return {
    id: subject.id,
    // ⚠️ 可空**原样传**。空时屏幕会显示「未提供显示名」——那是 IdP 侧该补的东西。
    //   在这里 `?? subject.id` 会让相邻两列显示同一个串,并把「IdP 没给显示名」这个
    //   事实盖掉;`?? '—'` 则会被读成「这个人没有名字」。
    displayName: subject.displayName,
    // ⚠️ 整个数组。只取第一个会让权限复核**看漏兼任**(既是管理员又是审计员)。
    //   空数组是合法的 —— 没有任何角色的成员存在,屏幕显示 '—'。
    roles: subject.roles,
    syncedAt: utcStamp(subject.updatedAt),
    // 🚨 没有来源。见模块注释 —— **不许**填 `utcStamp(subject.updatedAt)`。
    lastActiveAt: null,
    status: toStatus(subject.active),
  }
}

/**
 * 从成员里归并出角色筛选的可选项。第一项是「全部」。
 *
 * ⚠️ **不写死一份角色清单**:角色名由客户的 IdP 定义,写死的那份在第一个用
 * `engineer` 而不是 `member` 的客户那里就会漏掉半数人 —— 而下拉里没有的角色,
 * 用户根本无从发现自己漏了。
 *
 * ⚠️ 代价说清楚:归并的是**已经取到的这一页**。分页之后才出现的角色不在选项里
 * (见模块注释关于 `nextCursor` 的那段)。这是 `api.ts` 收窄掉分页信息的连带后果,
 * 不是这里能补的。
 *
 * 排序用**码位序**而不是 `localeCompare` —— 后者随运行环境的 locale 变,
 * 于是同一份数据在开发机与 CI 上排成两个样子,快照测试会随机红。
 */
export function roleOptionsOf(subjects: readonly Subject[]): readonly string[] {
  const seen = new Set<string>()
  for (const subject of subjects) {
    for (const role of subject.roles) seen.add(role)
  }
  const sorted = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return [ALL_ROLES, ...sorted]
}

/**
 * 一行是否通过筛选。
 *
 * 匹配范围与输入框的 placeholder(「姓名 / 主体标识」)一致 —— 只看这两列。
 * 顺带匹配角色会让「输入 admin 找人」意外命中一批同事,而用户不会知道为什么。
 *
 * @param status **已解析**的状态筛选。刻意不收裸串:解析要在遍历之外做一次,
 *   否则零行时那次解析根本不会发生 —— 一个筛选值拼错了却「通过」,
 *   与遍历零个元素的断言循环是同一种空跑。
 */
export function matchesFilters(
  row: MemberRow,
  filters: { readonly query: string; readonly role: string; readonly status: StatusFilter },
): boolean {
  const needle = filters.query.trim().toLowerCase()
  if (needle !== '') {
    // 显示名可空 —— 空时只按 id 匹配,不拿 id 去凑一个「姓名」。
    const haystack = `${row.displayName ?? ''}\n${row.id}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  if (filters.role !== ALL_ROLES && !row.roles.includes(filters.role)) return false
  if (filters.status.kind === 'one' && row.status !== filters.status.status) return false
  return true
}

/**
 * 组装整屏的 props。
 *
 * ## 必填与选填的分界
 *
 * **必填**的四个(`subjects` / `capacity` / `requestId` / `idp`)都是**数据**:
 * 它们要么来自服务端,要么是「服务端今天给不出」这件事本身。给它们默认值等于给这一屏
 * 装第二个事实源 —— 而那正是 D2 那笔账的形状(界面显示一个数,服务端按另一个数拒绝)。
 * 后两个今天只能传 `null`,**必填逼着每个构造点把这一行写出来**,那是看得见的;
 * 在这里写死则是看不见的。
 *
 * **选填**的都是**界面状态**(选中谁、筛成什么样)。它们的默认值是筛选器的约定,
 * 不是任何服务端数值的兜底 —— 两者不要混。
 *
 * ⚠️ **`selectedIndex` 索引的是筛选**后**的 `rows`。** 筛选值一变,同一个下标就指向了
 * 另一个人,而屏上只是高亮换了一行 —— 没有任何提示。宿主在改 query / role / status 时
 * 应当同时把它复位成 `-1`;要按人记住选中,得由宿主存 `Subject.id` 再反查下标。
 * 组件收的是下标(`onSelect(index)`),这个换算只能在宿主那边做。
 */
export function toMembersProps(input: {
  readonly subjects: readonly Subject[]
  readonly capacity: ConsoleCapacity
  /** 本次列表响应的 requestId。今天 `ConsoleApi` 给不出 —— 传 `null`,别凑。 */
  readonly requestId: string | null
  /**
   * 成员清单是不是取完了。
   *
   * ⚠️ 必填。默认 true 会让漏传的人拿到一句「共 N 人」的假话,而没有任何东西会红。
   * 见 `api.ts` 的 {@link Page} 与 MembersScreen 的 `countComplete`。
   */
  readonly complete: boolean
  /** IdP 连接。今天契约里没有这个端点 —— 传 `null`,别编。见模块注释。 */
  readonly idp: IdpConnection | null
  readonly selectedIndex?: number
  readonly query?: string
  readonly role?: string
  readonly status?: string
  readonly onQueryChange?: (next: string) => void
  readonly onRoleChange?: (next: string) => void
  readonly onStatusChange?: (next: string) => void
  readonly onSelect?: (index: number) => void
  readonly onSync?: () => void
  readonly onAddMember?: () => void
  readonly onDisable?: (id: string) => void
  readonly onReinstate?: (id: string) => void
  readonly onSyncIntervalChange?: (next: string) => void
  readonly onTestConnection?: () => void
  readonly onViewAudit?: () => void
}): MembersScreenProps {
  const query = input.query ?? ''
  const role = input.role ?? ALL_ROLES
  const statusLabel = input.status ?? ALL_STATUSES
  // 解析放在遍历之外,且**先于**任何 map/filter —— 见 matchesFilters 的参数注释:
  // 放进循环里的话,零行时它一次都不会跑,一个拼错的筛选值会安静地「通过」。
  const status = resolveStatusFilter(statusLabel)

  const rows = input.subjects
    .map(toRow)
    .filter((row) => matchesFilters(row, { query, role, status }))

  return {
    rows,
    // 越界与 -1 都由屏幕按「未选中」处理,这里不夹逼 —— 夹逼会把宿主的一个真 bug
    // (下标没跟着筛选复位)变成「莫名其妙选中了第一行」,更难查。
    selectedIndex: input.selectedIndex ?? -1,
    // ⚠️ 分母是**筛选前**的条数。用 capacity.memberCount 会渲染出「4 / 2」,见模块注释。
    totalCount: input.subjects.length,
    countComplete: input.complete,
    // D2:容量读数只有一个构造点。isolationLevel 认不出的第三档在那里抛,不在这里退化。
    capacity: toCapacityReading(input.capacity),
    query,
    role,
    roleOptions: roleOptionsOf(input.subjects),
    status: statusLabel,
    statusOptions: STATUS_OPTIONS,
    // 🚨 没有同步运行的记录。屏上会显示「从未同步」—— 那一档本身也不精确,
    //    但拿 max(updatedAt) 顶替是把行级事实当成运行级事实。见模块注释。
    lastSyncedAt: null,
    requestId: input.requestId,
    idp: input.idp,
    // exactOptionalPropertyTypes 下不能写 `onX: input.onX` —— 那会把 `undefined`
    // 显式赋给一个可选属性,类型上不合法。省略与「传了个 undefined」在这里是两回事:
    // 屏幕按「省略即只展示」退化(Select 变成只读),而不是接一个吞掉的回调。
    ...(input.onQueryChange === undefined ? {} : { onQueryChange: input.onQueryChange }),
    ...(input.onRoleChange === undefined ? {} : { onRoleChange: input.onRoleChange }),
    ...(input.onStatusChange === undefined ? {} : { onStatusChange: input.onStatusChange }),
    ...(input.onSelect === undefined ? {} : { onSelect: input.onSelect }),
    ...(input.onSync === undefined ? {} : { onSync: input.onSync }),
    ...(input.onAddMember === undefined ? {} : { onAddMember: input.onAddMember }),
    ...(input.onDisable === undefined ? {} : { onDisable: input.onDisable }),
    ...(input.onReinstate === undefined ? {} : { onReinstate: input.onReinstate }),
    ...(input.onSyncIntervalChange === undefined
      ? {}
      : { onSyncIntervalChange: input.onSyncIntervalChange }),
    ...(input.onTestConnection === undefined ? {} : { onTestConnection: input.onTestConnection }),
    ...(input.onViewAudit === undefined ? {} : { onViewAudit: input.onViewAudit }),
  }
}
