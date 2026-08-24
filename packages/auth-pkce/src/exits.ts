/**
 * loopback 回调静默失败时的**三条出口** —— 2026-08-21 裁决,设计侧已画进界面。
 *
 * ## 这一族失败为什么必须有出口
 *
 * 三种失败模式里最静默的一种:**浏览器侧一切正常,客户端侧只是没等到**。
 * 成因是回调没抵达 —— 防火墙拦了 127.0.0.1 绑定、端口被占、
 * 浏览器或代理拦了向 127.0.0.1 的跳转。
 *
 * 用户会觉得「我明明登录了」,而客户端还在转圈。**没有出口就只能杀进程重来。**
 *
 * ## 三条出口,以及为什么是这三条
 *
 * 关键判据是**码的传递方向**:
 *
 * | # | 出口 | 方向 | 代价 |
 * | --- | --- | --- | --- |
 * | ① | 自动换端口重试一次(静默) | app ← browser,绑定完整保留 | 无 |
 * | ② | 手动「重试」= 新端口 + 全新 PKCE 往返 | 同上 | 低 · **首选** |
 * | ③ | 配对码(RFC 8628 设备授权流) | **app → browser** | 中,需 IdP 支持设备端点 |
 *
 * ③ 的码由**客户端生成、显示在客户端、用户念进浏览器** ——
 * 没有任何机密从浏览器流回客户端,客户端只是轮询自己发起的那个请求。
 * 绑定关系换了一种形式仍然成立。
 *
 * ## 🚨 ④ 手工粘贴授权码(OOB)—— **本实现明确不提供**
 *
 * 方向是 **browser → app**,而那正是危险的方向。
 *
 * loopback 的价值在于「码被投递给了**发起请求的同一台机器上的同一个进程**」。
 * 粘贴把这条绑定彻底去掉。PKCE 能挡住攻击者拿走码去兑换(没有 verifier
 * 兑不出),但**挡不住反向的社工** —— 诱导用户把**自己的**码粘进攻击者的客户端。
 *
 * 更根本的是:「从浏览器复制一串码粘到应用里」这个习惯本身就是钓鱼面。
 * RFC 8252 明确不建议 OOB;把它做成兜底,等于用一个长期风险换一次性的便利。
 * ③ 已经提供了同样的逃生口,没有理由再开 ④。
 *
 * ⚠️ **这条不在实现时重新讨论。** 理由已经写在设计侧的界面上
 * (`DesktopAuthScreen.tsx` 顶部),这里是它的执行落点。
 * 本文件因此**没有**任何接受「用户粘贴的码」的入口 ——
 * 不是忘了写,是它不该存在。
 *
 * @module @dshwar/auth-pkce/exits
 */

/** 桌面认证的三个阶段。与 `DesktopAuthScreen` 的 `DesktopAuthPhase` 一一对应。 */
export type AuthPhase = 'waiting' | 'stalled' | 'pairing'

/**
 * 等多久算「静默失败」。
 *
 * ⚠️ 这个数是**用户耐心**的量级,不是网络超时的量级。
 * 授权本身可能要用户输密码、过 MFA —— 那些都在浏览器里,与我们无关。
 * 我们等的是「回调有没有回来」,而回调一旦被拦,等一分钟和等一小时一样。
 *
 * 45 秒的依据:够慢速用户完成一次 MFA,又不至于让「卡住了」这件事
 * 拖到用户自己去杀进程。界面上是**计秒读数**而不是转圈 ——
 * 它比 spinner 多给一条信息:已经等了多久。
 */
export const STALL_AFTER_MS = 45_000

/**
 * 自动换端口重试的次数。
 *
 * ⚠️ **只重试一次。** 端口被占是偶发的,换一个通常就好;
 * 而防火墙拦 127.0.0.1 绑定是**恒定的** —— 那种情况下重试一百次
 * 也一样,只是把 45 秒变成 75 分钟。
 *
 * 一次之后就进 `stalled`,把出口交给用户。
 */
export const AUTO_RETRY_PORTS = 1

/**
 * 挑一个回环端口。
 *
 * ⚠️ **不写死端口号。** 写死的后果有两个:
 * 一是被占时必然失败(而那正是三条出口要救的场景之一);
 * 二是它成了一个可预测的攻击面 —— 本机上任何进程都能抢先监听那个端口,
 * 然后收走本该给我们的授权码。
 *
 * ⇒ 每次现挑一个高位随机端口,并且**让操作系统确认它真的能绑**
 * (那一步在宿主的 `CallbackListener` 里 —— 这里只出候选)。
 *
 * @param random 注入随机源,测试里换成固定值 —— 否则断言随机漂。
 */
export function pickLoopbackPort(random: () => number = Math.random): number {
  // 49152–65535 是 IANA 的动态/私有端口区间,不与任何注册服务冲突。
  const MIN = 49152
  const MAX = 65535
  return MIN + Math.floor(random() * (MAX - MIN + 1))
}

/** 用挑到的端口拼回调地址。 */
export function loopbackRedirectUri(port: number, path = '/callback'): string {
  return `http://127.0.0.1:${String(port)}${path}`
}

/**
 * 一次登录尝试的结果。
 *
 * ⚠️ `stalled` **不是 `failed`**。与「501 不是失败」是同一条纪律:
 * 失败该让人重试,而 stalled 是「还没回来,而且可能永远不会」——
 * 它需要的是**出口**,不是重试按钮。把两者混在一起的后果是
 * 用户对着一个失败提示反复点重试,而每一次都会再等 45 秒。
 */
export type AttemptOutcome =
  | { readonly kind: 'ok'; readonly code: string }
  | { readonly kind: 'stalled'; readonly triedPorts: readonly number[] }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * 这一次 stalled 之后,界面该给哪些出口。
 *
 * @param idpSupportsDeviceFlow IdP 的 discovery 里有没有 `device_authorization_endpoint`
 *
 * ⚠️ **③ 要按 IdP 的能力决定给不给,不能无条件显示。**
 * 显示一个点下去会失败的出口,比不显示更糟:用户会以为自己做错了什么。
 * 而 `device_authorization_endpoint` 是 discovery 里能直接读到的 ——
 * 不需要猜,也不该猜。
 */
export function exitsFor(idpSupportsDeviceFlow: boolean): readonly AuthPhase[] {
  // ① 已经在 stalled 之前自动做过了,不作为「出口」呈现给用户。
  // ② 永远可用,是首选。
  // ③ 视 IdP 能力。
  return idpSupportsDeviceFlow ? ['stalled', 'pairing'] : ['stalled']
}
