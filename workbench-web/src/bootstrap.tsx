/**
 * 出厂装配 —— 把运行期配置变成一棵挂好的 React 树。
 *
 * ## 为什么它不在 `main.tsx` 里
 *
 * `main.tsx` 有一件事做不到:**被测试调用**。它在模块顶层就找 `#root`、
 * 建 root、渲染 —— 一 import 就跑,而测试环境里没有那些东西。
 * 于是每个测试都只能**自己拼装一遍**被测系统,而那时验的是
 * 「这么拼能工作」,不是「出厂真的这么拼」。
 *
 * 这个区别在本仓有过一次代价三个版本的实例(CLAUDE.md 第六节那张表第 4 行):
 * `registerWorkspaceRoutes` 实现完整、测试齐全,而 `server.ts` 从不传它 ——
 * 七条路由在真实部署里全 404,**一道红都没有**,因为所有测试
 * 都自己手工调 `createGateway` 把它挂上去了。
 *
 * ⇒ 装配逻辑全部落在 {@link bootstrapWorkbench};`main.tsx` 只剩
 * 「找 `#root` + 把真实的 `createRoot().render` 传进来」这一件 DOM 动作。
 * `test/shipped-entry.test.ts` 调的就是本函数,并另有一条读源码的断言
 * 盯住 `main.tsx` 确实走了它、没有自己另拼一份。
 *
 * ## 三个宿主的差别在这里收敛成一个 `hostKind`
 *
 * 旧版本由宿主直接注入 `baseUrl`。那等于把「差别只有 baseURL」这句验收
 * 交给三份部署配置各自去遵守 —— 而它们分家的过程没有任何一步会红。
 *
 * 现在宿主注入的是**它是谁**(`hostKind`,Tauri 另加 `gatewayPort`),
 * `baseUrl` 由 {@link hostConfig} 算出来。于是那句验收有了唯一的落点,
 * 而「给某个宿主换个 baseUrl」这种事必须去改 `hosts.ts` —— 那里有断言。
 *
 * ## ⚠️ 这里**不调** `hostSecrets`,那不是漏了
 *
 * `SecretStore` 的消费方是**认证流程**(换 token、续期),而那条流程今天
 * 还在壳那一侧:Rust 的钥匙串在 `src-tauri/src/keychain.rs`,
 * 回环监听在 `@dshwar/auth-pkce/loopback`,把它们串起来的编排属于桌面壳。
 *
 * 前端这棵树自己**不碰长效凭据** —— 它只拿运行期注入的短效 Bearer。
 * 在这里调一次 `hostSecrets` 再把结果丢掉,会让「前端持有过一个能读钥匙串的句柄」
 * 这件事变成事实,而换来的只是一次看起来更完整的接线。
 *
 * @module @dshwar/workbench-web/bootstrap
 */
import type * as React from 'react'
import { StrictMode } from 'react'
import { applyAccent, type Theme } from '@dshwar/design-system'
import { App } from './App.tsx'
import { createWorkbenchApi } from './api.ts'
import { HOST_KINDS, hostConfig, type HostKind, type HostRuntime } from './hosts.ts'

/**
 * 运行期注入的配置。宿主在加载入口模块**之前**把它挂到 `window` 上。
 *
 * ⚠️ **没有 `baseUrl`。** 它由 `hostKind`(+ Tauri 的 `gatewayPort`)算出来 ——
 * 见本模块顶部。宿主能注入的是「我是谁」,不是「你去连哪」。
 */
export interface RuntimeConfig {
  /** 这份产物跑在哪个宿主里。**不给默认值**,理由见 {@link readConfig}。 */
  readonly hostKind: HostKind
  /** 网关监听的回环端口。**只有 Tauri 需要**,另两家是同源的。 */
  readonly gatewayPort?: number
  /** 运行时 Bearer。由部署方的 IdP 签发 —— DSHWAR 不签发身份令牌(硬规则 4)。 */
  readonly token: string
  /** 产品名。白牌租户会换掉它。 */
  readonly productName: string
  /** 法律主体名,页脚用。缺省是空串 —— 那是合法状态(自建部署没有主体)。 */
  readonly legalEntityName: string
  /**
   * 租户主色。`null` = **未配置**,那是合法状态,渲染成中性外观。
   *
   * ⚠️ 未配置绝不能被兜底成某个颜色 —— 那会把 V0.8.0 那次
   * 「哨兵默认色 → `string | null`」的类型层区分在渲染层原样抵消掉。
   * `check-guards.mjs` 有一条守卫盯着这个形状。
   */
  readonly primaryColor: string | null
  /** 亮 / 暗主题。见 {@link readConfig} 里为什么这一项**可以**有默认值。 */
  readonly theme: Theme
}

/** 本模块用到的那一点点 `window`。 */
export interface BootstrapWindow {
  readonly __DSHWAR_CONFIG__?: Partial<RuntimeConfig> | undefined
}

/**
 * 本模块用到的那一点点 `document` —— 结构类型,不是 `Document`。
 *
 * 与 `applyAccent` 的 `AccentTarget` 同一个理由:测试要传一个能记账的假货,
 * 而按 `Document` 造假货意味着补几百个成员,实际发生的总是用断言绕过去 ——
 * 那等于这一层根本没有类型。
 */
export interface BootstrapDocument {
  readonly documentElement: {
    readonly style: {
      setProperty(name: string, value: string): void
      removeProperty(name: string): void
    }
    setAttribute(name: string, value: string): void
    removeAttribute(name: string): void
  }
}

/** 把建好的树挂上去。`main.tsx` 传真实的 `createRoot(host).render`。 */
export type MountFn = (element: React.ReactElement) => void

declare global {
  interface Window {
    __DSHWAR_CONFIG__?: Partial<RuntimeConfig>
  }
}

/**
 * 读运行期配置。
 *
 * ⚠️ **缺 `hostKind` / `token` 一律拒绝启动**,不给默认值。
 *
 * `token` 给默认值会让失败推迟到第一次请求 —— 症状是「界面空白」或
 * 「一直转圈」,而真正的原因是配置没注入。与硬规则 6 的 fail closed 同一条。
 *
 * 🚨 **`hostKind` 尤其不能默认成 `'remote-web'`。** 那个默认值在两个宿主上
 * 完全正确,在第三个上把 baseUrl 算成同源 —— 而 Tauri 里同源是
 * `tauri://localhost`,请求发出去得到的是一句与 CORS 无关的网络错误,
 * 与「网关没起来」无法区分(见 `hosts.ts` 的 `tauriBaseUrl`)。
 * 一个「在多数情况下正确」的默认值,坏起来正是最难查的那种。
 *
 * ## 哪些可以有默认值,为什么
 *
 * | 项 | 默认 | 为什么这不是在猜 |
 * | --- | --- | --- |
 * | `productName` | `'DSHWAR'` | 中性品牌就是未配置的**正确外观** |
 * | `legalEntityName` | `''` | 自建部署没有法律主体,空是真实状态 |
 * | `primaryColor` | `null` | `null` 就是「未配置」本身,不是替它挑了个色 |
 * | `theme` | `'light'` | 样式表的默认已经是亮 —— 不设属性就是亮主题 |
 *
 * 判据是**这个默认值有没有替宿主做决定**。上面四项的默认都等于
 * 「宿主没说 = 什么都没配」,而 `hostKind` / `token` 的任何默认值
 * 都是在替宿主回答一个只有它知道答案的问题。
 */
export function readConfig(raw: Partial<RuntimeConfig> | undefined): RuntimeConfig {
  const hostKind = raw?.hostKind
  const token = raw?.token
  // ⚠️ 判空写成一个条件而不是「先攒 missing 再判长度」:后者读起来更顺,
  //   但 tsc 跟不过去 —— 缺一个就抛之后,下面那些字段仍然是 `| undefined`,
  //   于是只能靠 `?? ''` 之类的兜底把它们糊过去,而那正是这个函数要拦的东西。
  if (hostKind === undefined || token === undefined || token === '') {
    const missing = [
      ...(hostKind === undefined ? ['hostKind'] : []),
      ...(token === undefined || token === '' ? ['token'] : []),
    ]
    throw new Error(
      `运行期配置缺少 ${missing.join(' / ')} —— 宿主必须在加载前挂上 window.__DSHWAR_CONFIG__。\n` +
        '没有默认值是刻意的:一个「默认远端 Web / 默认同源」的默认值\n' +
        '会让 Tauri 里的失败推迟到第一次请求,而那时的错误信息与「网关没起来」一样。',
    )
  }
  // ⚠️ 认不出的 hostKind **停下**,不回落到某一家。宿主打错一个字母时
  //   回落等于安静地跑在另一套配置上,而那正是「差别只有 baseURL」失效的方式。
  //   类型在这一行已经不管用了:注入的是运行期的 JSON,不是 TS 值。
  if (!HOST_KINDS.includes(hostKind)) {
    throw new Error(
      `未知的 hostKind:${String(hostKind)} —— 合法值是 ${HOST_KINDS.join(' / ')}。\n` +
        '这里不回落到 remote-web:回落会让一个拼错的宿主名安静地跑在同源配置上。',
    )
  }
  return {
    hostKind,
    ...(raw?.gatewayPort === undefined ? {} : { gatewayPort: raw.gatewayPort }),
    token,
    productName: raw?.productName ?? 'DSHWAR',
    legalEntityName: raw?.legalEntityName ?? '',
    primaryColor: raw?.primaryColor ?? null,
    theme: raw?.theme ?? 'light',
  }
}

/**
 * 一次装配的结果 —— 交给测试断言,`main.tsx` 不看。
 *
 * 返回它而不是让测试去翻 mount 到的那棵树:React 元素的 props 能读,
 * 但读出来的是**渲染前**的样子,而这里要验的恰恰是**装配**本身。
 */
export interface BootstrapResult {
  /** 实际算出来的 baseUrl —— 「差别只有 baseURL」那句验收的落点。 */
  readonly baseUrl: string
  /** 实际用的主题。DOM 属性与 `applyAccent` 收到的是**同一个值**,见下。 */
  readonly theme: Theme
  /** 主色配了没有。`false` = 走中性外观。 */
  readonly branded: boolean
}

/**
 * 出厂装配。
 *
 * ## 主题只读一次
 *
 * `data-theme` 属性与 `applyAccent` 的第三个参数来自**同一个变量**。
 * 分两处读的后果很隐蔽:属性说暗、派生说亮时,派生出来的文字色落在暗画布上
 * 只有 2 点几比一 —— 看起来像「这个租户的颜色淡了点」,不像坏了,
 * 不会有任何东西变红,也不会有人报上来。
 *
 * @param win 宿主注入配置的地方
 * @param doc 主题写到哪棵树上。传真实 `document` 就是全局
 * @param mount 把树挂上去。`main.tsx` 传 `createRoot(host).render`
 */
export function bootstrapWorkbench(
  win: BootstrapWindow,
  doc: BootstrapDocument,
  mount: MountFn,
): BootstrapResult {
  const config = readConfig(win.__DSHWAR_CONFIG__)

  // exactOptionalPropertyTypes:`gatewayPort: undefined` 与「没有这个键」是两回事。
  const runtime: HostRuntime =
    config.gatewayPort === undefined ? {} : { gatewayPort: config.gatewayPort }
  const { baseUrl } = hostConfig(config.hostKind, runtime)

  // 主题先写属性再派生 —— 两者同一个 config.theme,不各读一次。
  doc.documentElement.setAttribute('data-theme', config.theme)
  const derived = applyAccent(config.primaryColor, doc.documentElement, config.theme)

  mount(
    <StrictMode>
      <App
        api={createWorkbenchApi({ baseUrl, token: config.token })}
        branding={{ productName: config.productName, legalEntityName: config.legalEntityName }}
      />
    </StrictMode>,
  )

  return { baseUrl, theme: config.theme, branded: derived !== null }
}
