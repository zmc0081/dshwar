import { Context } from '@deepseek-ai/cordis'
import { StaticAuth } from '@dshwar/auth-static'
import { PrincipalService } from '@dshwar/principal'
import type { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ADMIN_KEY_HEADER,
  assertTenant,
  createGateway,
  InMemoryAdminKeyResolver,
  type GatewayEnv,
} from '../src/index.ts'

const ENTRIES = [
  { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] },
  { token: 'dev-bob', id: 'bob-a2b3', tenantId: 'globex', roles: ['member'] },
]

const ADMIN_KEYS = [
  { key: 'admin-acme', tenantId: 'acme', label: 'acme 运维' },
  { key: 'admin-globex', tenantId: 'globex', label: 'globex 运维' },
]

let app: Hono<GatewayEnv>

beforeEach(async () => {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, { entries: ENTRIES, quiet: true })

  app = createGateway({
    ctx,
    adminKeys: new InMemoryAdminKeyResolver(ADMIN_KEYS),
    // 探针路由：只回显中间件放进上下文的东西，用来验证鉴权栈本身。
    // 真实端点在 Session 3 / 4。
    runtimeRoutes: (a) => {
      a.get('/v1/sessions/probe', (c) =>
        c.json({
          subjectId: c.get('principal')?.id ?? null,
          tenantId: c.get('principal')?.tenantId ?? null,
          scoped: c.get('scopedCtx')?.principal.current().id ?? null,
          requestId: c.get('requestId'),
        }),
      )
    },
    adminRoutes: (a) => {
      a.get('/v1/admin/probe', (c) =>
        c.json({ tenantId: c.get('admin')?.tenantId ?? null, requestId: c.get('requestId') }),
      )
      a.get('/v1/admin/probe/:tenant', (c) => {
        assertTenant(c.get('admin')!, c.req.param('tenant'))
        return c.json({ ok: true, requestId: c.get('requestId') })
      })
    },
  })
})

const runtime = (token?: string) =>
  app.request('/v1/sessions/probe', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })

const admin = (key?: string, path = '/v1/admin/probe') =>
  app.request(path, { headers: key === undefined ? {} : { [ADMIN_KEY_HEADER]: key } })

describe('会话路由 —— Bearer → verify → runWithPrincipal', () => {
  it('有效 token 换出 principal 并派生会话作用域', async () => {
    const res = await runtime('dev-alice')
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, string>
    expect(body.subjectId).toBe('alice-e6f1')
    expect(body.tenantId).toBe('acme')
    // 作用域内的 ctx.principal.current() 就是那个主体 —— 消费方零改动的落点
    expect(body.scoped).toBe('alice-e6f1')
  })

  it('不同 token 落到不同主体', async () => {
    const a = (await (await runtime('dev-alice')).json()) as Record<string, string>
    const b = (await (await runtime('dev-bob')).json()) as Record<string, string>

    expect(a.scoped).toBe('alice-e6f1')
    expect(b.scoped).toBe('bob-a2b3')
  })

  // 复现 V0.1.0 验证 C 到 HTTP 层
  it('并发请求不串号', async () => {
    const N = 60
    const results = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const token = i % 2 === 0 ? 'dev-alice' : 'dev-bob'
        const expected = i % 2 === 0 ? 'alice-e6f1' : 'bob-a2b3'
        const body = (await (await runtime(token)).json()) as Record<string, string>
        return body.scoped === expected
      }),
    )
    expect(results.filter((ok) => !ok)).toEqual([])
  })

  it('每个请求有独立的 requestId', async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const body = (await (await runtime('dev-alice')).json()) as Record<string, string>
        return body.requestId
      }),
    )
    expect(new Set(ids).size).toBe(10)
  })

  it('requestId 同时出现在响应头里', async () => {
    const res = await runtime('dev-alice')
    const body = (await res.json()) as Record<string, string>
    expect(res.headers.get('x-request-id')).toBe(body.requestId)
  })
})

describe('认证失败:形状完全一致,不泄漏原因', () => {
  // 认证接口是预言机。区分「不存在」「已过期」「租户不匹配」等于给攻击者探针。
  it('无 token / 错 token / 空 token 的响应形状完全一致', async () => {
    const responses = await Promise.all([
      runtime(undefined),
      runtime('nope'),
      runtime(''),
      runtime('dev-alic'),
      runtime('DEV-ALICE'),
    ])

    const bodies = await Promise.all(responses.map(async (r) => (await r.json()) as never))
    const shapes = bodies.map((b) => {
      const { error } = b as { error: { code: string; message: string; requestId: string } }
      return JSON.stringify({ code: error.code, message: error.message })
    })

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401])
    expect(new Set(shapes).size, '不同失败原因产生了不同的响应').toBe(1)
  })

  it('错误响应用契约里的统一形状', async () => {
    const res = await runtime('nope')
    const body = (await res.json()) as { error: Record<string, unknown> }

    expect(Object.keys(body).sort()).toEqual(['error'])
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId'])
    expect(body.error['code']).toBe('unauthorized')
  })

  it('错误消息不含被验证的 token', async () => {
    const secret = 'super-secret-token'
    const res = await runtime(secret)
    expect(JSON.stringify(await res.json())).not.toContain(secret)
  })

  it('错误消息不透露任何已配置的 token', async () => {
    const res = await runtime('nope')
    const text = JSON.stringify(await res.json())
    for (const entry of ENTRIES) {
      expect(text).not.toContain(entry.token)
    }
  })
})

describe('令牌分离 —— 中间件层就分开(R4)', () => {
  it('Admin Key 访问运行时端点被拒', async () => {
    const res = await app.request('/v1/sessions/probe', {
      headers: { [ADMIN_KEY_HEADER]: 'admin-acme' },
    })
    expect(res.status).toBe(401)
  })

  it('Bearer token 访问 Admin 端点被拒', async () => {
    const res = await app.request('/v1/admin/probe', {
      headers: { authorization: 'Bearer dev-alice' },
    })
    expect(res.status).toBe(401)
  })

  it('两者同时提供也被拒 —— 不允许「哪个能过算哪个」', async () => {
    const res = await app.request('/v1/sessions/probe', {
      headers: { authorization: 'Bearer dev-alice', [ADMIN_KEY_HEADER]: 'admin-acme' },
    })
    expect(res.status).toBe(401)
  })

  it('有效 Admin Key 可访问 Admin 端点', async () => {
    const res = await admin('admin-acme')
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, string>).tenantId).toBe('acme')
  })

  it('无效 Admin Key 被拒,形状与运行时一致', async () => {
    const res = await admin('nope')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: Record<string, unknown> }
    expect(body.error['code']).toBe('unauthorized')
  })

  it('缺 Admin Key 被拒', async () => {
    expect((await admin(undefined)).status).toBe(401)
  })
})

describe('Admin Key 按租户签发,一把钥匙不得横跨租户', () => {
  it('自己租户的操作放行', async () => {
    const res = await admin('admin-acme', '/v1/admin/probe/acme')
    expect(res.status).toBe(200)
  })

  it('跨租户操作被拒(403)', async () => {
    const res = await admin('admin-acme', '/v1/admin/probe/globex')
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden')
  })

  it('反向同样被拒', async () => {
    const res = await admin('admin-globex', '/v1/admin/probe/acme')
    expect(res.status).toBe(403)
  })

  it('重复的 Admin Key 在构造时拒绝,不静默覆盖', () => {
    expect(
      () =>
        new InMemoryAdminKeyResolver([
          { key: 'same', tenantId: 'acme', label: 'a' },
          { key: 'same', tenantId: 'globex', label: 'b' },
        ]),
    ).toThrow(/重复声明/)
  })

  it('空 Admin Key 在构造时拒绝', () => {
    expect(() => new InMemoryAdminKeyResolver([{ key: '', tenantId: 'acme', label: 'a' }])).toThrow(
      /不得为空/,
    )
  })
})

describe('未匹配路由', () => {
  it('用契约的错误形状,不是 Hono 默认的 404 文本', async () => {
    const res = await app.request('/v1/nonexistent')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('not_found')
    expect(body.error.requestId).toBeTruthy()
  })
})

describe('会话作用域随请求释放', () => {
  // 网关是长命进程、按请求派生。用 withPrincipal 会每次留下一个隔离槽位，
  // 内存随请求数线性增长且不报错 —— V0.1.0 已实测。
  it('大量请求后隔离槽位不随请求数增长', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    await ctx.plugin(StaticAuth, { entries: ENTRIES, quiet: true })

    const probe = createGateway({
      ctx,
      adminKeys: new InMemoryAdminKeyResolver(ADMIN_KEYS),
      runtimeRoutes: (a) => {
        a.get('/v1/sessions/probe', (c) => c.json({ ok: true }))
      },
    })

    const storeSize = () => Reflect.ownKeys(ctx.reflect.store).length
    const before = storeSize()

    for (let i = 0; i < 100; i += 1) {
      await probe.request('/v1/sessions/probe', {
        headers: { authorization: 'Bearer dev-alice' },
      })
    }

    expect(storeSize() - before, '每个请求都泄漏了一个隔离槽位').toBe(0)
  })
})
