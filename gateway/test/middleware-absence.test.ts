/**
 * 🚨 **一条否定性事实:漏挂认证中间件时 `current()` 不抛。**
 *
 * ## 为什么这值得一条测试而不是一段注释
 *
 * 否定性事实**最容易在重构中被无声改掉** —— 没有人会为「它不做某件事」
 * 写断言,于是某天有人「顺手加强」了 `current()`,行为变了而没有任何东西变红。
 *
 * 写成断言之后有两个作用:
 *
 * 1. 谁把行为改成「会抛」了,这条会红 —— 他会看见这段注释,
 *    从而知道自己动的是一个**被刻意选择**的行为,不是一个疏漏
 * 2. 谁想删 `auth-coverage.test.ts`(探针 10),会先撞上这条测试 ——
 *    它明写着**所以那条不能删**
 *
 * ## 🚨 所以探针 10 不能删
 *
 * V0.6.0 给 `PrincipalService.current()` 加了「未绑定就抛」。
 * **那条改动不防漏挂中间件** —— 本文件就是证明。
 *
 * 漏挂中间件时 `runWithPrincipal` 从未运行,`ctx.get(PRINCIPAL_BINDING)`
 * 于是**回落到根绑定**,而根绑定在三种支持的形态下都有值:
 *
 * | 形态 | 根绑定 |
 * | --- | --- |
 * | 进程档 | 该进程的真实 principal |
 * | 逻辑档 · 单用户 | `ANONYMOUS`(V0.6.0 起显式 provide) |
 * | 逻辑档 · 多用户 | 启动即拒,这个状态不存在 |
 *
 * ⇒ **不抛。** 唯一防住「新增路由漏挂中间件」的,是
 * `gateway/test/auth-coverage.test.ts` 那条遍历契约的认证断言,
 * 以及盯着它的探针 10。
 *
 * **两个机制防两件不同的事,一个都不能少:**
 *
 * | 机制 | 防什么 | 何时发现 |
 * | --- | --- | --- |
 * | `current()` 抛 | 装配没跑 / 被绕过 | 启动或首个请求 |
 * | 认证覆盖断言 + 探针 10 | 新增路由漏挂中间件 | 测试期 |
 *
 * ---
 *
 * ## ⚠️ 它与「解除绑定后会抛」不矛盾 —— 区分点是**从哪个 ctx 读**
 *
 * 本文件断言「不抛」,而 `packages/principal/test/service.test.ts` 断言
 * 「逃逸出 `runWithPrincipal` 的作用域会抛」。**两条都对**,因为读的不是同一个 ctx:
 *
 * | 场景 | 手上的 ctx | 进过 `isolate` 吗 | 结果 |
 * | --- | --- | --- | --- |
 * | **本文件**:漏挂中间件 | **根 ctx** | 没有 | ✅ 读到根绑定,不抛 |
 * | 逃逸的会话作用域 | **已释放的 scoped ctx** | 进过,且已 dispose | 🚨 抛 |
 *
 * 关键在于 `ctx.isolate(slot)` **切断了该槽位对父作用域的继承** ——
 * 所以只有「进过隔离又退出」的那个 ctx 会落空,而根 ctx 永远看得见自己的绑定。
 *
 * ⇒ **漏挂中间件的路由从来没进过隔离作用域**,它拿的就是根 ctx。
 *
 * 🚨 半年后同时读到这两句的人:它们不是同一个场景的两种说法,
 * 不要按其中一句去改行为。
 */
import { Context } from '@deepseek-ai/cordis'
import { Hono } from 'hono'
import {
  ANONYMOUS,
  createPrincipal,
  PRINCIPAL_BINDING,
  PrincipalService,
  PrincipalUnboundError,
} from '@dshwar/principal'
import { describe, expect, it } from 'vitest'

/** 造一个「装配好了根绑定,但路由上没有任何认证中间件」的 app。 */
async function appWithoutAuth(rootBinding: unknown) {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  // 装配阶段 provide —— 这正是 V0.6.0 改成无条件的那一行做的事
  ctx.provide(PRINCIPAL_BINDING, rootBinding)

  const app = new Hono()
  // ⚠️ **刻意不挂 runtimeAuth。** 这就是「漏挂中间件」的形状。
  app.get('/unguarded', (c) => {
    const principal = ctx.principal.current()
    return c.json({ id: principal.id, tenantId: principal.tenantId })
  })
  return app
}

describe('🚨 否定性事实:漏挂中间件时不抛(所以探针 10 不能删)', () => {
  it('★ 逻辑档单用户:请求不抛,principal 回落到根上的 ANONYMOUS', async () => {
    const app = await appWithoutAuth(ANONYMOUS)
    const res = await app.request('/unguarded')

    // ★ 200 而不是 500 —— 这**正是**要断言的那件事
    expect(res.status, '漏挂中间件竟然抛了 —— 若这是有意改动,请一并更新本文件的注释').toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe('anonymous')
  })

  it('★ 进程档:回落到根上那个真实 principal —— 同样不抛', async () => {
    const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
    const app = await appWithoutAuth(alice)
    const res = await app.request('/unguarded')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; tenantId: string }
    // 拿到的是**根绑定**,而不是「这次请求是谁」——
    // 这正是漏挂中间件的危险之处,而它不会以异常的形式显形。
    expect(body.id).toBe('alice-e6f1')
    expect(body.tenantId).toBe('acme')
  })

  it('★ 对照:只有「根上从来没 provide 过」才抛', async () => {
    // 这一条是上面两条的对照面 —— 少了它,一个「永远不抛」的实现
    // 也能通过前两条,而那样 V0.6.0 的改动就等于没做。
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    // 刻意不 provide

    expect(() => ctx.principal.current()).toThrow(PrincipalUnboundError)
  })

  it('★ 抛出来的信息要说清「这不是没认证」', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)

    const error = (() => {
      try {
        ctx.principal.current()
        return undefined
      } catch (e) {
        return e as Error
      }
    })()

    expect(error).toBeInstanceOf(PrincipalUnboundError)
    // 一条说「未认证」的错误信息会把人引向认证配置,
    // 而真正的问题在装配 —— 指错方向比没有信息更浪费人
    expect(error!.message).toContain('装配')
    expect(error!.message).toContain('不是「本次请求没认证」')
  })
})

describe('探针 10 与本文件的关系(留给将来动这块的人)', () => {
  it('auth-coverage.test.ts 必须存在 —— 它才是防漏挂中间件的那道', async () => {
    // 若有人删了它,这条会红,并把理由摆在他面前。
    // 这不是「测试文件存在性检查」这种没营养的断言 —— 它断言的是
    // **一条安全防线还在**,而上面四条已经证明 principal 层补不上那个位置。
    const { existsSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const here = dirname(fileURLToPath(import.meta.url))
    expect(
      existsSync(join(here, 'auth-coverage.test.ts')),
      'auth-coverage.test.ts 被删了 —— 而 principal 层的 current() **不会**替它抛。' +
        '删它之前请先读本文件顶部的对照表。',
    ).toBe(true)
  })
})
