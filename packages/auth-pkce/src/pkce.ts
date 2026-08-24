/**
 * PKCE 的**纯计算部分** —— 没有 I/O,没有宿主假设。
 *
 * ## 为什么它必须是纯的
 *
 * 「三个宿主共用同一套认证实现」这句话,落到代码上就是这个文件:
 * 生成 verifier、算 challenge、拼授权 URL、拼换取请求 —— 这四件事
 * 在远端 Web、本地 sidecar、Tauri 里**一模一样**。
 * 不一样的只有「怎么打开浏览器」「怎么收回调」「把 refresh token 放哪」,
 * 那三件在 `host.ts` 里做成端口。
 *
 * ⇒ 于是「共用同一套实现」不是一句口号,而是**这个文件被三处 import**;
 * 而它没有 I/O,所以能被完整单测 —— 不用起浏览器、不用开端口。
 *
 * ## ⚠️ 用 WebCrypto,不用 `node:crypto`
 *
 * `crypto.subtle` 在 Node 18+ 与所有现代浏览器里都是标准接口。
 * 用 `node:crypto` 会让这个文件**只能在 Node 里跑** —— 远端 Web 那一份
 * 就得另写一遍,而两遍迟早分家。分家的表现是其中一个宿主的 challenge
 * 算法悄悄退化(比如回落到 `plain`),而那**不会有任何东西变红**。
 *
 * ## 🚨 硬规则 4:DSHWAR 不签发身份令牌
 *
 * 本文件只**拼请求**,不签发任何东西。授权服务器是**部署方的 IdP**,
 * token 端点也是它的。DSHWAR 在这条链路上是消费者:
 * 它拿到 access token 之后去验签(`@dshwar/auth-oidc`),仅此而已。
 *
 * @module @dshwar/auth-pkce/pkce
 */

/** RFC 7636 允许 43–128 字符。取 64 字节随机 → base64url 后 86 字符,落在区间内。 */
const VERIFIER_BYTES = 64

/**
 * base64url 编码(无填充)。
 *
 * ⚠️ **不能用 `btoa` 之后再替换字符**:`btoa` 只吃 latin1,
 * 而这里的输入是随机字节,超出 latin1 的字节会抛 `InvalidCharacterError`。
 * 那种错**只在某些随机值上出现** —— 一个平均 1/N 概率才复现的登录失败,
 * 是最难查的一类。
 */
function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 生成 n 字节密码学随机数据。 */
function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return bytes
}

/**
 * 一次 PKCE 往返的全部本地秘密。
 *
 * ⚠️ **`verifier` 绝不出现在任何 URL 里。** 它只在最后换取 token 时
 * 直接 POST 给 IdP 的 token 端点。放进 URL 会进浏览器历史、进代理日志、
 * 进 Referer 头 —— 而它一旦泄漏,PKCE 提供的那层保护就没了。
 */
export interface PkceSession {
  /** 只发给 token 端点,永不进 URL。 */
  readonly verifier: string
  /** `S256(verifier)`,放进授权 URL。 */
  readonly challenge: string
  /**
   * CSRF 防护。回调带回来的 `state` 必须与它**逐字节相等**。
   *
   * ⚠️ 它与 `verifier` 防的**不是同一件事**:
   * `state` 防「别人把他的回调塞给我」,`verifier` 防「别人拿走我的码去兑换」。
   * 两者都要,少任何一个都有一条完整的攻击路径。
   */
  readonly state: string
  /** 本次回调监听的端口。换端口重试时它会变 —— 见三条出口。 */
  readonly redirectUri: string
}

/**
 * 起一次 PKCE 会话。
 *
 * @param redirectUri loopback 回调地址,如 `http://127.0.0.1:51789/callback`
 *
 * ⚠️ **必须是 `127.0.0.1` 而不是 `localhost`。** RFC 8252 §8.3 明确要求:
 * `localhost` 的解析结果取决于 hosts 文件与 DNS,可能被指到别处;
 * 而回环 IP 字面量没有这个歧义。这条在实现里很容易写错,
 * 因为两者在开发机上几乎总是等价的 —— 直到某台机器上不是。
 */
export async function startPkce(redirectUri: string): Promise<PkceSession> {
  assertLoopback(redirectUri)
  const verifier = base64url(randomBytes(VERIFIER_BYTES))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return {
    verifier,
    challenge: base64url(new Uint8Array(digest)),
    state: base64url(randomBytes(32)),
    redirectUri,
  }
}

/**
 * 回调地址必须是回环地址。
 *
 * @throws 不是 `http://127.0.0.1` 或 `http://[::1]` 开头时
 */
export function assertLoopback(redirectUri: string): void {
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    throw new Error(`回调地址不是合法 URL:${redirectUri}`)
  }
  // ⚠️ 只认这两个字面量。`localhost` 不算 —— 见 startPkce 的注释。
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]' && url.hostname !== '::1') {
    throw new Error(
      `回调地址必须用回环 IP 字面量,收到 "${url.hostname}"。\n` +
        'RFC 8252 §8.3:localhost 的解析取决于 hosts 与 DNS,可能被指到别处;\n' +
        '而回环 IP 没有这个歧义。两者在开发机上几乎总是等价的 —— 直到某台机器上不是。',
    )
  }
  // ⚠️ http 是**对的**:回环地址上的 https 需要一张没人能签的证书。
  //   RFC 8252 §7.3 明确允许。这里禁的是**非回环的 http**,而那已被上面拦下。
  if (url.protocol !== 'http:') {
    throw new Error(`回环回调用 http,收到 ${url.protocol}(见 RFC 8252 §7.3)`)
  }
}

/** 授权请求要用到的、来自部署方 IdP 的那几项配置。 */
export interface IdpConfig {
  /** discovery 里的 `authorization_endpoint`。 */
  readonly authorizationEndpoint: string
  /** discovery 里的 `token_endpoint`。 */
  readonly tokenEndpoint: string
  /**
   * 公开客户端 id。
   *
   * ⚠️ **不带 client_secret。** 桌面应用是 RFC 8252 说的「公开客户端」:
   * 任何随二进制分发的 secret 都不是 secret。PKCE 正是为了替代它 ——
   * 若这里出现了 secret 字段,说明有人把 Web 应用的流程照搬了过来。
   */
  readonly clientId: string
  readonly scopes: readonly string[]
}

/**
 * 拼授权 URL。
 *
 * ⚠️ 只放 `challenge`,**不放 `verifier`** —— 见 {@link PkceSession}。
 */
export function authorizeUrl(idp: IdpConfig, session: PkceSession): string {
  const url = new URL(idp.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', idp.clientId)
  url.searchParams.set('redirect_uri', session.redirectUri)
  url.searchParams.set('scope', idp.scopes.join(' '))
  url.searchParams.set('state', session.state)
  url.searchParams.set('code_challenge', session.challenge)
  // ⚠️ 写死 S256。`plain` 在 RFC 7636 里存在,但它等于没有 PKCE ——
  //   把 method 做成可配置,等于给「配错就退化成 plain」留了一条路。
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/**
 * 校验回调并取出授权码。
 *
 * @param callbackUrl loopback 服务器收到的完整 URL
 * @throws state 不匹配、IdP 返回了 error、或没有 code 时
 *
 * ⚠️ **先比 state,再看别的。** 顺序有意义:一个 state 不匹配的回调
 * 根本不是给我们的,它带的 `error` 参数也不该被当成我们这次登录的结果。
 */
export function codeFromCallback(callbackUrl: string, session: PkceSession): string {
  const url = new URL(callbackUrl, 'http://127.0.0.1')
  const state = url.searchParams.get('state')
  if (state !== session.state) {
    throw new Error(
      'state 不匹配 —— 这个回调不是本次登录发起的。\n' +
        '可能是上一次登录的回调迟到了,也可能是有人把他的回调塞了过来。\n' +
        '两种都不该继续,而后者正是 state 存在的理由。',
    )
  }
  const error = url.searchParams.get('error')
  if (error !== null) {
    const description = url.searchParams.get('error_description')
    throw new Error(`IdP 拒绝了本次授权:${error}${description === null ? '' : ` — ${description}`}`)
  }
  const code = url.searchParams.get('code')
  if (code === null || code === '') {
    throw new Error('回调里既没有 code 也没有 error —— IdP 的响应不符合 OAuth 2.0')
  }
  return code
}

/**
 * 拼换取 token 的请求体。
 *
 * ⚠️ 返回 `URLSearchParams` 而不是发请求 —— 本文件不做 I/O。
 * 谁去发、用什么 fetch,是宿主的事。
 */
export function tokenRequestBody(
  idp: IdpConfig,
  session: PkceSession,
  code: string,
): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: session.redirectUri,
    client_id: idp.clientId,
    // ★ verifier 只在这里出现一次,直接 POST 给 token 端点。
    code_verifier: session.verifier,
  })
}

/** 用 refresh token 换新的 access token 的请求体。 */
export function refreshRequestBody(idp: IdpConfig, refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: idp.clientId,
  })
}
