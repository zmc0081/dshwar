/**
 * M2 验收:**第三方仅凭 SDK 完成一次完整会话,不接触 dsh。**
 *
 * 这条标准有两半,两半都必须验:
 *
 * 1. **能跑通** —— `examples/sdk-session` 的代码对着真实网关跑完一次会话。
 *    这里起的是**真实 HTTP 服务器**(绑真实端口),不是 `app.fetch` 直调。
 *    SSE 走的是 chunked transfer,而 `app.fetch` 不经过 socket ——
 *    用它测等于把「流式能穿过 HTTP」这件事跳过了。
 *
 * 2. **依赖面干净** —— 示例包只依赖 `@dshwar/sdk`。跑通但偷偷 import 了
 *    `@deepseek-ai/dsh-*`,那句验收标准就是假的。这半边由静态检查保证,
 *    因为它没法靠跑一次测试证明。
 *
 * 测试本身在 gateway 里而不是示例包里,正是为了让示例包能只有一个依赖 ——
 * 装配网关需要上游那七个插件,放进示例就污染了它的依赖面。
 */
import { serve } from '@hono/node-server'
import { runSession } from '@dshwar/example-sdk-session'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGateway, GatewaySessionStore, registerRuntimeRoutes } from '../src/index.ts'
import { createTestHarness, AUTH_ENTRIES } from './harness.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let baseUrl: string
let close: () => Promise<void>

beforeAll(async () => {
  const harness = await createTestHarness({
    fake: { tokens: ['仅', '凭', 'SDK'], delayMs: 1 },
  })
  const store = new GatewaySessionStore()

  const app = createGateway({
    ctx: harness.ctx,
    adminKeys: { resolve: () => undefined },
    runtimeRoutes: registerRuntimeRoutes({
      store,
      createAgent: harness.createAgent,
      userMessage: harness.userMessage,
      heartbeatMs: 1000,
    }),
  })

  // 端口 0 = 让内核挑一个空闲端口。写死端口会在并行跑测试时互相撞。
  const server = serve({ fetch: app.fetch, port: 0 })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
  close = () => new Promise<void>((resolve) => server.close(() => resolve()))
})

afterAll(async () => {
  await close?.()
})

describe('M2 验收:仅凭 SDK 完成一次完整会话', () => {
  it('示例代码对着真实 HTTP 网关跑完建会话→发轮→收流→查状态→释放', async () => {
    const lines: string[] = []

    const transcript = await runSession({
      baseUrl,
      token: AUTH_ENTRIES[0]!.token,
      prompt: '证明一下',
      log: (line) => lines.push(line),
    })

    expect(transcript.text).toBe('仅凭SDK')
    expect(transcript.turn).toBe(1)
    expect(transcript.eventTypes).toContain('turn.started')
    expect(transcript.eventTypes).toContain('message.delta')
    expect(transcript.eventTypes.at(-1)).toBe('turn.completed')

    // 五步都跑到了 —— 少任何一步都不算「完整会话」
    expect(lines.some((l) => l.includes('会话已建立'))).toBe(true)
    expect(lines.some((l) => l.includes('第 1 轮已受理'))).toBe(true)
    expect(lines.some((l) => l.includes('会话已释放'))).toBe(true)
  })

  it('会话释放后再查即 404 —— 示例确实清理干净了', async () => {
    const transcript = await runSession({
      baseUrl,
      token: AUTH_ENTRIES[0]!.token,
      prompt: '再来一次',
    })

    const response = await fetch(`${baseUrl}/v1/sessions/${transcript.sessionId}`, {
      headers: { authorization: `Bearer ${AUTH_ENTRIES[0]!.token}` },
    })
    expect(response.status).toBe(404)
  })

  it('令牌无效时抛 DshwarApiError 而不是静默失败', async () => {
    await expect(
      runSession({ baseUrl, token: 'not-a-real-token', prompt: '你好' }),
    ).rejects.toMatchObject({ name: 'DshwarApiError', code: 'unauthorized', status: 401 })
  })
})

describe('M2 验收:示例的依赖面里没有 dsh', () => {
  const examplePkg = JSON.parse(
    readFileSync(join(repoRoot, 'examples', 'sdk-session', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

  it('运行时依赖只有 @dshwar/sdk', () => {
    expect(Object.keys(examplePkg.dependencies ?? {})).toEqual(['@dshwar/sdk'])
  })

  it('连 devDependencies 里都没有 dsh 或 cordis', () => {
    const all = Object.keys({ ...examplePkg.dependencies, ...examplePkg.devDependencies })
    expect(all.filter((d) => d.startsWith('@deepseek-ai/'))).toEqual([])
  })

  it('示例源码只 import @dshwar/sdk', () => {
    // 只看 import 的**来源**,不看正文 —— 注释里解释「本包不依赖 dsh」时
    // 必然要写出 dsh 这三个字母,拿裸串匹配会把说明文字本身判成违规。
    const specifier = /(?:^|\n)\s*import\s(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"]/g

    for (const file of ['session.ts', 'cli.ts']) {
      const source = readFileSync(join(repoRoot, 'examples', 'sdk-session', 'src', file), 'utf8')
      const external = [...source.matchAll(specifier)]
        .map((m) => m[1]!)
        .filter((s) => !s.startsWith('.') && !s.startsWith('node:'))

      expect(external, `${file} 只允许 import @dshwar/sdk`).toEqual(
        external.length === 0 ? [] : ['@dshwar/sdk'],
      )
    }
  })
})
