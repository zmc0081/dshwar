/**
 * 运营后台应用 —— 把控制台九屏接进真实 `/v1/admin` API。
 *
 * ## 它做什么、不做什么
 *
 * 做:hash 路由 → 选屏 · 拉数据 → `view/*` 转换层 → props。
 * 不做:任何网络原语。`fetch` 只出现在 `api.ts`(守卫盯着,一个前端包
 * 恰好一个出口)。也不做任何**写**操作 —— 见下面那句话。
 *
 * ## 🚨 这一版整个是只读的,而那不是偷懒
 *
 * `/v1/admin` 面今天只有 `PATCH …/{id}/quota` 一条写端点,而 `QuotasScreen`
 * 没有配额编辑控件。于是本文件**一个 `on*Save` 都不接**。
 *
 * 接一个「点了什么都不发生」的保存按钮,与接一个「发了请求但服务端没有这个
 * 端点」的按钮,在屏幕上是同一个样子:用户点完,界面不动,他会再点一次。
 * 本仓把这一族叫「假成功回执」,它是最贵的那一族 —— 所以宁可让按钮闲着,
 * 并把闲着的原因写进下面的缺口表。
 *
 * ⚠️ **但设计系统那边有两处按钮不会因为「没接回调」而置灰**,这是真缺陷,
 * 记在这里不藏:
 *
 * | 位置 | 形状 |
 * | --- | --- |
 * | `BrandingScreen:203` | `onClick={() => onSave?.()}`,`disabled` 只看 `saving` |
 * | `MembersScreen:321` | 「添加成员」同形 |
 * | `MembersScreen:293` | 行内「停用 / 启用」同形 |
 *
 * 三处都是**点了没反应**,而不是**说了假话** —— 危害小一级,但仍然要修。
 * 修法是把 `disabled={onX === undefined}` 加上去,那属于设计系统的改动,
 * 不在本文件的范围里。
 *
 * ## 🚨 而第四处**是**说假话:成员表被一个恒为假的条件藏掉
 *
 * `MembersScreen.tsx:264` 是 `const connected = idp !== null`,第 369 行把
 * **整张成员表**挂在它下面。契约里没有 IdP 端点 ⇒ `idp` 唯一诚实的取值是
 * `null` ⇒ 在**任何**诚实的部署里那个条件恒为假 ⇒ 屏幕走进空态,
 * 标题写着「还没有同步到成员」—— 而 `/v1/admin/subjects` 刚刚返回了一串人。
 *
 * 实测(桩服务端返回 3 位成员):屏上一个人都没有,只有那句空态。
 * 这不是「少显示了点东西」,是**界面说的与系统知道的不一致**,
 * 而它看起来完全正常 —— 一个措辞得体的空态,没有人会去怀疑它。
 *
 * ⇒ 本文件在它上面摆一条更正(见 {@link App} 的 `renderMembers`)。
 * 遮不掉那句假话,至少不让它单独说话。真正的修法是把表格与 `connected` 解耦:
 * IdP 连接卡该独立地说「未配置」,而不是替成员表决定要不要出现。
 *
 * ## 加载与错误:四态,不是两态
 *
 * `loading` / `ok` / `failed` 之外还有 **`not-implemented`**。它不属于
 * `failed`:失败该让人重试,而没实现重试一万次也一样。控制台这一面只有
 * `/v1/admin/policies` 会走到它(部署没接策略存储时网关回落 501)。
 *
 * ⚠️ **`kind !== 'ok'` 时一律不给屏幕喂空数组。** 空数组读作「没有数据」,
 * 而真相是「没读到」—— 两者的下一步完全相反(前者去查为什么没消耗,
 * 后者去查为什么没数据)。所以每一屏进门先判 `kind`,不 ok 就换成一张说明卡。
 *
 * ---
 *
 * # 屏上的字段 × 有没有来源
 *
 * 这张表是本文件的**主要产出之一**。规则:加一个 `'—'` / `null` / `[]`
 * 之前先在这里加一行。一个没有出处的值,与一个编出来的值,在屏幕上长得一样。
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | **总览** 计费周期 `period` | ❌ Admin 面没有账期端点 | `view/overview.ts` 出 `'—'` |
 * | **总览** 活跃租户数 / Agent 运行数 | ❌ 按租户签发的 key 看不到跨租户;`/v1/jobs` 是 planned | 同上,`'—'` |
 * | **总览** 租户表 | ❌ 无租户端点 | 同上,空表 + `tenantTotal: '—'` |
 * | **租户列表屏** 整屏 | ❌ 无 `/v1/admin/tenants` | **不渲染**,换成缺口卡。见下面的 🚨 |
 * | **租户详情屏** 整屏 | ❌ 同上 | 同上 |
 * | **成员** `requestId` | ⚠️ 契约响应里有,`ConsoleApi.listSubjects()` 只取了 `.data` | 传 `null`;修法是放宽 `api.ts` 的返回,不是在这里造一个 |
 * | **成员** `lastSyncedAt` | ❌ 没有同步运行记录 | `view/members.ts` 出 `null` →「从未同步」 |
 * | **成员** IdP 连接卡 | ❌ 契约里没有这个端点 | `idp: null` → 卡片走未配置态,同步按钮自动置灰 |
 * | **成员** 添加 / 停用 / 启用 | ❌ 身份由 SCIM 供给系统写入,Admin 面没有写端点 | 不接回调(逻辑档下的「添加成员」除外,见下) |
 * | **模型准入** 模型目录 | ❌ 没有目录端点 | `catalog: []` → 表格空态,那句空态文案说的正好是实情 |
 * | **模型准入** `notifyMembers` | 🚨 契约里没有,而布尔没有「说不知道」的表达 | 传 `false` **并在屏上方挂一张说明卡**;不接 `onNotifyMembersChange`,改不动比「改得动却存不下」诚实 |
 * | **模型准入** 降级事件 / 上游事件流 | ❌ 没有事件端点 | `view/models.ts` 出 `null` / `[]` |
 * | **配额与账单** 租户清单 | ⚠️ 无租户端点;从 `subjects` ∪ `usage` 的 `tenantId` 反推 | 见 {@link tenantIdsFrom} —— 它是**下界**,不是全集 |
 * | **配额与账单** 配额属于谁 | ⚠️ 配额按主体、这一屏按租户选,契约里没有租户级配额 | 主体由用户在成员屏点选;没点 → `quota: null` → 不渲染配额卡 |
 * | **配额与账单** 告警线 / 单次运行上限 / 并发上限 | ❌ 契约里没有 | `view/quotas.ts` 出 `null` / `'—'` |
 * | **配额与账单** `enforcement` | ⚠️ 契约给不出,要按执行层的实际语义裁一次 | 见 {@link enforcementOf} —— 本文件做的**唯一一次裁决**,依据写在那里 |
 * | **用量** `requestId` | ⚠️ 同成员屏,`api.usage()` 只取了 `.data` | 传 `null` |
 * | **用量** 「部门」维度 | ❌ `UsageRecord` 里没有部门 | 选中它时**拒绝并说出来**,不静默、也不抛掉整屏。见 {@link App} 里的 `dimensionGap` |
 * | **审计** 导出 | ❌ 没有导出端点 | 不接 `onExport` |
 * | **品牌与外观** 读 / 写 | ❌ 两个方向都没有端点 | 读:用**运行期注入**的那份(见 `main.tsx`);写:不接,并在屏上方挂说明卡 |
 * | **外壳** 操作者身份 | ❌ Admin Key 认不出「我是谁」,没有 whoami 端点 | 由宿主注入;没注入就显示 `'—'` / 「未知操作者」,**不编一个名字** |
 * | **外壳** `scope`(顶栏租户标签) | ✅ 仅当用户在配额屏选了租户 | 其余路由一律 `null` —— 那个标签会被截进工单当证据 |
 * | **外壳** `preview`(走查开关) | — 真实部署没有这回事 | `null`。它切的是**安全等级**的显示,而不改任何服务端状态 |
 *
 * ## 🚨 两屏刻意不渲染 —— 而原因在设计系统里,不在数据缺口
 *
 * `TenantsScreen` 的**行数据是写死在组件里的夹具**(6 个租户名、
 * 一句点名某租户的隔离横幅、一个 `1–6 / 24` 的计数、以及一个带 `copyable`
 * 的假 `req_9f3c21ab7e`)。把它挂上真实控制台,管理员看到的是六个不存在的
 * 租户,以及一个粘进工单就查不到的 request id。
 *
 * 它的 `empty` 分支也不能用:那一支把副标题写成「还没有租户」(一句我们
 * 没有依据的计数断言),空态提示里又写死了「当前容量基线:逻辑档 ·
 * MEMBER CAP 1 人」—— 而它正上方的 `CapacityReadout` 显示的是**真实**容量。
 * 两个数并排,一个真一个假。
 *
 * `TenantScreen` 则是另一回事:它的 props 全部必填且全部没有来源
 * (身份 / 配额读数 / 限额草稿 / 近期运行 / 凭据),凑齐它就是凭空造一个租户。
 *
 * ⇒ 两条路由都**可达**,进去看到的是一张说明卡:缺哪个端点、为什么现在
 * 不画那一屏。这比一个画得很像的假屏诚实,也比一个 404 有用。
 *
 * @module @dshwar/console-web/App
 */
import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  SUGGESTED_PRIMARY_COLOR,
  type ConsoleCapacity,
  type TenantBranding,
} from '@dshwar/console-contract'
import { AuditScreen } from '@dshwar/design-system/screens/console/AuditScreen'
import {
  BrandingScreen,
  type BrandingDraft,
} from '@dshwar/design-system/screens/console/BrandingScreen'
import { IsolationGate } from '@dshwar/design-system/screens/console/IsolationGate'
import { MembersScreen } from '@dshwar/design-system/screens/console/MembersScreen'
import { ModelsScreen } from '@dshwar/design-system/screens/console/ModelsScreen'
import { OverviewScreen } from '@dshwar/design-system/screens/console/OverviewScreen'
import {
  QuotasScreen,
  type PolicyEnforcement,
} from '@dshwar/design-system/screens/console/QuotasScreen'
import {
  Shell,
  type ShellAccount,
  type ShellBranding,
  type ShellTheme,
} from '@dshwar/design-system/screens/console/Shell'
// ⚠️ 只取 `EmptyState`。**`TenantsScreen` 本体刻意不引** —— 理由见模块注释的
//   「两屏刻意不渲染」。副作用是它的夹具数据仍会进 bundle(同一个模块),
//   那是体积问题,不是正确性问题;拆掉要动设计系统的文件划分,归后面的 Session。
import { EmptyState } from '@dshwar/design-system/screens/console/TenantsScreen'
import {
  UsageScreen,
  type UsageBarDensity,
  type UsageDimension,
} from '@dshwar/design-system/screens/console/UsageScreen'
import {
  asMaybeImplemented,
  type AuditEntry,
  type ConsoleApi,
  type MaybeImplemented,
  type Page,
  type Policy,
  type Quota,
  type Subject,
  type UsageRecord,
} from './api.ts'
import { CapacityPage } from './pages/Capacity.tsx'
import { hrefOf, parseRoute, ROUTE_OF_SCREEN, SCREEN_OF_ROUTE, type Route } from './router.ts'
import { ALL_ACTIONS, DEFAULT_RANGE, toAuditProps } from './view/audit.ts'
import { toDraft } from './view/branding.ts'
import { toCapacityReading } from './view/capacity.ts'
import { ALL_ROLES, ALL_STATUSES, toMembersProps } from './view/members.ts'
import { pickPolicy, toModelsProps } from './view/models.ts'
import { toOverviewProps } from './view/overview.ts'
import { toQuotasProps } from './view/quotas.ts'
// ⚠️ 「全部租户」那一档不在这里写死成 `ALL_TENANTS` —— 它已经是
//   `INITIAL_USAGE_VIEW_STATE.tenant` 的值。两处各取一次就是两个来源,
//   而它们今天恰好相等 —— 那正是 D2 那笔账的形状。
import {
  INITIAL_USAGE_VIEW_STATE,
  toUsageProps,
  USAGE_DIMENSIONS_WITH_SOURCE,
} from './view/usage.ts'

/**
 * 一次远程读取的四种状态。**`not-implemented` 不是 `failed` 的一种。**
 *
 * 与 `workbench-web/src/App.tsx` 的那份同形 —— 两个前端对「没实现」的
 * 处理必须一致,否则同一个 501 在两处会长成两个样子。
 */
export type Remote<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'not-implemented'
      readonly plannedVersion: string | null
      readonly requestId: string | null
    }

/**
 * 「还没到 `ok`」的那三档。
 *
 * 从 {@link Remote} 现取,**不另写一份联合** —— 抄一份的后果是
 * `Remote` 将来加一档而这里没跟上,那一档会安静地掉进某个 `else` 分支,
 * 显示成另一种状态的措辞。同一条纪律见 `Shell` 的 `ShellIsolation`。
 */
type Pending = Exclude<Remote<unknown>, { readonly kind: 'ok' }>

/**
 * 订阅 hash 变化。
 *
 * ⚠️ 用 `hashchange` 而不是 `popstate` —— 后者是 history router 的事件,
 * 而 D7 约束 1 明确不用 history router。两者在同一个页面里表现相近,
 * 但 `popstate` 在 Tauri 的文件协议下不触发。
 */
function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export interface AppProps {
  readonly api: ConsoleApi
  /**
   * 品牌配置。**运行期下发**,不编译进产物 —— 一个二进制服务所有租户。
   *
   * ⚠️ 这也是「品牌与外观」那一屏**唯一**的读来源:契约里没有品牌端点。
   * 它不是兜底,是实情 —— 宿主注入了什么,这个部署的品牌就是什么;
   * 没注入的字段就是**未配置**(`NEUTRAL_BRANDING` 的那些 `null`),
   * 而未配置是一个完整的、受支持的形态,不是半成品。
   */
  readonly branding: TenantBranding
  /**
   * 当前操作者。
   *
   * ⚠️ **Admin Key 认不出「我是谁」** —— 它按租户签发,不代表某个人,
   * 而 `/v1/admin` 面没有 whoami 端点。所以身份只能由宿主注入;
   * 宿主没注入时 `main.tsx` 传的是显式的「未知」,不是一个编出来的名字。
   */
  readonly operator: ShellAccount
}

export function App({ api, branding, operator }: AppProps): React.JSX.Element {
  const route = useRoute()

  // ---- 远程数据。五个来源,各自独立失败 ----
  const [capacity, setCapacity] = useState<Remote<ConsoleCapacity>>({ kind: 'loading' })
  const [subjects, setSubjects] = useState<Remote<Page<Subject>>>({ kind: 'loading' })
  const [usage, setUsage] = useState<Remote<Page<UsageRecord>>>({ kind: 'loading' })
  const [policies, setPolicies] = useState<Remote<Page<Policy>>>({ kind: 'loading' })
  const [audit, setAudit] = useState<Remote<Page<AuditEntry>>>({ kind: 'loading' })
  const [quota, setQuota] = useState<Remote<Quota | null>>({ kind: 'ok', value: null })

  // ---- 界面状态。全部由本层持有,屏幕不留副本 ----
  const [theme, setTheme] = useState<ShellTheme>('light')
  const [memberQuery, setMemberQuery] = useState('')
  const [memberRole, setMemberRole] = useState<string>(ALL_ROLES)
  const [memberStatus, setMemberStatus] = useState<string>(ALL_STATUSES)
  /**
   * 选中的成员,按 **id** 记,不按下标。
   *
   * ⚠️ 这是 `view/audit.ts` 那条「选中态按 id 传」在成员屏的同款落地:
   * 下标指向的是「上一次筛选结果里的第几行」,筛选条件一变就可能指到
   * 另一个人 —— 而屏上只是高亮换了一行,没有任何提示。按 id 记之后,
   * 「选中的是另一个人」这个 bug 在结构上不可能发生。
   */
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [usageDimension, setUsageDimension] = useState<UsageDimension>(
    INITIAL_USAGE_VIEW_STATE.dimension,
  )
  /** 被拒绝的那个维度;`null` = 没人试过。见 {@link AppProps} 上方缺口表的「部门」一行。 */
  const [dimensionGap, setDimensionGap] = useState<UsageDimension | null>(null)
  const [usageTenant, setUsageTenant] = useState<string>(INITIAL_USAGE_VIEW_STATE.tenant)
  const [seriesLimit, setSeriesLimit] = useState<number>(INITIAL_USAGE_VIEW_STATE.seriesLimit)
  const [barDensity, setBarDensity] = useState<UsageBarDensity>(INITIAL_USAGE_VIEW_STATE.barDensity)
  const [auditQuery, setAuditQuery] = useState('')
  const [auditAction, setAuditAction] = useState<string>(ALL_ACTIONS)
  const [auditRange, setAuditRange] = useState<string>(DEFAULT_RANGE)
  const [auditId, setAuditId] = useState<string | null>(null)
  /**
   * 审计的「现在」。
   *
   * ⚠️ 取的是**这批数据到手的时刻**,不是每次渲染的 `new Date()`。
   * 后者会让「近 24 小时」的窗口随渲染悄悄前移,于是一条记录可能在
   * 用户没做任何事的情况下自己滑出列表。窗口的原点应当与数据同龄。
   */
  const [auditNow, setAuditNow] = useState<Date>(() => new Date())
  /** 开户闸门。`'isolation'` = 逻辑档下有人点了「添加成员」。 */
  const [gate, setGate] = useState<'closed' | 'isolation'>('closed')
  const [draft, setDraft] = useState<BrandingDraft>(() => toDraft(branding))

  const go = useCallback((next: Route): void => {
    // ⚠️ 赋值给 `location.hash` 而不是 `history.pushState` ——
    //   后者被 D7 约束 1 的守卫明确禁掉(它在 Tauri 里没有服务端回落)。
    window.location.hash = hrefOf(next)
  }, [])

  // ---- 容量。D2 要求它常驻首页,也是成员屏与开户闸门的唯一来源 ----
  useEffect(() => {
    let alive = true
    api.capacity().then(
      (value) => {
        if (alive) setCapacity({ kind: 'ok', value })
      },
      (error: unknown) => {
        if (alive) setCapacity({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  // ---- 成员 ----
  useEffect(() => {
    let alive = true
    api.listSubjects().then(
      (value) => {
        if (alive) setSubjects({ kind: 'ok', value })
      },
      (error: unknown) => {
        if (alive) setSubjects({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  // ---- 用量 ----
  useEffect(() => {
    let alive = true
    api.usage().then(
      (value) => {
        if (alive) setUsage({ kind: 'ok', value })
      },
      (error: unknown) => {
        if (alive) setUsage({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  // ---- 准入策略。★ 这是控制台唯一会回落 501 的端点,**如实往下传** ----
  useEffect(() => {
    let alive = true
    asMaybeImplemented(() => api.policies()).then(
      (result) => {
        if (!alive) return
        setPolicies(
          result.kind === 'ok'
            ? { kind: 'ok', value: result.value }
            : {
                kind: 'not-implemented',
                plannedVersion: result.plannedVersion,
                requestId: result.requestId,
              },
        )
      },
      (error: unknown) => {
        if (alive) setPolicies({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  // ---- 审计 ----
  useEffect(() => {
    let alive = true
    api.audit().then(
      (value) => {
        if (!alive) return
        setAudit({ kind: 'ok', value })
        setAuditNow(new Date())
      },
      (error: unknown) => {
        if (alive) setAudit({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  // ---- 选中主体的配额。没选人就是没有,不是失败 ----
  useEffect(() => {
    if (subjectId === null) {
      setQuota({ kind: 'ok', value: null })
      return
    }
    let alive = true
    setQuota({ kind: 'loading' })
    api.getQuota(subjectId).then(
      (value) => {
        if (alive) setQuota({ kind: 'ok', value })
      },
      (error: unknown) => {
        if (alive) setQuota({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api, subjectId])

  const tenantIds = tenantIdsFrom(pageOf(subjects), pageOf(usage))

  // ---- 唯一租户时替用户选中它;多于一个时**不替他选** ----
  useEffect(() => {
    if (tenantId !== null) return
    // ⚠️ 在 effect 里重算一遍,而不是把上面那个 `tenantIds` 放进依赖数组:
    //   它每次渲染都是一个新数组,进依赖就是每次渲染都跑一次 effect。
    const ids = tenantIdsFrom(pageOf(subjects), pageOf(usage))
    // ⚠️ 只在「恰好一个」时自动选。两个以上还替他挑一个的话,屏上会出现一份
    //   属于某个租户的读数,而他从没选过那个租户 —— 与 `policies[0]` 那条
    //   「静默展示别人的策略」是同一族。
    const only = ids.length === 1 ? ids[0] : undefined
    if (only !== undefined) setTenantId(only)
  }, [subjects, usage, tenantId])

  return (
    <Shell
      branding={toShellBranding(branding)}
      screen={SCREEN_OF_ROUTE[route]}
      theme={theme}
      // 🚨 顶栏那个 accent 标签会被截图进工单,当成「这次操作发生在哪个租户」的
      //    证据。所以只有用户**真的选了**租户的那一屏才给它值。
      scope={route === 'billing' ? tenantId : null}
      account={operator}
      // 走查开关。真实部署一律 null —— 它切的是安全等级的**显示**,
      // 而不改任何服务端状态,给管理员一张关于隔离档的假回执。
      preview={null}
      onNavigate={(id) => go(ROUTE_OF_SCREEN[id])}
      onTheme={setTheme}
    >
      {renderScreen()}
    </Shell>
  )

  function renderScreen(): React.JSX.Element {
    switch (route) {
      case 'capacity':
        return renderOverview()
      case 'tenants':
        return (
          <Gap
            icon="building-2"
            title="租户列表还没有数据源"
            body="契约里没有 /v1/admin/tenants —— 控制台读不到租户清单。设计稿里那张表今天是组件内的夹具(六个不存在的租户名、一个查不到的 request id),挂上来只会让人以为它是真的。"
            hint="缺口:GET /v1/admin/tenants · 端点落地前这一屏保持空白"
          />
        )
      case 'tenant':
        return (
          <Gap
            icon="building-2"
            title="租户详情还没有数据源"
            body="这一屏的每一项(身份、配额读数、限额、近期运行、凭据状态)都必填,而它们一个都没有端点。凑齐它等于凭空造一个租户 —— 那比一张空白页贵得多。"
            hint="缺口:GET /v1/admin/tenants/{id} · 连 id 都还没有地方可查"
          />
        )
      case 'members':
        return renderMembers()
      case 'models':
        return renderModels()
      case 'billing':
        return renderQuotas()
      case 'usage':
        return renderUsage()
      case 'audit':
        return renderAudit()
      case 'settings':
        return renderBranding()
    }
  }

  /**
   * 总览 + D2 的容量读数。
   *
   * ⚠️ `CapacityPage` 是 V0.5.0 留下的那一页,**原样留在首页**而不是重画一遍:
   * 它把三档状态说成人话(「单用户部署」/「还剩 1 个名额」/「必须改用进程隔离」),
   * 而 `OverviewScreen` 里没有任何一格在说容量。两者不重叠。
   */
  function renderOverview(): React.JSX.Element {
    if (capacity.kind !== 'ok') return remoteNotice(capacity, '容量读数', 'GET /v1/admin/capacity')
    if (usage.kind !== 'ok') return remoteNotice(usage, '用量记录', 'GET /v1/admin/usage')
    if (subjects.kind !== 'ok') return remoteNotice(subjects, '成员清单', 'GET /v1/admin/subjects')
    const cap = capacity.value
    const records = usage.value
    const list = subjects.value
    return attempt(() => (
      <>
        <CapacityPage capacity={cap} />
        <OverviewScreen
          {...toOverviewProps({
            capacity: cap,
            usage: records.data,
            subjects: list.data,
            // 「查看全部租户」去的是租户屏 —— 那里今天是一张说明卡。
            // 送人去一张说清缺口的页,好过给一个点了没反应的链接。
            onViewAllTenants: () => go('tenants'),
          })}
        />
      </>
    ))
  }

  function renderMembers(): React.JSX.Element {
    if (subjects.kind !== 'ok') return remoteNotice(subjects, '成员清单', 'GET /v1/admin/subjects')
    if (capacity.kind !== 'ok') return remoteNotice(capacity, '容量读数', 'GET /v1/admin/capacity')
    // 先落成局部 const 再进闭包 —— 不指望 TS 把 `capacity` 的收窄带进箭头函数里。
    const cap = capacity.value
    const list = subjects.value
    const reading = attemptValue(() => toCapacityReading(cap))
    if (reading.kind === 'failed') return conversionNotice('容量读数', reading.message)
    const isolation = reading.value.isolation

    // ★ 先算 props,再用它的 `rows` 把 id ↔ 下标换算清楚。
    //   顺序不能反:`rows` 是**筛选后**的,而筛选发生在转换层里。
    //
    // ⚠️ 走 `attemptValue` 而不是直接调:`toMembersProps` 里有会抛的分支
    //   (认不出的成员状态、认不出的隔离档)。直接调的话那个 throw 会穿过
    //   React 渲染,把整棵树连同左侧导航一起卸掉 —— 见 {@link attempt}。
    const built = attemptValue(() =>
      toMembersProps({
        subjects: list.data,
        capacity: cap,
        // ★ V0.9.0 收尾:`api.ts` 改成返回 {@link Page} 之后,requestId 真的有了。
        //   翻了几页就有几个 —— 取**第一个**,并在 UI 上带出总页数。
        //   一个也没有(不该发生)时给 null,而不是编。
        requestId: list.requestIds[0] ?? null,
        // ⚠️ 撞上自动翻页上限时,「共 N 人」这句话就不成立了 ——
        //   调用方必须据此改口。传下去,不在这里悄悄圆场。
        complete: list.complete,
        idp: null,
        query: memberQuery,
        role: memberRole,
        status: memberStatus,
        onQueryChange: setMemberQuery,
        onRoleChange: setMemberRole,
        onStatusChange: setMemberStatus,
        onViewAudit: () => go('audit'),
        // 逻辑档下先手弹开户闸门,而不是打开一个不存在的添加表单。
        // 进程档下**不接** —— Admin 面没有创建成员的端点,身份由 SCIM 供给系统写入。
        ...(isolation === 'logical' ? { onAddMember: () => setGate('isolation') } : {}),
      }),
    )
    if (built.kind === 'failed') return conversionNotice('成员清单', built.message)
    const base = built.value
    const selectedIndex =
      subjectId === null ? -1 : base.rows.findIndex((row) => row.id === subjectId)

    return (
      <>
        {/*
          🚨 **屏幕会把这 N 位成员整个藏起来,并说一句假话。**

          `MembersScreen.tsx:264` 是 `const connected = idp !== null`,而第 369 行
          把**整张成员表**挂在 `connected` 下面。契约里没有 IdP 端点,`idp` 唯一
          诚实的取值就是 `null` —— 于是在**任何**诚实的部署里 `connected` 恒为假,
          屏幕走进那个空态,标题写着「还没有同步到成员」。

          那句话在这里是**错的**:`/v1/admin/subjects` 刚刚返回了 N 位成员。
          它与本仓最贵的那一族同形 —— 界面说的与系统知道的不一致,而它看起来
          完全正常(一个措辞得体的空态,谁都不会怀疑)。

          ⇒ 修法是把表格与 `connected` 解耦(IdP 连接卡该独立地说「未配置」,
          而不是替成员表决定要不要出现)。那是设计系统的改动,不在本文件的范围里。
          在它落地之前,把这句更正**摆在假话上面** —— 遮不掉它,至少不让它单独说话。
        */}
        {base.totalCount > 0 ? (
          <Gap
            icon="triangle-alert"
            title={`下面那句「还没有同步到成员」是错的 —— 实际读到 ${base.totalCount} 位`}
            body="这一屏把成员表挂在「IdP 连接已配置」这个条件下,而契约里没有 IdP 端点,那个条件永远为假。于是真实的成员被整个藏起来,换成了一句我们知道不成立的空态文案。这是设计系统的一处待修,不是数据问题。"
            hint={`MembersScreen.tsx:264 const connected = idp !== null · 本次 GET /v1/admin/subjects 返回 ${base.totalCount} 条`}
          />
        ) : null}
        <MembersScreen
          {...base}
          selectedIndex={selectedIndex}
          onSelect={(index) => setSubjectId(base.rows[index]?.id ?? null)}
        />
        <IsolationGate
          open={gate === 'isolation'}
          capacity={reading.value}
          // 🚨 `null` 是对的:闸门是**先手**弹的,添加请求根本没发出去,
          //    自然没有 requestId 可给。拿一句「(无)」把空位填满,
          //    等于把「我没拿到」伪装成「他忘了贴」。
          evidence={null}
          onClose={() => setGate('closed')}
        />
      </>
    )
  }

  function renderModels(): React.JSX.Element {
    if (policies.kind !== 'ok') {
      return remoteNotice(policies, '准入策略', 'GET /v1/admin/policies')
    }
    if (tenantId === null) return chooseTenantNotice()
    const policy = pickPolicy(policies.value.data, tenantId)
    if (policy === null) {
      return (
        <Gap
          icon="boxes"
          title={`租户 ${tenantId} 没有准入策略记录`}
          body="策略端点读通了,而这个租户在里面没有记录。执行层对没有记录的租户是原样放行(见 packages/model-router/src/index.ts)—— 这一屏因此没有可展示的白名单,而不是「一个模型都不准」。"
          hint="没有写端点,策略今天只能在部署侧的 governance.modelPolicies 里配"
        />
      )
    }
    return attempt(() => (
      <>
        <Gap
          icon="bell-off"
          title="「在工作台内提示成员」这一项没有来源"
          body="契约里没有这个字段,而布尔值没有「说不知道」的表达 —— 屏上那个未勾选的复选框与「明确配置为不提示」长得一模一样。它显示的 false 不代表任何已保存的配置,也存不下去(没有写端点),所以这里不接它的回调:改不动,比改得动却存不下诚实。"
          hint="缺口:Policy 里没有 notifyMembers · 也没有 PATCH /v1/admin/policies"
        />
        <ModelsScreen
          {...toModelsProps({
            policy,
            // 没有目录端点 → 空表格 + 空态文案,而那句话说的正好是实情。
            catalog: [],
            notifyMembers: false,
          })}
        />
      </>
    ))
  }

  function renderQuotas(): React.JSX.Element {
    if (subjects.kind !== 'ok') return remoteNotice(subjects, '成员清单', 'GET /v1/admin/subjects')
    if (policies.kind === 'loading' || policies.kind === 'failed') {
      return remoteNotice(policies, '准入策略', 'GET /v1/admin/policies')
    }
    const result: MaybeImplemented<readonly Policy[]> =
      policies.kind === 'ok'
        ? { kind: 'ok', value: policies.value.data }
        : {
            kind: 'not-implemented',
            plannedVersion: policies.plannedVersion,
            requestId: policies.requestId,
          }
    const verdict = enforcementOf(result, tenantId)

    return attempt(() => (
      <QuotasScreen
        {...toQuotasProps({
          tenants: tenantIds,
          selectedTenantId: tenantId,
          policies: result,
          // ⚠️ 「读不到」与「没有」在这一格上都传 null —— 转换层的注释明说
          //   `null` = 没读到 / 没有。两者的区别由配额卡整块不渲染承担。
          quota: quota.kind === 'ok' ? quota.value : null,
          catalog: [],
          enforcement: verdict.enforcement,
          enforcementCode: verdict.code,
          onTenantChange: setTenantId,
        })}
      />
    ))
  }

  function renderUsage(): React.JSX.Element {
    if (usage.kind !== 'ok') return remoteNotice(usage, '用量记录', 'GET /v1/admin/usage')
    const records = usage.value
    return (
      <>
        {dimensionGap === null ? null : (
          <Gap
            icon="chart-column"
            title={`「${dimensionGap === 'department' ? '部门' : dimensionGap}」维度没有数据源`}
            body="UsageRecord 里只有主体、租户、模型三个可分组的字段,没有部门归属。已经保持在原来的维度上 —— 换过去会画出一张分不出组的图,而那张图看起来完全正常。"
            hint="缺口:UsageRecord 无 department · 要分部门得先由 IdP 同步组织结构"
          />
        )}
        {attempt(() => (
          <UsageScreen
            {...toUsageProps({
              records: records.data,
              dimension: usageDimension,
              tenant: usageTenant,
              seriesLimit,
              barDensity,
              // ⚠️ 契约的 ListUsageResponse 带 requestId,`api.usage()` 只取了 `.data`。
              //   同成员屏:修法在 api.ts,不在这里造一个。
              requestId: null,
              onDimensionChange: (next) => {
                // ★ **不把没有来源的维度收进状态。** 收进去之后这一屏只能整个换成
                //   说明卡,而那时用户没有任何控件可以切回来 —— 一条走进去就出不来的路。
                //   ⇒ 拒绝 + 说出来,原维度保持不动。沉默的拒绝比说出来的拒绝糟。
                if (USAGE_DIMENSIONS_WITH_SOURCE.includes(next)) {
                  setUsageDimension(next)
                  setDimensionGap(null)
                  return
                }
                setDimensionGap(next)
              },
              onTenantChange: setUsageTenant,
              onSeriesLimitChange: setSeriesLimit,
              onBarDensityChange: setBarDensity,
              onBillingPreview: () => go('billing'),
            })}
          />
        ))}
      </>
    )
  }

  function renderAudit(): React.JSX.Element {
    if (audit.kind !== 'ok') return remoteNotice(audit, '审计记录', 'GET /v1/admin/audit')
    const entries = audit.value
    return attempt(() => (
      <AuditScreen
        {...toAuditProps({
          entries: entries.data,
          now: auditNow,
          selectedId: auditId,
          query: auditQuery,
          actionFilter: auditAction,
          range: auditRange,
          onSelect: (_index, id) => setAuditId(id),
          onQueryChange: setAuditQuery,
          onActionFilterChange: setAuditAction,
          onRangeChange: setAuditRange,
        })}
      />
    ))
  }

  /**
   * 品牌与外观。
   *
   * ⚠️ 这一屏**读得到、存不下**,而两者的原因不同:
   * 读的那份来自运行期注入(宿主知道这个部署配了什么);
   * 写没有端点,所以不接 `onSave` / `onReset`。
   *
   * 接 `onChange` 是有价值的:这一屏的主体是**派生结果预览**
   * (输入一个主色,看六个角色令牌派生成什么样)。那份计算在本地完成,
   * 不需要服务端 —— 它是这一屏今天唯一真的能做的事。
   */
  function renderBranding(): React.JSX.Element {
    return (
      <>
        <Gap
          icon="palette"
          title="品牌配置没有读写端点 —— 这一屏是本地预览"
          body="契约里既没有读也没有写。屏上显示的是宿主在运行期注入的那一份(见 main.tsx),改动只在本页有效,刷新即丢。🚨 而「保存并确认派生结果」那个按钮在没有接收方时也不会置灰 —— 点它不会有任何事发生,那是设计系统的一处待修。"
          hint="缺口:GET / PATCH /v1/admin/branding 都不存在"
        />
        <BrandingScreen
          branding={draft}
          // ⚠️ 建议色是**输入框的占位**,不是默认值 —— 它只影响「用建议起点」
          //   那个按钮和 placeholder,不参与派生。传给 primaryColor 就成了兜底,
          //   而那正是 V0.8.0 拆掉的哨兵。
          suggestedSeed={SUGGESTED_PRIMARY_COLOR}
          onChange={setDraft}
        />
      </>
    )
  }

  /** 没选租户时的说明。**空不是错误,不该长得像错误。** */
  function chooseTenantNotice(): React.JSX.Element {
    return tenantIds.length === 0 ? (
      <Gap
        icon="building-2"
        title="还看不到任何租户"
        body="租户清单是从成员与用量记录的 tenantId 反推的(契约里没有租户端点)。两者都没有记录时,这里就是空的 —— 这不等于「没有租户」,只等于「没有能证明租户存在的记录」。"
        hint="缺口:GET /v1/admin/tenants · 现有清单是下界,不是全集"
      />
    ) : (
      <Gap
        icon="building-2"
        title="先选一个租户"
        body="准入策略是按租户的。到「配额与账单」里选一个,这一屏会跟着显示它的白名单。"
        hint={`可选:${tenantIds.join(' · ')}`}
      />
    )
  }
}

/**
 * 契约品牌 → 外壳品牌。
 *
 * ⚠️ **一个字段都不给默认值**,可空的原样传 `null`:
 * 未配置在这套设计里是**受支持的完整形态**(声明带整行消失、徽标回落成
 * 产品名的文字 wordmark),而不是半成品。给个默认值等于替客户宣称一件
 * 他没配过的事。
 *
 * ⚠️ `copyrightYear` 取**当前年份**而不是写死一个数:写死的那个到了明年
 * 仍在页脚上说去年,而没有任何东西会红。这也正是设计系统把它设成必填的理由。
 */
function toShellBranding(branding: TenantBranding): ShellBranding {
  return {
    productName: branding.productName,
    legalEntityName: branding.legalEntityName,
    logoPath: branding.logoLight?.path ?? null,
    logoDarkPath: branding.logoDark?.path ?? null,
    privacyUrl: branding.privacyPolicyUrl,
    termsUrl: branding.termsOfServiceUrl,
    copyrightYear: new Date().getFullYear(),
  }
}

/**
 * 租户清单的**下界**。
 *
 * ⚠️ 契约里没有租户端点,所以这份清单是从「有成员」或「有用量记录」反推的。
 * 它漏掉**一个成员都没有、也从未产生用量**的租户 —— 那种租户确实存在
 * (刚创建的),而我们看不见它。
 *
 * ⇒ 它是下界,不是全集。屏上不写「共 N 个租户」这类计数断言,
 * 只把这几个当成下拉的选项 —— 选项少一个的代价是「选不到」,
 * 而计数错一个的代价是「读的人以为自己看到了全部」。
 *
 * ⚠️ **刻意不从 `Policy[]` 里取。** 策略端点回落 501 时那一路会变成空,
 * 于是租户下拉整个塌掉,配额那块**真数**被一起藏掉 —— 而屏幕会显示
 * 「还没有租户可配」,一句假话。成员与用量两个来源都不受策略端点影响。
 */
function tenantIdsFrom(
  subjects: readonly Subject[],
  usage: readonly UsageRecord[],
): readonly string[] {
  const seen = new Set<string>()
  for (const s of subjects) seen.add(s.tenantId)
  for (const r of usage) seen.add(r.tenantId)
  // 字典序(UTF-16 码元序),与 `view/usage.ts` 的 `byCodeUnit` 同口径:
  // `localeCompare` 依赖 ICU,同一份数据在两台机器上能排出两种顺序。
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * 执行层拿这份策略**会做什么** —— 本文件唯一的一次裁决。
 *
 * ## 为什么必须在这里裁,而不是在转换层
 *
 * `view/quotas.ts` 刻意把它做成必填入参并写明理由:算它需要在一处
 * **本仓尚未裁决**的矛盾里选边 —— 设计 kit 说「缺席不等于放行」,
 * 而跑在生产路径上的 model-router 三处一致地说「没配策略 = 原样放行」。
 * 转换层不该顺手替人选一边,所以选择落在这里,并且写出来。
 *
 * ## 裁决与依据
 *
 * 判据是:`enforcement` 问的是「**执行层实际会做什么**」——
 * 那是一个关于运行中的系统的**事实问题**,不是一个设计偏好。
 * 于是按 `packages/model-router/src/index.ts` 的实际分支答:
 *
 * | 情形 | 取值 | 依据 |
 * | --- | --- | --- |
 * | 策略端点回落 501 | `not-enforced` | 一条读不到的记录,谁也没在执行它 |
 * | 还没选租户 | `not-enforced` | 断言最弱的一档:没有选中的策略,自然没有执行 |
 * | 读通了,这个租户没有记录 | `allow-all` | model-router:「没配策略 = 不治理,原样放行」 |
 * | `allowedModels: []` | `allow-all` | 契约语义:空清单 = 全部允许(准入 opt-in) |
 * | `allowedModels` 非空 | `allowlist-only` | 清单外的模型走 `deny / model_not_allowed` |
 *
 * ⚠️ **`deny-all` 一次都不会被选中,而那是对的**:model-router 里没有
 * 任何一条分支会一律拒绝。留着这一档是给将来的执行层用的,不是给这里凑的。
 *
 * ## 🚨 错误码只填服务端真的会发的那一枚
 *
 * `model_not_allowed` 是 model-router 的 `deny` reason 原文。它在屏上带
 * `copyable`,会被粘进工单 —— 所以除了 `allowlist-only` 那一档,其余一律
 * `null`。少一枚码,好过多一枚客服查不到的码。
 */
function enforcementOf(
  policies: MaybeImplemented<readonly Policy[]>,
  tenantId: string | null,
): { readonly enforcement: PolicyEnforcement; readonly code: string | null } {
  if (policies.kind === 'not-implemented') return { enforcement: 'not-enforced', code: null }
  if (tenantId === null) return { enforcement: 'not-enforced', code: null }
  const policy = pickPolicy(policies.value, tenantId)
  if (policy === null || policy.allowedModels.length === 0) {
    return { enforcement: 'allow-all', code: null }
  }
  return { enforcement: 'allowlist-only', code: 'model_not_allowed' }
}

interface GapProps {
  readonly icon: string
  readonly title: string
  readonly body: string
  readonly hint: string
}

/**
 * 一处缺口的说明卡。
 *
 * ## 为什么每一处缺口都要**说出来**,而不是留白
 *
 * 留白与「这里本来就没东西」在屏幕上是同一个样子。管理员看到一张空表,
 * 会去查为什么没有数据;看到这张卡,他知道要去查的是**端点还没有**。
 * 两者的下一步完全不同,而只有后者能让他不白花那一轮。
 *
 * ⚠️ `hint` 一律写**具体缺哪个端点**,不写「敬请期待」。
 * 前者是一条可以拿去提 issue 的信息,后者是一句安慰。
 */
function Gap({ icon, title, body, hint }: GapProps): React.JSX.Element {
  return <EmptyState icon={icon} title={title} body={body} hint={hint} />
}

/**
 * 一次远程读取还没到 `ok` 时显示什么。
 *
 * ⚠️ **`failed` 与 `not-implemented` 分开说** —— 前者让人重试,
 * 后者重试一万次也一样。把两者合成一个红色失败态的后果很具体:
 * 用户对着它反复点刷新。
 *
 * ⚠️ 参数类型刻意是 {@link Pending} 而不是 `Remote<unknown>`:
 * 这个函数**只**在「还没到 ok」时有话可说。收下 `ok` 那一档的后果是
 * 它得为一个成功的读取编一句说明 —— 而编不出来的时候,最省事的写法
 * 是给个「未知错误」。收窄之后,拿一份成功的数据来调它是**编译错误**。
 *
 * @param what 人话的名字(「成员清单」),给读的人看
 * @param endpoint 具体端点,给去查日志的人看
 */
function remoteNotice(remote: Pending, what: string, endpoint: string): React.JSX.Element {
  if (remote.kind === 'loading') {
    return <Gap icon="loader" title={`正在读取${what}`} body="等服务端回话。" hint={endpoint} />
  }
  if (remote.kind === 'not-implemented') {
    return (
      <Gap
        icon="construction"
        title={`${what}的端点还没有接线`}
        body="服务端回的是 501:这个端点在契约里有,在这个部署上还没实现。重试不会有帮助 —— 它与「暂时不可用」是两回事。"
        hint={`${endpoint} · 501 · 计划版本 ${remote.plannedVersion ?? '(服务端没说)'} · ${
          remote.requestId ?? '(无 requestId)'
        }`}
      />
    )
  }
  return (
    <Gap
      icon="triangle-alert"
      title={`读不到${what}`}
      // 原样显示服务端那句话:改写它等于在用户与日志之间加一层翻译,
      // 而那层翻译错了没有任何东西会红。
      body={remote.message}
      hint={`${endpoint} · 这是一次失败,不是「没有数据」—— 可以重试`}
    />
  )
}

/** 转换层抛出来时显示什么。措辞与 {@link remoteNotice} 的失败态刻意不同 —— 见 {@link attempt}。 */
function conversionNotice(what: string, message: string): React.JSX.Element {
  return (
    <Gap
      icon="octagon-alert"
      title={`${what}转换不下去`}
      body={message}
      hint="这不是网络问题:服务端给的值超出了界面认得的范围,重试没有用"
    />
  )
}

type Attempt<T> =
  { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'failed'; readonly message: string }

/**
 * 跑一次可能抛的转换。
 *
 * ## 为什么要接住那些 throw,而不是让它炸穿
 *
 * `view/*` 里的每一处 `throw` 都是刻意的:认不出的隔离档、没有来源的
 * 分组维度、混币的用量、目录覆盖不了的准入清单 —— 它们的共同点是
 * **继续画下去就会显示一个看起来完全正常的错数**,所以宁可响亮地停下。
 *
 * 「响亮」是目的,「炸穿整个应用」不是。React 渲染期抛出会把整棵树卸掉,
 * 屏幕变白 —— 那时连左侧导航都没了,用户既看不到原因,也去不了别的屏。
 * ⇒ 接住,把**原样的那段话**印在这一屏的位置上,其余部分照常可用。
 *
 * ⚠️ **原样印,不改写。** 那些消息里写着「为什么不能猜」与「该怎么修」,
 * 是这一族错误最有价值的部分;换成「出错了」等于把它删掉。
 *
 * ⚠️ 它**不**兜底、**不**回落到某个默认值。接住的是「显示什么」,
 * 不是「用什么数继续画」—— 后者正是这些 throw 要拦的事。
 */
function attempt(build: () => React.JSX.Element): React.JSX.Element {
  const result = attemptValue(build)
  return result.kind === 'ok' ? result.value : conversionNotice('这一屏的数据', result.message)
}

/** {@link attempt} 的取值版:调用方要拿转换结果做别的事时用。 */
function attemptValue<T>(build: () => T): Attempt<T> {
  try {
    return { kind: 'ok', value: build() }
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  }
}

/**
 * 取出一页的数据部分。
 *
 * ⚠️ **只在「这一处真的只需要数组」时用。** 它丢掉 `complete` 与 `requestIds`,
 * 而那两样正是 V0.9.0 收尾要补回来的东西 —— 见 api.ts 的 {@link Page}。
 * 需要它们的地方(成员计数、工单标识)必须显式接上,不许走这条捷径。
 */
function pageOf<T>(remote: Remote<Page<T>>): readonly T[] {
  return remote.kind === 'ok' ? remote.value.data : []
}

/** 把任何 throw 出来的东西变成一句能显示的话。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
