/**
 * OfflineFallback 单测 —— 三态语义、连接层判据、缓存、短路。
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OfflineFallback } from '../src/index.ts'

/** 活着的假本地端点(只应答 /v1/models)。 */
let alive: { server: Server; baseUrl: string }

beforeAll(async () => {
  alive = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')
        return
      }
      res.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` })
    })
  })
})

afterAll(() => {
  alive.server.close()
})

const cloudUp = () => vi.fn(async () => new Response(null, { status: 200 }))
const cloudDown = () =>
  vi.fn(async () => {
    throw new TypeError('fetch failed')
  })

function fallback(over: Partial<ConstructorParameters<typeof OfflineFallback>[0]> = {}) {
  return new OfflineFallback({
    cloudProbeUrl: 'https://cloud.example',
    localTarget: { provider: 'local', model: 'qwen3:8b' },
    localBaseUrl: alive.baseUrl,
    ...over,
  })
}

describe('三态', () => {
  it('云端可达 → online', async () => {
    const f = fallback({ fetchImpl: cloudUp() as unknown as typeof fetch })
    expect(await f.decide('deepseek')).toEqual({ kind: 'online' })
  })

  it('★ 云端不可达 + 本地活着 → downgraded,带明确目标', async () => {
    const f = fallback({ fetchImpl: cloudDown() as unknown as typeof fetch })
    expect(await f.decide('deepseek')).toEqual({
      kind: 'downgraded',
      provider: 'local',
      model: 'qwen3:8b',
    })
  })

  it('★ 云端不可达 + 本地也没起 → offline-unavailable(不塌缩成前两态)', async () => {
    const f = fallback({
      fetchImpl: cloudDown() as unknown as typeof fetch,
      localBaseUrl: 'http://127.0.0.1:9/v1',
      probeTimeoutMs: 400,
    })
    expect(await f.decide('deepseek')).toEqual({ kind: 'offline-unavailable' })
  })
})

describe('判据与短路', () => {
  it('★ 云端 500 也算可达 —— 服务器答话了,故障不在网络,降级会掩盖真实故障', async () => {
    const f = fallback({
      fetchImpl: vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    })
    expect(await f.decide('deepseek')).toEqual({ kind: 'online' })
  })

  it('请求的就是本地 provider → 不探测直接 online', async () => {
    const spy = cloudDown()
    const f = fallback({ fetchImpl: spy as unknown as typeof fetch })
    expect(await f.decide('local')).toEqual({ kind: 'online' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('探测结果按 TTL 缓存 —— 断网时不把超时叠满每个请求', async () => {
    let clock = 0
    const spy = cloudDown()
    const f = fallback({
      fetchImpl: spy as unknown as typeof fetch,
      cacheTtlMs: 10_000,
      now: () => clock,
    })

    await f.decide('deepseek')
    clock = 5_000
    await f.decide('deepseek') // TTL 内 —— 不再探测
    expect(spy).toHaveBeenCalledTimes(1)

    clock = 15_000
    await f.decide('deepseek') // TTL 过 —— 重新探测
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('缓存过期后网络恢复 → 回到 online(降级不是棘轮)', async () => {
    let clock = 0
    let down = true
    const f = fallback({
      fetchImpl: vi.fn(async () => {
        if (down) throw new TypeError('fetch failed')
        return new Response(null, { status: 200 })
      }) as unknown as typeof fetch,
      cacheTtlMs: 1_000,
      now: () => clock,
    })

    expect((await f.decide('deepseek')).kind).toBe('downgraded')
    down = false
    clock = 2_000
    expect((await f.decide('deepseek')).kind).toBe('online')
  })
})
