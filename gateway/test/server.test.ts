/**
 * 可执行入口的验收。
 *
 * 两件要证的事:
 *
 * 1. **`profiles/gateway.yml` 与程序化装配不漂移。** profile 是文档里给出的部署
 *    组合;它和真正跑起来的东西对不上,文档就是骗人的。漂移必须变红,而不是靠人
 *    每次改 profile 时记得同步。
 * 2. **`startServer()` 真的能起来并服务请求。** 起真实端口、发真实 HTTP ——
 *    入口代码最常见的失败模式是「构建通过但一跑就炸」,只有真起一次才测得到。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DELIBERATELY_OMITTED, GATEWAY_PLUGINS } from '../src/runtime.ts'
import { parseArgs, startServer, type ServerConfig } from '../src/server.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('profiles/gateway.yml 与程序化装配不漂移', () => {
  /** 只抽 `name:` 行 —— 与 profile-parity 测试同款,刻意不引 yaml 解析器。 */
  async function profilePlugins(): Promise<string[]> {
    const text = await readFile(join(repoRoot, 'profiles', 'gateway.yml'), 'utf8')
    return [...text.matchAll(/^\s*name:\s*'([^']+)'/gm)].map((m) => m[1]!)
  }

  it('profile 里的每个插件,要么装了,要么在「刻意不装」清单里', async () => {
    const declared = new Set<string>([...GATEWAY_PLUGINS, ...DELIBERATELY_OMITTED])
    const missing = (await profilePlugins()).filter((name) => !declared.has(name))

    expect(
      missing,
      'profile 里有插件既没被装配,也没被列入 DELIBERATELY_OMITTED —— ' +
        '要么补进装配,要么写明为什么不装',
    ).toEqual([])
  })

  it('装配里的每个上游/DSHWAR 插件都能在 profile 里找到', async () => {
    const inProfile = new Set(await profilePlugins())
    const extra = GATEWAY_PLUGINS.filter((name) => !inProfile.has(name))

    expect(extra, '装配装了 profile 里没有的插件 —— profile 不再是那份部署组合').toEqual([])
  })

  it('「刻意不装」的每一条都真的在 profile 里', async () => {
    // 否则这份清单会积累早已删掉的插件名,变成噪音
    const inProfile = new Set(await profilePlugins())
    const stale = DELIBERATELY_OMITTED.filter((name) => !inProfile.has(name))
    expect(stale, 'DELIBERATELY_OMITTED 里有 profile 早已不含的条目').toEqual([])
  })
})

describe('parseArgs', () => {
  it('支持 --k v 与 --k=v 两种写法', () => {
    expect(parseArgs(['--config', 'a.json', '--port=9000'])).toEqual({
      config: 'a.json',
      port: '9000',
    })
  })

  it('后面没有值的 flag 当成开关', () => {
    expect(parseArgs(['--help', '--config', 'a.json'])).toEqual({
      help: 'true',
      config: 'a.json',
    })
  })
})

describe('startServer 真的能起来并服务请求', () => {
  let tmp: string
  let server: { url: string; close: () => Promise<void> } | undefined

  const config = (root: string): ServerConfig => ({
    host: '127.0.0.1',
    port: 0, // 0 = 内核挑一个空闲端口，避免并行跑测试时互撞
    workspaceRoot: join(root, 'workspaces'),
    sessionRoot: join(root, 'sessions'),
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat',
    authEntries: [{ token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] }],
    adminKeys: [{ key: 'admin-acme', label: 'acme 运维', tenantId: 'acme' }],
    credentials: [
      {
        subjectId: 'alice-e6f1',
        tenantId: 'acme',
        ref: 'DEEPSEEK_API_KEY',
        value: 'sk-alice-XXXX',
      },
    ],
  })

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dshwar-server-'))
  })

  afterEach(async () => {
    await server?.close()
    server = undefined
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  })

  it('未带令牌的请求得到契约形状的 401', async () => {
    server = await startServer(config(tmp))
    const response = await fetch(`${server.url}/v1/sessions`)

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('unauthorized')
    expect(body.error.requestId).toMatch(/\S/)
  })

  it('带令牌能列出会话(空表)', async () => {
    server = await startServer(config(tmp))
    const response = await fetch(`${server.url}/v1/sessions`, {
      headers: { authorization: 'Bearer dev-alice' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: [], nextCursor: null })
  })

  it('Admin Key 能读到凭据的 describe,且响应里没有值', async () => {
    server = await startServer(config(tmp))
    const response = await fetch(`${server.url}/v1/admin/subjects/alice-e6f1/credentials`, {
      headers: { 'x-dshwar-admin-key': 'admin-acme' },
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('DEEPSEEK_API_KEY')
    expect(text).toContain('"configured":true')
    // 硬规则 5:永不返回值。凭据真的配了,但值不能出现在响应里。
    expect(text, 'Admin 响应里出现了凭据值').not.toContain('sk-alice-XXXX')
  })

  it('跨租户的 Admin Key 拿不到别的租户的主体', async () => {
    server = await startServer({
      ...config(tmp),
      adminKeys: [{ key: 'admin-globex', label: 'globex 运维', tenantId: 'globex' }],
    })
    const response = await fetch(`${server.url}/v1/admin/subjects/alice-e6f1/credentials`, {
      headers: { 'x-dshwar-admin-key': 'admin-globex' },
    })

    expect(response.status).toBe(403)
  })

  it('未匹配的路径走契约形状的 404,而不是 Hono 默认文本', async () => {
    server = await startServer(config(tmp))
    const response = await fetch(`${server.url}/v1/nope`, {
      headers: { authorization: 'Bearer dev-alice' },
    })

    expect(response.status).toBe(404)
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'not_found' },
    })
  })

  it('authEntries 为空时拒绝启动 —— 而不是起来之后拒绝每个人', async () => {
    await expect(startServer({ ...config(tmp), authEntries: [] })).rejects.toThrow(/authEntries/)
  })
})
