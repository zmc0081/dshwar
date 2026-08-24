/**
 * 宿主端口与三条出口的断言。
 *
 * 这一份测的是**架构约束**,不是功能:
 *
 * | 断言 | 它守的那条约束 |
 * | --- | --- |
 * | Web 宿主存 refresh token 会抛 | 前端永不持有长效凭据 |
 * | 抛的是 `RefreshTokenNotStorable` 而不是普通 Error | 「这是设计不是故障」要能被区分 |
 * | 端口在动态区间且不写死 | 写死的端口既会被占,也是可预测的攻击面 |
 * | 自动重试**只有一次** | 防火墙拦绑定是恒定的,重试一百次只是把 45 秒变成 75 分钟 |
 * | IdP 不支持设备流时不给配对码出口 | 显示一个点下去会失败的出口,比不显示更糟 |
 */
import { describe, expect, it } from 'vitest'
import { RefreshTokenNotStorable, WEB_SECRETS_REFUSE, type SecretStore } from '../src/host.ts'
import {
  AUTO_RETRY_PORTS,
  exitsFor,
  loopbackRedirectUri,
  pickLoopbackPort,
  STALL_AFTER_MS,
} from '../src/exits.ts'
import { assertLoopback } from '../src/pkce.ts'

describe('前端永不持有长效凭据', () => {
  it('★ Web 宿主存 refresh token → 抛 RefreshTokenNotStorable', async () => {
    // 这不是「功能没做」,是这个宿主的正确行为:浏览器里没有钥匙串,
    // localStorage / cookie 对任何同源脚本可读。
    await expect(WEB_SECRETS_REFUSE.store('k', 'a-refresh-token')).rejects.toBeInstanceOf(
      RefreshTokenNotStorable,
    )
  })

  it('★ 抛的是专门的类型 —— 调用方要能与「真的失败了」区分开', async () => {
    // 做成异常而不是返回 false:返回值会被忽略,而一个被忽略的 false
    // 的表现是「以为存上了,下次启动要重新登录」——用户会以为是 bug。
    await WEB_SECRETS_REFUSE.store('k', 'x').catch((e: unknown) => {
      expect(e).toBeInstanceOf(RefreshTokenNotStorable)
      expect(String(e)).toMatch(/这是设计,不是故障/)
    })
  })

  it('load 返回 null 而不是抛 —— 取不到是正常路径', async () => {
    // 反向对照:若 load 也抛,调用方每次启动都要 try/catch 一次「没登录过」。
    await expect(WEB_SECRETS_REFUSE.load('k')).resolves.toBeNull()
    await expect(WEB_SECRETS_REFUSE.clear('k')).resolves.toBeUndefined()
  })

  it('一个正常的 SecretStore(桌面宿主)不受这条限制 —— 规则不是「一律不许存」', async () => {
    const mem = new Map<string, string>()
    const desktop: SecretStore = {
      store: (k, v) => {
        mem.set(k, v)
        return Promise.resolve()
      },
      load: (k) => Promise.resolve(mem.get(k) ?? null),
      clear: (k) => {
        mem.delete(k)
        return Promise.resolve()
      },
    }
    await desktop.store('k', 'a-refresh-token')
    await expect(desktop.load('k')).resolves.toBe('a-refresh-token')
  })
})

describe('loopback 端口', () => {
  it('★ 落在 IANA 动态区间,且不写死', () => {
    // 写死的后果有两个:被占时必然失败;以及成为一个可预测的攻击面 ——
    // 本机上任何进程都能抢先监听那个端口,收走本该给我们的授权码。
    let asserted = 0
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const port = pickLoopbackPort(() => r)
      asserted += 1
      expect(port).toBeGreaterThanOrEqual(49152)
      expect(port).toBeLessThanOrEqual(65535)
    }
    expect(asserted, '一个端口都没验到 —— 本条空跑了').toBe(5)
    // 不同随机源给出不同端口
    expect(pickLoopbackPort(() => 0)).not.toBe(pickLoopbackPort(() => 0.9))
  })

  it('拼出的回调地址通得过 assertLoopback', () => {
    const uri = loopbackRedirectUri(pickLoopbackPort(() => 0.5))
    expect(() => assertLoopback(uri)).not.toThrow()
    expect(uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })
})

describe('三条出口', () => {
  it('★ 自动重试只有一次 —— 防火墙拦绑定是恒定的', () => {
    // 重试一百次一样失败,只是把 45 秒变成 75 分钟。
    expect(AUTO_RETRY_PORTS).toBe(1)
  })

  it('等待阈值是用户耐心的量级,不是网络超时的量级', () => {
    expect(STALL_AFTER_MS).toBeGreaterThanOrEqual(30_000)
    expect(STALL_AFTER_MS).toBeLessThanOrEqual(90_000)
  })

  it('★ IdP 不支持设备流 → 不给配对码出口', () => {
    // 显示一个点下去会失败的出口,比不显示更糟:用户会以为自己做错了什么。
    expect(exitsFor(false)).toEqual(['stalled'])
  })

  it('★ IdP 支持设备流 → 给配对码出口(反向对照)', () => {
    // 少了这条,一个「永远只给一条出口」的实现也能通过上一条。
    expect(exitsFor(true)).toEqual(['stalled', 'pairing'])
  })
})

describe('🚨 手工粘贴授权码(OOB)明确不实现', () => {
  it('★ 本包没有任何接受「用户粘贴的码」的入口', async () => {
    // 判据落在**导出面**上:一个能收用户粘贴的码的 API 必然要导出。
    //
    // 方向是 browser → app,而 loopback 的价值恰恰在于
    // 「码被投递给了发起请求的同一台机器上的同一个进程」——
    // 粘贴把这条绑定彻底去掉。PKCE 挡得住攻击者拿走码去兑换,
    // 挡不住反向的社工:诱导用户把**自己的**码粘进攻击者的客户端。
    const api = (await import('../src/index.ts')) as Record<string, unknown>
    const names = Object.keys(api)
    const suspicious = names.filter((n) => /paste|manual|oob|enterCode|submitCode/i.test(n))
    expect(suspicious, '出现了接受粘贴码的入口 —— 见 exits.ts 顶部,这条不在实现时重新讨论').toEqual(
      [],
    )
    // 出口计数:导出面不能是空的,否则这条断言什么都没查
    expect(names.length, '导出面是空的 —— 本条空跑了').toBeGreaterThan(5)
  })
})
