/**
 * `@dshwar/auth-pkce` —— 客户端认证:系统浏览器 + PKCE + loopback 回调。
 *
 * ## 边界:本包**不签发任何令牌**
 *
 * 硬规则 4:DSHWAR 是身份消费者,不是提供者。授权服务器是**部署方的 IdP**,
 * token 端点也是它的。本包只做三件事:
 *
 * 1. 拼出正确的 PKCE 请求(`pkce.ts` —— 纯计算,三宿主共用同一份);
 * 2. 定义三个宿主各自不同的四个端口(`host.ts`);
 * 3. loopback 静默失败时的三条出口(`exits.ts`)。
 *
 * ## 「三个宿主共用同一套认证实现」落在哪
 *
 * 落在 `pkce.ts` 被三处 import 这件事上 —— 它没有 I/O,
 * 用的是 Node 与浏览器都有的 `crypto.subtle`。
 * 差别全部收在 `host.ts` 的四个端口里,而端口的实现各宿主自己给。
 *
 * ## 🚨 前端永不持有长效凭据
 *
 * 这不是一条 grep 规则,是架构约束:浏览器里没有钥匙串,
 * 而 localStorage / cookie 对任何同源脚本可读。
 * ⇒ 远端 Web 宿主的 `SecretStore` **一律拒绝**存 refresh token
 * (见 {@link WEB_SECRETS_REFUSE}),它只拿短效 access token。
 *
 * @module @dshwar/auth-pkce
 */

export {
  assertLoopback,
  authorizeUrl,
  codeFromCallback,
  refreshRequestBody,
  startPkce,
  tokenRequestBody,
  type IdpConfig,
  type PkceSession,
} from './pkce.ts'

export {
  RefreshTokenNotStorable,
  WEB_SECRETS_REFUSE,
  type AuthHost,
  type BrowserOpener,
  type CallbackListener,
  type SecretStore,
} from './host.ts'

export {
  AUTO_RETRY_PORTS,
  exitsFor,
  loopbackRedirectUri,
  pickLoopbackPort,
  STALL_AFTER_MS,
  type AttemptOutcome,
  type AuthPhase,
} from './exits.ts'
