/**
 * **契约里每个 `/v1` 端点都必须要求认证**(V0.5.5)。
 *
 * ## 它防的是一个已经差点发生的错
 *
 * 认证中间件是**按路径前缀单独注册**的:
 *
 * ```ts
 * app.use('/v1/sessions', runtimeAuth(ctx))
 * app.use('/v1/sessions/*', runtimeAuth(ctx))
 * ```
 *
 * 新增一组路由时,只写 handler 是不够的 —— 必须回到 `app.ts` 再加两行。
 * 而 V0.5.5 加 `/v1/workspaces/*` 时**正是漏掉了那两行**:
 * handler 写好了、测试也写好了,但没有任何东西要求认证。
 *
 * 漏掉的后果不是「不安全一点」,是 `c.get('principal')` 为 `undefined` ——
 * 而**全部归属判定都建立在它之上**。等于所有人共用一个匿名身份,
 * 任何人都能列出任何人的工作区。
 *
 * ## 为什么是遍历 ROUTES 而不是逐个端点写断言
 *
 * 逐个写的话,下一个新增端点仍然要靠人记得来加一条 —— 与漏挂中间件
 * 是同一个失败模式。**遍历契约则是自动纳入的**:契约里出现一条新路径,
 * 这条断言立刻开始管它。
 *
 * 这正是 CLAUDE.md 第六节元规则要的答案:「谁验证认证挂全了?」—— 这条。
 */
import { ROUTES } from '@dshwar/api-contract'
import { Context } from '@deepseek-ai/cordis'
import { StaticAuth } from '@dshwar/auth-static'
import { PrincipalService } from '@dshwar/principal'
import { beforeAll, describe, expect, it } from 'vitest'
import { createGateway } from '../src/app.ts'
import { InMemoryAdminKeyResolver } from '../src/admin-keys.ts'
import { registerWorkspaceRoutes } from '../src/workspaces/routes.ts'
import { InMemoryWorkspaceStore } from '../src/workspaces/store.ts'

let app: ReturnType<typeof createGateway>

beforeAll(async () => {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, { entries: [], quiet: true })
  app = createGateway({
    ctx,
    adminKeys: new InMemoryAdminKeyResolver([]),
    workbenchRoutes: registerWorkspaceRoutes({
      store: new InMemoryWorkspaceStore(),
      workspaceRoot: process.cwd(),
    }),
  })
})

/** 把契约里的 `{id}` 换成一个具体值,好真的发出去。 */
const concrete = (path: string): string => path.replace(/\{[^}]+\}/g, 'probe-id')

describe('★ /v1 端点的认证覆盖', () => {
  it('契约里有路由可遍历 —— 否则本条是空跑', () => {
    // 没有这一句,ROUTES 哪天变成空数组,下面的 forEach 一次都不执行,
    // 而测试仍然「通过」。空跑的绿与真通过在输出里长得一样。
    expect(ROUTES.length).toBeGreaterThan(10)
  })

  for (const route of ROUTES) {
    const isAdmin = route.path.startsWith('/v1/admin/')
    const label = `${route.method.toUpperCase()} ${route.path}`

    it(`${label} 无凭证时 401`, async () => {
      const res = await app.request(concrete(route.path), {
        method: route.method.toUpperCase(),
        // 刻意不带任何 Authorization / x-dshwar-admin-key
        ...(route.method === 'post' || route.method === 'patch'
          ? { headers: { 'content-type': 'application/json' }, body: '{}' }
          : {}),
      })

      // ⚠️ 断言 401 而不是「不是 200」—— 后者会把 404 也算成通过,
      // 而 404 恰恰是「路由没挂上」的症状,那是另一个 bug 不是安全。
      expect(
        res.status,
        isAdmin
          ? `${label} 没要求 Admin Key —— 管理端点裸奔`
          : `${label} 没要求 Bearer —— principal 会是 undefined,而归属判定全建立在它之上`,
      ).toBe(401)
    })
  }
})
