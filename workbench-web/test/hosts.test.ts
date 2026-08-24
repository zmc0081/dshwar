/**
 * 三宿主接线的测试 —— Session 5 验收那句话的**可执行落点**。
 *
 * 验收原话:「同一份前端产物在三个宿主下跑通,**差别只有 baseURL**」。
 * 这里把它变成一条会红的断言:三份配置的**键集**与**每个非 baseUrl 字段的值**
 * 都必须一致。某天有人给 Tauri 加了一个别的宿主没有的开关,本文件当场红。
 *
 * ## 三条断言各管一件事,不要合并
 *
 * | 断言 | 管什么 | 坏掉时的样子 |
 * | --- | --- | --- |
 * | 同构 | 别的宿主没有的开关 | Tauri 悄悄长出第二份行为 |
 * | **反向对照** | baseUrl **确实**因宿主而异 | 「除 baseUrl 外」在给一个不存在的差别开豁免 |
 * | 穷尽性 | 新宿主必须被接线 | 加了成员却没给分支,`hostConfig` 走到 default |
 *
 * 第二条是这一轮补覆盖的反向对照。没有它,把三家的 baseUrl 全写成同一个常量
 * 之后,同构断言照样全绿 —— 而那时整个 `hostConfig` 已经退化成一个常量,
 * 「三宿主」这件事没有任何东西在验。
 *
 * ## 谁验证这些断言
 *
 * `scripts/verify-assertions.mjs` 探针 23:往 Tauri 那一支塞一个别的宿主
 * 没有的 scope,确认同构断言真的变红。
 */
import { describe, expect, it } from 'vitest'
import { RefreshTokenNotStorable, WEB_SECRETS_REFUSE, type SecretStore } from '@dshwar/auth-pkce'
import {
  HOST_KINDS,
  SAME_ORIGIN_BASE_URL,
  hostConfig,
  hostSecrets,
  type HostConfig,
  type HostKind,
  type HostRuntime,
} from '../src/hosts.ts'

/** 假钥匙串。这里不验它的行为,只验「宿主给了才算数」。 */
const FAKE_KEYCHAIN: SecretStore = {
  store: (): Promise<void> => Promise.resolve(),
  load: (): Promise<string | null> => Promise.resolve(null),
  clear: (): Promise<void> => Promise.resolve(),
}

/**
 * ★ **穷尽性的编译期落点。**
 *
 * 类型是 `Record<HostKind, HostRuntime>` —— {@link HOST_KINDS} 加一个成员时
 * 这张表少一个键,**本文件编译不过**(`pnpm typecheck:test` 红);
 * 同一刻 `hostConfig` 的 `default` 分支里 `kind` 不再是 `never`,
 * src 也编译不过(`pnpm typecheck` 红)。两处各红一次,漏不掉。
 */
const RUNTIME_FOR: Record<HostKind, HostRuntime> = {
  'remote-web': {},
  'local-sidecar': { secrets: FAKE_KEYCHAIN },
  tauri: { gatewayPort: 8787, secrets: FAKE_KEYCHAIN },
}

/**
 * 把配置摊成可按名取值的形状。
 *
 * ⚠️ 键**从返回值现取**,不抄一份 —— 抄的那份与真实字段不同步时,
 * 「多出来的那个字段」恰好就是本文件要抓的东西,而它会正好落在抄漏的位置。
 */
function fieldsOf(kind: HostKind): Record<string, unknown> {
  const config: HostConfig = hostConfig(kind, RUNTIME_FOR[kind])
  return { ...config }
}

describe('hostConfig · ★ 验收:三个宿主除 baseUrl 外逐字段相同', () => {
  it('键集完全一致 —— 「给 Tauri 加一个别的宿主没有的开关」在这里红', () => {
    const [first, ...rest] = HOST_KINDS
    const baseline = Object.keys(fieldsOf(first)).sort()

    let asserted = 0
    for (const kind of rest) {
      asserted += 1
      expect(
        Object.keys(fieldsOf(kind)).sort(),
        `${kind} 的配置字段与 ${first} 不是同一套 —— 三个宿主开始分家了`,
      ).toEqual(baseline)
    }
    expect(asserted, '一个宿主都没比到 —— 本条空跑了').toBe(HOST_KINDS.length - 1)
  })

  it('每个非 baseUrl 字段的值都一致', () => {
    const [first, ...rest] = HOST_KINDS
    const baseline = fieldsOf(first)

    let asserted = 0
    for (const kind of rest) {
      const other = fieldsOf(kind)
      for (const key of Object.keys(baseline)) {
        // baseUrl 是唯一允许不同的字段 —— 它由下面那条反向对照单独盯着。
        if (key === 'baseUrl') continue
        asserted += 1
        expect(
          other[key],
          `${kind} 的 ${key} 与 ${first} 不同 —— 「差别只有 baseURL」已经不成立`,
        ).toEqual(baseline[key])
      }
    }
    // 出口计数:`continue` 能把整个内层循环过滤干净,而那时前置的
    // 「键集非空」照样通过。判据在出口,不在入口。
    expect(asserted, '一个字段都没比到 —— 本条空跑了').toBeGreaterThan(0)
  })

  it('★ 反向对照:baseUrl 确实因宿主而异 —— 否则这条豁免在替一个不存在的差别开路', () => {
    // 三家的 baseUrl 若全都相同,上面两条会「全绿」而毫无意义:
    // 那时 hostConfig 已经退化成一个常量,「三宿主」没有任何东西在验。
    const tauri = hostConfig('tauri', RUNTIME_FOR.tauri).baseUrl
    expect(tauri).not.toBe(hostConfig('remote-web', RUNTIME_FOR['remote-web']).baseUrl)
    expect(tauri).not.toBe(hostConfig('local-sidecar', RUNTIME_FOR['local-sidecar']).baseUrl)
  })

  it('两个同源宿主连 baseUrl 都一样 —— 差别其实只落在 Tauri 一家', () => {
    // 前端由网关同一个服务提供 ⇒ 相对路径,连端口都不用知道。
    expect(hostConfig('remote-web', RUNTIME_FOR['remote-web'])).toEqual(
      hostConfig('local-sidecar', RUNTIME_FOR['local-sidecar']),
    )
    expect(hostConfig('remote-web', RUNTIME_FOR['remote-web']).baseUrl).toBe(SAME_ORIGIN_BASE_URL)
  })

  it('同源 baseUrl 不是空串 —— 空串与「宿主忘了注入」长得一模一样', () => {
    // main.tsx 的 readConfig 正是把空 baseUrl 判成缺失。一个既表示「同源」
    // 又表示「没配」的值,会让 fail closed 那条路永远走不到。
    expect(SAME_ORIGIN_BASE_URL).not.toBe('')
  })
})

describe('hostConfig · 🚨 Tauri 的 baseUrl 推断不出来,缺端口就抛', () => {
  it('缺 gatewayPort → 抛,而不是回落到同源', () => {
    // 判据是「抛」。回落到同源会让失败推迟到第一次请求,而那时的症状是
    // 一句与 CORS 无关的网络错误 —— 与「网关没起来」无法区分。
    expect(() => hostConfig('tauri', {})).toThrow()
    expect(() => hostConfig('tauri', { secrets: FAKE_KEYCHAIN })).toThrow()
  })

  it('端口不合法 → 抛。0 要单独挡:那是壳侧「还没分配」的初值', () => {
    let asserted = 0
    // 字面量数组:构造上非空、无过滤,不需要出口计数 —— 这里数一次只为
    // 与上面两条保持同一种读法。
    for (const port of [0, -1, 1.5, 65536, Number.NaN]) {
      asserted += 1
      expect(() => hostConfig('tauri', { gatewayPort: port })).toThrow()
    }
    expect(asserted).toBe(5)
  })

  it('给了端口 → 回环 origin,且不是 localhost', () => {
    expect(hostConfig('tauri', { gatewayPort: 8787 }).baseUrl).toBe('http://127.0.0.1:8787')
    // RFC 8252 §8.3 的同一条理由:localhost 的解析取决于 hosts 与 DNS。
    expect(hostConfig('tauri', { gatewayPort: 8787 }).baseUrl).not.toContain('localhost')
  })
})

describe('hostSecrets · 三家的长效凭据存放处', () => {
  it('远端 Web 拿到的是 WEB_SECRETS_REFUSE,存 refresh token 直接被拒', async () => {
    const store = hostSecrets('remote-web', {})
    expect(store).toBe(WEB_SECRETS_REFUSE)
    await expect(store.store('k', 'rt')).rejects.toBeInstanceOf(RefreshTokenNotStorable)
    // 取与清是安静的 —— 「没有」不是错误,而调用方本来就该能无条件登出。
    await expect(store.load('k')).resolves.toBeNull()
    await expect(store.clear('k')).resolves.toBeUndefined()
  })

  it('★ 远端 Web 传了 secrets 也要拒 —— 架构约束不是可覆盖的默认值', () => {
    // 这种调用只可能来自「让三个宿主长得一样」的好意重构,
    // 而它一旦成功,前端就有了一个能存长效凭据的路径。
    expect(() => hostSecrets('remote-web', { secrets: FAKE_KEYCHAIN })).toThrow()
  })

  it('sidecar 与 Tauri 必须由宿主注入,没注入就抛', () => {
    let asserted = 0
    for (const kind of HOST_KINDS) {
      if (kind === 'remote-web') continue
      asserted += 1
      expect(hostSecrets(kind, { secrets: FAKE_KEYCHAIN })).toBe(FAKE_KEYCHAIN)
      // 不回落到 WEB_SECRETS_REFUSE:那会让「桌面端记得登录」静默失效,
      // 而症状「每次启动都要重新登录」看起来像 bug,不像没接线。
      expect(() => hostSecrets(kind, {})).toThrow()
    }
    expect(asserted, '一个宿主都没比到 —— 本条空跑了').toBe(HOST_KINDS.length - 1)
  })
})

describe('HostKind · 穷尽性', () => {
  it('★ 每个成员都被接线 —— 加一个成员时 hostConfig 的 switch 编译不过', () => {
    // 编译期的那一半在两处:`RUNTIME_FOR` 的 `Record<HostKind, …>`(本文件),
    // 与 `hostConfig` 的 `default: unreachableHost(kind)`(src)。
    // 这里补运行时的一半,防止两边靠「记得同步」维持一致。
    expect(Object.keys(RUNTIME_FOR).sort()).toEqual([...HOST_KINDS].sort())

    let asserted = 0
    for (const kind of HOST_KINDS) {
      asserted += 1
      expect(hostConfig(kind, RUNTIME_FOR[kind]).baseUrl, `${kind} 没拿到 baseUrl`).not.toBe('')
      expect(hostSecrets(kind, RUNTIME_FOR[kind]), `${kind} 没拿到 SecretStore`).toBeDefined()
    }
    expect(asserted, '一个宿主都没走到 —— 本条空跑了').toBe(HOST_KINDS.length)
    expect(HOST_KINDS.length, 'HOST_KINDS 空了,上面整个循环会静默跳过').toBeGreaterThan(0)
  })
})
