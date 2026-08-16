/**
 * 出站投递。
 *
 * 任务书的三条都在:签名可被第三方独立验证(用 node:crypto 从头实现,
 * 不 import 本包的 verify)、重试耗尽落审计不静默丢弃、端点互不拖累。
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  deliver,
  SIGNATURE_HEADER,
  signPayload,
  TIMESTAMP_HEADER,
  verifySignature,
  WebhookDispatcher,
  type DeliveryFailure,
  type SubjectEvent,
} from '../src/index.ts'

const event: SubjectEvent = {
  type: 'subject.deactivated',
  subjectId: '9:authentikak-0001',
  tenantId: 'acme',
  source: 'authentik',
  at: '2026-08-16T00:00:00.000Z',
}

const noSleep = async (): Promise<void> => undefined

/** 收集请求的假下游。 */
function receiver(statuses: number[]): {
  fetch: typeof globalThis.fetch
  requests: { headers: Record<string, string>; body: string }[]
} {
  const requests: { headers: Record<string, string>; body: string }[] = []
  let call = 0
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    requests.push({
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
      body: String(init?.body),
    })
    call += 1
    return new Response(null, { status: statuses[Math.min(call - 1, statuses.length - 1)] })
  }) as typeof globalThis.fetch
  return { fetch: fetchImpl, requests }
}

describe('签名', () => {
  it('第三方只凭文档描述就能独立验证 —— 不用本包的任何代码', async () => {
    const down = receiver([200])
    await deliver({ url: 'https://downstream.example/hook', secret: 's3cret' }, event, {
      fetch: down.fetch,
      sleep: noSleep,
      onFailure: () => undefined,
    })

    const req = down.requests[0]!
    const timestamp = req.headers[TIMESTAMP_HEADER]!
    const signature = req.headers[SIGNATURE_HEADER]!

    // 文档说的算法:sha256=hex(HMAC-SHA256(secret, `${timestamp}.${body}`))
    // 这里用 node:crypto 从头算,不 import 本包的 verify ——
    // 只有我们自己算得对的签名等于没有签名
    const expected = `sha256=${createHmac('sha256', 's3cret')
      .update(`${timestamp}.${req.body}`)
      .digest('hex')}`

    expect(signature).toBe(expected)
  })

  it('verifySignature 接受正确签名,拒绝篡改的 body', () => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = JSON.stringify(event)
    const signature = signPayload('s3cret', timestamp, body)

    expect(verifySignature({ secret: 's3cret', signature, timestamp, body })).toBe(true)
    expect(
      verifySignature({
        secret: 's3cret',
        signature,
        timestamp,
        body: body.replace('acme', 'evil'),
      }),
    ).toBe(false)
    expect(verifySignature({ secret: 'wrong', signature, timestamp, body })).toBe(false)
  })

  it('超出时间窗的请求即使签名正确也被拒 —— 抗重放的另一半', () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600)
    const body = JSON.stringify(event)
    const signature = signPayload('s3cret', staleTs, body)

    expect(verifySignature({ secret: 's3cret', signature, timestamp: staleTs, body })).toBe(false)
    // 显式放宽窗口则通过 —— 证明拒绝确实来自时间窗
    expect(
      verifySignature({ secret: 's3cret', signature, timestamp: staleTs, body, maxSkewSec: 7200 }),
    ).toBe(true)
  })
})

describe('重试与失败', () => {
  it('瞬时失败后重试成功,不落审计', async () => {
    const down = receiver([500, 200])
    const failures: DeliveryFailure[] = []

    const ok = await deliver({ url: 'https://x.example/h', secret: 's' }, event, {
      fetch: down.fetch,
      sleep: noSleep,
      onFailure: (f) => failures.push(f),
    })

    expect(ok).toBe(true)
    expect(down.requests).toHaveLength(2)
    expect(failures).toEqual([])
  })

  it('重试耗尽 → 落审计,不静默丢弃', async () => {
    const down = receiver([503])
    const failures: DeliveryFailure[] = []

    const ok = await deliver({ url: 'https://x.example/h', secret: 's' }, event, {
      fetch: down.fetch,
      sleep: noSleep,
      retries: 2,
      onFailure: (f) => failures.push(f),
    })

    expect(ok).toBe(false)
    expect(down.requests).toHaveLength(3)
    // 审计是排查「下游为什么没收到」的唯一线索
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ attempts: 3, lastError: 'HTTP 503' })
    expect(failures[0]!.event.type).toBe('subject.deactivated')
  })

  it('连接异常与 HTTP 失败同样计入重试', async () => {
    const failures: DeliveryFailure[] = []
    const explode = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof globalThis.fetch

    const ok = await deliver({ url: 'https://x.example/h', secret: 's' }, event, {
      fetch: explode,
      sleep: noSleep,
      retries: 1,
      onFailure: (f) => failures.push(f),
    })

    expect(ok).toBe(false)
    expect(failures[0]?.attempts).toBe(2)
    expect(failures[0]?.lastError).toMatch(/ECONNREFUSED/)
  })

  it('每次重试都重签 —— 复用首签会让重试在下游看来像重放', async () => {
    const down = receiver([500, 200])
    await deliver({ url: 'https://x.example/h', secret: 's' }, event, {
      fetch: down.fetch,
      sleep: noSleep,
      onFailure: () => undefined,
    })

    // 两次请求的签名头都必须能独立验证(时间戳可能相同,但签名必须对各自的时间戳成立)
    for (const req of down.requests) {
      expect(
        verifySignature({
          secret: 's',
          signature: req.headers[SIGNATURE_HEADER]!,
          timestamp: req.headers[TIMESTAMP_HEADER]!,
          body: req.body,
        }),
      ).toBe(true)
    }
  })
})

describe('多端点分发', () => {
  it('一个下游挂了不拖累其它下游', async () => {
    const calls: string[] = []
    const failures: DeliveryFailure[] = []
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url))
      return new Response(null, { status: String(url).includes('bad') ? 500 : 200 })
    }) as typeof globalThis.fetch

    const dispatcher = new WebhookDispatcher(
      [
        { url: 'https://good.example/h', secret: 'a' },
        { url: 'https://bad.example/h', secret: 'b' },
        { url: 'https://also-good.example/h', secret: 'c' },
      ],
      { fetch: fetchImpl, sleep: noSleep, retries: 0, onFailure: (f) => failures.push(f) },
    )

    const results = await dispatcher.dispatch(event)
    expect(results).toEqual([true, false, true])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.endpoint).toBe('https://bad.example/h')
  })
})
