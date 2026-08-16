/**
 * `console-web` 的单测 —— 路由、SDK 层、容量展示逻辑。
 *
 * ⚠️ **刻意不测 JSX 渲染。** 那需要 jsdom + testing-library 两个依赖,
 * 而它们买到的是「组件能不能挂载」—— 一个几乎不会坏的性质。
 * 真正会坏、且坏了没人发现的是**展示判断**:逻辑档该显示什么、
 * 快满了算多少、进程上限为 null 时渲染成什么。那些已经拆成纯函数,
 * 在这里一条一条钉住。
 *
 * 这是「测有价值的那部分」而不是「凑覆盖率」。
 */
import type { ConsoleCapacity } from '@dshwar/console-contract'
import { describe, expect, it } from 'vitest'
import { createConsoleApi } from '../src/api.ts'
import { detailOf, headlineOf, healthOf, maxProcessesLabel } from '../src/capacity-view.ts'
import { DEFAULT_ROUTE, hrefOf, parseRoute, ROUTES } from '../src/router.ts'

const cap = (over: Partial<ConsoleCapacity> = {}): ConsoleCapacity => ({
  isolationLevel: 'process',
  maxProcesses: 39,
  memberCap: 39,
  memberCount: 3,
  rssPerProcessMb: 63,
  basis: '整机 4096 MB × 0.6 ÷ 63 MB/进程 = 39 → 39',
  ...over,
})

describe('路由(D7 约束 1)', () => {
  it('解析 hash 的三种写法', () => {
    expect(parseRoute('#/members')).toBe('members')
    expect(parseRoute('#members')).toBe('members')
    expect(parseRoute('#/usage?tab=daily')).toBe('usage')
  })

  it('认不出的路径回落默认路由,而不是抛错或 404', () => {
    // 与 fail closed 不冲突:那条管**权限**,认不出身份必须拒;
    // 这里管**导航**,认不出路径把人送回首页比给他死胡同好。
    expect(parseRoute('#/nope')).toBe(DEFAULT_ROUTE)
    expect(parseRoute('')).toBe(DEFAULT_ROUTE)
    expect(parseRoute('#')).toBe(DEFAULT_ROUTE)
  })

  it('默认路由是容量页 —— D2 要求它常驻首页', () => {
    expect(DEFAULT_ROUTE).toBe('capacity')
  })

  it('hrefOf 生成的每个链接都能被 parseRoute 解析回去', () => {
    // 手拼 `#/xxx` 拼错了没人会发现 —— 这条断言让两者对得上
    for (const route of ROUTES) {
      expect(parseRoute(hrefOf(route))).toBe(route)
    }
  })
})

describe('SDK 层(D7 约束 3)', () => {
  it('★ baseUrl 可注入 —— V0.7.0 靠这一条把同一份代码跑在三个宿主里', async () => {
    const seen: string[] = []
    const api = createConsoleApi({
      baseUrl: 'http://127.0.0.1:8787',
      adminKey: 'k',
      fetch: async (input) => {
        seen.push(String(input))
        return new Response(
          JSON.stringify({
            isolationLevel: 'process',
            maxProcesses: 39,
            memberCap: 39,
            memberCount: 3,
            rssPerProcessMb: 63,
            basis: 'b',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })

    await api.capacity()
    // 本地 sidecar 的形态。远端只需换这一个参数,前端代码一行不动。
    expect(seen[0]).toBe('http://127.0.0.1:8787/v1/admin/capacity')
  })

  it('投影掉 SDK 返回里的额外字段 —— 不让服务端加字段自动流进前端类型', async () => {
    const api = createConsoleApi({
      baseUrl: 'http://x',
      adminKey: 'k',
      fetch: async () =>
        new Response(
          JSON.stringify({
            isolationLevel: 'logical',
            maxProcesses: null,
            memberCap: 1,
            memberCount: 1,
            rssPerProcessMb: 63,
            basis: 'b',
            requestId: 'req-1',
            futureField: 'should not leak',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    })
    const result = await api.capacity()
    expect(Object.keys(result)).not.toContain('futureField')
    expect(Object.keys(result)).not.toContain('requestId')
  })
})

describe('容量展示(D2)', () => {
  it('★ 逻辑档单用户不显示成「已满」—— 那正是他该有的样子', () => {
    const single = cap({
      isolationLevel: 'logical',
      maxProcesses: null,
      memberCap: 1,
      memberCount: 1,
    })
    expect(healthOf(single)).toBe('single-user')
    // 不说「1 / 1」—— 那个写法暗示快满了
    expect(headlineOf(single)).toBe('单用户部署')
    expect(headlineOf(single)).not.toContain('1 / 1')
  })

  it('逻辑档真的超了才算 full', () => {
    const over = cap({
      isolationLevel: 'logical',
      maxProcesses: null,
      memberCap: 1,
      memberCount: 2,
    })
    expect(healthOf(over)).toBe('full')
    expect(detailOf(over)).toContain('必须改用进程隔离')
  })

  it('留一个名额时就提示,不等真满', () => {
    expect(healthOf(cap({ memberCap: 10, memberCount: 9 }))).toBe('nearly-full')
    expect(healthOf(cap({ memberCap: 10, memberCount: 10 }))).toBe('full')
    expect(healthOf(cap({ memberCap: 10, memberCount: 8 }))).toBe('ok')
  })

  it('★ 每种状态的副文案都说得出下一步做什么', () => {
    // 一句只描述现状的提示("已达上限")会让人去搜文档
    for (const c of [
      cap({ isolationLevel: 'logical', maxProcesses: null, memberCap: 1, memberCount: 1 }),
      cap({ memberCap: 10, memberCount: 10 }),
      cap({ memberCap: 10, memberCount: 9 }),
      cap({ memberCap: 10, memberCount: 2 }),
    ]) {
      const text = detailOf(c)
      expect(text.length, '副文案是空的').toBeGreaterThan(10)
      // 每一句都要提到「怎么办」或「依据是什么」
      expect(text, `没说下一步:${text}`).toMatch(/isolation\.|加内存|上限依据/)
    }
  })

  it('★ maxProcesses 为 null 时显示「—」而不是 0', () => {
    // 契约那边坚持用 null 就是为了逼这一步做判断。
    // 0 会被渲染成「进程上限 0」,读起来像「一个都不能起」,是错的。
    expect(maxProcessesLabel(cap({ maxProcesses: null }))).toBe('—')
    expect(maxProcessesLabel(cap({ maxProcesses: 39 }))).toBe('39')
  })
})
