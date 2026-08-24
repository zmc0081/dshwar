/**
 * 宿主端口 —— **三个宿主的全部差别都在这个文件里**。
 *
 * `pkce.ts` 是三处共用的纯计算;这里是那三处各自不同的四件事:
 *
 * | 端口 | 远端 Web | 本地 sidecar | Tauri |
 * | --- | --- | --- | --- |
 * | 打开浏览器 | `window.open` / 同页跳转 | `open` 系统命令 | Tauri shell 插件 |
 * | 收回调 | **收不了**(见下) | Node http 服务器 | 同 sidecar |
 * | 存 refresh token | **不存**(见下) | 系统钥匙串 | 系统钥匙串 |
 * | 时钟 | `Date.now()` | 同 | 同 |
 *
 * @module @dshwar/auth-pkce/host
 */
import type { PkceSession } from './pkce.ts'

/**
 * 长效凭据的存放处。
 *
 * ## 🚨 为什么 `store` 可以**拒绝**
 *
 * 验收里那句「前端代码里搜不到长效凭据」不是一条 grep 规则,
 * 它是一个**架构约束**:浏览器里没有钥匙串,而 `localStorage` /
 * `sessionStorage` / cookie 都不是钥匙串 —— 它们对任何一段
 * 同源脚本可读,一次 XSS 就能把 refresh token 整个带走。
 * 而 refresh token 的价值恰恰在于**长期有效**。
 *
 * ⇒ 远端 Web 宿主的正确行为是**根本不拿 refresh token**:
 * 只拿短效 access token,过期就重新走一次授权(IdP 会话通常还在,
 * 用户感知是一次跳转)。
 *
 * 于是这个接口的 `store` 允许抛 {@link RefreshTokenNotStorable} ——
 * **那不是失败,是这个宿主的正确行为**。调用方据此走「不保存」那条路,
 * 而不是把它当成错误弹给用户。
 *
 * ⚠️ 不要为了「让三个宿主长得一样」给 Web 塞一个 localStorage 实现。
 * 那会让这条架构约束退化成一行注释,而注释拦不住下一个人。
 */
export interface SecretStore {
  /**
   * 存 refresh token。
   *
   * @throws {RefreshTokenNotStorable} 这个宿主不具备安全存放的条件
   */
  store(key: string, refreshToken: string): Promise<void>
  /** 取回。没有(或宿主不存)时返回 `null`。 */
  load(key: string): Promise<string | null>
  /** 清掉。登出时调。 */
  clear(key: string): Promise<void>
}

/**
 * 这个宿主**不具备**安全存放长效凭据的条件。
 *
 * ⚠️ 它是一个**预期内的结果**,不是故障。捕获它的地方应当切到
 * 「不保存,过期重新授权」那条路,而不是显示一个错误。
 *
 * 之所以做成异常而不是返回 `false`:返回值会被忽略,而异常不会。
 * 一个被忽略的 `false` 的表现是「以为存上了,下次启动要重新登录」——
 * 用户会以为是 bug,而实际上是设计。
 */
export class RefreshTokenNotStorable extends Error {
  constructor(hostName: string) {
    super(
      `${hostName} 没有安全存放长效凭据的地方 —— 这是设计,不是故障。\n` +
        '浏览器里 localStorage / sessionStorage / cookie 都对同源脚本可读,\n' +
        '一次 XSS 就能带走 refresh token,而它的价值恰恰在于长期有效。\n' +
        '⇒ 正确做法是只拿短效 access token,过期时重新走一次授权。',
    )
    this.name = 'RefreshTokenNotStorable'
  }
}

/**
 * 浏览器里那一半:把用户送到 IdP。
 *
 * ⚠️ **必须是系统浏览器,不能是嵌入式 WebView。** RFC 8252 §8.12:
 * 嵌入式 WebView 里,宿主应用能读到用户输入的密码 ——
 * 那把「DSHWAR 不碰密码」这条硬规则从架构约束降级成了自觉。
 * 系统浏览器还能复用用户已有的 IdP 会话与已注册的 passkey。
 */
export interface BrowserOpener {
  open(url: string): Promise<void>
}

/**
 * loopback 回调的接收方。
 *
 * @see DesktopAuthScreen 里那三条出口 —— 这个端口失败时走的就是它们。
 */
export interface CallbackListener {
  /**
   * 在某个回环端口上等一次回调。
   *
   * @returns 收到的完整回调 URL
   * @throws 超时、端口被占、绑定被拒时 —— 三种都走「三条出口」
   */
  listen(session: PkceSession, options: { timeoutMs: number }): Promise<string>
}

/** 一个宿主提供的全部能力。 */
export interface AuthHost {
  readonly name: string
  readonly browser: BrowserOpener
  /** `null` = 这个宿主收不了 loopback 回调(远端 Web)。 */
  readonly callback: CallbackListener | null
  readonly secrets: SecretStore
  /** 现在几点。测试里换成固定值,免得断言随时间漂。 */
  now(): number
}

/**
 * 远端 Web 宿主的 {@link SecretStore} —— **一律拒绝**。
 *
 * 它存在的意义不是「提供功能」,而是**让这条架构约束有一个可执行的落点**:
 * 谁在 Web 宿主里试图存 refresh token,谁就会立刻拿到一个说明理由的异常,
 * 而不是把它悄悄写进 localStorage。
 */
export const WEB_SECRETS_REFUSE: SecretStore = {
  store: (): Promise<void> => Promise.reject(new RefreshTokenNotStorable('远端 Web 宿主')),
  load: (): Promise<string | null> => Promise.resolve(null),
  clear: (): Promise<void> => Promise.resolve(),
}
