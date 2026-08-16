/**
 * JWT 认证。
 *
 * 这是本仓里最接近攻击面的一段代码,所以负向用例占绝大多数:
 * alg 混淆、alg:none、过期、错 iss / aud、伪造 kid —— 每一条都出过真实 CVE。
 *
 * 用**真实密钥对**跑,不 mock 验签:mock 掉验签之后,「验签是对的」这句话
 * 就没被证明过。JWKS 端点用一个本地 HTTP 服务器提供,同样不 mock 网络。
 */
import { Context } from '@deepseek-ai/cordis'
import { AuthError } from '@dshwar/auth'
import { InMemorySubjectStore, type SubjectStore } from '@dshwar/subject'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JwtAuth } from '../src/index.ts'

const ISSUER = 'https://idp.acme.example'
const AUDIENCE = 'dshwar'
const SOURCE = 'acme-idp'

let rsa: Awaited<ReturnType<typeof generateKeyPair>>
let hmacSecret: Uint8Array
let jwksServer: Server
let jwksUri: string
/** 当前对外提供的 JWK 集合。测试可以改它来模拟 kid 轮换。 */
let publishedKeys: JWK[] = []

beforeAll(async () => {
  rsa = await generateKeyPair('RS256', { extractable: true })
  hmacSecret = new TextEncoder().encode('a'.repeat(48))

  const jwk = await exportJWK(rsa.publicKey)
  publishedKeys = [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }]

  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ keys: publishedKeys }))
  })
  await new Promise<void>((ready) => jwksServer.listen(0, '127.0.0.1', ready))
  jwksUri = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/jwks`
})

afterAll(async () => {
  await new Promise<void>((done) => jwksServer.close(() => done()))
})

/** 签一个 token。默认签得完全正确,由各用例挑一处改坏。 */
async function sign(
  overrides: {
    sub?: string
    iss?: string
    aud?: string
    kid?: string
    expiresIn?: string
    notBefore?: string
    claims?: Record<string, unknown>
  } = {},
): Promise<string> {
  return new SignJWT({ org_id: 'acme', ...overrides.claims })
    .setProtectedHeader({ alg: 'RS256', kid: overrides.kid ?? 'k1' })
    .setSubject(overrides.sub ?? 'ak-0001')
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setIssuedAt()
    .setNotBefore(overrides.notBefore ?? '0s')
    .setExpirationTime(overrides.expiresIn ?? '5m')
    .sign(rsa.privateKey)
}

let subjects: SubjectStore
let failures: string[]

async function makeAuth(
  overrides: Partial<ConstructorParameters<typeof JwtAuth>[1]> = {},
): Promise<JwtAuth> {
  const ctx = new Context()
  return new JwtAuth(ctx, {
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri,
    source: SOURCE,
    subjects,
    tenantMap: { strategy: 'claim', claim: 'org_id' },
    onFailure: (d) => failures.push(d),
    ...overrides,
  })
}

beforeEach(async () => {
  subjects = new InMemorySubjectStore()
  failures = []
  await subjects.upsert({
    source: SOURCE,
    externalId: 'ak-0001',
    userName: 'alice',
    tenantId: 'acme',
  })
})

describe('正常路径', () => {
  it('签名有效且镜像里在用 → 拿到 principal', async () => {
    const auth = await makeAuth()
    const principal = await auth.verify(await sign())

    expect(principal.tenantId).toBe('acme')
    expect(principal.claims['userName']).toBe('alice')
    expect(failures).toEqual([])
  })

  it('roles 从 token 的 roles claim 取', async () => {
    const auth = await makeAuth()
    const principal = await auth.verify(await sign({ claims: { roles: ['member', 'admin'] } }))
    expect(principal.roles).toEqual(['member', 'admin'])
  })
})

// ★ V0.3.0 的验收标准:身份源侧停用后，下一次请求被拒
describe('验签通过 ≠ 放行', () => {
  it('镜像里被停用 → 拒绝,即使 token 仍然有效', async () => {
    const auth = await makeAuth()
    const token = await sign()

    // 先证明这个 token 本来是好的
    await expect(auth.verify(token)).resolves.toBeDefined()

    const alice = await subjects.getByExternalId(SOURCE, 'ak-0001')
    await subjects.deactivate(alice!.id)

    // 同一个 token,现在必须被拒 —— IdP 侧停用不会让已签发的 token 失效
    await expect(auth.verify(token)).rejects.toBeInstanceOf(AuthError)
    expect(failures.at(-1)).toMatch(/已被停用/)
  })

  it('镜像里根本没有这个人 → 拒绝', async () => {
    const auth = await makeAuth()
    await expect(auth.verify(await sign({ sub: 'never-provisioned' }))).rejects.toBeInstanceOf(
      AuthError,
    )
    expect(failures.at(-1)).toMatch(/不存在/)
  })

  it('另一个 source 推来的同 externalId 不算数', async () => {
    const auth = await makeAuth({ source: 'other-idp' })
    await expect(auth.verify(await sign())).rejects.toBeInstanceOf(AuthError)
  })
})

describe('租户由映射裁决,不信 token 自称', () => {
  it('镜像与本次裁决冲突时拒绝,而不是选一边', async () => {
    // token 说 org_id: globex，但镜像里 alice 属于 acme
    const auth = await makeAuth()
    await expect(auth.verify(await sign({ claims: { org_id: 'globex' } }))).rejects.toBeInstanceOf(
      AuthError,
    )
    expect(failures.at(-1)).toMatch(/租户归属冲突/)
  })

  it('映射不出租户时拒绝(fallback 默认 reject)', async () => {
    const auth = await makeAuth({ tenantMap: { strategy: 'claim', claim: 'missing_claim' } })
    await expect(auth.verify(await sign())).rejects.toBeInstanceOf(AuthError)
    expect(failures.at(-1)).toMatch(/租户映射失败/)
  })

  it('issuer 策略下,租户来自配置表而非 token', async () => {
    const auth = await makeAuth({
      tenantMap: { strategy: 'issuer', issuers: { [ISSUER]: 'acme' } },
    })
    // token 里写着 org_id: globex，但 issuer 策略压根不看它
    const principal = await auth.verify(await sign({ claims: { org_id: 'globex' } }))
    expect(principal.tenantId).toBe('acme')
  })
})

describe('算法:不给 alg 混淆留缝', () => {
  it('构造时就拒绝对称算法', async () => {
    await expect(makeAuth({ algorithms: ['HS256' as never] })).rejects.toThrow(/不允许的算法/)
  })

  it('构造时就拒绝空算法列表', async () => {
    await expect(makeAuth({ algorithms: [] })).rejects.toThrow(/不得为空/)
  })

  it('用公钥当 HMAC 密钥伪造的 token 被拒', async () => {
    const auth = await makeAuth()
    const forged = await new SignJWT({ org_id: 'acme' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject('ak-0001')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(hmacSecret)

    await expect(auth.verify(forged)).rejects.toBeInstanceOf(AuthError)
  })

  it('alg:none 被拒', async () => {
    const auth = await makeAuth()
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')
    const body = Buffer.from(
      JSON.stringify({ sub: 'ak-0001', iss: ISSUER, aud: AUDIENCE, org_id: 'acme' }),
    ).toString('base64url')

    await expect(auth.verify(`${header}.${body}.`)).rejects.toBeInstanceOf(AuthError)
  })
})

describe('标准声明', () => {
  it('过期的 token 被拒', async () => {
    const auth = await makeAuth()
    await expect(auth.verify(await sign({ expiresIn: '-1h' }))).rejects.toBeInstanceOf(AuthError)
  })

  it('尚未生效的 token 被拒', async () => {
    const auth = await makeAuth()
    await expect(auth.verify(await sign({ notBefore: '1h' }))).rejects.toBeInstanceOf(AuthError)
  })

  it('issuer 不匹配被拒 —— 且不做前缀匹配', async () => {
    const auth = await makeAuth()
    await expect(
      auth.verify(await sign({ iss: 'https://idp.evil.example' })),
    ).rejects.toBeInstanceOf(AuthError)
    // 前缀匹配会让 https://idp.acme.example.evil.com 通过
    await expect(auth.verify(await sign({ iss: `${ISSUER}.evil.example` }))).rejects.toBeInstanceOf(
      AuthError,
    )
  })

  it('audience 不匹配被拒', async () => {
    const auth = await makeAuth()
    await expect(auth.verify(await sign({ aud: 'someone-else' }))).rejects.toBeInstanceOf(AuthError)
  })

  it('缺 sub 被拒', async () => {
    const auth = await makeAuth()
    const noSub = await new SignJWT({ org_id: 'acme' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(rsa.privateKey)

    await expect(auth.verify(noSub)).rejects.toBeInstanceOf(AuthError)
    expect(failures.at(-1)).toMatch(/缺少 sub/)
  })

  it('完全不是 JWT 的字符串被拒', async () => {
    const auth = await makeAuth()
    for (const junk of ['', 'not-a-token', 'a.b.c', '....']) {
      await expect(auth.verify(junk), junk).rejects.toBeInstanceOf(AuthError)
    }
  })
})

describe('JWKS', () => {
  it('未知 kid 被拒', async () => {
    const auth = await makeAuth()
    await expect(auth.verify(await sign({ kid: 'no-such-key' }))).rejects.toBeInstanceOf(AuthError)
  })

  it('JWKS 端点连不上时拒绝,而不是放行', async () => {
    // fail open 在认证层是灾难:IdP 抖一下，全世界都能进来
    const auth = await makeAuth({ jwksUri: 'http://127.0.0.1:1/jwks' })
    await expect(auth.verify(await sign())).rejects.toBeInstanceOf(AuthError)
  })
})

describe('AuthError 不携带原因(预言机防护)', () => {
  it('无论哪种失败,错误对象都一模一样', async () => {
    const auth = await makeAuth()
    const cases = [
      await sign({ expiresIn: '-1h' }),
      await sign({ aud: 'wrong' }),
      await sign({ sub: 'never-provisioned' }),
      'not-a-token',
    ]

    const messages = new Set<string>()
    for (const token of cases) {
      await auth.verify(token).catch((e: Error) => messages.add(`${e.name}:${e.message}`))
    }

    // 区分失败原因等于给攻击者一支探针
    expect(messages.size, '不同失败原因产生了可区分的错误').toBe(1)
  })

  it('详细原因走 onFailure,不进错误对象', async () => {
    const auth = await makeAuth()
    await auth.verify(await sign({ sub: 'never-provisioned' })).catch(() => undefined)

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/never-provisioned/)
  })
})

describe('配置错误在启动时炸', () => {
  it('租户映射配置不合法时构造即失败', async () => {
    await expect(makeAuth({ tenantMap: { strategy: 'claim' } })).rejects.toThrow(/需要配置 claim/)
  })
})
