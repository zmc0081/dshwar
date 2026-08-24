/**
 * loopback 回调监听 —— **真的起服务器、真的发请求**。
 *
 * ## 为什么这一份不许用 mock
 *
 * 被测的东西全部是「操作系统与 HTTP 协议实际怎么表现」:
 * 绑到哪个地址、端口被占时抛什么 errno、服务器关掉之后第二个连接会怎样。
 * 把 `node:http` mock 掉之后,这几条断言验的就只剩「我以为它会这样」——
 * 而这一族的 bug 恰恰长在「我以为」与「实际」之间。
 *
 * | 断言 | 它守的那条约束 |
 * | --- | --- |
 * | `address` 是 `127.0.0.1` | 绑全网卡 = 把授权码暴露给整个局域网 |
 * | 端口用不了抛 `LoopbackPortUnavailable` 且 `retryAnotherPort` | 出口 ① 的触发条件要能被认出来 |
 * | 超时抛 `LoopbackTimeout` 而不是普通 Error | 超时 ≠ 失败,它触发的是三条出口 |
 * | 非 GET / 路径不对 / state 不对 → 404,**且不消耗这一次** | 本机任何进程都别想一枪打掉登录 |
 * | 第一个回调之后端口就没了 | 一个能被调用两次的回调是重放面 |
 * | 应答正文里搜不到收到的任何字节 | 反射型 XSS,而且是在登录上下文里 |
 * | `index.ts` 不 import `loopback.ts` | 远端 Web 那一份要进浏览器打包 |
 *
 * ## ⚠️ 每条测试都要关掉服务器
 *
 * 忘了关的表现是 **vitest 不退出** —— 而「不退出」在输出里什么都不是:
 * 没有红、没有失败计数,只有一个看起来在跑的进程。
 * 所以这里用 `track()` 统一登记,`afterEach` 无条件收。
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loopbackRedirectUri, pickLoopbackPort } from '../src/exits.ts'
import {
  bindLoopback,
  classifyBindError,
  LoopbackBindRefused,
  LoopbackError,
  LoopbackPortUnavailable,
  LoopbackTimeout,
  nodeCallbackListener,
  openLoopbackAt,
  type LoopbackListening,
} from '../src/loopback.ts'
import { codeFromCallback, startPkce, type PkceSession } from '../src/pkce.ts'

// ---------------------------------------------------------------------------
// 收尾:一个都不许漏
// ---------------------------------------------------------------------------

const openHandles: LoopbackListening[] = []
const openServers: Server[] = []
const openSockets: Socket[] = []

function track<T extends LoopbackListening>(handle: T): T {
  openHandles.push(handle)
  return handle
}

afterEach(async () => {
  for (const s of openSockets.splice(0)) s.destroy()
  for (const h of openHandles.splice(0)) await h.close()
  for (const srv of openServers.splice(0)) {
    srv.closeAllConnections()
    await new Promise<void>((done) => {
      if (!srv.listening) {
        done()
        return
      }
      srv.close(() => {
        done()
      })
    })
  }
})

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/**
 * 绑一个真端口。
 *
 * ⚠️ 随机端口有相当概率撞上「这个端口用不了」—— 被别人占,或者(Windows 上)
 * 落进 WinNAT / Hyper-V 的保留段。那不是被测代码的问题,重挑一个就好;
 * **这个夹具本身就是出口 ① 的一次真实演练。**
 *
 * 但**不能无限重试**:那样一个「永远绑不上」的真实故障会表现为测试挂住,
 * 而挂住在输出里什么都不是。所以次数写死。
 */
async function bindFresh(): Promise<LoopbackListening> {
  let last: unknown = null
  for (let i = 0; i < 8; i += 1) {
    try {
      return track(await bindLoopback())
    } catch (e: unknown) {
      if (!(e instanceof LoopbackPortUnavailable)) throw e
      last = e
    }
  }
  throw new Error(`连挑 8 个端口都用不了,不正常:${String(last)}`)
}

/** 起一次完整的等待:绑端口 → 建会话 → 拿到「回调到了」的 Promise。 */
async function waiting(timeoutMs = 3_000): Promise<{
  handle: LoopbackListening
  session: PkceSession
  arrived: Promise<string>
}> {
  const handle = await bindFresh()
  const session = await startPkce(handle.redirectUri)
  // ⚠️ 先拿 Promise 再发请求 —— 与真实用法一致(见 LoopbackListening 的说明):
  //   waitForCallback 之前抵达的请求一律 404,因为那时还不知道本次的 state。
  const arrived = handle.waitForCallback(session, timeoutMs)
  return { handle, session, arrived }
}

/** 原始 socket,用来做「连得上吗」「同一条连接上再来一发」这类协议层观察。 */
function rawConnect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    openSockets.push(socket)
    socket.once('connect', () => {
      resolve(socket)
    })
    socket.once('error', reject)
  })
}

/** 读到第一份响应头为止(或到时间)。 */
function readResponse(socket: Socket, ms = 500): Promise<string> {
  return new Promise((resolve) => {
    let buf = ''
    const timer = setTimeout(() => {
      resolve(buf)
    }, ms)
    socket.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      if (buf.includes('\r\n\r\n')) {
        clearTimeout(timer)
        resolve(buf)
      }
    })
  })
}

/** 试着连一下,返回 `CONNECTED` / errno / `TIMEOUT`。 */
function probeConnect(host: string, port: number, ms = 400): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, host)
    const finish = (verdict: string): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(verdict)
    }
    const timer = setTimeout(() => {
      finish('TIMEOUT')
    }, ms)
    socket.once('error', (e: Error) => {
      finish((e as NodeJS.ErrnoException).code ?? 'ERROR')
    })
    socket.once('connect', () => {
      finish('CONNECTED')
    })
  })
}

// ---------------------------------------------------------------------------

describe('正常回调', () => {
  it('★ 收到回调 → 兑现完整 URL,codeFromCallback 能从里面取出码', async () => {
    const { handle, session, arrived } = await waiting()
    const target = `${handle.redirectUri}?code=the-code&state=${encodeURIComponent(session.state)}`

    const res = await fetch(target)
    await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(await arrived).toBe(target)
    // 端到端:监听收上来的东西,pkce.ts 那一半真的认得
    expect(codeFromCallback(await arrived, session)).toBe('the-code')
  })

  it('★ 给用户看的那一页里,搜不到回调带来的任何字节(反射型 XSS)', async () => {
    // 这条 XSS 的上下文格外贵:用户此刻刚在 IdP 上完成认证,
    // 浏览器里躺着一个新鲜的授权码和一个活着的 IdP 会话。
    const { handle, session, arrived } = await waiting()
    const marker = '<script>alert(1)</script>'
    const res = await fetch(
      `${handle.redirectUri}?code=${encodeURIComponent(marker)}&state=${encodeURIComponent(session.state)}`,
    )
    const body = await res.text()
    await arrived

    expect(body).not.toContain('alert')
    expect(body).not.toContain('script>')
    expect(body).not.toContain(session.state)
    // 出口计数:正文不能是空的,否则「搜不到」这三条什么都没查
    expect(body.length, '正文是空的 —— 上面三条空跑了').toBeGreaterThan(100)
    // CSP 把「这一页不需要脚本」从自觉变成强制
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  })

  it('nodeCallbackListener(CallbackListener 的实现)走同一条路,收完自己关掉', async () => {
    // ⚠️ 这条验的是**出厂形状**:上面那些测的是 openLoopbackAt,
    //   而 host.ts 声明的端口是 listen(session, {timeoutMs})。
    //   两者分家的表现是「实现完整、测试齐全,而真正被装配的那个从没跑过」。
    const port = await freePort()
    const session = await startPkce(loopbackRedirectUri(port))
    const arrived = nodeCallbackListener.listen(session, { timeoutMs: 3_000 })
    const target = `${session.redirectUri}?code=via-port&state=${encodeURIComponent(session.state)}`
    await (await fetch(target)).text()

    expect(codeFromCallback(await arrived, session)).toBe('via-port')
    // 收完就该没了 —— listen 的 finally 里关
    expect(await probeConnect('127.0.0.1', port)).not.toBe('CONNECTED')
  })
})

describe('★ 绑的是 127.0.0.1,不是 0.0.0.0', () => {
  it('操作系统确认的绑定地址是 127.0.0.1', async () => {
    // 判据落在 server.address() 的观测值上,不落在源码里的字面量 ——
    // 一个 listen(port)(不传 host,等价于绑全网卡)会完整绕过字面量判据。
    const handle = await bindFresh()
    expect(handle.address).toBe('127.0.0.1')
    expect(handle.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })

  it('从本机的非回环地址连不上(有非回环网卡时才验)', async () => {
    // ⚠️ 这条是上一条的行为侧对照:address 字段说的是「绑到哪」,
    //   这条问的是「局域网上够不够得着」。两者一起才盖住整条约束。
    const handle = await bindFresh()
    const external = firstExternalIpv4()
    if (external === null) {
      // 没有非回环网卡时**不假装验过**:上面那条仍然守着绑定地址。
      expect(handle.address, '没有非回环网卡,本条只剩绑定地址这一层').toBe('127.0.0.1')
      return
    }
    // 回环端口在本机自己的局域网地址上必须够不着。CONNECTED 就是绑成 0.0.0.0 了。
    expect(await probeConnect(external, handle.port)).not.toBe('CONNECTED')
  })
})

describe('★ 「这个端口用不了」要能与「绑不上」区分开', () => {
  it('端口被占 → LoopbackPortUnavailable,且 retryAnotherPort 为 true', async () => {
    // 这正是出口 ① 的触发条件:换一个端口通常就好。
    const squatter = createServer(() => {})
    openServers.push(squatter)
    await new Promise<void>((ready) => {
      squatter.listen(0, '127.0.0.1', ready)
    })
    const addr = squatter.address()
    expect(typeof addr === 'object' && addr !== null, '拿不到占位服务器的端口').toBe(true)
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0

    const failure = await openLoopbackAt(loopbackRedirectUri(port)).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(LoopbackPortUnavailable)
    expect(failure).toBeInstanceOf(LoopbackError)
    expect((failure as LoopbackError).retryAnotherPort).toBe(true)
    expect((failure as LoopbackError).port).toBe(port)
  })

  it('🚨 EACCES 判成「换个端口试试」—— Windows 的保留端口段给的就是它', () => {
    // 2026-08-23 实测:本文件第一版把 EACCES 归进「恒定失败」,理由读起来
    // 顺理成章(「防火墙拦 127.0.0.1 绑定是恒定的」),而这一份测试第一次跑
    // 就撞上 —— 绑 127.0.0.1:62596 得到 EACCES,因为它落在 WinNAT / Hyper-V 的
    // excludedportrange(本机实测 62503–62602)里。那是逐端口的判决,
    // 换一个端口立刻就好。
    //
    // 按第一版判据,这台机器上的登录会间歇性失败,而提示说的是「换端口没用」。
    const e = classifyBindError(62_596, 'EACCES')
    expect(e).toBeInstanceOf(LoopbackPortUnavailable)
    expect(e.retryAnotherPort).toBe(true)
    expect(e.message).toContain('保留段')
  })

  it('★ 每个 errno 都有明确归属,逐条验(分类器:有几个分类码就验几条)', () => {
    // 一条负向验证的绿会被读成「整个分类器已验证」。所以逐码来,并数出口。
    const cases: readonly (readonly [string, boolean])[] = [
      ['EADDRINUSE', true], // 被别人占了 —— 换一个
      ['EACCES', true], // 保留端口段 —— 换一个
      ['EADDRNOTAVAIL', false], // 容器里没有回环网卡 —— 换端口没用
      ['ENETDOWN', false], // 网络栈没起来 —— 同上
      ['EPERM', false], // 整条绑定路径被拦 —— 同上
      ['UNKNOWN', false], // 🚨 兜底判「不可重试」:认不出来就停下让人看一眼
    ]
    let asserted = 0
    for (const [code, retryable] of cases) {
      const e = classifyBindError(50_000, code)
      asserted += 1
      expect(e.retryAnotherPort, `${code} 归错了`).toBe(retryable)
      expect(e, `${code} 的类型与 retryAnotherPort 对不上`).toBeInstanceOf(
        retryable ? LoopbackPortUnavailable : LoopbackBindRefused,
      )
      expect(e.port).toBe(50_000)
    }
    expect(asserted, '一个 errno 都没验到 —— 本条空跑了').toBe(cases.length)
  })

  it('能绑的端口不许被判成用不了(反向对照)', async () => {
    // 规则不是「见到绑定就红」。
    const handle = await bindFresh()
    expect(handle.port).toBeGreaterThanOrEqual(49152)
  })
})

describe('★ 超时要能与失败区分开', () => {
  it('等不到回调 → LoopbackTimeout,retryAnotherPort 为 false', async () => {
    // 超时不是失败:浏览器侧可能一切正常,只是回调没走回来。
    // 当失败处理的后果是用户对着「登录失败」反复点重试,每次再等一遍。
    const handle = await bindFresh()
    const session = await startPkce(handle.redirectUri)
    const failure = await handle.waitForCallback(session, 60).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(LoopbackTimeout)
    expect((failure as LoopbackTimeout).waitedMs).toBe(60)
    expect((failure as LoopbackTimeout).retryAnotherPort).toBe(false)
    expect((failure as LoopbackTimeout).port).toBe(handle.port)
  })

  it('超时之后端口不许还留着 —— 出口 ②/③ 会另起一次', async () => {
    const handle = await bindFresh()
    const session = await startPkce(handle.redirectUri)
    await expect(handle.waitForCallback(session, 60)).rejects.toBeInstanceOf(LoopbackTimeout)
    expect(await probeConnect('127.0.0.1', handle.port)).not.toBe('CONNECTED')
  })

  it('没超时的那次不许抛(反向对照)', async () => {
    // 少了这条,一个「立刻超时」的实现也能通过上面两条。
    const { handle, session, arrived } = await waiting(3_000)
    await (
      await fetch(`${handle.redirectUri}?code=c&state=${encodeURIComponent(session.state)}`)
    ).text()
    await expect(arrived).resolves.toContain('code=c')
  })
})

describe('🚨 只认 GET + 精确路径 + 本次 state', () => {
  it('★ 非 GET → 404,而且**不消耗这一次**', async () => {
    // 后半句才是重点:一发 POST 就能把这次登录打掉的话,
    // 本机任何进程扫一遍 49152–65535 就能让人永远登不上。
    const { handle, session, arrived } = await waiting()
    // ⚠️ 这几发**必须带上正确的 code 与 state**。
    //   第一版只发了裸地址,于是把 `req.method !== 'GET'` 整条删掉,这条测试
    //   照样绿 —— 拦下它们的是 state 那一关,不是方法这一关。
    //   一条「验的不是自己声称在验的那一维」的断言,与没有断言等价。
    const valid = `?code=x&state=${encodeURIComponent(session.state)}`
    let asserted = 0
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      const res = await fetch(`${handle.redirectUri}${valid}`, { method })
      await res.arrayBuffer()
      asserted += 1
      expect(res.status, `${method} 竟然没被拒`).toBe(404)
    }
    expect(asserted, '一个方法都没验到 —— 本条空跑了').toBe(5)

    // 打完五发之后,正经的回调仍然收得到
    await (
      await fetch(
        `${handle.redirectUri}?code=still-here&state=${encodeURIComponent(session.state)}`,
      )
    ).text()
    expect(codeFromCallback(await arrived, session)).toBe('still-here')
  })

  it('★ 路径不对 → 404,同样不消耗这一次', async () => {
    const { handle, session, arrived } = await waiting()
    const base = new URL(handle.redirectUri).origin
    let asserted = 0
    for (const path of ['/', '/callback/', '/callbac', '/CALLBACK', '/callback/extra']) {
      const res = await fetch(`${base}${path}?code=x&state=${encodeURIComponent(session.state)}`)
      await res.text()
      asserted += 1
      expect(res.status, `${path} 竟然被当成了回调`).toBe(404)
    }
    expect(asserted, '一条路径都没验到 —— 本条空跑了').toBe(5)

    await (
      await fetch(`${handle.redirectUri}?code=ok&state=${encodeURIComponent(session.state)}`)
    ).text()
    expect(codeFromCallback(await arrived, session)).toBe('ok')
  })

  it('★ 协议相对的请求目标 `//evil.example/callback` → 404', async () => {
    // ⚠️ 它也是以 `/` 开头的,而 `new URL('//evil.example/callback', origin)`
    //   会把它解析成**另一个源**上的 `/callback` —— pathname 判等照样通过。
    //   放进来的话,兑现给调用方的那个「回调 URL」会带一个攻击者选的 origin。
    //
    //   发这一发要走原始 socket:fetch 会先把它当 URL 规范化掉,
    //   于是根本送不出这个请求目标 —— 那样测的就不是这一维了。
    const { handle, session, arrived } = await waiting()
    const socket = await rawConnect(handle.port)
    socket.write(
      `GET //evil.example/callback?code=x&state=${encodeURIComponent(session.state)} HTTP/1.1\r\n` +
        'Host: 127.0.0.1\r\nConnection: close\r\n\r\n',
    )
    const replied = await readResponse(socket)
    expect(replied, '`//evil.example/callback` 被当成了本机的 /callback').toContain('404')
    expect(replied).not.toContain('200 OK')

    await (
      await fetch(`${handle.redirectUri}?code=intact&state=${encodeURIComponent(session.state)}`)
    ).text()
    expect(codeFromCallback(await arrived, session)).toBe('intact')
  })

  it('★ state 不是本次的 → 404,同样不消耗这一次', async () => {
    // 挡两种东西:本机进程的一枪(它猜不到 state),
    // 以及上一次登录迟到的回调落进这一次。
    const { handle, session, arrived } = await waiting()
    const res = await fetch(`${handle.redirectUri}?code=hijack&state=not-this-one`)
    await res.text()
    expect(res.status).toBe(404)

    await (
      await fetch(`${handle.redirectUri}?code=mine&state=${encodeURIComponent(session.state)}`)
    ).text()
    expect(codeFromCallback(await arrived, session)).toBe('mine')
  })

  it('404 的正文里也不回显收到的东西', async () => {
    const handle = await bindFresh()
    const res = await fetch(`${handle.redirectUri}?x=%3Cscript%3E`)
    const body = await res.text()
    expect(res.status).toBe(404)
    expect(body).not.toContain('script')
    expect(body.length, '404 正文是空的 —— 上一条空跑了').toBeGreaterThan(0)
  })
})

describe('🚨 只处理第一个回调', () => {
  it('★ 第一个回调之后:同一条连接上再来一发 → 404;新连接 → 连不上', async () => {
    const { handle, session, arrived } = await waiting()
    // 先把第二条连接建好 —— 此时 listener 还开着。
    // 这么摆是为了让「服务器内部那道 settled 闸」真的**看得见**:
    // 只测「新连接连不上」的话,验到的是 listener 关了,不是那道闸。
    const early = await rawConnect(handle.port)

    await (
      await fetch(`${handle.redirectUri}?code=first&state=${encodeURIComponent(session.state)}`)
    ).text()
    expect(codeFromCallback(await arrived, session)).toBe('first')

    const path = new URL(handle.redirectUri).pathname
    early.write(
      `GET ${path}?code=second&state=${encodeURIComponent(session.state)} HTTP/1.1\r\n` +
        `Host: 127.0.0.1\r\nConnection: close\r\n\r\n`,
    )
    const replay = await readResponse(early)
    expect(replay, '第二次回调竟然被受理了 —— 那是一个重放面').toContain('404')
    expect(replay).not.toContain('200 OK')

    // 而且端口本身已经没了
    expect(await probeConnect('127.0.0.1', handle.port)).not.toBe('CONNECTED')
  })

  it('waitForCallback 只能调一次 —— 第二次抛', async () => {
    const { handle, session, arrived } = await waiting()
    expect(() => handle.waitForCallback(session, 100)).toThrow(/只能调一次/)
    await (
      await fetch(`${handle.redirectUri}?code=c&state=${encodeURIComponent(session.state)}`)
    ).text()
    await arrived
  })

  it('close 幂等 —— 收尾路径上没人需要记得只调一次', async () => {
    const handle = await bindFresh()
    await Promise.all([handle.close(), handle.close()])
    await handle.close()
    expect(await probeConnect('127.0.0.1', handle.port)).not.toBe('CONNECTED')
  })
})

describe('⚠️ 共用入口不许拖 node 依赖进浏览器', () => {
  it('★ index.ts 的代码里没有 loopback.ts,而注释里有(注释不算违规)', () => {
    // 反向对照与正向判据摆在同一条里,是因为它们只有在一起时才成立:
    // 若把注释也算成违规,这条会逼着人把「为什么不从这里导出」那段说明删掉 ——
    // 而那比它要防的问题更贵(CLAUDE.md「守卫不能惩罚记录」)。
    const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')

    // 夹具必须在场:注释里确实提到了 loopback,否则下面那条是在空集上判等。
    expect(source, '入口里已经没有那段说明了 —— 下面那条会退化成恒绿').toContain('loopback')

    const code = source
      .split(/\r?\n/)
      .filter((line) => {
        const t = line.trim()
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
      })
      .join('\n')
    expect(
      code,
      'index.ts 再导出了 loopback —— 远端 Web 那一份会把 node:http 拖进打包图',
    ).not.toMatch(/from\s+'\.\/loopback\.ts'/)
  })
})

// ---------------------------------------------------------------------------

/** 本机第一个非回环 IPv4 地址;没有就返回 `null`(容器里很常见)。 */
function firstExternalIpv4(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family === 'IPv4' && !nic.internal) return nic.address
    }
  }
  return null
}

/** 借一个当下空着的端口(借完立刻还)。只给 nodeCallbackListener 那条用。 */
async function freePort(): Promise<number> {
  const probe = createServer(() => {})
  await new Promise<void>((ready) => {
    probe.listen(0, '127.0.0.1', ready)
  })
  const addr = probe.address()
  const port = typeof addr === 'object' && addr !== null ? addr.port : pickLoopbackPort()
  await new Promise<void>((done) => {
    probe.close(() => {
      done()
    })
  })
  return port
}
