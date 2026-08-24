/**
 * 运营后台的浏览器入口。
 *
 * ## 三个宿主的差别只有这个文件
 *
 * V0.7.0 的已定决策是「一份 React 代码,三个宿主,**差别只有 baseURL**」。
 * 这里就是那个差别落地的地方:`baseUrl` 与 `adminKey` 从**运行期配置**读,
 * 而不是编译进产物。
 *
 * | 宿主 | baseUrl 从哪来 |
 * | --- | --- |
 * | 远端 Web | 部署时注入的 `window.__DSHWAR_CONSOLE_CONFIG__` |
 * | 本地 sidecar | 同上,值是 `http://127.0.0.1:<port>` |
 * | Tauri | 壳注入,值同上 —— **不能推断**,`tauri://localhost` 不是网关 |
 *
 * ⚠️ **不从 `window.location` 推断。** 推断在远端能用、在 Tauri 里指到
 * `tauri://localhost/v1/...`,而那时报出来的是一句无关的网络错误。
 *
 * ## 🚨 这里的令牌是 **Admin API Key**,不是运行时 bearer
 *
 * 与 `workbench-web/src/main.tsx` 的关键差别。两者**绝不能同时送** ——
 * 网关的 `runtimeAuth` 在看 bearer 之前先判 admin 头存不存在,存在就直接 401。
 * 那不是 bug:一个既是管理员又是终端用户的请求,身份是歧义的。
 *
 * Admin Key **按租户签发,一把钥匙不得横跨租户**(CLAUDE.md 第七节)。
 * 所以「当前是哪个租户」这件事,由**谁把哪把钥匙注进来**决定 ——
 * 前端既推不出来,也不该去猜。
 *
 * ## 品牌与操作者身份也是运行期的
 *
 * 白牌走运行期主题,安装包永远中性 —— 一个二进制服务所有租户。
 * 而**操作者是谁**同样只能由宿主给:Admin Key 认不出人,`/v1/admin`
 * 面也没有 whoami 端点。没注入就显示显式的「未知」,不编一个名字。
 *
 * @module @dshwar/console-web/main
 */
import { NEUTRAL_BRANDING, type TenantBranding } from '@dshwar/console-contract'
import type { ShellAccount } from '@dshwar/design-system/screens/console/Shell'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { createConsoleApi } from './api.ts'
import './styles.ts'

/**
 * 运行期注入的配置。宿主在加载本模块**之前**把它挂上。
 *
 * ⚠️ 品牌那几个字段与 `TenantBranding` 同名同义,但**类型上都是可缺的**:
 * 缺 = 未配置 = 中性外观,那是一个**受支持的完整形态**(`NEUTRAL_BRANDING`),
 * 不是配置错误。与 `baseUrl` / `adminKey` 的「缺就拒绝启动」刚好相反 ——
 * 判据是「缺了还能不能正确工作」:少一个主色能,少一个网关地址不能。
 */
export interface RuntimeConfig {
  readonly baseUrl: string
  readonly adminKey: string
  readonly productName: string
  readonly legalEntityName: string | null
  /**
   * 品牌主色,`#RRGGBB`。
   *
   * 🚨 **`null` 不许被兜底。** null = 未配置 = 无彩中性外观;
   * 一行 `?? '#xxx'` 会把 V0.8.0 那次「未配置 vs 配置成某个值」的类型层区分
   * 完全抵消,而不会有任何东西变红。`check-guards.mjs` 有一条守卫盯着这个形状。
   */
  readonly primaryColor: string | null
  readonly supportEmail: string | null
  readonly privacyPolicyUrl: string | null
  readonly termsOfServiceUrl: string | null
  readonly logoPath: string | null
  readonly logoDarkPath: string | null
  /** 操作者全名 / 邮箱。缺 = 宿主没告诉我们他是谁。 */
  readonly operatorName: string | null
  /**
   * 头像里那一到两个字母。
   *
   * ⚠️ **由宿主截,不在这里从 `operatorName` 猜。** 缩写规则各语言不同
   * (设计系统的 `abbreviate` 对中文取前两字、对西文取首字母),
   * 而它猜错的表现是一个看起来正常的、属于别人的缩写。
   */
  readonly operatorInitials: string | null
}

declare global {
  interface Window {
    /**
     * ⚠️ 键名与工作台的 `__DSHWAR_CONFIG__` **刻意不同**。
     *
     * 两个前端可能被同一个反代挂在同一个源下,而它们要的令牌是两种
     * (Admin Key vs 运行时 bearer)。共用一个键名的后果是:先加载的那个
     * 把另一个的令牌读走,然后带着错的头去请求 —— 而 401 的错误信息
     * 不会提「你拿错了钥匙」。
     */
    __DSHWAR_CONSOLE_CONFIG__?: Partial<RuntimeConfig>
  }
}

/**
 * 读运行期配置。
 *
 * ⚠️ **缺 `baseUrl` 或 `adminKey` 一律拒绝启动**,不给默认值。
 *
 * 给默认值(比如同源、或空 key)会让失败推迟到第一次请求 ——
 * 那时的症状是「界面空白」或「一直转圈」,而真正的原因是配置没注入。
 * 与硬规则 6 的 fail closed 同一条:**缺前提就停下,不要猜一个继续跑。**
 *
 * ⚠️ 空串与缺失一样拒。一个空的 Admin Key 会让网关回 401,而 401 读起来
 * 像「这把钥匙被吊销了」—— 与「宿主的模板渲染出了个空值」完全是两回事。
 */
export function readConfig(raw: Partial<RuntimeConfig> | undefined): RuntimeConfig {
  const missing: string[] = []
  if (raw?.baseUrl === undefined || raw.baseUrl === '') missing.push('baseUrl')
  if (raw?.adminKey === undefined || raw.adminKey === '') missing.push('adminKey')
  if (missing.length > 0) {
    throw new Error(
      `运行期配置缺少 ${missing.join(' / ')} —— 宿主必须在加载前挂上 window.__DSHWAR_CONSOLE_CONFIG__。\n` +
        '没有默认值是刻意的:一个「默认同源」的默认值会让 Tauri 里的失败推迟到运行时。\n' +
        'adminKey 按租户签发,一把钥匙不得横跨租户 —— 它也没有任何可以猜的默认值。',
    )
  }
  return {
    baseUrl: raw?.baseUrl ?? '',
    adminKey: raw?.adminKey ?? '',
    // 品牌可以缺 —— 缺了就是中性外观,那是**合法状态**而不是配置错误。
    productName: raw?.productName ?? NEUTRAL_BRANDING.productName,
    legalEntityName: raw?.legalEntityName ?? null,
    // ★ 只把 `undefined` 归一成 `null`(两者都是「宿主没给」),**不换成任何颜色**。
    //   注意这里也不判空串:那个判断必须收敛在派生入口一处
    //   (`BrandingScreen` 里的 `seed === null || seed === ''`)——
    //   每个调用点各判一次的后果是总有一个点判错,而那个点的表现是
    //   「这个租户的界面莫名其妙有颜色」。
    primaryColor: raw?.primaryColor ?? null,
    supportEmail: raw?.supportEmail ?? null,
    privacyPolicyUrl: raw?.privacyPolicyUrl ?? null,
    termsOfServiceUrl: raw?.termsOfServiceUrl ?? null,
    logoPath: raw?.logoPath ?? null,
    logoDarkPath: raw?.logoDarkPath ?? null,
    operatorName: raw?.operatorName ?? null,
    operatorInitials: raw?.operatorInitials ?? null,
  }
}

/**
 * 运行期配置 → 契约的品牌形状。
 *
 * ⚠️ 以 `NEUTRAL_BRANDING` 打底,而不是自己写一串 `null`:
 * 契约将来加字段时,这里**自动**是「未配置」——
 * 手写的那串会少一个键,变成编译错误(好)或漏一个默认(坏),
 * 而是哪一种取决于那个字段是不是必填,不该靠运气。
 *
 * ⚠️ `favicon` / `accentColor` / 登录页文案等留在中性档:宿主今天不注入它们,
 * 而这一层**不替它们编值**。
 */
export function toBranding(config: RuntimeConfig): TenantBranding {
  return {
    ...NEUTRAL_BRANDING,
    productName: config.productName,
    legalEntityName: config.legalEntityName,
    // 原样。任何合并都会让「未配置」不可见 —— 见 RuntimeConfig.primaryColor。
    primaryColor: config.primaryColor,
    supportEmail: config.supportEmail,
    privacyPolicyUrl: config.privacyPolicyUrl,
    termsOfServiceUrl: config.termsOfServiceUrl,
    logoLight:
      config.logoPath === null ? null : { id: 'runtime-logo-light', path: config.logoPath },
    logoDark:
      config.logoDarkPath === null ? null : { id: 'runtime-logo-dark', path: config.logoDarkPath },
  }
}

/**
 * 运行期配置 → 顶栏那个「我是谁」。
 *
 * 🚨 **宿主没注入就显式说「未知」,不编一个名字、也不从别处推。**
 * 那个头像与全名会被用户拿来核对「我现在是以谁的身份在操作」——
 * 一个编出来的名字会让他确认一件假事,而这一屏能改的是租户级配置。
 *
 * ⚠️ 名字有、缩写没有时,缩写仍然是 `'—'`:截取规则各语言不同,
 * 猜出来的缩写与真的缩写在 24px 的圆里长得一模一样。
 */
export function toOperator(config: RuntimeConfig): ShellAccount {
  return {
    initials: config.operatorInitials ?? '—',
    name: config.operatorName ?? '未知操作者(宿主未注入 operatorName)',
  }
}

const host = document.getElementById('root')
if (host === null) throw new Error('页面缺少 #root —— 宿主的 HTML 与预期不符')

const config = readConfig(window.__DSHWAR_CONSOLE_CONFIG__)

createRoot(host).render(
  <StrictMode>
    <App
      api={createConsoleApi({ baseUrl: config.baseUrl, adminKey: config.adminKey })}
      branding={toBranding(config)}
      operator={toOperator(config)}
    />
  </StrictMode>,
)
