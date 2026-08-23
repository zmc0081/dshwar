/**
 * 极简 hash 路由 —— **D7 约束 1** 的落点。
 *
 * 与 `console-web/src/router.ts` **同一套理由**,不复述:为什么自己写、
 * 为什么必须是 hash(Tauri 里没有服务器帮你回落 index.html)、
 * 为什么现在写零成本。去读那个文件。
 *
 * 这里只记**与它不同**的一处:路由集不同,而且工作台的路由带参数。
 *
 * @module @dshwar/workbench-web/router
 */

/**
 * 工作台的路由。**闭集** —— 认不出的一律回落默认页,不做 404 页。
 *
 * 对应设计 kit 的 workbench 八屏:
 *
 * | 路由 | 屏 |
 * | --- | --- |
 * | `session` | `SessionScreen` —— 协作屏,默认 tab |
 * | `runs` | `RunsScreen` —— 运行历史 |
 * | `artifacts` | `ArtifactsScreen` —— 产物 |
 * | `jobs` | `JobsScreen` —— 后台作业(今天 501) |
 * | `settings` | `WorkspaceSettingsScreen` —— 工作区设置(策略今天 501) |
 *
 * 另外三个不是路由:`WorkbenchShell` 是外壳,`ToolCalls` 与 `OfflineState`
 * 是被别的屏嵌进去的片段。
 */
export const ROUTES = ['session', 'runs', 'artifacts', 'jobs', 'settings'] as const

export type Route = (typeof ROUTES)[number]

/** 默认路由:协作屏。它是工作台的默认 tab。 */
export const DEFAULT_ROUTE: Route = 'session'

/** 一次导航的完整目标:去哪个屏、在哪个工作区。 */
export interface Location {
  readonly route: Route
  /**
   * 当前工作区 id。
   *
   * ⚠️ **可以是 `null`,那不是「出错了」** —— 首次进入、或者这个 principal
   * 一个工作区都没有时就是 null。屏幕要能呈现空态,而不是崩掉或转圈。
   */
  readonly workspaceId: string | null
}

/**
 * 从 hash 解析位置。
 *
 * 形如 `#/runs?ws=wsp_123`。工作区放在 query 而不是路径段,理由是
 * **它跨屏不变**:切 tab 时工作区不该跟着变,放在 query 里换路由段不动它。
 *
 * ⚠️ **认不出就回落默认路由,不抛错、不显示 404。** 与 console-web 同一条:
 * 硬规则 6 的 fail closed 管的是**权限**,认不出身份必须拒;
 * 这里管的是**导航**,认不出路径把人送回首页比给他一个死胡同好。
 *
 * @param hash 形如 `#/runs?ws=wsp_123`、`#runs`、或空串
 */
export function parseLocation(hash: string): Location {
  const cleaned = hash.replace(/^#\/?/, '')
  const [head = '', query = ''] = cleaned.split('?')
  const route: Route = (ROUTES as readonly string[]).includes(head)
    ? (head as Route)
    : DEFAULT_ROUTE
  // ⚠️ 不用 URLSearchParams 的 `has`/`get` 直接判空串:`?ws=` 会给出 `''`,
  //   而空串意味着「传了一个空的工作区」—— 那是**配置错误**,不是没传。
  //   与 LogoSlot 的 `??` vs `||` 是同一条:悄悄把错值当缺失,会替人把错配当没配。
  const raw = new URLSearchParams(query).get('ws')
  return { route, workspaceId: raw === null || raw === '' ? null : raw }
}

/**
 * 生成一个位置的 href。
 *
 * 组件里不要手拼 `#/xxx?ws=yyy` —— 拼错了没人会发现,而一个拼错的链接
 * 表现为「点了没反应」或「跳回首页」,两者都不像 bug。
 */
export function hrefOf(location: Location): string {
  const base = `#/${location.route}`
  return location.workspaceId === null
    ? base
    : `${base}?ws=${encodeURIComponent(location.workspaceId)}`
}
