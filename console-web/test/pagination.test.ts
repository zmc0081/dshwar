/**
 * 分页与 requestId 的断言 —— V0.9.0 收尾修的那个洞。
 *
 * ## 它守的是什么
 *
 * Session 3 的第一版把每个列表方法写成 `(await client.x()).data`,
 * 在那一行同时丢掉 `nextCursor` 与 `requestId`。三个后果里最要紧的是**分母偏小**:
 *
 * 验收① 刚刚证明「1 / 64 位成员」的**分母**来自服务端,
 * 而**分子**若只数了第一页,那个刚被验证过的读数就被上游的分页悄悄污染了。
 * **一个被验证过的数字比一个没人验过的更危险 —— 它有背书。**
 *
 * ## ⚠️ 为什么必须构造一个**超过一页**的成员集合
 *
 * 开发环境里一个租户只有一两个人,永远翻不到第二页 ——
 * 那正是这个洞能活到今天的原因。测试要主动把它造出来。
 *
 * ## 判据
 *
 * | 断言 | 少了它会怎样 |
 * | --- | --- |
 * | 三页取完 → 数据是三页之和 | 分母偏小,而界面看起来完全正常 |
 * | 三页取完 → requestIds 有三个 | 工单里只有第一页的线索 |
 * | 撞上上限 → `complete: false` | **一个不报出来的上限,就是原来那个 bug 换了个位置** |
 * | 一页取完 → `complete: true` | 反向对照:少了它,一个「永远 false」的实现也能通过上一条 |
 */
import { describe, expect, it } from 'vitest'
import { createConsoleApi, MAX_PAGES, type Subject } from '../src/api.ts'

/** 造 n 个成员。id 带序号,便于断言取回的是**哪些**而不只是**几个**。 */
function subjectsOf(from: number, count: number): Subject[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `sub_${String(from + i).padStart(4, '0')}`,
    tenantId: 'acme',
    displayName: null,
    active: true,
    roles: ['member'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }))
}

/**
 * 一个按游标分页的假网关。
 *
 * @param pages 每一页的条数。`[50, 50, 12]` = 三页共 112 条。
 * @returns `calls` 记录每次请求带的 cursor —— 用来断言**真的翻页了**,
 *   而不是「碰巧返回了正确的条数」。
 */
function pagedFetch(pages: readonly number[]) {
  const calls: (string | null)[] = []
  let issued = 0
  const fetchImpl: typeof globalThis.fetch = (input) => {
    const url = new URL(String(input))
    const cursor = url.searchParams.get('cursor')
    calls.push(cursor)
    const index = cursor === null ? 0 : Number(cursor)
    const size = pages[index] ?? 0
    const data = subjectsOf(issued, size)
    issued += size
    const hasNext = index + 1 < pages.length
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data,
          nextCursor: hasNext ? String(index + 1) : null,
          requestId: `req_page_${index}`,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
  }
  return { fetchImpl, calls }
}

const OPTS = { baseUrl: 'http://x', adminKey: 'k' }

describe('分页:分母不能被上游截断', () => {
  it('★ 三页共 112 位成员 → 全部取回,且真的翻了页', async () => {
    const { fetchImpl, calls } = pagedFetch([50, 50, 12])
    const api = createConsoleApi({ ...OPTS, fetch: fetchImpl })
    const page = await api.listSubjects()

    expect(page.data, '分母被截断了 —— 只取到第一页').toHaveLength(112)
    expect(page.complete).toBe(true)
    // ⚠️ 断言**真的翻了页**,不是碰巧返回了 112 条:
    //   第一次不带 cursor,后两次带着上一页给的 cursor。
    expect(calls).toEqual([null, '1', '2'])
    // 取回的是**哪些**,不只是几个 —— 少一页时条数会对不上,但顺序也要对。
    expect(page.data[0]?.id).toBe('sub_0000')
    expect(page.data[111]?.id).toBe('sub_0111')
  })

  it('★ 每一页各一个 requestId —— 只留一个等于让工单少两条线索', async () => {
    const { fetchImpl } = pagedFetch([50, 50, 12])
    const api = createConsoleApi({ ...OPTS, fetch: fetchImpl })
    const page = await api.listSubjects()
    expect(page.requestIds).toEqual(['req_page_0', 'req_page_1', 'req_page_2'])
  })

  it('单页时 complete 为 true —— 反向对照', async () => {
    // 少了这条,一个「永远返回 complete: false」的实现也能通过下一条。
    const { fetchImpl, calls } = pagedFetch([3])
    const api = createConsoleApi({ ...OPTS, fetch: fetchImpl })
    const page = await api.listSubjects()
    expect(page.data).toHaveLength(3)
    expect(page.complete).toBe(true)
    expect(calls).toEqual([null])
  })

  it('★ 撞上 MAX_PAGES → complete 为 false,不静默截断', async () => {
    // 一个不报出来的上限,就是原来那个 bug 换了个位置。
    const { fetchImpl } = pagedFetch(Array.from({ length: MAX_PAGES + 5 }, () => 1))
    const api = createConsoleApi({ ...OPTS, fetch: fetchImpl })
    const page = await api.listSubjects()
    expect(page.complete, '撞上上限却说取完了 —— 界面会显示一个偏小的总数').toBe(false)
    expect(page.data).toHaveLength(MAX_PAGES)
    expect(page.requestIds).toHaveLength(MAX_PAGES)
  })

  it('★ 服务端每页回同一个 cursor(坏掉了)也不会死循环', async () => {
    // 出口计数式的循环:pages 数到上限就停。
    //
    // ⚠️ **这一条的负向验证形态与别处不同,值得记一笔。**
    //   把 `if (pages >= MAX_PAGES)` 那一行去掉之后,本条**不会变红,而是挂住** ——
    //   循环永远跑不完,vitest 一直等下去,整个 runner 被拖住。
    //
    //   实测时它把一个后台任务挂了十分钟,而**输出里什么都没有** ——
    //   既不是「通过」也不是「失败」。更麻烦的是进程被强杀时,
    //   变异过的 `api.ts` 留在了工作区(见 CLAUDE.md「凡改一处再看结果」那一节)。
    //
    //   ⇒ 记录在这里是因为:「跑一遍看它红不红」这个通用做法,
    //     对**死循环类**的守卫不成立。那一类的证据是「它有没有终止」,
    //     而 vitest 的默认超时会把终止失败报成一个含糊的 timeout。
    const stuck: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [], nextCursor: 'same', requestId: 'r' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const api = createConsoleApi({ ...OPTS, fetch: stuck })
    const page = await api.listSubjects()
    expect(page.complete).toBe(false)
    expect(page.requestIds).toHaveLength(MAX_PAGES)
  })

  it('四个列表方法都走同一条通路 —— 不是只修了成员那一个', async () => {
    let asserted = 0
    for (const call of [
      (a: ReturnType<typeof createConsoleApi>) => a.listSubjects(),
      (a: ReturnType<typeof createConsoleApi>) => a.usage(),
      (a: ReturnType<typeof createConsoleApi>) => a.policies(),
      (a: ReturnType<typeof createConsoleApi>) => a.audit(),
    ]) {
      const { fetchImpl, calls } = pagedFetch([2, 2])
      const api = createConsoleApi({ ...OPTS, fetch: fetchImpl })
      const page = await call(api)
      asserted += 1
      expect(page.data).toHaveLength(4)
      expect(page.requestIds).toHaveLength(2)
      expect(calls).toEqual([null, '1'])
    }
    expect(asserted, '一个方法都没验到 —— 本条空跑了').toBe(4)
  })
})
