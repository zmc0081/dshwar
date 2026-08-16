/**
 * V0.3.0 的端到端验收 —— **进程内全链路**。
 *
 * ```
 * 供给方(按 authentik / Entra 的文档化形状发请求)
 *   → 网关 /scim/v2(SCIM token)
 *   → Subject Mirror
 *   → JwtAuth(真实密钥对 + 真实 JWKS 服务器)
 *   → 停用后同一个 token 被拒
 *   → webhook 出站,签名可独立验证
 * ```
 *
 * 与真容器验收的关系:本测试驱动的是**我们这一侧的完整链路**,供给方的请求
 * 形状按 REPORT-V3 §4 的文档化行为逐字构造。authentik 容器版验收脚本在
 * `scripts/e2e-authentik.md`(🟠 代码就绪待外部资源)—— 它验证的增量只有一件事:
 * authentik 真实发出的请求与文档化形状是否一致(REPORT-V3 标 ⚠️ 的三条)。
 */
import { AuthError } from '@dshwar/auth'
import { JwtAuth } from '@dshwar/auth-jwt'
import { createScimApp } from '@dshwar/scim-server'
import { InMemorySubjectStore, type SubjectStore } from '@dshwar/subject'
import {
  verifySignature,
  WebhookDispatcher,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  type SubjectEvent,
} from '@dshwar/webhooks'
import { Context } from '@deepseek-ai/cordis'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGateway, InMemoryAdminKeyResolver, InMemoryScimTokenResolver } from '../src/index.ts'

const SOURCE = 'authentik'
const ISSUER = 'https://idp.acme.example'

let keyPair: Awaited<ReturnType<typeof generateKeyPair>>
let jwksServer: Server
let subjects: SubjectStore
let app: ReturnType<typeof createGateway>
let auth: JwtAuth
let delivered: { headers: Record<string, string>; body: string }[]
let events: SubjectEvent[]

const SCIM = {
  authorization: 'Bearer scim-token',
  'content-type': 'application/scim+json',
}

beforeAll(async () => {
  keyPair = await generateKeyPair('RS256', { extractable: true })
  const jwk = await exportJWK(keyPair.publicKey)
  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }))
  })
  await new Promise<void>((ready) => jwksServer.listen(0, '127.0.0.1', ready))
  const jwksUri = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/jwks`

  subjects = new InMemorySubjectStore()
  delivered = []
  events = []

  // webhook 下游:收下请求供签名验证
  const downstream = (async (_url: unknown, init?: RequestInit) => {
    delivered.push({
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
      body: String(init?.body),
    })
    return new Response(null, { status: 200 })
  }) as typeof globalThis.fetch

  const dispatcher = new WebhookDispatcher(
    [{ url: 'https://downstream.example/hooks/dshwar', secret: 'shared-secret' }],
    { fetch: downstream, retries: 0, onFailure: () => undefined },
  )

  app = createGateway({
    ctx: new Context(),
    adminKeys: new InMemoryAdminKeyResolver([]),
    scim: {
      source: SOURCE,
      app: createScimApp({
        source: SOURCE,
        subjects,
        tenantMap: { strategy: 'issuer', issuers: { [SOURCE]: 'acme' } },
        onSubjectChange: (change) => {
          const event: SubjectEvent = {
            type: `subject.${change.type}` as SubjectEvent['type'],
            subjectId: change.subject.id,
            tenantId: change.subject.tenantId,
            source: change.subject.source,
            at: new Date().toISOString(),
          }
          events.push(event)
          void dispatcher.dispatch(event)
        },
      }),
      tokens: new InMemoryScimTokenResolver([
        { token: 'scim-token', source: SOURCE, label: 'authentik 供给' },
      ]),
    },
  })

  auth = new JwtAuth(new Context(), {
    issuer: ISSUER,
    audience: 'dshwar',
    jwksUri,
    source: SOURCE,
    subjects,
    tenantMap: { strategy: 'issuer', issuers: { [ISSUER]: 'acme' } },
  })
})

afterAll(async () => {
  await new Promise<void>((done) => jwksServer.close(() => done()))
})

const scim = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: SCIM,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function tokenFor(sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience('dshwar')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(keyPair.privateKey)
}

describe('M2.5 验收:供给 → 认证 → 停用 → 拒绝,全程零定制代码', () => {
  it('① 供给方推两个用户进来', async () => {
    const alice = await scim('POST', '/scim/v2/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      externalId: 'ak-alice',
      userName: 'alice',
      active: true,
    })
    const bob = await scim('POST', '/scim/v2/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      externalId: 'ak-bob',
      userName: 'bob',
      active: true,
    })

    expect(alice.status).toBe(201)
    expect(bob.status).toBe(201)
    expect(await subjects.list({ source: SOURCE })).toHaveLength(2)
  })

  it('② 两人都能通过 JWT 认证', async () => {
    const alice = await auth.verify(await tokenFor('ak-alice'))
    const bob = await auth.verify(await tokenFor('ak-bob'))

    expect(alice.tenantId).toBe('acme')
    expect(bob.tenantId).toBe('acme')
  })

  it('③ 供给方停用 alice(authentik 的 PUT 形状)', async () => {
    const mirror = await subjects.getByExternalId(SOURCE, 'ak-alice')
    const res = await scim('PUT', `/scim/v2/Users/${mirror!.id}`, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      externalId: 'ak-alice',
      userName: 'alice',
      active: false,
    })
    expect(res.status).toBe(200)
  })

  it('④ alice 的下一次请求被拒 —— 即使 token 本身仍然有效', async () => {
    // ★ 这一条就是 M2.5 的验收标准
    await expect(auth.verify(await tokenFor('ak-alice'))).rejects.toBeInstanceOf(AuthError)
  })

  it('⑤ bob 不受影响 —— 停用是精确的,不是一刀切', async () => {
    await expect(auth.verify(await tokenFor('ak-bob'))).resolves.toMatchObject({
      tenantId: 'acme',
    })
  })

  it('⑥ 停用事件已出站,签名可被下游独立验证', async () => {
    const deactivations = events.filter((e) => e.type === 'subject.deactivated')
    expect(deactivations).toHaveLength(1)

    const hit = delivered.find((d) => d.body.includes('subject.deactivated'))
    expect(hit, 'webhook 没有送到下游').toBeDefined()

    expect(
      verifySignature({
        secret: 'shared-secret',
        signature: hit!.headers[SIGNATURE_HEADER]!,
        timestamp: hit!.headers[TIMESTAMP_HEADER]!,
        body: hit!.body,
      }),
    ).toBe(true)

    // 载荷只有 id 与元数据,没有用户资料 —— webhook 会经过下游的日志与代理
    const payload = JSON.parse(hit!.body) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['at', 'source', 'subjectId', 'tenantId', 'type'])
  })

  it('⑦ Entra 的 PATCH 形状也能走完同一条链(第二个供给方形状)', async () => {
    const mirror = await subjects.getByExternalId(SOURCE, 'ak-bob')
    const res = await scim('PATCH', `/scim/v2/Users/${mirror!.id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', value: { active: 'False' } }],
    })
    expect(res.status).toBe(200)

    await expect(auth.verify(await tokenFor('ak-bob'))).rejects.toBeInstanceOf(AuthError)
    expect(events.filter((e) => e.type === 'subject.deactivated')).toHaveLength(2)
  })
})
