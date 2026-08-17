import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ANONYMOUS,
  createPrincipal,
  PRINCIPAL_BINDING,
  PrincipalService,
  PrincipalUnboundError,
  runWithPrincipal,
  withPrincipal,
  type Principal,
} from '../src/index.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex', roles: ['admin'] })

async function rootContext(): Promise<Context> {
  const ctx = new Context()
  // fiber 是 PromiseLike,不 await 则服务尚未注册 —— Session 0 在这上面栽过一次
  await ctx.plugin(PrincipalService)
  // ★ V0.6.0:装配阶段**显式** provide ANONYMOUS —— 与 assembleRuntime 同款。
  // 不 provide 的话 current() 会抛 PrincipalUnboundError,而那正是本版本要的:
  // 「没人表过态」与「合法的单用户」不再是同一个值。
  ctx.provide(PRINCIPAL_BINDING, ANONYMOUS)
  return ctx
}

describe('PrincipalService', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await rootContext()
  })

  it('注册为 ctx.principal', () => {
    expect(ctx.principal).toBeDefined()
    expect(ctx.principal).toBeInstanceOf(PrincipalService)
  })

  // 若这里能返回 undefined,每个下游都要自己判空,而漏判一处
  // 就等于「把没有主体的操作当成有主体」。
  it('未绑定时 current() 返回 ANONYMOUS 而非 undefined', () => {
    expect(ctx.principal.current()).toEqual(ANONYMOUS)
    expect(ctx.principal.isAnonymous()).toBe(true)
  })

  it('绑定后 current() 返回该主体', () => {
    const scoped = withPrincipal(ctx, alice)
    expect(scoped.principal.current()).toEqual(alice)
    expect(scoped.principal.isAnonymous()).toBe(false)
  })
})

describe('withPrincipal · 作用域隔离', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await rootContext()
  })

  // 复现 Session 0 验证 A1c —— 架构成立与否卡在这一条上
  it('兄弟作用域互不可见', () => {
    const aCtx = withPrincipal(ctx, alice)
    const bCtx = withPrincipal(ctx, bob)

    expect(aCtx.principal.current().id).toBe(alice.id)
    expect(bCtx.principal.current().id).toBe(bob.id)
    expect(aCtx.principal.current().id).not.toBe(bCtx.principal.current().id)
  })

  // 复现 Session 0 验证 A2
  it('父作用域不受子作用域影响', () => {
    withPrincipal(ctx, alice)
    withPrincipal(ctx, bob)

    expect(ctx.principal.isAnonymous()).toBe(true)
  })

  // 复现 Session 0 验证 A4:subagent 在会话内再派生自己的作用域
  it('嵌套派生:孙作用域覆盖,父作用域不变', () => {
    const sessionCtx = withPrincipal(ctx, alice)
    const subagent = createPrincipal({ id: 'alice-subagent', tenantId: 'acme' })
    const subCtx = withPrincipal(sessionCtx, subagent)

    expect(subCtx.principal.current().id).toBe('alice-subagent')
    expect(sessionCtx.principal.current().id).toBe(alice.id)
    expect(ctx.principal.isAnonymous()).toBe(true)
  })

  // 服务只在根注册一次,却要按访问方作用域读出不同的绑定 ——
  // 靠的是 cordis 的 context Proxy 把 this.ctx 重绑到访问方(Session 0 A6)。
  it('服务实例只有一个,但每个作用域拿到各自的 traced wrapper', () => {
    const aCtx = withPrincipal(ctx, alice)
    const bCtx = withPrincipal(ctx, bob)

    expect(aCtx.principal).not.toBe(bCtx.principal)
    expect(aCtx.principal).not.toBe(ctx.principal)
  })

  // 复现 Session 0 验证 A5:会话结束不得把 principal 泄漏给下一个会话。
  //
  // ★ V0.6.0 起断言的东西变了,而且是**变强**:
  //   此前解除后 current() 返回 ANONYMOUS —— 一个静默的 fail closed 值,
  //   症状是「莫名其妙解析不到凭据」。runWithPrincipal 的 TSDoc 当时就把
  //   这一点写成了警告。现在它**抛**,那句警告因此不再需要。
  //
  //   为什么 isolate 过的作用域在解除后没有根绑定兜底:
  //   `ctx.isolate(slot)` 切断的正是该槽位对父作用域的继承 ——
  //   这不是 bug,是隔离的定义。
  it('绑定解除后,逃逸出去的作用域**抛**而不是静默退化', async () => {
    const scoped = ctx.isolate(PRINCIPAL_BINDING)
    const dispose = scoped.provide(PRINCIPAL_BINDING, alice)

    expect(scoped.principal.current().id).toBe(alice.id)
    await dispose()
    expect(() => scoped.principal.current()).toThrow(PrincipalUnboundError)
  })
})

describe('runWithPrincipal · 生命周期', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = await rootContext()
  })

  it('回调内可读到绑定的主体', async () => {
    const seen = await runWithPrincipal(ctx, alice, (scoped) => scoped.principal.current().id)
    expect(seen).toBe(alice.id)
  })

  it('★ 回调结束后,逃逸的作用域抛 —— 不再静默退化成匿名', async () => {
    // 「不要让 sessionCtx 逃逸出回调」这条纪律,现在由**运行时**执行,
    // 而不只是 TSDoc 里的一句话。逃逸的代价从「查半天为什么没凭据」
    // 变成「立刻拿到一个说清原因的错误」。
    let escaped: Context | undefined
    await runWithPrincipal(ctx, alice, (scoped) => {
      escaped = scoped
    })
    expect(() => escaped!.principal.current()).toThrow(PrincipalUnboundError)
  })

  it('回调抛错时同样解除绑定', async () => {
    let escaped: Context | undefined
    await expect(
      runWithPrincipal(ctx, alice, (scoped) => {
        escaped = scoped
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // 回调抛错时同样解除 —— finally 里的 dispose 真的跑了
    expect(() => escaped!.principal.current()).toThrow(PrincipalUnboundError)
  })

  // 长命 fiber 里按请求反复派生会累积隔离槽位。这条测试把「为什么网关必须用
  // runWithPrincipal 而不是 withPrincipal」变成可度量的事实,而不是一句注释。
  //
  // 实测(cordis 4.0.1):runWithPrincipal 跑 200 次槽位数不变,
  // withPrincipal 跑 200 次涨 200 —— 一次调用一个槽位,进程活多久就积累多久。
  // 断言写成精确值而非不等式:松的断言在实现退化时仍会通过。
  it('runWithPrincipal 零累积,withPrincipal 每次调用积累一个隔离槽位', async () => {
    const storeSize = () => Reflect.ownKeys(ctx.reflect.store).length
    const ROUNDS = 200

    const baseline = storeSize()
    for (let i = 0; i < ROUNDS; i += 1) {
      await runWithPrincipal(ctx, alice, () => undefined)
    }
    expect(storeSize() - baseline).toBe(0)

    const afterRun = storeSize()
    for (let i = 0; i < ROUNDS; i += 1) {
      withPrincipal(ctx, alice)
    }
    expect(storeSize() - afterRun).toBe(ROUNDS)
  })
})

describe('并发', () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  // 复现 Session 0 验证 C。顺序执行永远不串号,必须制造真实交错:
  // 在读取 principal 的前后各挂起一次,最大化交错窗口。
  it('并发 100 组 principal 无串号', async () => {
    const ctx = await rootContext()
    const ROUNDS = 100

    const principals: Principal[] = Array.from({ length: ROUNDS }, (_, i) =>
      createPrincipal({ id: `user-${i}`, tenantId: `tenant-${i % 7}` }),
    )

    const jobs = principals.map((principal) =>
      runWithPrincipal(ctx, principal, async (scoped) => {
        await sleep(Math.random() * 3)
        const seenBefore = scoped.principal.current()
        await sleep(Math.random() * 3)
        const seenAfter = scoped.principal.current()
        return {
          expected: principal.id,
          before: seenBefore.id,
          after: seenAfter.id,
          tenant: seenAfter.tenantId,
          expectedTenant: principal.tenantId,
        }
      }),
    )

    const results = await Promise.all(jobs)
    const crossTalk = results.filter(
      (r) => r.before !== r.expected || r.after !== r.expected || r.tenant !== r.expectedTenant,
    )

    expect(results).toHaveLength(ROUNDS)
    expect(crossTalk).toEqual([])
  })

  // 匿名与具名混跑:匿名不得借到别人的身份(硬规则 6 的前置条件)
  it('匿名与具名混合并发,匿名始终是匿名', async () => {
    const ctx = await rootContext()
    const ROUNDS = 100

    const jobs = Array.from({ length: ROUNDS }, (_, i) => {
      if (i % 2 === 0) {
        return runWithPrincipal(ctx, alice, async (scoped) => {
          await sleep(Math.random() * 2)
          return scoped.principal.current().id === alice.id ? 'ok' : 'named-leaked'
        })
      }
      return (async () => {
        await sleep(Math.random() * 2)
        return ctx.principal.isAnonymous() ? 'ok' : 'anon-leaked'
      })()
    })

    const results = await Promise.all(jobs)
    expect(results.filter((r) => r !== 'ok')).toEqual([])
  })
})
