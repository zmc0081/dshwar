/**
 * loopback 回调监听 —— {@link CallbackListener} 的 **Node 侧**实现。
 * 本地 sidecar 与 Tauri 共用这一份;远端 Web 收不了回调,那一格是 `null`。
 *
 * ## ⚠️ 它**不**从 `index.ts` 导出
 *
 * 本文件 import `node:http`。`index.ts` 是三个宿主共用的入口,而远端 Web 那一份
 * 要进浏览器打包 —— 一旦 `index.ts` 再导出本文件,`node:http` 就会被拖进
 * 浏览器构建图里。打包器对此的反应各不相同:Vite 会在**构建期**报
 * 「externalized for browser compatibility」然后照样出包,运行到那行才炸。
 *
 * ⇒ 走单独的子路径导出 `@dshwar/auth-pkce/loopback`。
 * 这不是洁癖:**边界写在 exports 字段里才拦得住,写在注释里拦不住。**
 *
 * ## 四条安全约束,以及它们各自防的是什么
 *
 * | 约束 | 不这么做会怎样 |
 * | --- | --- |
 * | 只绑 `127.0.0.1`,不绑 `0.0.0.0` | 绑全网卡 = 把授权码暴露给整个局域网 |
 * | 只认 `GET` + 精确路径 + 本次 `state` | 本机任何进程都能一枪打掉这次登录 |
 * | 正文是**常量**,不回显收到的东西 | 反射型 XSS,而且是在用户浏览器的**登录**上下文里 |
 * | 收到第一个回调就立刻关掉服务器 | 一个继续监听的回环端口是一个持续的攻击面 |
 *
 * ## 失败要能被**区分**,因为三种失败走三条不同的路
 *
 * | 失败 | 类型 | `retryAnotherPort` | 调用方该做什么 |
 * | --- | --- | --- | --- |
 * | 这个端口用不了 | {@link LoopbackPortUnavailable} | `true` | 出口 ① 自动换端口重试一次 |
 * | 绑定这件事本身被拒 | {@link LoopbackBindRefused} | `false` | 直接进 `stalled` —— 换端口没用 |
 * | 等不到回调 | {@link LoopbackTimeout} | `false` | 进 `stalled`,把三条出口交给用户 |
 *
 * 中间那一行是这张表存在的理由:**逐端口的失败是偶发的,整机性的失败是恒定的**。
 * 把两者揉成一个 `Error` 的后果是重试逻辑对着恒定失败重试 ——
 * 而那只是把 45 秒变成 75 分钟(见 `exits.ts` 的 `AUTO_RETRY_PORTS`)。
 *
 * ## 🚨 `EACCES` 是**逐端口**的,不是「权限不足」—— 2026-08-23 实测推翻
 *
 * 本文件第一版把判据写成「`EADDRINUSE` 可重试,**其余一律不可**,因为
 * 防火墙拦 127.0.0.1 绑定是恒定的」。那句话读起来顺理成章,而且与
 * `exits.ts` 里「防火墙拦绑定是恒定的」完全对得上 —— 但它错了。
 *
 * 测试第一次跑就撞上:Windows 上绑 `127.0.0.1:62596` 得到 **`EACCES`**。
 * 成因是 WinNAT / Hyper-V 的**保留端口段**(`netsh int ipv4 show
 * excludedportrange protocol=tcp`,本机实测 62503–62602 正在其中)。
 * 那是一段一段的、逐端口的判决 —— **换一个端口立刻就好**。
 *
 * 按第一版判据,这台机器上的登录会**间歇性失败**,而且提示说的是
 * 「换端口不会有帮助」。用户照做,于是问题永远不解决。
 *
 * ⇒ 判据改成:动态端口区间(49152–65535)里,`EADDRINUSE` 与 `EACCES`
 * **都是逐端口的判决**,都值得换一个端口再试一次;其余 errno 才算整机性。
 * 代价上限也算得清:`AUTO_RETRY_PORTS` 是 1,最多多试一次。
 *
 * @module @dshwar/auth-pkce/loopback
 */
import { createServer, type ServerResponse } from 'node:http'
import { loopbackRedirectUri, pickLoopbackPort } from './exits.ts'
import type { CallbackListener } from './host.ts'
import { assertLoopback, type PkceSession } from './pkce.ts'

/**
 * 回调成功后给用户看的那一页。
 *
 * 🚨 **它是常量,不含任何来自请求的字节。** 把 `req.url` 或 `code` 拼进来
 * 就是一条反射型 XSS —— 而这条 XSS 的上下文格外贵:用户此刻刚在 IdP 上
 * 完成认证,浏览器里躺着一个新鲜的授权码和一个活着的 IdP 会话。
 *
 * ⚠️ 无外部资源、无脚本。CSP 头把这一点变成**强制**的,而不是靠这份字符串自觉。
 */
const DONE_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>登录完成</title>
<style>
  body { margin: 0; display: grid; place-items: center; min-height: 100vh;
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         color: #1a1a1a; background: #fafafa; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #555; }
  @media (prefers-color-scheme: dark) {
    body { color: #ededed; background: #161616; }
    p { color: #a6a6a6; }
  }
</style>
</head>
<body>
<main>
<h1>登录完成</h1>
<p>可以关掉这个标签页,回到应用继续。</p>
</main>
</body>
</html>
`

/** 回调路径的默认值。IdP 侧注册的 `redirect_uri` 与它一致。 */
const DEFAULT_CALLBACK_PATH = '/callback'

/**
 * loopback 监听这一族失败的共同基类。
 *
 * ⚠️ `retryAnotherPort` 做成**数据**而不是留给调用方 `instanceof` 判断:
 * 判断散落在调用方,就会有一处漏判 —— 而漏判的表现是「有时候能自动恢复,
 * 有时候不能」,那是最难复现的一类工单。
 */
export class LoopbackError extends Error {
  /** 出问题的那个端口。诊断信息里要能说出是哪个。 */
  readonly port: number
  /** 换一个端口重试是否可能有用。 */
  readonly retryAnotherPort: boolean

  constructor(message: string, port: number, retryAnotherPort: boolean) {
    super(message)
    this.name = 'LoopbackError'
    this.port = port
    this.retryAnotherPort = retryAnotherPort
  }
}

/**
 * **这一个端口**用不了 —— 被占(`EADDRINUSE`)或落在系统的保留段里(`EACCES`)。
 *
 * ⚠️ **这是出口 ① 的触发条件,不是一次失败。** 换一个端口通常就好 ——
 * 但换端口意味着 `redirect_uri` 变了,于是**必须重新走一次 `startPkce`**,
 * 不能复用上一次的会话。这一点写在这里,因为它是最容易写错的一步:
 * 复用旧会话的后果是 IdP 拿到一个与授权请求不匹配的 `redirect_uri`,
 * 而 IdP 报的错通常只是 `invalid_request`。
 */
export class LoopbackPortUnavailable extends LoopbackError {
  /** 系统给的 errno 码。`EADDRINUSE` = 被占,`EACCES` = 落在保留段里。 */
  readonly code: string

  constructor(port: number, code: string) {
    super(
      `回环端口 ${String(port)} 用不了(${code})。\n` +
        (code === 'EACCES'
          ? '这个端口落在系统的保留段里(Windows 上是 WinNAT / Hyper-V 的 excludedportrange)。\n'
          : '这个端口已被别的进程占用。\n') +
        '换一个端口重试一次即可 —— 但要重新走 startPkce,因为 redirect_uri 变了。',
      port,
      true,
    )
    this.name = 'LoopbackPortUnavailable'
    this.code = code
  }
}

/**
 * **绑定这件事本身**被系统拒绝 —— 不是这个端口的问题。
 *
 * 🚨 **换端口没用。** 这一族的成因是整机性的:容器里没有回环网卡
 * (`EADDRNOTAVAIL`)、网络栈没起来(`ENETDOWN`)、安全软件把整条回环
 * 绑定路径拦死。重试只会把等待时间乘以重试次数。
 *
 * ⚠️ `EACCES` **不在这一族里**,尽管它读起来最像「权限不足」——
 * 见模块头 2026-08-23 那条实测。
 */
export class LoopbackBindRefused extends LoopbackError {
  /** 系统给的 errno 码。诊断时是唯一有信息量的东西。 */
  readonly code: string

  constructor(port: number, code: string) {
    super(
      `绑定回环端口 ${String(port)} 被拒绝(${code})。\n` +
        '这一族成因是整机性的(容器里没有回环网卡、网络栈没起来、安全软件拦死了回环绑定),\n' +
        '换端口重试不会有帮助 —— 直接把三条出口交给用户。',
      port,
      false,
    )
    this.name = 'LoopbackBindRefused'
    this.code = code
  }
}

/**
 * 哪些 errno 是**逐端口**的判决。
 *
 * 🚨 `EACCES` 在这里不是笔误 —— 见模块头 2026-08-23 那条实测:
 * Windows 的保留端口段给的就是它,而那是一段一段的,换个端口立刻就好。
 *
 * ⚠️ 这个集合只在**动态端口区间(49152–65535)**里成立。
 * 低位端口上的 `EACCES` 是真的「要 root」,而本包永不绑低位端口
 * (`pickLoopbackPort` 的区间写死在 `exits.ts` 里)。
 */
const PER_PORT_BIND_ERRORS: ReadonlySet<string> = new Set(['EADDRINUSE', 'EACCES'])

/**
 * 把绑定失败的 errno 分成「换个端口试试」与「别试了」。
 *
 * 导出是为了**能被单独验**:这是一个分类器,而分类器的每个分类码
 * 都该有一条负向验证 —— 真去绑一个 Windows 保留端口是不可复现的,
 * 但把映射本身钉死是可复现的。
 *
 * @param code 来自 `NodeJS.ErrnoException.code`,拿不到时传 `'UNKNOWN'`
 */
export function classifyBindError(port: number, code: string): LoopbackError {
  return PER_PORT_BIND_ERRORS.has(code)
    ? new LoopbackPortUnavailable(port, code)
    : new LoopbackBindRefused(port, code)
}

/**
 * 等到超时也没有回调抵达。
 *
 * ⚠️ **超时 ≠ 失败。** 它是 `exits.ts` 里那个 `stalled` 状态的触发器:
 * 浏览器侧可能一切正常,只是回调没能走回来。把它当失败处理的后果是
 * 用户对着一个「登录失败」反复点重试,而每一次都会再等一遍。
 */
export class LoopbackTimeout extends LoopbackError {
  /** 实际等了多久。界面上的计秒读数就是它。 */
  readonly waitedMs: number

  constructor(port: number, waitedMs: number) {
    super(
      `等了 ${String(waitedMs)} ms 没等到回调(端口 ${String(port)})。\n` +
        '⚠️ 这不是失败:浏览器侧可能一切正常,只是回调没走回来。\n' +
        '走 exits.ts 的三条出口,不要显示「登录失败」。',
      port,
      false,
    )
    this.name = 'LoopbackTimeout'
    this.waitedMs = waitedMs
  }
}

/**
 * 一个已经绑好、正在等回调的回环监听。
 *
 * ## 为什么「绑定」与「等待」是两步
 *
 * 因为 `redirect_uri` 里有端口,而端口能不能绑要问操作系统 ——
 * 于是顺序只能是**先绑、再拿 `redirectUri` 建 PKCE 会话**:
 *
 * ```ts
 * const listening = await bindLoopback()
 * const session = await startPkce(listening.redirectUri)
 * const arrived = listening.waitForCallback(session, STALL_AFTER_MS) // ← 先要这个 Promise
 * await browser.open(authorizeUrl(idp, session))                     // 再开浏览器
 * const code = codeFromCallback(await arrived, session)
 * ```
 *
 * ⚠️ **`waitForCallback` 要在开浏览器之前调。** 在它之前抵达的请求一律 404 ——
 * 服务器此刻还不知道本次的 `state`,而一个不核对 `state` 就放行的窗口
 * 正是下面那条约束要关掉的东西。
 */
export interface LoopbackListening {
  /**
   * **操作系统确认的**绑定地址。
   *
   * ★ 「绑的是 127.0.0.1 而不是 0.0.0.0」这条约束的判据落在这里 ——
   * 它是 `server.address()` 的观测值,不是源码里的字面量。
   * 判据落在字面量上的话,一个 `listen(port)`(不传 host,等价于绑全网卡)
   * 会完整地绕过它。
   */
  readonly address: string
  /** 实际绑到的端口。 */
  readonly port: number
  /** 拿去建 PKCE 会话、并注册给 IdP 的那个地址。 */
  readonly redirectUri: string
  /**
   * 等一次回调。
   *
   * @param session 本次 PKCE 会话 —— 它的 `state` 用来认「哪个回调是我的」
   * @param timeoutMs 等多久,通常传 `STALL_AFTER_MS`
   * @returns 收到的完整回调 URL,交给 `codeFromCallback` 取码
   * @throws {LoopbackTimeout} 超时 —— **不是失败**,见该类
   *
   * ⚠️ 只能调一次。第二次会同步抛 —— 一个能被等两次的回调监听,
   * 意味着调用方对「已经用掉了」这件事有误解,而那正是重放面的来源。
   */
  waitForCallback(session: PkceSession, timeoutMs: number): Promise<string>
  /**
   * 关掉。**幂等**,重复调用返回同一个 Promise。
   *
   * 正常路径下服务器在收到回调的那一刻就已经停止接受新连接了;
   * 这个方法是给「取消登录」「超时之后」「测试收尾」用的兜底。
   */
  close(): Promise<void>
}

/**
 * 在**指定的**回调地址上起监听。
 *
 * @param redirectUri 必须是带显式端口的回环地址,如 `http://127.0.0.1:51789/callback`
 * @throws {LoopbackPortUnavailable} 端口被占
 * @throws {LoopbackBindRefused} 其它绑定失败
 */
export async function openLoopbackAt(redirectUri: string): Promise<LoopbackListening> {
  // 复用 pkce.ts 的那条判据,不在这里重写一遍 —— 两份判据迟早分家,
  // 而分家的表现是「授权 URL 拦得住 localhost,监听却绑得上」。
  assertLoopback(redirectUri)
  const url = new URL(redirectUri)
  if (url.port === '') {
    throw new Error(
      `回调地址必须带显式端口,收到 ${redirectUri}。\n` +
        '不带端口意味着 80,而 80 需要特权且几乎必然被占;\n' +
        '更要命的是它与「每次现挑一个高位随机端口」这条直接矛盾。',
    )
  }
  const port = Number(url.port)
  // ⚠️ 绑定地址取自回调地址里的那个回环字面量,而 assertLoopback 已经把它
  //   约束成 127.0.0.1 / ::1 二选一。**这里不能写 '0.0.0.0',也不能省掉 host 参数**
  //   —— `listen(port)` 不传 host 等价于绑全网卡,而那等于把授权码
  //   暴露给整个局域网。`url.hostname` 对 IPv6 会带方括号,这么写顺手剥掉。
  const host = url.hostname === '127.0.0.1' ? '127.0.0.1' : '::1'
  const path = url.pathname
  const origin = `http://${url.host}`

  /** 已经吃掉一个回调了。之后的一律拒绝 —— 见模块头那张表的最后一行。 */
  let settled = false
  /** 本次要认的 `state`。`null` = 还没开始等,此刻没有任何回调是合法的。 */
  let expectedState: string | null = null
  let received: string | null = null
  let waiting = false
  let resolveWaiter: ((callbackUrl: string) => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let closing: Promise<void> | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /**
   * 一律 404,**不区分**「路径不对」「方法不对」「已经用过了」。
   *
   * ⚠️ 区分开等于对着端口扫描回答「这个端口上确实有一个回调在等」——
   * 而扫遍 49152–65535 只要几秒。405 / 409 比 404 好读,但好读的对象是攻击者。
   */
  const refuse = (res: ServerResponse): void => {
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    // 🚨 正文是常量。回显 req.url 就是一条反射型 XSS,见 DONE_PAGE 的说明。
    res.end('Not Found')
  }

  const server = createServer((req, res) => {
    const target = req.url ?? ''
    // ⚠️ `//evil.com/callback` 也是以 `/` 开头的,而 `new URL` 会把它当协议相对地址
    //   解析成另一个源 —— 于是 pathname 变成 `/callback`,判等通过。
    //   这一行拦的就是它。
    if (settled || req.method !== 'GET' || !target.startsWith('/') || target.startsWith('//')) {
      refuse(res)
      return
    }
    const requested = new URL(target, origin)
    if (requested.pathname !== path) {
      refuse(res)
      return
    }
    // 🚨 认 `state`。少了这一条,本机上任何进程只要猜中端口、打一发 GET,
    //   就能让服务器「收到回调」并自我关闭 —— 一枪打掉这次登录。
    //   顺带还挡住一类非对抗的情形:上一次登录迟到的回调落进这一次。
    if (expectedState === null || requested.searchParams.get('state') !== expectedState) {
      refuse(res)
      return
    }

    settled = true
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      // 这一页不需要任何外部资源,也不需要脚本。写死成 'none' 之后,
      // 哪天有人往 DONE_PAGE 里加一个 <script>,浏览器会直接拦掉。
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      // 应答完就断。回环端口上没有第二次交互,keep-alive 只会让 close() 悬着。
      connection: 'close',
    })
    res.end(DONE_PAGE)

    // 立刻停止接受新连接 —— 一个继续监听的回环端口是一个持续的攻击面。
    // 已经在应答中的这条连接不受影响(实测:server.close() 不掐正在写的响应)。
    server.close()

    // ⚠️ 等这一页**真的发出去**再兑现 Promise。
    //   立刻兑现的话,调用方的 `finally { await close() }` 会在响应落地之前
    //   把 socket 拆掉 —— 用户看到的是一个空白页或者连接重置,
    //   而我们这边一切正常。那种落差查起来极贵:两边的日志都说成功。
    const callbackUrl = requested.toString()
    res.on('close', () => {
      received = callbackUrl
      clearTimer()
      const resolve = resolveWaiter
      resolveWaiter = null
      if (resolve !== null) resolve(callbackUrl)
    })
  })

  await new Promise<void>((resolve, reject) => {
    function onError(err: Error): void {
      server.removeListener('listening', onListening)
      reject(classifyBindError(port, (err as NodeJS.ErrnoException).code ?? 'UNKNOWN'))
    }
    function onListening(): void {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })

  const info = server.address()
  const bound = typeof info === 'object' && info !== null ? info : { address: host, port }
  // 端口原样回填 —— 不重新拼 host,免得 IPv6 的方括号在两处各写一遍而写岔。
  const boundUrl = new URL(redirectUri)
  boundUrl.port = String(bound.port)

  const close = (): Promise<void> => {
    if (closing !== null) return closing
    clearTimer()
    closing = new Promise<void>((done) => {
      // keep-alive 的空闲连接会让 close() 的回调悬到 keepAliveTimeout ——
      // 在测试里表现为「vitest 不退出」,而**不退出在输出里什么都不是**。
      server.closeAllConnections()
      if (!server.listening) {
        done()
        return
      }
      server.close(() => {
        done()
      })
    })
    return closing
  }

  return {
    address: bound.address,
    port: bound.port,
    redirectUri: boundUrl.toString(),
    waitForCallback(session: PkceSession, timeoutMs: number): Promise<string> {
      if (waiting) {
        throw new Error(
          'waitForCallback 只能调一次。\n' +
            '一个能被等两次的回调监听,意味着调用方对「这一次已经用掉了」有误解 ——\n' +
            '而那正是重放面的来源。要再等一次,重新绑一个端口、重新走 startPkce。',
        )
      }
      waiting = true
      expectedState = session.state
      if (received !== null) return Promise.resolve(received)
      return new Promise<string>((resolve, reject) => {
        resolveWaiter = resolve
        timer = setTimeout(() => {
          timer = null
          resolveWaiter = null
          // 超时也要把端口收掉 —— 出口 ②/③ 会另起一次,旧端口留着只是攻击面。
          void close()
          reject(new LoopbackTimeout(bound.port, timeoutMs))
        }, timeoutMs)
      })
    },
    close,
  }
}

/**
 * 现挑一个高位随机端口并绑上。
 *
 * @param options.random 注入随机源,测试里换成固定值 —— 否则断言随机漂
 * @param options.path 回调路径,默认 `/callback`
 * @throws {LoopbackPortUnavailable} 挑到的端口用不了(被占,或落在系统保留段里)
 *
 * ## ⚠️ 重试**不在这里**
 *
 * 因为换端口就换了 `redirect_uri`,而 `redirect_uri` 是 PKCE 会话的一部分 ——
 * 重试必须连 `startPkce` 一起重来,那是调用方的编排。这里只负责
 * **把「被占」与「绑不上」区分开**,让调用方能照着 `AUTO_RETRY_PORTS` 决定重不重试。
 */
export function bindLoopback(
  options: { readonly random?: () => number; readonly path?: string } = {},
): Promise<LoopbackListening> {
  const port = pickLoopbackPort(options.random ?? Math.random)
  return openLoopbackAt(loopbackRedirectUri(port, options.path ?? DEFAULT_CALLBACK_PATH))
}

/**
 * `host.ts` 那个端口的 Node 实现:在**会话里已经写死的**那个端口上等一次回调。
 *
 * ⚠️ 走这条路时端口已经定死在 `session.redirectUri` 里了,所以它**换不了端口** ——
 * 出口 ① 必须发生在 `startPkce` 之前,用 {@link bindLoopback}。
 * 这个端口存在是为了满足 {@link CallbackListener} 的形状,不是推荐用法。
 */
export const nodeCallbackListener: CallbackListener = {
  async listen(session: PkceSession, options: { timeoutMs: number }): Promise<string> {
    const listening = await openLoopbackAt(session.redirectUri)
    try {
      return await listening.waitForCallback(session, options.timeoutMs)
    } finally {
      await listening.close()
    }
  },
}
