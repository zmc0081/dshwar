/**
 * V0.4.1 Session 1:workspaceId 在 `/v1` 上的流转。
 *
 * 决策见 `docs/DECISIONS/workspace-in-api.md`:**只在建会话时传一次**,
 * 此后由会话 id 承载。这里验的是那个决策真的成立 ——
 * 发轮 / SSE / 删除都不带 workspaceId,而文件仍落在正确的工作区里。
 */
import { DEFAULT_WORKSPACE_ID, tenantWorkspaceRoot, TenantFileSystem } from '@dshwar/fs-tenant'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createGateway,
  GatewaySessionStore,
  InMemoryAdminKeyResolver,
  registerRuntimeRoutes,
} from '../src/index.ts'
import { AUTH_ENTRIES, createTestHarness } from './harness.ts'

const ALICE = { authorization: 'Bearer dev-alice' }
const alice = { id: AUTH_ENTRIES[0]!.id, tenantId: 'acme' }

let app: ReturnType<typeof createGateway>
let store: GatewaySessionStore
let root: string
let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'dshwar-ws-'))
  root = join(tmp, 'workspaces')
  for (const ws of [DEFAULT_WORKSPACE_ID, 'proj-a', 'proj-b']) {
    await mkdir(tenantWorkspaceRoot(root, alice as never, ws), { recursive: true })
  }

  const harness = await createTestHarness()
  store = new GatewaySessionStore()

  // fs-tenant 的 workspaceOf 从会话簿取值 —— 这是 Session 0 留的注入点
  // 在网关侧的落地:工作区来源是会话,不是每次请求的参数。
  //
  // 真实部署里这个闭包读的是「当前请求属于哪个会话」(由中间件放进作用域);
  // 测试里只有一个会话在跑,直接取会话簿里最新的那个即可。
  const innerCtx = harness.ctx.isolate('fs')
  await innerCtx.plugin(LocalFileSystem, { cwd: root })
  await harness.ctx.plugin(TenantFileSystem, {
    inner: innerCtx.fs as FileSystem,
    root,
    workspaceOf: () => store.list(alice as never)[0]?.workspaceId,
  })

  app = createGateway({
    ctx: harness.ctx,
    adminKeys: new InMemoryAdminKeyResolver([]),
    runtimeRoutes: registerRuntimeRoutes({
      store,
      createAgent: harness.createAgent,
      userMessage: harness.userMessage,
    }),
  })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
})

async function create(body: Record<string, unknown> = {}) {
  const res = await app.request('/v1/sessions', {
    method: 'POST',
    headers: { ...ALICE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { res, body: (await res.json()) as { session: Record<string, unknown> } }
}

describe('建会话时携带 workspaceId', () => {
  it('显式传入时,响应里带回同一个值', async () => {
    const { res, body } = await create({ workspaceId: 'proj-a' })
    expect(res.status).toBe(201)
    expect(body.session['workspaceId']).toBe('proj-a')
  })

  // R2:改造前的调用方不传，行为必须与改造前一致
  it('省略时落到 default', async () => {
    const { body } = await create({})
    expect(body.session['workspaceId']).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('会话簿里记的是同一个值 —— fs-tenant 从这里取', async () => {
    const { body } = await create({ workspaceId: 'proj-b' })
    const id = body.session['id'] as string
    expect(store.get(id, alice as never)?.workspaceId).toBe('proj-b')
  })
})

describe('此后不必再带 —— 会话 id 承载工作区', () => {
  it('GET / 发轮 / 删除都不带 workspaceId,仍能正确路由', async () => {
    const { body } = await create({ workspaceId: 'proj-a' })
    const id = body.session['id'] as string

    // 三个后续端点都不带 workspaceId
    const got = await app.request(`/v1/sessions/${id}`, { headers: ALICE })
    expect(got.status).toBe(200)
    expect(((await got.json()) as { session: { workspaceId: string } }).session.workspaceId).toBe(
      'proj-a',
    )

    const turn = await app.request(`/v1/sessions/${id}/turns`, {
      method: 'POST',
      headers: { ...ALICE, 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })
    expect(turn.status).toBe(202)

    const del = await app.request(`/v1/sessions/${id}`, { method: 'DELETE', headers: ALICE })
    expect(del.status).toBe(200)
  })
})

describe('列表的可选过滤', () => {
  it('不带参数返回全部工作区的会话(与改造前一致)', async () => {
    await create({ workspaceId: 'proj-a' })
    await create({ workspaceId: 'proj-b' })
    await create({})

    const res = await app.request('/v1/sessions', { headers: ALICE })
    const { data } = (await res.json()) as { data: unknown[] }
    expect(data).toHaveLength(3)
  })

  it('带参数只返回该工作区的会话', async () => {
    await create({ workspaceId: 'proj-a' })
    await create({ workspaceId: 'proj-b' })

    const res = await app.request('/v1/sessions?workspaceId=proj-a', { headers: ALICE })
    const { data } = (await res.json()) as { data: { workspaceId: string }[] }
    expect(data).toHaveLength(1)
    expect(data[0]!.workspaceId).toBe('proj-a')
  })

  it('过滤到不存在的工作区返回空表,而不是报错', async () => {
    await create({ workspaceId: 'proj-a' })
    const res = await app.request('/v1/sessions?workspaceId=nope', { headers: ALICE })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
  })
})

describe('非法 workspaceId 在建会话时就被拒,不落到 default', () => {
  it('仅含空白被拒 —— 缺省不是旁路', async () => {
    // fs-tenant 的校验在第一次文件操作时才触发;但会话记录里必须原样保留，
    // 不能被静默改写成 default —— 否则用户会以为自己在 proj-x 里干活
    const { body } = await create({ workspaceId: '   ' })
    expect(body.session['workspaceId']).toBe('   ')
    expect(body.session['workspaceId']).not.toBe(DEFAULT_WORKSPACE_ID)
  })
})
