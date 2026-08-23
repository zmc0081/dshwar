/**
 * hash 路由的测试 —— D7 约束 1 的落点。
 *
 * 重点在**两处会被悄悄合并的区分**:
 * 1. 认不出的路由回落默认页(导航上宁可兜),与 fail closed(权限上宁可拒)不冲突;
 * 2. `?ws=`(空串)与没有 `ws=` **不是一回事** —— 前者是配置错误。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, hrefOf, parseLocation, ROUTES } from '../src/router.ts'

describe('parseLocation · 认不出就回落,不抛错', () => {
  it('每个合法路由都能解析出自己', () => {
    // 遍历的是 as const 数组(构造上非空、无过滤),不需要出口计数。
    for (const route of ROUTES) {
      expect(parseLocation(`#/${route}`).route).toBe(route)
      expect(parseLocation(`#${route}`).route).toBe(route)
    }
    expect(ROUTES).toHaveLength(5)
  })

  it('★ 认不出的路径回落默认页 —— 不抛错、不显示 404', () => {
    // 导航上宁可兜,与硬规则 6「权限上宁可拒」不冲突:两者判据不同。
    expect(parseLocation('#/不存在').route).toBe(DEFAULT_ROUTE)
    expect(parseLocation('').route).toBe(DEFAULT_ROUTE)
    expect(parseLocation('#').route).toBe(DEFAULT_ROUTE)
    expect(parseLocation('#/').route).toBe(DEFAULT_ROUTE)
    expect(parseLocation('#/runs/extra').route).toBe(DEFAULT_ROUTE)
  })
})

describe('parseLocation · 工作区 id', () => {
  it('从 query 取,跨屏不变', () => {
    expect(parseLocation('#/runs?ws=wsp_123').workspaceId).toBe('wsp_123')
    expect(parseLocation('#/artifacts?ws=wsp_123').workspaceId).toBe('wsp_123')
  })

  it('★ `?ws=` 与没有 ws= 都给 null —— 空串是配置错误,不能当成「传了一个空工作区」', () => {
    // 与 LogoSlot 的 `??` vs `||` 同一条:悄悄把错值当缺失,会替人把错配当没配。
    // 这里两者都归 null,但**理由不同**:没传是正常的(首次进入),
    // 传了空串是调用方拼错了 —— 后者将来若要报警,判据就在这一行。
    expect(parseLocation('#/runs?ws=').workspaceId).toBeNull()
    expect(parseLocation('#/runs').workspaceId).toBeNull()
    expect(parseLocation('#/runs?other=1').workspaceId).toBeNull()
  })

  it('带特殊字符的 id 能原样取回', () => {
    const id = 'wsp/with space+plus'
    const round = parseLocation(hrefOf({ route: 'runs', workspaceId: id }))
    expect(round.workspaceId).toBe(id)
  })
})

describe('hrefOf · 与 parseLocation 互逆', () => {
  it('★ 每个路由 × 有无工作区,来回一趟不变', () => {
    let asserted = 0
    for (const route of ROUTES) {
      for (const workspaceId of [null, 'wsp_123']) {
        const round = parseLocation(hrefOf({ route, workspaceId }))
        asserted += 1
        expect(round.route).toBe(route)
        expect(round.workspaceId).toBe(workspaceId)
      }
    }
    expect(asserted, '一次都没来回 —— 本条空跑了').toBe(ROUTES.length * 2)
  })

  it('没有工作区时不带空的 query —— `#/runs?ws=` 会被下一次解析当成空串', () => {
    expect(hrefOf({ route: 'runs', workspaceId: null })).toBe('#/runs')
    expect(hrefOf({ route: 'runs', workspaceId: null })).not.toContain('?')
  })
})
