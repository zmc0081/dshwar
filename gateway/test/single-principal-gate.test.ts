/**
 * V0.4.7 —— 逻辑档只支持单主体的两层闸门。
 *
 * 这不是「隔离强度不够」的软约束,是**架构限制**:逻辑档下 principal 到不了
 * agent 执行层,多用户的文件全落进 `anonymous/anonymous/` 互相覆盖。
 * 四条路全部走不通,见 `ARCHITECTURE.md` §2.4。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrincipal } from '@dshwar/principal'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertSinglePrincipalCapable,
  createIsolatedRuntime,
  LogicalIsolationMultiUserError,
  startServer,
  type ServerConfig,
} from '../src/index.ts'
import { createTestHarness } from './harness.ts'

describe('配置层闸门(主)—— 启动时确定性判断', () => {
  it('★ 逻辑档 + 多个静态令牌 → 拒绝启动', () => {
    expect(() => assertSinglePrincipalCapable('logical', { staticTokenCount: 2 })).toThrow(
      LogicalIsolationMultiUserError,
    )
  })

  it('逻辑档 + OIDC / JWT / SCIM 各自都拒', () => {
    for (const identity of [{ hasOidc: true }, { hasJwt: true }, { hasScim: true }]) {
      expect(() => assertSinglePrincipalCapable('logical', identity)).toThrow(
        LogicalIsolationMultiUserError,
      )
    }
  })

  it('✅ 单令牌的逻辑档放行 —— single-user.yml 必须仍能跑', () => {
    expect(() => assertSinglePrincipalCapable('logical', { staticTokenCount: 1 })).not.toThrow()
    expect(() => assertSinglePrincipalCapable('logical', { staticTokenCount: 0 })).not.toThrow()
  })

  it('✅ 进程档不受限 —— 多用户正是它的用途', () => {
    expect(() =>
      assertSinglePrincipalCapable('process', { staticTokenCount: 50, hasOidc: true }),
    ).not.toThrow()
  })

  it('★ 错误信息给出路,并写明代价', () => {
    try {
      assertSinglePrincipalCapable('logical', { staticTokenCount: 2 })
      expect.unreachable('应当抛出')
    } catch (e) {
      const message = (e as Error).message
      // 一个没有出路的门禁,最后拦住的只有守规矩的人 —— 其余人直接注释掉它。
      expect(message, '没告诉人该怎么办').toContain('isolation')
      expect(message).toContain('process')
      expect(message, '没写明代价,人们会以为改档是免费的').toContain('58 MB')
      expect(message, '没说单用户不受影响,会吓退单机用户').toContain('single-user')
    }
  })
})

describe('运行时兜底(防御深度)—— 拒绝会话,不拒绝服务', () => {
  it('★ 第二个不同主体的会话被拒,但服务还活着', async () => {
    const harness = await createTestHarness()
    const isolated = createIsolatedRuntime({ level: 'logical', inProcess: harness })

    const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
    const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })

    await expect(
      isolated.createAgent({
        sessionId: 's1',
        model: undefined,
        provider: undefined,
        principal: alice,
      }),
    ).resolves.toBeDefined()

    await expect(
      isolated.createAgent({
        sessionId: 's2',
        model: undefined,
        provider: undefined,
        principal: bob,
      }),
    ).rejects.toThrow(/只支持单主体/)

    // ⚠️ 关键:进程没死,第一个主体照常能继续开会话。
    // 逻辑档下杀进程 = 第二个用户能干掉第一个用户的运行时,是白送的 DoS 向量。
    await expect(
      isolated.createAgent({
        sessionId: 's3',
        model: undefined,
        provider: undefined,
        principal: alice,
      }),
    ).resolves.toBeDefined()
  }, 20_000)

  it('同一主体的多个会话不受影响', async () => {
    const harness = await createTestHarness()
    const isolated = createIsolatedRuntime({ level: 'logical', inProcess: harness })
    const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })

    for (const id of ['a', 'b', 'c']) {
      await expect(
        isolated.createAgent({
          sessionId: id,
          model: undefined,
          provider: undefined,
          principal: alice,
        }),
      ).resolves.toBeDefined()
    }
  }, 20_000)
})

describe('端到端:startServer 的配置层闸门', () => {
  let tmp: string
  let server: { url: string; close: () => Promise<void> } | undefined

  const base = (root: string, tokens: number): ServerConfig => ({
    host: '127.0.0.1',
    port: 0,
    workspaceRoot: join(root, 'workspaces'),
    sessionRoot: join(root, 'sessions'),
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat',
    authEntries: Array.from({ length: tokens }, (_, i) => ({
      token: `dev-${i}`,
      id: `user-${i}`,
      tenantId: 'acme',
    })),
  })

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dshwar-gate-'))
  })
  afterEach(async () => {
    await server?.close()
    server = undefined
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  })

  it('★ 默认档 + 两个令牌 → 拒绝启动', async () => {
    await expect(startServer(base(tmp, 2))).rejects.toThrow(LogicalIsolationMultiUserError)
  }, 20_000)

  it('✅ 默认档 + 一个令牌 → 正常起来(红线 1 不变)', async () => {
    server = await startServer(base(tmp, 1))
    const res = await fetch(`${server.url}/v1/sessions`, {
      headers: { authorization: 'Bearer dev-0' },
    })
    expect(res.status).toBe(200)
  }, 20_000)

  it('✅ 两个令牌 + process 档 → 正常起来', async () => {
    server = await startServer({
      ...base(tmp, 2),
      isolation: { level: 'process', maxProcesses: 4 },
    })
    const res = await fetch(`${server.url}/v1/sessions`, {
      headers: { authorization: 'Bearer dev-0' },
    })
    expect(res.status).toBe(200)
  }, 20_000)
})
