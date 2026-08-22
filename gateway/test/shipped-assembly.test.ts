/**
 * **出厂装配守卫** —— 契约里的每条路由,在**真正出厂的那个网关**里都挂上了吗?
 *
 * ## 它拦的是什么
 *
 * V0.8.0 的审计发现两条同根的缺陷,都在仓库里活了三个版本:
 *
 * | | 契约说 | 出厂网关实际 |
 * | --- | --- | --- |
 * | `/v1/workspaces` 等七条 | `implemented` | **404** —— `server.ts` 从不传 `workbenchRoutes` |
 * | `/v1/jobs` 三条 | `implemented` | **404** —— 压根没有 handler,status 标错了 |
 *
 * **没有任何一道红。** `registerWorkspaceRoutes` 实现完整、单测齐全,
 * 但它在全仓的调用点**只有 `gateway/test/` 里的三处** ——
 * 那些测试**自己手工调 `createGateway` 把它挂上去**,
 * 验的是「挂进去之后行为正确」,不是「**出厂真的挂了它**」。
 *
 * ## 判据必须是「出厂挂了什么」,不是「能挂什么」
 *
 * 所以这个文件**刻意不碰 `createGateway`**。它调 `startServer()` ——
 * 与 `bin: dshwar-gateway` 指向的是同一条装配路径 —— 起真实端口、发真实 HTTP。
 * 任何「自己拼一个 app 出来」的写法都会立刻退化成它要拦的那种测试。
 *
 * ⚠️ 这是 CLAUDE.md 那条设计准则在装配层的实例:
 * **「组件能不能装配」是结构问题,「出厂到底装了什么」是行为问题** ——
 * 查结构永远查不到行为。
 *
 * ## 三个容易把它变成恒绿的坑,以及各自的堵法
 *
 * 1. **资源 404 与端点 404 长得一样。** `GET /v1/sessions/{不存在的 id}`
 *    合法地返回 404 —— 若判据只看状态码,守卫会把「端点没挂」放过去。
 *    → 判据看 message:`app.notFound` 抛的是 `notFound('endpoint')` =
 *    `"endpoint not found"`,而资源级的是 `"session not found"` / `"resource not found"`。
 *    → 而这个判据本身是**字符串匹配**,改一次文案它就静默失效。
 *    所以下面第一条测试是**判据自身的对照**:打一个契约里没有的路径,
 *    断言它确实返回那句话。文案一改,那条先红。
 *
 * 2. **不带认证会把缺失的 handler 掩盖掉。** `/v1/jobs` 在 `app.ts:111-112`
 *    挂了 `runtimeAuth` 中间件却没有 handler —— 匿名请求得到的是 401(中间件拒的),
 *    看起来「端点在」。**必须带有效凭证**,让请求穿过中间件落到路由表上。
 *
 * 3. **循环可能一次都没执行到断言。** → 在**出口**计数,
 *    并断言计数等于 `ROUTES.length`(CLAUDE.md「凡遍历集合做断言处」那条推论)。
 *
 * ## 请求刻意构造成快速失败
 *
 * 守卫只问「这个端点挂没挂」,不问它的行为。所以路径参数一律填不存在的 id、
 * 请求体一律送一个**非对象**的合法 JSON —— schema 校验必然失败,
 * 于是没有任何一条请求会真的建会话、起 agent 或写文件。
 */
import { ROUTES } from '@dshwar/api-contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type ServerConfig } from '../src/server.ts'

/** `app.notFound()` 的原话。守卫全靠它区分「端点没挂」与「资源不存在」。 */
const ENDPOINT_NOT_FOUND = 'endpoint not found'

const RUNTIME_TOKEN = 'dev-alice'
const ADMIN_KEY = 'admin-acme'

let tmp: string
let server: { url: string; close: () => Promise<void> }

function configOf(root: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0, // 内核挑空闲端口,避免并行跑测试时互撞
    workspaceRoot: join(root, 'workspaces'),
    sessionRoot: join(root, 'sessions'),
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat',
    authEntries: [{ token: RUNTIME_TOKEN, id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] }],
    adminKeys: [{ key: ADMIN_KEY, label: 'acme 运维', tenantId: 'acme' }],
  }
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'dshwar-shipped-'))
  server = await startServer(configOf(tmp))
}, 60_000)

afterAll(async () => {
  await server?.close()
  await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
})

/** 契约路径 → 可请求的具体路径。`{id}` 一律填一个不存在的 id。 */
function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, 'zz-nonexistent')
}

function headersFor(auth: string): Record<string, string> {
  switch (auth) {
    case 'runtime':
      return { authorization: `Bearer ${RUNTIME_TOKEN}`, 'content-type': 'application/json' }
    case 'admin':
      return { 'x-dshwar-admin-key': ADMIN_KEY, 'content-type': 'application/json' }
    default:
      // signature:凑不出有效签名,预期 401 —— 401 不是端点 404,守卫照样通过。
      return { 'content-type': 'application/json' }
  }
}

interface Probe {
  readonly status: number
  readonly code: string
  readonly message: string
}

async function probe(method: string, path: string, auth: string): Promise<Probe> {
  const response = await fetch(`${server.url}${path}`, {
    method: method.toUpperCase(),
    headers: headersFor(auth),
    // 非对象的合法 JSON:能过 `c.req.json()`,过不了任何 schema ——
    // 于是端点若挂着,回的是 400 / 501 / 401,绝不会真的动手做事。
    ...(method === 'get' || method === 'delete' ? {} : { body: '"dshwar-assembly-probe"' }),
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
  }
  return {
    status: response.status,
    code: body.error?.code ?? '',
    message: body.error?.message ?? '',
  }
}

describe('出厂装配 —— startServer 挂了契约承诺的每条路由', () => {
  it('★ 判据自身的对照:契约外的路径确实回「endpoint not found」', async () => {
    // 这条**不是**在测 404 处理器,是在**验证下面那条守卫的判据还成立**。
    // `notFound('endpoint')` 的文案一旦改动,守卫会静默地把所有路由都放行 ——
    // 那时先红的是这一条。
    const result = await probe('get', '/v1/definitely-not-in-the-contract', 'runtime')

    expect(result.status).toBe(404)
    expect(result.code).toBe('not_found')
    expect(
      result.message,
      '端点级 404 的文案变了 —— 出厂装配守卫的判据已失效,先修判据再看它报什么',
    ).toBe(ENDPOINT_NOT_FOUND)
  })

  it('★ 契约里每条路由都真的挂在出厂网关上', async () => {
    const failures: string[] = []
    let asserted = 0

    for (const route of ROUTES) {
      const path = concretePath(route.path)
      const result = await probe(route.method, path, route.auth)
      asserted += 1

      const endpointMissing = result.status === 404 && result.message === ENDPOINT_NOT_FOUND
      const where = `${route.method.toUpperCase()} ${route.path} (${route.operationId}, ${route.status})`

      if (route.status === 'planned') {
        // planned 必须是 501 —— 契约里写着「404 会让第三方以为路径写错、
        // 去猜别的路径;501 说的是这个端点是真的,只是还没到」。
        if (result.status !== 501) {
          failures.push(`${where} —— planned 却返回 ${result.status} ${result.message}`)
        }
      } else if (endpointMissing) {
        failures.push(`${where} —— 契约标 implemented,出厂网关却没有挂它(404 endpoint not found)`)
      }
    }

    // 出口计数:一个遍历零次的循环与一个没有断言的测试等价,而它显示为「通过」。
    expect(asserted, '一条路由都没探到 —— 本条空跑了').toBe(ROUTES.length)
    expect(ROUTES.length).toBeGreaterThan(0)

    expect(
      failures,
      '出厂的 startServer 没有挂上契约承诺的路由。\n' +
        '⚠️ 修的方向有两个,别选错:\n' +
        '  · 实现存在但没接线 → 在 server.ts 的 createGateway 里补上对应的 registrar\n' +
        '  · 实现根本不存在 → 把 routes.ts 里那条的 status 改成 planned(让它回落 501)\n' +
        '失败清单:\n' +
        failures.join('\n'),
    ).toEqual([])
  })
})
