/**
 * 极简 hash 路由 —— **D7 约束 1** 的落点。
 *
 * ## 为什么自己写,而不是引 react-router
 *
 * 因为约束本身很小(「用 hash,别用 history」),而引一个路由库会带来
 * 一个**更大的、需要长期盯住的**问题:库的默认导出通常是 history router,
 * 一次误用 `createBrowserRouter` 就违反了约束,而那时守卫要去分辨 dshwar-guard-allow: 说明为什么禁它,必须写出这个名字
 * 「用的是哪个工厂函数」—— 那是个比 20 行代码难维护得多的规则。
 *
 * 自己写之后,守卫只需要断言「没有人 import 路由库」与「没有人碰
 * history API」,两条都是 grep 级别的确定性判断。
 *
 * ## 为什么必须是 hash(V0.7.0 的伏笔)
 *
 * Tauri 里前端资源从 `tauri://localhost` 或本地文件加载,**没有服务器
 * 帮你把任意路径回落到 index.html**。history router 依赖那个回落 ——
 * 用户刷新 `/settings` 会拿到 404。hash 路由把路径放在 `#` 后面,
 * 对服务器永远只是一个 `/`,所以三个宿主(远端 Web / 本地 sidecar / Tauri)
 * 共用一份代码。
 *
 * ⚠️ **现在写零成本,事后补是重构** —— 路由散落在几十个组件里之后再换,
 * 每个 `<Link>` 与每次跳转都要动。
 *
 * @module @dshwar/console-web/router
 */
import type { ConsoleScreenId } from '@dshwar/design-system/screens/console/Shell'

/**
 * 应用里所有的路由。**闭集** —— 认不出的一律回落首页,不做 404 页。
 *
 * | 路由 | 屏 | 数据来源 |
 * | --- | --- | --- |
 * | `capacity` | `OverviewScreen` + V0.5.0 的 `CapacityPage` | `/v1/admin/{capacity,usage,subjects}` |
 * | `tenants` | `TenantsScreen` —— **今天不渲染**,见 App 的缺口表 | ❌ 无端点 |
 * | `tenant` | `TenantScreen` —— 同上 | ❌ 无端点 |
 * | `members` | `MembersScreen` | `/v1/admin/subjects` + `/v1/admin/capacity` |
 * | `models` | `ModelsScreen` | `/v1/admin/policies` |
 * | `billing` | `QuotasScreen` | `/v1/admin/policies` + `…/{id}/quota` |
 * | `usage` | `UsageScreen` | `/v1/admin/usage` |
 * | `audit` | `AuditScreen` | `/v1/admin/audit` |
 * | `settings` | `BrandingScreen` | ❌ 无端点,只有运行期注入的那份 |
 *
 * ## ⚠️ `capacity` 就是导航里的「总览」,不是第二个屏
 *
 * 路由 id 叫 `capacity` 是 V0.5.0 定的(D2 要求容量读数常驻首页,
 * 而 `test/console-web.test.ts` 把 `DEFAULT_ROUTE === 'capacity'` 钉住了);
 * 导航里它的名字是「总览」。**同一块地方的两个名字,不是两处地方** ——
 * 所以没有单独的 `overview` 路由:一个屏两个 URL,迟早有人只更新其中一个。
 *
 * ## ⚠️ 为什么没有 `tenant` 的 id 参数
 *
 * 因为今天拿到 id 也没有端点可以查(契约里没有 `/v1/admin/tenants/{id}`)。
 * 加一个解析不了任何东西的参数,只会让人以为这条路已经通了。
 * 端点落地时照 `workbench-web/src/router.ts` 的 `?ws=` 形态补,那时它才有意义。
 */
export const ROUTES = [
  'capacity',
  'tenants',
  'tenant',
  'members',
  'models',
  'billing',
  'usage',
  'audit',
  'settings',
] as const

export type Route = (typeof ROUTES)[number]

/** 默认路由:容量页。D2 要求它是常驻首页。 */
export const DEFAULT_ROUTE: Route = 'capacity'

/**
 * 路由 → 左侧导航里高亮哪一项。
 *
 * ## 为什么需要一次映射,而不是让两者同名
 *
 * 导航是**分区**(6 项 + 分隔线下的「品牌与外观」),路由是**屏**(9 个)。
 * 分区少于屏,是因为详情屏与它的列表屏属于同一段:站在租户详情上,
 * 「租户」那一项高亮说的是真话 —— 你确实在租户这一段里。
 *
 * ⚠️ **认不出的路由不许随手挑一项。** `Shell.screen` 的注释写得很明白:
 * 导航同时是**位置指示**。高亮一个与当前内容无关的分区,等于告诉用户
 * 他在另一个地方 —— 而那与「界面不知道自己在哪」在屏幕上长得一模一样。
 * 写成 `Record<Route, …>` 就是为了让「新增路由忘了映射」是**编译错误**,
 * 而不是一次随手的挑选。
 *
 * ⚠️ `usage` 归在「配额与账单」段下:用量是账单的**输入**,
 * 而设计 kit 的导航里没有独立的「用量」项。这是分区判断,不是数据判断 ——
 * 若哪天 kit 加了那一项,这里跟着改一行即可。
 */
export const SCREEN_OF_ROUTE: Record<Route, ConsoleScreenId> = {
  capacity: 'overview',
  tenants: 'tenants',
  tenant: 'tenants',
  members: 'members',
  models: 'models',
  billing: 'billing',
  usage: 'billing',
  audit: 'audit',
  settings: 'settings',
}

/**
 * 导航项 → 点它去哪个路由。{@link SCREEN_OF_ROUTE} 的反向。
 *
 * ⚠️ 写成 `Record<ConsoleScreenId, Route>`:**设计系统新增一个导航项而这里
 * 忘了跟,是编译错误**。不写死成 `Record` 的话,那一项点下去会静默无事 ——
 * 一个点了没反应的导航项,与「这个功能还没做」在屏幕上无法分辨。
 */
export const ROUTE_OF_SCREEN: Record<ConsoleScreenId, Route> = {
  overview: 'capacity',
  tenants: 'tenants',
  members: 'members',
  models: 'models',
  billing: 'billing',
  audit: 'audit',
  settings: 'settings',
}

/**
 * 从 hash 解析路由。
 *
 * ⚠️ **认不出就回落到默认路由,不抛错、不显示 404。**
 * 这与 CLAUDE.md 硬规则 6 的「fail closed」不冲突 —— 那条管的是**权限**,
 * 认不出身份必须拒;这里管的是**导航**,认不出路径把人送回首页
 * 比给他一个死胡同好。两者的判据不同:安全上宁可拒,可用性上宁可兜。
 *
 * @param hash 形如 `#/members` 或 `#members` 或空串
 */
export function parseRoute(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '').split('?')[0] ?? ''
  return (ROUTES as readonly string[]).includes(cleaned) ? (cleaned as Route) : DEFAULT_ROUTE
}

/** 生成一个路由的 href。组件里不要手拼 `#/xxx` —— 拼错了没人会发现。 */
export function hrefOf(route: Route): string {
  return `#/${route}`
}
