/**
 * **工作区 CRUD + 产物浏览(V0.5.5 Session 1)**。
 *
 * ## 验收的核心是那条 404
 *
 * 「跨用户访问他人工作区一律 404,不是 403」—— 403 会泄漏「这个 id 存在」,
 * 而工作区 id 的存在性本身就是信息:它能被用来探测「某个租户有没有叫 X 的项目」。
 *
 * 这条要在**每个**端点上验,不是验一次就完 —— 一个新端点忘了查归属
 * 是最容易犯、也最难在 review 里看出来的错。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tenantWorkspaceRoot } from '@dshwar/fs-tenant'
import { Context } from '@deepseek-ai/cordis'
import { StaticAuth } from '@dshwar/auth-static'
import { createPrincipal, PrincipalService } from '@dshwar/principal'
import { beforeEach, describe, expect, it } from 'vitest'
import { createGateway } from '../src/app.ts'
import { InMemoryAdminKeyResolver } from '../src/admin-keys.ts'
import { registerWorkspaceRoutes } from '../src/workspaces/routes.ts'
import { InMemoryWorkspaceStore } from '../src/workspaces/store.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })
// 同租户的另一个人 —— 「不跨用户共享」这条要连同租户也拦住,
// 否则「不跨租户」与「不跨用户」会被混成一条。
const carol = createPrincipal({ id: 'carol-77aa', tenantId: 'acme' })

// 令牌与 principal 的对应。走真实的 auth-static —— 伪造 auth 服务的话,
// runWithPrincipal 拿不到真的 cordis Context,而作用域正是要验的东西之一。
const ENTRIES = [
  { token: 'tok-alice', id: alice.id, tenantId: alice.tenantId },
  { token: 'tok-bob', id: bob.id, tenantId: bob.tenantId },
  { token: 'tok-carol', id: carol.id, tenantId: carol.tenantId },
]
const AS = (id: string) => ({ authorization: `Bearer tok-${id.split('-')[0]}` })

let store: InMemoryWorkspaceStore
let root: string
let app: ReturnType<typeof createGateway>
let ctx: Context

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, { entries: ENTRIES, quiet: true })
  store = new InMemoryWorkspaceStore()
  root = mkdtempSync(join(tmpdir(), 'ws-test-'))
  app = createGateway({
    ctx,
    adminKeys: new InMemoryAdminKeyResolver([]),
    workbenchRoutes: registerWorkspaceRoutes({ store, workspaceRoot: root }),
  })
})

describe('工作区 CRUD', () => {
  it('建 → 取 → 列', async () => {
    const created = await app.request('/v1/workspaces', {
      method: 'POST',
      headers: { ...AS(alice.id), 'content-type': 'application/json' },
      body: JSON.stringify({ name: '季度报告' }),
    })
    expect(created.status).toBe(201)
    const { workspace } = (await created.json()) as { workspace: { id: string; name: string } }
    expect(workspace.name).toBe('季度报告')

    const got = await app.request(`/v1/workspaces/${workspace.id}`, { headers: AS(alice.id) })
    expect(got.status).toBe(200)

    const listed = await app.request('/v1/workspaces', { headers: AS(alice.id) })
    const { data } = (await listed.json()) as { data: { id: string }[] }
    expect(data.map((w) => w.id)).toEqual([workspace.id])
  })

  it('★ id 由服务端生成,首字符是字母 —— 满足 fs-tenant 白名单', async () => {
    // 让客户端指定 id 意味着要在每个入口校验、拒绝、给错误信息,
    // 三件事都可能被下一个入口忘掉。服务端生成是构造上安全的。
    const res = await app.request('/v1/workspaces', {
      method: 'POST',
      headers: { ...AS(alice.id), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', id: '../../etc' }),
    })
    const { workspace } = (await res.json()) as { workspace: { id: string } }
    expect(workspace.id).not.toContain('..')
    expect(workspace.id).toMatch(/^[A-Za-z0-9]/)
  })

  it('name 为空或过长被拒', async () => {
    for (const name of ['', '   ', 'x'.repeat(201)]) {
      const res = await app.request('/v1/workspaces', {
        method: 'POST',
        headers: { ...AS(alice.id), 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      expect(res.status, `name=${JSON.stringify(name.slice(0, 20))} 竟被接受`).toBe(400)
    }
  })

  it('删掉之后取不到', async () => {
    const ws = await store.create(alice, 'w')
    const del = await app.request(`/v1/workspaces/${ws.id}`, {
      method: 'DELETE',
      headers: AS(alice.id),
    })
    expect(del.status).toBe(204)
    const got = await app.request(`/v1/workspaces/${ws.id}`, { headers: AS(alice.id) })
    expect(got.status).toBe(404)
  })
})

describe('★ 跨主体一律 404(不是 403)', () => {
  it('跨租户:bob 摸不到 alice 的工作区', async () => {
    const ws = await store.create(alice, '季度报告')
    for (const [path, method] of [
      [`/v1/workspaces/${ws.id}`, 'GET'],
      [`/v1/workspaces/${ws.id}`, 'DELETE'],
      [`/v1/workspaces/${ws.id}/deliverables`, 'GET'],
    ] as const) {
      const res = await app.request(path, { method, headers: AS(bob.id) })
      expect(res.status, `${method} ${path} 没返回 404`).toBe(404)
      // 403 会告诉攻击者「这个 id 是真的」—— 那本身就是他想要的信息
      expect(res.status).not.toBe(403)
    }
  })

  it('★ 同租户的另一个人也摸不到 —— 「不跨用户共享」不等于「不跨租户」', async () => {
    // 这一条最容易漏:两人同属 acme,一个只查 tenantId 的实现会放行。
    // 而 D3 定案说的是**不跨用户共享**,租户只是其中一层。
    const ws = await store.create(alice, '季度报告')
    const res = await app.request(`/v1/workspaces/${ws.id}`, { headers: AS(carol.id) })
    expect(res.status).toBe(404)
  })

  it('列表只含自己的', async () => {
    await store.create(alice, 'a1')
    await store.create(alice, 'a2')
    await store.create(carol, 'c1')

    const res = await app.request('/v1/workspaces', { headers: AS(carol.id) })
    const { data } = (await res.json()) as { data: { name: string }[] }
    expect(data.map((w) => w.name)).toEqual(['c1'])
  })

  it('删别人的工作区返回 404,且**没真的删掉**', async () => {
    const ws = await store.create(alice, '季度报告')
    const res = await app.request(`/v1/workspaces/${ws.id}`, {
      method: 'DELETE',
      headers: AS(bob.id),
    })
    expect(res.status).toBe(404)
    // 断言副作用没发生 —— 只看状态码的话,一个「先删再判归属」的实现
    // 也会返回 404,而数据已经没了
    expect(await store.get(alice, ws.id)).toBeDefined()
  })
})

describe('产物浏览:直接读文件系统,不建表', () => {
  it('列出工作区里的文件与目录', async () => {
    const ws = await store.create(alice, '季度报告')
    const dir = tenantWorkspaceRoot(root, alice, ws.id)
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'a.txt'), 'hello')
    writeFileSync(join(dir, 'sub', 'b.md'), '# b')

    const res = await app.request(`/v1/workspaces/${ws.id}/deliverables`, { headers: AS(alice.id) })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { path: string; kind: string; size: number }[] }

    const paths = data.map((d) => d.path).sort()
    expect(paths).toEqual(['a.txt', 'sub', 'sub/b.md'])
    // 路径一律用正斜杠 —— Windows 上 `sub\b.md` 会让前端拼链接时出错
    expect(paths.every((p) => !p.includes('\\'))).toBe(true)
    expect(data.find((d) => d.path === 'a.txt')?.size).toBe(5)
    expect(data.find((d) => d.path === 'sub')?.kind).toBe('directory')
  })

  it('★ 目录不存在时返回空列表而不是 500 —— 刚建的工作区还没写过文件', async () => {
    const ws = await store.create(alice, '空的')
    const res = await app.request(`/v1/workspaces/${ws.id}/deliverables`, { headers: AS(alice.id) })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: unknown[] }
    expect(data).toEqual([])
  })

  it('产物落点由 fs-tenant 钉死,不是自己拼的路径', async () => {
    const ws = await store.create(alice, 'w')
    const expected = tenantWorkspaceRoot(root, alice, ws.id)
    // 四段全在:{root}/{tenantId}/{userId}/{workspaceId}
    expect(expected).toContain(join('acme', 'alice-e6f1', ws.id))
  })

  it('maxEntries 截断,不让一个几万文件的工作区把响应撑爆', async () => {
    const small = createGateway({
      ctx,
      adminKeys: new InMemoryAdminKeyResolver([]),
      workbenchRoutes: registerWorkspaceRoutes({ store, workspaceRoot: root, maxEntries: 2 }),
    })
    const ws = await store.create(alice, 'many')
    const dir = tenantWorkspaceRoot(root, alice, ws.id)
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 5; i += 1) writeFileSync(join(dir, `f${i}.txt`), 'x')

    const res = await small.request(`/v1/workspaces/${ws.id}/deliverables`, {
      headers: AS(alice.id),
    })
    const { data } = (await res.json()) as { data: unknown[] }
    expect(data.length).toBe(2)
  })
})
