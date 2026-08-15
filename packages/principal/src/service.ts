import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { ANONYMOUS, isAnonymousPrincipal, type Principal } from './principal.ts'

/**
 * principal 绑定所在的 cordis 服务槽位名。
 *
 * 与服务本身(`ctx.principal`)**分开两个槽位**,这是本包的核心设计,理由如下。
 *
 * cordis 的 `ctx.isolate(name)` 隔离的是「某个名字的服务槽位」。若把
 * `PrincipalService` 本身放进被隔离的槽位,每个会话就得各自持有一个服务实例;
 * 而服务实例是插件生命周期的一部分,per-request 造插件既昂贵又会让
 * `ctx.principal` 在根作用域下变成 `undefined`——那正是
 * `current(): Principal` 承诺永不返回 undefined 所要避免的。
 *
 * 拆成两个槽位后:
 * - `ctx.principal` 在根注册**一次**,处处可见
 * - 绑定值按会话隔离,`withPrincipal` 只 isolate 这一个槽位
 *
 * 之所以成立,靠的是 cordis 的 context 是 Proxy:服务方法里的 `this.ctx`
 * 会重绑到**访问方**的 context,于是同一个服务实例能按调用者所在的作用域
 * 读出不同的绑定。这一条已在 Session 0 验证 A6 实测确认
 * (`docs/FEASIBILITY-REPORT.md`)。
 *
 * 导出它是给 `adapters/` 与测试用的。**业务代码不要直接读这个槽位**,
 * 走 `ctx.principal.current()`——直接读会绕开 ANONYMOUS 兜底,
 * 把一个 `undefined` 泄漏进下游的判据里。
 */
export const PRINCIPAL_BINDING = 'principalBinding'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 当前作用域的主体服务。见 {@link PrincipalService}。 */
    principal: PrincipalService
  }
}

/**
 * 主体服务,注册为 `ctx.principal`。
 *
 * 作为 cordis 插件在**根上下文加载一次**即可:
 *
 * ```ts
 * await ctx.plugin(PrincipalService)
 * ```
 *
 * 之后任何作用域下 `ctx.principal.current()` 都能读到该作用域绑定的主体,
 * 未绑定处返回 {@link ANONYMOUS}。
 *
 * ⚠️ 本类**刻意不使用** ECMAScript `#private` 字段。cordis 通过 Proxy 包装服务
 * 以重绑 `this.ctx`,而 `#private` 按语言规范只能在真实实例上访问,在 wrapper 上
 * 必抛 `TypeError`,且报错信息完全指不到根因。仓库的 ESLint 规则会拦截这种写法,
 * 实测见 `docs/FEASIBILITY-REPORT.md` §4.1。
 */
export class PrincipalService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'principal')
  }

  /**
   * 读取**当前作用域**的主体。
   *
   * 永不返回 `undefined`——未绑定即 {@link ANONYMOUS}。这不是便利性设计,
   * 是安全设计:如果这里可能返回 undefined,每个下游都要自己判空,
   * 而漏判一处的后果是「把没有主体的操作当成有主体」——凭据解析、路径钉死、
   * 存储前缀会各自以不同的方式失败,其中至少一种是静默越权。
   * 让它永远有值,并且让那个值是「拒绝」,漏判就变成了 fail closed。
   *
   * ⚠️ **每次操作现场调用,不要跨操作缓存返回值。** 上游 `dsh-credentials` 的
   * 契约明文要求凭据每次操作重新解析(`resolve` 的 TSDoc:"consumers re-resolve
   * at each operation and must not cache across operations"),principal 是那次解析的
   * 输入,缓存它等于把凭据也一起缓存了。更直接的原因是:同一个运行时里
   * **相邻两次操作可能属于不同的人**——这正是 DSHWAR 存在的理由。把 principal
   * 存进插件实例字段,下一个用户就会拿到上一个用户的身份,而这种串号在测试里
   * 极难复现(Session 0 验证 C 专门为此在解析路径上插入随机挂起来制造交错)。
   *
   * @returns 当前作用域绑定的主体,未绑定时为 {@link ANONYMOUS}
   */
  current(): Principal {
    const bound = this.ctx.get(PRINCIPAL_BINDING) as Principal | undefined
    return bound ?? ANONYMOUS
  }

  /**
   * 当前作用域是否为匿名主体。
   *
   * 便利方法,等价于 `isAnonymousPrincipal(this.current())`。
   * 下游用它做 fail closed 判定(CLAUDE.md 硬规则 6)。
   *
   * @returns 是否匿名
   */
  isAnonymous(): boolean {
    return isAnonymousPrincipal(this.current())
  }
}

/**
 * 派生一个绑定了 `principal` 的子作用域。
 *
 * 返回的 context 就是**服务端交给「一个会话」的那个东西**:
 *
 * ```ts
 * const principal = await ctx.auth.verify(bearerToken)   // 边缘认证
 * const sessionCtx = withPrincipal(ctx, principal)       // 派生会话作用域
 * // 此下所有插件按 principal 解析，消费方零改动
 * ```
 *
 * 实现上只 isolate {@link PRINCIPAL_BINDING} 一个槽位,其余服务照常从父作用域
 * 继承 —— 换言之,派生一个会话作用域**不会**重建任何插件,代价只是一次
 * context 派生。
 *
 * ## 生命周期
 *
 * 绑定的存活期跟随**调用方所在的 fiber**:该 fiber 卸载时绑定自动解除
 * (Session 0 验证 A5 实测)。因此在插件内部按会话派生是安全的 —— 插件卸载,
 * 它派生的全部会话作用域一并消失。
 *
 * ⚠️ 但在**长命 fiber 里按请求反复调用**(将来 V0.2.0 的网关正是这个形状)
 * 需要显式释放,否则每个请求都会在 `ctx.reflect.store` 里留下一个隔离槽位,
 * 进程活多久就积累多久。那种场景请改用 {@link runWithPrincipal},它在回调
 * 结束后释放绑定。本函数保持「返回 context」的形状,是因为会话式用法
 * (一次派生、长期持有)确实需要它。
 *
 * @param ctx 父上下文,通常是根上下文
 * @param principal 该会话的主体;应由 {@link createPrincipal} 构造
 * @returns 绑定了该主体的子上下文
 */
export function withPrincipal(ctx: Context, principal: Principal): Context {
  const scoped = ctx.isolate(PRINCIPAL_BINDING)
  scoped.provide(PRINCIPAL_BINDING, principal)
  return scoped
}

/**
 * 在绑定了 `principal` 的子作用域里执行一段逻辑,结束后释放绑定。
 *
 * 与 {@link withPrincipal} 的区别只在生命周期:本函数在回调 settle 之后
 * (无论成功还是抛错)解除绑定并释放隔离槽位。**按请求处理的服务端应当用它**,
 * 否则长命进程会随请求数无界积累隔离槽位。
 *
 * ```ts
 * const result = await runWithPrincipal(ctx, principal, async (sessionCtx) => {
 *   return sessionCtx.credentials.resolve(ref)
 * })
 * ```
 *
 * ⚠️ 不要让 `sessionCtx` 逃逸出回调 —— 回调返回后它的绑定已被解除,
 * 再用它读 principal 会得到 {@link ANONYMOUS},而那是个 fail closed 的值,
 * 症状是「莫名其妙解析不到凭据」而不是明确的报错。
 *
 * @param ctx 父上下文
 * @param principal 该次操作的主体
 * @param fn 在会话作用域内执行的回调
 * @returns 回调的返回值
 */
export async function runWithPrincipal<T>(
  ctx: Context,
  principal: Principal,
  fn: (scoped: Context) => T | Promise<T>,
): Promise<T> {
  const scoped = ctx.isolate(PRINCIPAL_BINDING)
  const dispose = scoped.provide(PRINCIPAL_BINDING, principal)
  try {
    return await fn(scoped)
  } finally {
    await dispose()
  }
}
