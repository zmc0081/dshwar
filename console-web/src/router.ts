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

/** 应用里所有的路由。**闭集** —— 认不出的一律回落首页,不做 404 页。 */
export const ROUTES = ['capacity', 'members', 'usage'] as const

export type Route = (typeof ROUTES)[number]

/** 默认路由:容量页。D2 要求它是常驻首页。 */
export const DEFAULT_ROUTE: Route = 'capacity'

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
