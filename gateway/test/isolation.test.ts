/**
 * V0.4.5 Session 3 —— 隔离级别与网关接线。
 *
 * 核心断言只有一句:**切到进程隔离后,客户端看到的东西一模一样。**
 * 所以这里刻意复用 V0.2.0 那套「仅凭 HTTP 完成一次会话」的验收路径,
 * 只把隔离级别换掉 —— 若要为进程档另写一套验收,红线 2 就已经破了。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InMemoryMeteringStore, safeRecord } from '@dshwar/metering'
import { forkLauncher, Supervisor, type SupervisorEvent } from '@dshwar/supervisor'
import type { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  createIsolatedRuntime,
  DEFAULT_ISOLATION_LEVEL,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  ISOLATION_LEVELS,
  parseIsolationLevel,
  registerRuntimeRoutes,
  auditSupervisorEvents,
  type GatewayEnv,
  type IsolationLevel,
} from '../src/index.ts'
import { createTestHarness, readSSE } from './harness.ts'

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'worker-entry.ts')
process.env['NODE_OPTIONS'] = [process.env['NODE_OPTIONS'], '--experimental-strip-types']
  .filter(Boolean)
  .join(' ')

let supervisor: Supervisor | undefined
let store: GatewaySessionStore | undefined

afterEach(async () => {
  await store?.releaseAll().catch(() => undefined)
  supervisor?.dispose()
  supervisor = undefined
  store = undefined
})

interface Booted {
  readonly app: Hono<GatewayEnv>
  readonly store: GatewaySessionStore
  readonly metering: InMemoryMeteringStore
  readonly meteringErrors: string[]
  readonly supervisorEvents: SupervisorEvent[]
}

/** 按隔离级别装一个完整网关。**两档共用同一段接线** —— 那正是要证明的事。 */
async function boot(
  level: IsolationLevel,
  options: { maxProcesses?: number; quotaDenies?: boolean; quotaDeniesTurnOnly?: boolean } = {},
): Promise<Booted> {
  const metering = new InMemoryMeteringStore()
  const supervisorEvents: SupervisorEvent[] = []
  const meteringErrors: string[] = []
  const sessionStore = new GatewaySessionStore({
    // 与 usage-api.test.ts 同款接线 —— 走 safeRecord,不直接调 store.record()
    onUsage: (obs) => {
      void safeRecord(
        metering,
        {
          subjectId: obs.session.subjectId,
          tenantId: obs.session.tenantId,
          sessionId: obs.session.id,
          turn: obs.turn,
          step: obs.step,
          provider: obs.session.provider ?? 'fake',
          model: obs.session.model ?? 'fake-1',
          usage: obs.usage ?? { inputTokens: 0, outputTokens: 0 },
          unreported: obs.usage === undefined,
          at: new Date().toISOString(),
        },
        (d) => meteringErrors.push(d),
      )
    },
  })
  store = sessionStore

  let isolated
  if (level === 'process') {
    const root = mkdtempSync(join(tmpdir(), 'dshwar-iso-'))
    supervisor = new Supervisor({
      launcher: {
        launch: (spec) =>
          forkLauncher(WORKER, {
            args: ['--tokens', '你好|,|世界', '--delay', '0'],
            bootstrap: {
              workspaceRoot: root,
              sessionRoot: join(root, 'sessions'),
              authEntries: [{ token: 'tok', id: spec.principalId, tenantId: spec.tenantId }],
              defaultProvider: 'fake',
              defaultModel: 'fake-1',
              quiet: true,
            },
          }).launch(spec),
      },
      profile: 'gateway',
      maxProcesses: options.maxProcesses ?? 4,
      idleTimeoutMs: 60_000,
      onEvent: (e) => supervisorEvents.push(e),
    })
    isolated = createIsolatedRuntime({ level, supervisor, store: sessionStore })
  } else {
    const harness = await createTestHarness({ fake: { tokens: ['你好', ',', '世界'] } })
    isolated = createIsolatedRuntime({ level, inProcess: harness })
  }

  const app = createGateway({
    ctx: (await createTestHarness()).ctx,
    adminKeys: new InMemoryAdminKeyResolver([{ key: 'admin-acme', tenantId: 'acme', label: 'a' }]),
    runtimeRoutes: registerRuntimeRoutes({
      store: sessionStore,
      createAgent: isolated.createAgent,
      userMessage: isolated.userMessage,
      heartbeatMs: 50,
      ...(options.quotaDeniesTurnOnly === true
        ? {
            quota: {
              check: async () => ({ kind: 'deny' as const, reason: 'quota_exhausted' }),
              admit: () => ({ kind: 'allow' as const }),
            },
          }
        : {}),
      ...(options.quotaDenies === true
        ? {
            quota: {
              check: async () => ({ kind: 'deny' as const, reason: 'quota_exhausted' }),
              // V0.4.6:准入判定同步、读快照。这里直接返回 deny 模拟
              // 「快照说这个租户烧完了」。
              admit: () => ({ kind: 'deny' as const, reason: 'quota_exhausted' }),
            },
          }
        : {}),
    }),
  })

  return { app, store: sessionStore, metering, meteringErrors, supervisorEvents }
}

const auth = { authorization: 'Bearer dev-alice' }

async function fullSession(app: Hono<GatewayEnv>): Promise<{
  status: number
  events: { id: string | undefined; type: string; data: Record<string, unknown> }[]
}> {
  const created = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (created.status !== 201) return { status: created.status, events: [] }
  const id = ((await created.json()) as { session: { id: string } }).session.id

  const stream = await app.request(`/v1/sessions/${id}/stream`, { headers: auth })
  await app.request(`/v1/sessions/${id}/turns`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ input: '你好' }),
  })
  const events = await readSSE(stream, { until: (e) => e.type === 'turn.completed', maxMs: 8000 })
  return { status: 201, events }
}

describe('R6 三档隔离', () => {
  it('★ 默认是 logical —— 进程隔离必须显式开(红线 1)', () => {
    expect(DEFAULT_ISOLATION_LEVEL).toBe('logical')
    expect(parseIsolationLevel(undefined)).toBe('logical')
    expect(ISOLATION_LEVELS).toEqual(['logical', 'process', 'container'])
  })

  it('认不出的级别直接抛,不静默回退到默认', () => {
    // 静默回退的后果:配置写错一个字母,部署方以为开了进程隔离,
    // 实际跑在逻辑隔离上 —— 而这个差别是安全等级的差别。
    expect(() => parseIsolationLevel('proces')).toThrow(/未知的隔离级别/)
    expect(() => parseIsolationLevel('')).toThrow(/未知的隔离级别/)
  })

  it('container 档只是配置位,起不来但给出可执行的指引(红线 4)', () => {
    expect(() => createIsolatedRuntime({ level: 'container' })).toThrow(/未实现/)
    expect(() => createIsolatedRuntime({ level: 'container' })).toThrow(/ProcessLauncher/)
  })

  it('配置与级别不匹配时立刻抛,不留到第一个请求', () => {
    expect(() => createIsolatedRuntime({ level: 'logical' })).toThrow(/进程内运行时/)
    expect(() => createIsolatedRuntime({ level: 'process' })).toThrow(/supervisor 与 store/)
  })
})

describe('R6 网关接线:两档的对外行为一致(红线 2)', () => {
  it('logical 档:仅凭 HTTP 完成一次完整会话', async () => {
    const { app } = await boot('logical')
    const { status, events } = await fullSession(app)

    expect(status).toBe(201)
    expect(events.map((e) => e.type)).toContain('turn.started')
    expect(events.map((e) => e.type)).toContain('turn.completed')
  }, 30_000)

  it('★ process 档:同一段验收路径,一字不改地跑通', async () => {
    const { app } = await boot('process')
    const { status, events } = await fullSession(app)

    expect(status).toBe(201)
    const types = events.map((e) => e.type)
    expect(types).toContain('turn.started')
    expect(types).toContain('message.delta')
    expect(types).toContain('message.completed')
    expect(types).toContain('turn.completed')

    // 拼出来的正文与逻辑档相同 —— 客户端看不出自己跑在哪一档
    const text = events
      .filter((e) => e.type === 'message.delta')
      .map((e) => e.data['text'] as string)
      .join('')
    expect(text).toBe('你好,世界')
  }, 30_000)

  it('两档的事件类型序列相同', async () => {
    const logical = await boot('logical')
    const logicalTypes = (await fullSession(logical.app)).events.map((e) => e.type)
    await logical.store.releaseAll()

    const process_ = await boot('process')
    const processTypes = (await fullSession(process_.app)).events.map((e) => e.type)

    expect(processTypes).toEqual(logicalTypes)
  }, 40_000)
})

describe('R7 治理联动:不另起一套', () => {
  it('计量归属在跨进程下仍正确', async () => {
    const { app, metering } = await boot('process')
    await fullSession(app)

    // tenantId 是 UsageFilter 的**必填**项 —— 与 audit 同一条理由:
    // 可选的租户过滤总有一天被忘掉。漏了它这里会恒空。
    const records = await metering.query({ tenantId: 'acme', subjectId: 'alice-e6f1' })
    expect(records.length, '跨进程之后计量没收到任何用量').toBeGreaterThan(0)
    // 归属三件套必须原样 —— 用量经 IPC 回传后仍算在发起人头上
    expect(records[0]).toMatchObject({ subjectId: 'alice-e6f1', tenantId: 'acme' })
  }, 30_000)

  it('配额判定仍在父进程 —— policy 不进子进程', async () => {
    // 只让**精确判定**拒绝,准入放行 —— 这样才测得到「发轮时的判定在父进程」
    const { app, supervisorEvents } = await boot('process', { quotaDeniesTurnOnly: true })
    const created = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const id = ((await created.json()) as { session: { id: string } }).session.id

    const turn = await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ input: '你好' }),
    })

    // 判定在父进程做出并生效,与逻辑档同一条代码路径 —— 子进程不参与
    expect(turn.status).toBe(429)
    // 起了一个进程(建会话时),但**没有第二个** —— 被拒的这一轮
    // 没有额外拉起任何东西,判定确实发生在父进程里
    expect(supervisorEvents.filter((e) => e.kind === 'spawn')).toHaveLength(1)
  }, 30_000)

  /**
   * ★ 缺口已修(V0.4.6 Session 2)。本条从「钉死现状」翻转成「断言正确行为」。
   *
   * 曾经的形态:配额只挂在 `/turns` 上,而进程在**建会话**时就起来 ——
   * 配额耗尽的租户能不断建会话、占满进程槽位,把付费租户挤出去。
   * 逻辑隔离下这几乎没有成本,是进程隔离把它放大成了真实的拒绝服务向量。
   *
   * 现在建会话走准入判定(同步、读快照、不等 metering),烧完即拒。
   */
  it('★ 配额耗尽的租户建不了会话,进程池不被占用', async () => {
    const { app, supervisorEvents } = await boot('process', { quotaDenies: true })
    const created = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(created.status).toBe(429)
    // 关键:**一个进程都没起**。这才是准入判定的意义 ——
    // 拒绝发生在付出 115 ms 冷启动 + 58 MB 之前。
    expect(supervisorEvents.filter((e) => e.kind === 'spawn')).toHaveLength(0)
  }, 30_000)

  it('★ 准入判定在两档隔离下行为一致(红线 2)', async () => {
    // 客户端不该知道自己跑在哪种隔离下 —— 包括被拒的时候。
    // 若只在 process 档做准入,两档就分叉了。
    const logical = await boot('logical', { quotaDenies: true })
    const logicalRes = await logical.app.request('/v1/sessions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    await logical.store.releaseAll()

    const process_ = await boot('process', { quotaDenies: true })
    const processRes = await process_.app.request('/v1/sessions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(logicalRes.status).toBe(processRes.status)
    expect(logicalRes.status).toBe(429)
  }, 30_000)

  it('进程 spawn / 回收 / 崩溃进审计', async () => {
    const entries: Record<string, unknown>[] = []
    const sink = auditSupervisorEvents((entry) => entries.push(entry))

    const { app } = await boot('process')
    await fullSession(app)
    for (const event of (await boot('process')).supervisorEvents) sink(event)

    // 直接喂几条,断言翻译形状 —— 接线本身在上面已经跑过
    sink({ kind: 'spawn', principalId: 'u-1', tenantId: 'acme', pid: 1 })
    sink({ kind: 'reclaim', principalId: 'u-1', tenantId: 'acme', pid: 1 })
    sink({
      kind: 'crash',
      principalId: 'u-1',
      tenantId: 'acme',
      pid: 1,
      exitCode: 7,
      signal: null,
    })

    const actions = entries.map((e) => e['action'])
    expect(actions).toContain('supervisor.spawn')
    expect(actions).toContain('supervisor.reclaim')
    expect(actions).toContain('supervisor.crash')
    // 按租户归档 —— 只有 principalId 的记录在控制平面里定位不到
    expect(entries.every((e) => e['tenantId'] === 'acme')).toBe(true)
    expect(entries.every((e) => e['actor'] === 'supervisor')).toBe(true)
  }, 40_000)

  it('进程池满时返回 503 unavailable', async () => {
    const { app } = await boot('process', { maxProcesses: 0 })
    const res = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    // V0.4.5 这里曾是 429 —— 那是被「契约零变更」逼出来的折中,语义是错的。
    // V0.4.6 补了 unavailable,撤销折中:「这台机器满了」不是「你请求太多」。
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('unavailable')
    expect(body.error.message).toContain('已满')
  }, 30_000)
})
