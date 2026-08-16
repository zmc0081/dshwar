/**
 * **真实路径冒烟** —— 从 V0.4.6 拆过来、由 V0.4.7 解除阻塞的那一条。
 *
 * 验收的是一句话:**真实 HTTP 请求穿过网关之后,principal 确实抵达了 agent
 * 执行层。** 断言点选在客户端能看到的地方 —— SSE 正文里是那个 agent 真正
 * 解析出来的工作区根。中间任何一环把 principal 弄丢,正文就会变成
 * `anonymous/anonymous`。
 *
 * ## 为什么必须两档各跑一遍
 *
 * V0.4.7 的修复是**档位特定**的:根上 provide 只在进程档生效。
 * 冒烟若只跑默认的逻辑单用户档,压根碰不到那行改动 —— 绿了也证明不了任何事。
 *
 * | 档 | 期望落点 | 它证明什么 |
 * | --- | --- | --- |
 * | 逻辑单用户 | `/anonymous/anonymous/default` | 正常形态,不是 bug |
 * | 进程 + 真实 principal | `/acme/alice-e6f1/default` | **修复本身** |
 *
 * ## 与 `principal-reach.test.ts` 的分工
 *
 * 那一个证明**服务层**拿得到 principal(直接读 agent.ctx 的绑定);
 * 这一个证明**真实请求路径**穿过网关之后确实拿到了。两者都需要 ——
 * 服务层对了而接线漏了,是 V0.4.6 里踩过的形状。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forkLauncher, Supervisor } from '@dshwar/supervisor'
import type { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  createIsolatedRuntime,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  registerRuntimeRoutes,
  type GatewayEnv,
} from '../src/index.ts'
import { assembleRuntime } from '../src/runtime.ts'
import { WorkspaceEchoAdapter } from './fixtures/workspace-echo.ts'
import { readSSE } from './harness.ts'

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'worker-entry.ts')
process.env['NODE_OPTIONS'] = [process.env['NODE_OPTIONS'], '--experimental-strip-types']
  .filter(Boolean)
  .join(' ')

const AUTH = { authorization: 'Bearer dev-alice' }
const ENTRY = { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme' }

let cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined)
  cleanup = []
})

/** 走完整的 HTTP 路径:建会话 → 连流 → 发一轮 → 取正文。 */
async function driveOverHttp(app: Hono<GatewayEnv>, provider: string): Promise<string> {
  const created = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ provider, model: 'echo-1' }),
  })
  expect(created.status, `建会话失败:${await created.clone().text()}`).toBe(201)
  const id = ((await created.json()) as { session: { id: string } }).session.id

  const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: AUTH })
  await app.request(`/v1/sessions/${id}/turns`, {
    method: 'POST',
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ input: '你在哪个工作区' }),
  })

  const events = await readSSE(stream, { until: (e) => e.type === 'turn.completed', maxMs: 10_000 })
  return events
    .filter((e) => e.type === 'message.delta')
    .map((e) => e.data['text'] as string)
    .join('')
}

describe('第一层冒烟:echo provider,无需任何 API key', () => {
  it('★ 逻辑单用户档 → 落在 anonymous/anonymous(正常形态)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smoke-logical-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))

    // ★ 走产品装配路径 assembleRuntime(),不用 createTestHarness ——
    // 用 harness 就是重演「测试布局掩盖产品缺口」那个错误。
    const runtime = await assembleRuntime({
      workspaceRoot: root,
      sessionRoot: join(root, 'sessions'),
      authEntries: [ENTRY],
      defaultProvider: 'echo-workspace',
      defaultModel: 'echo-1',
      quiet: true,
    })
    cleanup.push(() => runtime.dispose())

    const ctx = runtime.ctx as unknown as {
      llm: { registerAdapter(n: string[], a: unknown): void }
      get(n: string): unknown
    }
    ctx.llm.registerAdapter(['echo-workspace'], new WorkspaceEchoAdapter(ctx, root))

    const store = new GatewaySessionStore()
    cleanup.push(() => store.releaseAll())
    const app = createGateway({
      ctx: runtime.ctx,
      adminKeys: new InMemoryAdminKeyResolver([{ key: 'k', tenantId: 'acme', label: 'a' }]),
      runtimeRoutes: registerRuntimeRoutes({
        store,
        ...createIsolatedRuntime({ level: 'logical', inProcess: runtime }),
        heartbeatMs: 50,
      }),
    })

    const landing = await driveOverHttp(app, 'echo-workspace')
    expect(landing, `实际落点 ${landing}`).toBe('/anonymous/anonymous/default')
  }, 40_000)

  it('★★ 进程档 + 真实 principal → 落在 acme/alice-e6f1(V0.4.7 修复的证明)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smoke-process-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))

    const supervisor = new Supervisor({
      launcher: {
        launch: (spec) =>
          forkLauncher(WORKER, {
            args: ['--workspace-root', root],
            bootstrap: {
              workspaceRoot: root,
              sessionRoot: join(root, 'sessions'),
              authEntries: [{ token: 'tok', id: spec.principalId, tenantId: spec.tenantId }],
              defaultProvider: 'echo-workspace',
              defaultModel: 'echo-1',
              quiet: true,
            },
          }).launch(spec),
      },
      profile: 'gateway',
      maxProcesses: 4,
      idleTimeoutMs: 60_000,
    })
    cleanup.push(async () => supervisor.dispose())

    // 父进程只用来认证与路由 —— 进程档下它不驱动 agent
    const authRuntime = await assembleRuntime({
      workspaceRoot: root,
      sessionRoot: join(root, 'auth-sessions'),
      authEntries: [ENTRY],
      defaultProvider: 'echo-workspace',
      defaultModel: 'echo-1',
      quiet: true,
    })
    cleanup.push(() => authRuntime.dispose())

    const store = new GatewaySessionStore()
    cleanup.push(() => store.releaseAll())
    const app = createGateway({
      ctx: authRuntime.ctx,
      adminKeys: new InMemoryAdminKeyResolver([{ key: 'k', tenantId: 'acme', label: 'a' }]),
      runtimeRoutes: registerRuntimeRoutes({
        store,
        ...createIsolatedRuntime({ level: 'process', supervisor, store }),
        heartbeatMs: 50,
      }),
    })

    const landing = await driveOverHttp(app, 'echo-workspace')

    // ★ 这一行就是 V0.4.7 的验收。子进程的根 ctx 上有
    // assembleRuntime({ principal }) 钉下的绑定,于是 fs-tenant 算出正确的租户目录。
    expect(landing, `实际落点 ${landing} —— 若是 anonymous,说明根上 provide 没生效`).toBe(
      '/acme/alice-e6f1/default',
    )
  }, 60_000)
})
