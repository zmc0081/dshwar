/**
 * PKCE 的断言。
 *
 * ## 重点不是「正常输入能用」,是几条**安全性质**
 *
 * 这一族的失效都很安静:退化成 `plain`、verifier 进了 URL、
 * state 没比对 —— 每一条在正常路径上都**完全看不出来**,
 * 登录照样成功。它们只在被攻击时才显形,而那时来不及了。
 *
 * | 断言 | 它防的那条攻击路径 |
 * | --- | --- |
 * | `code_challenge_method` 恒为 S256 | 退化成 plain = 等于没有 PKCE |
 * | verifier 不进 URL | 进了浏览器历史 / 代理日志 / Referer,PKCE 就废了 |
 * | state 不匹配就抛 | 别人把他的回调塞给我 |
 * | 回调必须是回环 IP 字面量 | `localhost` 的解析可能被指到别处 |
 * | 两次会话的 verifier 不同 | 复用等于把一次泄漏变成永久泄漏 |
 */
import { describe, expect, it } from 'vitest'
import {
  assertLoopback,
  authorizeUrl,
  codeFromCallback,
  refreshRequestBody,
  startPkce,
  tokenRequestBody,
  type IdpConfig,
} from '../src/pkce.ts'

const IDP: IdpConfig = {
  authorizationEndpoint: 'https://idp.example.com/authorize',
  tokenEndpoint: 'https://idp.example.com/token',
  clientId: 'dshwar-desktop',
  scopes: ['openid', 'profile', 'offline_access'],
}

const REDIRECT = 'http://127.0.0.1:51789/callback'

describe('startPkce · 形状与随机性', () => {
  it('verifier 落在 RFC 7636 的 43–128 字符区间,且是 base64url', async () => {
    const s = await startPkce(REDIRECT)
    expect(s.verifier.length).toBeGreaterThanOrEqual(43)
    expect(s.verifier.length).toBeLessThanOrEqual(128)
    // base64url 字符集:不含 + / =
    expect(s.verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(s.challenge).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('★ 两次会话的 verifier 与 state 都不同 —— 复用把一次泄漏变成永久泄漏', async () => {
    const a = await startPkce(REDIRECT)
    const b = await startPkce(REDIRECT)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.state).not.toBe(b.state)
    expect(a.challenge).not.toBe(b.challenge)
  })

  it('★ challenge 是 verifier 的 SHA-256,不是 verifier 本身', async () => {
    // 退化成 `plain` 的表现就是这两个相等 —— 而登录照样成功。
    const s = await startPkce(REDIRECT)
    expect(s.challenge).not.toBe(s.verifier)
    // 独立复算一遍,不信实现自己
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.verifier))
    let binary = ''
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
    const expected = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(s.challenge).toBe(expected)
  })
})

describe('authorizeUrl · verifier 绝不进 URL', () => {
  it('★ 授权 URL 里有 challenge,没有 verifier', async () => {
    const s = await startPkce(REDIRECT)
    const url = authorizeUrl(IDP, s)
    expect(url).toContain(encodeURIComponent(s.challenge).replace(/%2D/g, '-'))
    // ⚠️ 判据打在**整串**上,不是打在某个参数上 —— verifier 出现在
    //   任何位置(包括被当成别的参数的值)都是泄漏。
    expect(url, 'verifier 进了 URL —— 浏览器历史、代理日志、Referer 全都有它了').not.toContain(
      s.verifier,
    )
  })

  it('★ code_challenge_method 恒为 S256', async () => {
    // 写死而不是可配置:可配置等于给「配错就退化成 plain」留了一条路。
    const s = await startPkce(REDIRECT)
    const url = new URL(authorizeUrl(IDP, s))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe(s.state)
  })

  it('scope 用空格连接,client_id 与 redirect_uri 原样带上', async () => {
    const s = await startPkce(REDIRECT)
    const url = new URL(authorizeUrl(IDP, s))
    expect(url.searchParams.get('scope')).toBe('openid profile offline_access')
    expect(url.searchParams.get('client_id')).toBe('dshwar-desktop')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
  })
})

describe('assertLoopback · 必须是回环 IP 字面量', () => {
  it('★ localhost 被拒 —— 它的解析取决于 hosts 与 DNS', () => {
    // 两者在开发机上几乎总是等价的,直到某台机器上不是。
    expect(() => assertLoopback('http://localhost:51789/callback')).toThrow(/回环 IP 字面量/)
  })

  it('★ 非回环地址被拒', () => {
    expect(() => assertLoopback('http://example.com/callback')).toThrow()
    expect(() => assertLoopback('http://10.0.0.5:8080/callback')).toThrow()
  })

  it('反向对照:127.0.0.1 与 ::1 都放行 —— 规则不是「见到 http 就红」', () => {
    expect(() => assertLoopback('http://127.0.0.1:51789/callback')).not.toThrow()
    expect(() => assertLoopback('http://[::1]:51789/callback')).not.toThrow()
  })

  it('回环上的 http 是**对的**(RFC 8252 §7.3),https 反而被拒', () => {
    // 回环地址上的 https 需要一张没人能签的证书。
    expect(() => assertLoopback('https://127.0.0.1:51789/callback')).toThrow(/RFC 8252/)
  })

  it('不是合法 URL 时给一句能读懂的话', () => {
    expect(() => assertLoopback('不是个 URL')).toThrow(/不是合法 URL/)
  })
})

describe('codeFromCallback · state 先比,再看别的', () => {
  it('★ state 不匹配就抛 —— 这个回调不是本次登录发起的', async () => {
    const s = await startPkce(REDIRECT)
    expect(() => codeFromCallback(`${REDIRECT}?code=abc&state=别人的`, s)).toThrow(/state 不匹配/)
  })

  it('★ state 不匹配时,即使带着 error 也不当成本次的结果', async () => {
    // 顺序有意义:一个不是给我们的回调,它的 error 也不是我们的 error。
    const s = await startPkce(REDIRECT)
    expect(() => codeFromCallback(`${REDIRECT}?error=access_denied&state=别人的`, s)).toThrow(
      /state 不匹配/,
    )
  })

  it('IdP 明确拒绝时,把 error 与描述一起带出来', async () => {
    const s = await startPkce(REDIRECT)
    expect(() =>
      codeFromCallback(
        `${REDIRECT}?error=access_denied&error_description=用户取消&state=${s.state}`,
        s,
      ),
    ).toThrow(/access_denied.*用户取消/)
  })

  it('既没有 code 也没有 error → 抛(IdP 的响应不符合 OAuth 2.0)', async () => {
    const s = await startPkce(REDIRECT)
    expect(() => codeFromCallback(`${REDIRECT}?state=${s.state}`, s)).toThrow(/不符合 OAuth 2.0/)
    expect(() => codeFromCallback(`${REDIRECT}?code=&state=${s.state}`, s)).toThrow()
  })

  it('反向对照:正常回调取得出 code', async () => {
    const s = await startPkce(REDIRECT)
    expect(codeFromCallback(`${REDIRECT}?code=the-code&state=${s.state}`, s)).toBe('the-code')
  })
})

describe('tokenRequestBody · verifier 只在这里出现一次', () => {
  it('★ 换取请求带 verifier,且不带 client_secret', async () => {
    const s = await startPkce(REDIRECT)
    const body = tokenRequestBody(IDP, s, 'the-code')
    expect(body.get('code_verifier')).toBe(s.verifier)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    // ⚠️ 桌面应用是公开客户端 —— 任何随二进制分发的 secret 都不是 secret。
    expect(body.get('client_secret'), 'PKCE 正是为了替代 client_secret').toBeNull()
  })

  it('refresh 请求同样不带 secret', async () => {
    const body = refreshRequestBody(IDP, 'the-refresh-token')
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('the-refresh-token')
    expect(body.get('client_secret')).toBeNull()
  })
})
