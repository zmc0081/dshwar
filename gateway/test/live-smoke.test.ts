/**
 * **第二层冒烟:真实模型,真实 key。**
 *
 * ⚠️ **不进 `check:all`,无 key 自动 skip。** 理由:开源项目的贡献者第一步
 * 不能卡在拿 key 上 —— 那是第一层(echo provider)存在的意义。
 *
 * 那为什么还要这一层?因为**配置路径对 stub 通,不代表对真实适配器通**。
 * 第一层证明的是「DSHWAR 自己的接线通了」;这一层证明的是「接上真东西也通」。
 * 两者证明的不是同一件事。
 *
 * ## 怎么跑
 *
 * ```bash
 * echo "DEEPSEEK_API_KEY=sk-..." >> .env      # .env 已在 .gitignore 里
 * pnpm vitest run gateway/test/live-smoke.test.ts
 * ```
 *
 * ⚠️ **key 绝不写进 `gateway.config.json` 或任何受版本控制的文件。**
 * 这里读 `process.env` 是允许的:CLAUDE.md 的 `grep process.env packages/ → 0`
 * 只管 `packages/`,而 `examples/sdk-session/src/cli.ts` 已有先例。
 *
 * ## 状态
 *
 * 🟠 **本文件从未在 CI 中运行过。** 首发前需人工跑一次并记录结果 ——
 * 已列入 `docs/RELEASE-CHECKLIST.md`。
 *
 * ## 用一个**无效** key 跑会发生什么(实测,2026-08-16)
 *
 * SSE 里出现 `error` 事件,断言在那一条上失败。**这是对的信号,不是噪音** ——
 * 它说明真实适配器确实打到了网络、拿到 401,而 `agent/error → error`
 * 那条链路(V0.4.6 Session 4)把它送到了客户端。
 *
 * 换言之:**接线在无效 key 下就已经被验证了一半**,剩下一半(真的能拿到回复)
 * 需要有效 key。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { InMemoryPrincipalCredentialStore } from '@dshwar/credentials-multiuser'
import { createPrincipal } from '@dshwar/principal'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  createIsolatedRuntime,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  registerRuntimeRoutes,
} from '../src/index.ts'
import { assembleRuntime } from '../src/runtime.ts'
import { readSSE } from './harness.ts'

const API_KEY = process.env['DEEPSEEK_API_KEY']
const AUTH = { authorization: 'Bearer dev-alice' }

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined)
  cleanup = []
})

// `describe.skipIf` 而不是在测试体里 return:跳过要**显式可见**,
// 否则「没跑」和「跑过了」在输出里长得一样。
describe.skipIf(API_KEY === undefined || API_KEY === '')(
  '第二层冒烟:真实 DeepSeek(需 DEEPSEEK_API_KEY)',
  () => {
    it('★ 真实模型跑通一轮 —— 配置路径对真实适配器也通', async () => {
      const root = await mkdtemp(join(tmpdir(), 'live-smoke-'))
      cleanup.push(() => rm(root, { recursive: true, force: true }))

      const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
      const credentials = new InMemoryPrincipalCredentialStore()
      await credentials.put(alice, credentialRef('DEEPSEEK_API_KEY'), API_KEY!)

      const runtime = await assembleRuntime({
        workspaceRoot: root,
        sessionRoot: join(root, 'sessions'),
        authEntries: [{ token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme' }],
        credentialStore: credentials,
        defaultProvider: 'deepseek',
        defaultModel: 'deepseek-chat',
        // ★ 进程档的形态:一进程一 principal,钉在根上。
        // live smoke 走这一档,因为多租户只剩它一条路 —— 要验就验会用的那条。
        principal: alice,
        quiet: true,
      })
      cleanup.push(() => runtime.dispose())

      // ⚠️ 这一步是 `docs/UPSTREAM-ISSUE-agent-ctx.md` 之外的另一个已知缺口:
      // assembleRuntime() 目前不注册任何 provider(见那份 spawn 出去的任务)。
      // 在它补上之前,这里手工接一次上游的 DeepSeekAdapter。
      const ctx = runtime.ctx as unknown as {
        llm: { registerAdapter(n: string[], a: unknown): void }
      }
      const { DeepSeekAdapter } = await import('@deepseek-ai/dsh-llm-deepseek')
      ctx.llm.registerAdapter(
        ['deepseek'],
        new DeepSeekAdapter({
          options: () => ({
            baseURL: 'https://api.deepseek.com',
            apiKeyEnv: credentialRef('DEEPSEEK_API_KEY'),
            defaults: {},
            maxTokens: 256,
            defaultContextWindow: 65_536,
            models: [],
            streamIdleTimeoutMs: 60_000,
            retryPolicy: undefined,
          }),
          // ★ 凭据走 per-principal 解析,不是从环境变量直接读 ——
          // 那正是 DSHWAR 存在的理由。
          resolveApiKey: async () => {
            const resolved = await credentials.get(alice, credentialRef('DEEPSEEK_API_KEY'))
            if (resolved === undefined) throw new Error('凭据解析不到')
            return resolved
          },
          resolveUserId: () => 'dshwar-live-smoke',
        } as never),
      )

      const store = new GatewaySessionStore()
      cleanup.push(() => store.releaseAll())
      const app = createGateway({
        ctx: runtime.ctx,
        adminKeys: new InMemoryAdminKeyResolver([{ key: 'k', tenantId: 'acme', label: 'a' }]),
        runtimeRoutes: registerRuntimeRoutes({
          store,
          ...createIsolatedRuntime({ level: 'logical', inProcess: runtime }),
          heartbeatMs: 5000,
        }),
      })

      const created = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(created.status).toBe(201)
      const id = ((await created.json()) as { session: { id: string } }).session.id

      const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: AUTH })
      await app.request(`/v1/sessions/${id}/turns`, {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ input: '用一个词回答:天空是什么颜色?' }),
      })

      const events = await readSSE(stream, {
        until: (e) => e.type === 'turn.completed',
        maxMs: 60_000,
      })
      const text = events
        .filter((e) => e.type === 'message.delta')
        .map((e) => e.data['text'] as string)
        .join('')

      console.log(`    [live smoke] 真实模型回复:${text.slice(0, 80)}`)

      expect(events.some((e) => e.type === 'error'), 'SSE 里出现了 error 事件').toBe(false)
      expect(text.length, '真实模型没有产出任何正文').toBeGreaterThan(0)
    }, 120_000)
  },
)
