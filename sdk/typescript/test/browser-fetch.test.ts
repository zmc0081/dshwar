/**
 * 「SDK 在浏览器里能不能用」的那一条断言。
 *
 * ## 它守的是「Node 里的绿证明不了浏览器」
 *
 * V0.9.0 Session 2 接 Web 工作台时撞到:每一次请求都抛
 * `DshwarTransportError: request failed before a response was received`,
 * 而症状与「网络断了」「网关没起来」**一模一样**。
 *
 * 真因是 `this.fetchImpl = globalThis.fetch` —— 把 `Window` 上的方法存进
 * 实例字段,再 `this.fetchImpl(...)` 调,`this` 就成了这个 client。
 * 浏览器为此抛 `Illegal invocation`;**Node 的 fetch 不在乎 `this`**,
 * 于是 SDK 的全部测试一直是绿的,而它在浏览器里从来没能工作过。
 *
 * ## ⚠️ 这条测试怎么在 Node 里复现浏览器的行为
 *
 * 不能直接用 `globalThis.fetch` —— 在 Node 里它就是不报错,那正是问题所在。
 * 所以这里**造一个会检查 `this` 的 fetch**,与浏览器的 `Window.fetch` 同形:
 * 拿到的 `this` 不是宿主对象就抛。
 *
 * ⇒ 断言的是「客户端有没有把 `this` 带对」,而不是「fetch 能不能跑」。
 */
import { describe, expect, it } from 'vitest'
import { DshwarAdminClient, DshwarClient } from '../src/client.ts'

describe('浏览器语义:globalThis.fetch 必须 bind', () => {
  it('★ 客户端不得以自己为 this 调用宿主的 fetch(浏览器会抛 Illegal invocation)', async () => {
    // 与浏览器 `Window.fetch` 同形的替身:`this` 不是 host 就抛。
    const host = { name: 'fake-window' }
    // ⚠️ 只记录**判断结果**,不把 this 存成变量 —— 存了会触发 no-this-alias,
    //   而这里要观察的本来就只是「this 对不对」这一个布尔量。
    let sawHost = false
    function pickyFetch(this: unknown): Promise<Response> {
      sawHost = this === host
      if (this !== host) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], nextCursor: null, requestId: 'r' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }

    // 模拟「从宿主上取一个未绑定的方法」——正是 `globalThis.fetch` 的形态。
    const unbound = pickyFetch as unknown as typeof globalThis.fetch
    const bound = pickyFetch.bind(host) as unknown as typeof globalThis.fetch

    // ① 未绑定 → 客户端调它时 this 是 client,替身抛 —— 复现了浏览器的失败。
    const broken = new DshwarClient({ baseUrl: 'http://x', token: 't', fetch: unbound })
    await expect(broken.listWorkspaces()).rejects.toThrow(
      /request failed before a response was received/,
    )
    expect(sawHost, 'this 就是 host 的话,这条测试没有复现出那个 bug').toBe(false)

    // ② 绑定过 → 正常工作。这一条是**反向对照**:
    //    少了它,一个「永远抛」的实现也能通过 ①。
    sawHost = false
    const okClient = new DshwarClient({ baseUrl: 'http://x', token: 't', fetch: bound })
    await expect(okClient.listWorkspaces()).resolves.toEqual({
      data: [],
      nextCursor: null,
      requestId: 'r',
    })
    expect(sawHost).toBe(true)
  })

  it('★ 不传 fetch 时,客户端用的是**绑定过**的 globalThis.fetch', async () => {
    // 判据:把 globalThis.fetch 换成一个挑 this 的替身,再建一个**不传 fetch**
    // 的客户端 —— 若客户端存的是未绑定的引用,调用时 this 会是 client 而抛。
    const realFetch = globalThis.fetch
    const host = globalThis
    let sawHost = false
    try {
      globalThis.fetch = function (this: unknown): Promise<Response> {
        sawHost = this === host
        if (this !== host) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
        }
        return Promise.resolve(
          new Response(JSON.stringify({ data: [], nextCursor: null, requestId: 'r' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      } as typeof globalThis.fetch

      const client = new DshwarClient({ baseUrl: 'http://x', token: 't' })
      await expect(client.listWorkspaces()).resolves.toBeDefined()
      expect(sawHost, 'this 不是 globalThis —— 客户端没有 bind').toBe(true)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('★ DshwarAdminClient 同样要 bind —— 两个客户端各有一份构造函数', async () => {
    // ⚠️ 这一条是 V0.9.0 Session 3 补的,起因是**一处不实的注释**:
    //   `DshwarAdminClient` 的构造函数里写着「谁盯着它:test/browser-fetch.test.ts」,
    //   而那时这个文件只覆盖了 `DshwarClient`。
    //
    //   两个类各有一份 `this.fetchImpl = ...`,**修一个不会修另一个**。
    //   一条声称有人盯着、实际没人盯着的注释,比没有注释更糟:
    //   它让下一个人跳过这里。
    const realFetch = globalThis.fetch
    const host = globalThis
    let sawHost = false
    try {
      globalThis.fetch = function (this: unknown): Promise<Response> {
        sawHost = this === host
        if (this !== host) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              isolationLevel: 'logical',
              maxProcesses: null,
              memberCap: 1,
              memberCount: 0,
              rssPerProcessMb: 58,
              basis: 'test',
              requestId: 'r',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
      } as typeof globalThis.fetch

      const admin = new DshwarAdminClient({ baseUrl: 'http://x', adminKey: 'k' })
      await expect(admin.capacity()).resolves.toBeDefined()
      expect(sawHost, 'this 不是 globalThis —— DshwarAdminClient 没有 bind').toBe(true)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
