/**
 * OIDC 接入。
 *
 * 本包只做 discovery 解析,验签交给 auth-jwt —— 所以这里测的是
 * 「解析对不对」与「解析出的配置有没有把安全约束传下去」,
 * 不重复测验签(那是 auth-jwt 的测试)。
 *
 * 但最后有一条端到端:对着真实的 discovery + JWKS 走一次完整认证,
 * 证明两个包接得上。只测拼装不测接合,是最容易假绿的写法。
 */
import { Context } from '@deepseek-ai/cordis'
import { InMemorySubjectStore, type SubjectStore } from '@dshwar/subject'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createOidcAuth,
  discoveryUrl,
  fetchDiscovery,
  OidcDiscoveryError,
  toJwtConfig,
  type OidcAuthConfig,
} from '../src/index.ts'

let idp: Server
let issuer: string
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>
/** 测试可以改它来模拟各种残缺的 discovery 文档。 */
let discoveryDoc: Record<string, unknown>

beforeAll(async () => {
  keyPair = await generateKeyPair('RS256', { extractable: true })
  const jwk = await exportJWK(keyPair.publicKey)

  idp = createServer((req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url === '/.well-known/openid-configuration') return json(discoveryDoc)
    if (req.url === '/jwks')
      return json({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] })
    if (req.url === '/not-json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end('this is not json')
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((ready) => idp.listen(0, '127.0.0.1', ready))
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((done) => idp.close(() => done()))
})

let subjects: SubjectStore

beforeEach(async () => {
  subjects = new InMemorySubjectStore()
  await subjects.upsert({
    source: 'acme-idp',
    externalId: 'ak-0001',
    userName: 'alice',
    tenantId: 'acme',
  })
  discoveryDoc = {
    issuer: '',
    jwks_uri: '',
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
  }
})

/** 让 discovery 指向当前这台测试服务器。 */
function useIssuer(overrides: Record<string, unknown> = {}): void {
  discoveryDoc = {
    issuer,
    jwks_uri: `${issuer}/jwks`,
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    ...overrides,
  }
}

const baseConfig = (): Omit<OidcAuthConfig, 'issuer'> => ({
  audience: 'dshwar',
  source: 'acme-idp',
  subjects,
  tenantMap: { strategy: 'claim', claim: 'org_id' },
})

describe('discoveryUrl', () => {
  it('拼出标准路径', () => {
    expect(discoveryUrl('https://idp.example')).toBe(
      'https://idp.example/.well-known/openid-configuration',
    )
  })

  it('issuer 末尾有没有斜杠都能用', () => {
    // 各家 IdP 的写法不一致，这不该是部署方的负担
    expect(discoveryUrl('https://idp.example/')).toBe(discoveryUrl('https://idp.example'))
    expect(discoveryUrl('https://idp.example///')).toBe(discoveryUrl('https://idp.example'))
  })
})

describe('fetchDiscovery', () => {
  it('取到并解析出 issuer 与 jwks_uri', async () => {
    useIssuer()
    const doc = await fetchDiscovery(issuer)
    expect(doc.issuer).toBe(issuer)
    expect(doc.jwks_uri).toBe(`${issuer}/jwks`)
  })

  // 缺字段时立刻报错，而不是"先跑起来，用到时再说"
  it('缺 jwks_uri 立刻报错,并说清为什么', async () => {
    useIssuer({ jwks_uri: undefined })
    await expect(fetchDiscovery(issuer)).rejects.toBeInstanceOf(OidcDiscoveryError)
    await expect(fetchDiscovery(issuer)).rejects.toThrow(/jwks_uri/)
    await expect(fetchDiscovery(issuer)).rejects.toThrow(/永远无法验签/)
  })

  it('缺 issuer 立刻报错', async () => {
    useIssuer({ issuer: undefined })
    await expect(fetchDiscovery(issuer)).rejects.toThrow(/issuer/)
  })

  it('空字符串的字段等同于缺失', async () => {
    useIssuer({ jwks_uri: '   ' })
    await expect(fetchDiscovery(issuer)).rejects.toThrow(/jwks_uri/)
  })

  // OIDC Discovery 1.0 §4.3：不一致意味着配错了 URL，或者中间有人换掉了文档
  it('discovery 声明的 issuer 与配置不一致时拒绝', async () => {
    useIssuer({ issuer: 'https://someone-else.example' })
    await expect(fetchDiscovery(issuer)).rejects.toThrow(/不一致/)
  })

  it('末尾斜杠的差异不算不一致', async () => {
    useIssuer()
    await expect(fetchDiscovery(`${issuer}/`)).resolves.toBeDefined()
  })

  it('连不上时给出可读错误', async () => {
    await expect(fetchDiscovery('http://127.0.0.1:1')).rejects.toBeInstanceOf(OidcDiscoveryError)
  })

  it('HTTP 非 2xx 时给出状态码', async () => {
    await expect(fetchDiscovery(`${issuer}/nope`)).rejects.toThrow(/HTTP 404/)
  })

  it('不是合法 JSON 时给出可读错误', async () => {
    const notJson = async (): Promise<Response> =>
      new Response('this is not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    await expect(fetchDiscovery(issuer, notJson as never)).rejects.toThrow(/不是合法 JSON/)
  })
})

describe('toJwtConfig —— 算法协商只会变小', () => {
  it('取 discovery 声明的与我们允许的交集', () => {
    const config = toJwtConfig(
      {
        issuer: 'https://x.example',
        jwks_uri: 'https://x.example/jwks',
        id_token_signing_alg_values_supported: ['RS256', 'HS256', 'ES256', 'none'],
      },
      { issuer: 'https://x.example', ...baseConfig() },
    )
    // IdP 声明支持 HS256 是它的事，我们不会因此接受它
    expect(config.algorithms).toEqual(['RS256', 'ES256'])
  })

  it('显式配置的算法优先于协商', () => {
    const config = toJwtConfig(
      {
        issuer: 'https://x.example',
        jwks_uri: 'https://x.example/jwks',
        id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      },
      { issuer: 'https://x.example', ...baseConfig(), algorithms: ['ES256'] },
    )
    expect(config.algorithms).toEqual(['ES256'])
  })

  it('IdP 只声明对称算法时直接拒绝', () => {
    expect(() =>
      toJwtConfig(
        {
          issuer: 'https://x.example',
          jwks_uri: 'https://x.example/jwks',
          id_token_signing_alg_values_supported: ['HS256', 'HS512'],
        },
        { issuer: 'https://x.example', ...baseConfig() },
      ),
    ).toThrow(/没有任何非对称算法/)
  })

  it('discovery 没声明算法时不设限,交给 auth-jwt 的默认白名单', () => {
    const config = toJwtConfig(
      { issuer: 'https://x.example', jwks_uri: 'https://x.example/jwks' },
      { issuer: 'https://x.example', ...baseConfig() },
    )
    expect(config.algorithms).toBeUndefined()
  })
})

// 只测拼装不测接合，是最容易假绿的写法
describe('端到端:两个包真的接得上', () => {
  it('只填一个 issuer URL 就能完成一次认证', async () => {
    useIssuer()
    const auth = await createOidcAuth(new Context(), { issuer, ...baseConfig() })

    const token = await new SignJWT({ org_id: 'acme' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('ak-0001')
      .setIssuer(issuer)
      .setAudience('dshwar')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keyPair.privateKey)

    const principal = await auth.verify(token)
    expect(principal.tenantId).toBe('acme')
    expect(principal.claims['userName']).toBe('alice')
  })

  it('停用后同一个 token 被拒 —— 安全约束确实传下去了', async () => {
    useIssuer()
    const auth = await createOidcAuth(new Context(), { issuer, ...baseConfig() })
    const token = await new SignJWT({ org_id: 'acme' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('ak-0001')
      .setIssuer(issuer)
      .setAudience('dshwar')
      .setExpirationTime('5m')
      .sign(keyPair.privateKey)

    await expect(auth.verify(token)).resolves.toBeDefined()

    const alice = await subjects.getByExternalId('acme-idp', 'ak-0001')
    await subjects.deactivate(alice!.id)

    await expect(auth.verify(token)).rejects.toThrow(/authentication failed/)
  })

  it('discovery 不可用时构造就失败,而不是起来之后每个人都进不去', async () => {
    await expect(
      createOidcAuth(new Context(), { issuer: 'http://127.0.0.1:1', ...baseConfig() }),
    ).rejects.toBeInstanceOf(OidcDiscoveryError)
  })
})
