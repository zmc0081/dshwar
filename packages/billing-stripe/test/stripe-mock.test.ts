/**
 * stripe-mock 集成测试 —— 打**官方模拟器**,验证请求形状被一个实现了
 * Stripe 协议的真实服务端接受(D5)。
 *
 * ## 探测式跳过,不读环境变量
 *
 * 探 `localhost:12111`(stripe-mock 默认端口):通就跑,不通就 skip。
 * 不读环境变量 —— CLAUDE.md 的守卫拦 `packages/` 全境的 env 读取
 * (连注释里的字面量都拦,本注释因此不写那七个字符),而这里也确实
 * 不需要:端口是 stripe-mock 的默认约定,CI 与本机都用它。
 *
 * - **CI**:`ci.yml` 的 gate job 挂了 stripe-mock service container,
 *   端口必通 —— 这些测试在 CI **永远真跑**。服务起不来时 GitHub Actions
 *   会直接 fail 整个 job,不存在「服务没起,测试静默 skip」的窗口。
 * - **本机**:`docker run --rm -d -p 12111:12111 stripe/stripe-mock`。
 *   没起就 skip,vitest 输出里看得见 skipped 计数。
 *
 * ## ⚠️ 模拟器不是验证器(2026-08-17 实测)
 *
 * `amount=-5` 它照样 200,业务规则它一概不管。所以这里**只**验证
 * 协议层(认证、编码、响应解析);业务防线的断言在 `gateway.test.ts`
 * (fetch spy,断言拒绝发生在网络之前)。两个文件测两件事,不要合并。
 */
import type { BillingPeriod, Invoice } from '@dshwar/billing'
import { legalEntity } from '@dshwar/billing'
import { describe, expect, it } from 'vitest'
import { StripeGateway } from '../src/index.ts'

const MOCK_URL = 'http://localhost:12111'

/** 探测 stripe-mock 是否在跑。1 秒超时 —— 探测不该拖慢整个套件。 */
async function mockUp(): Promise<boolean> {
  try {
    const res = await fetch(`${MOCK_URL}/v1/charges`, {
      headers: { authorization: 'Bearer sk_test_probe' },
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

const up = await mockUp()

const PERIOD: BillingPeriod = { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' }

function issuedInvoice(): Invoice {
  return {
    id: `inv_mock_${Date.now()}`,
    tenantId: 'acme',
    period: PERIOD,
    currency: 'CNY',
    seller: { legalName: legalEntity('Acme Inc.'), taxId: null, address: null },
    status: 'issued',
    lines: [],
    totalMinor: 3000,
    createdAt: '2026-08-01T00:00:01Z',
    issuedAt: '2026-08-01T00:00:02Z',
  }
}

describe.skipIf(!up)('stripe-mock 集成(未探测到 localhost:12111 时跳过)', () => {
  it('★ createPayment 被真实协议实现接受,拿到 pi_ 句柄与 client_secret', async () => {
    const gw = new StripeGateway({ apiKey: 'sk_test_mock', baseUrl: MOCK_URL })

    const handle = await gw.createPayment(issuedInvoice())

    expect(handle.provider).toBe('stripe')
    expect(handle.externalId).toMatch(/^pi_/)
    expect(handle.clientSecret).toMatch(/secret/)
    expect(handle.status.length).toBeGreaterThan(0)
  })

  it('getPayment 按 id 回查通过', async () => {
    const gw = new StripeGateway({ apiKey: 'sk_test_mock', baseUrl: MOCK_URL })
    const handle = await gw.getPayment('pi_anything')
    expect(handle.externalId.length).toBeGreaterThan(0)
    expect(handle.provider).toBe('stripe')
  })

  it('对照:没有认证头,stripe-mock 也会 401 —— 我们的成功不是白给的', async () => {
    // 这条是上面两条的对照面:证明 mock 真的在验 Authorization,
    // 从而「createPayment 成功」蕴含「认证头接对了」。
    const res = await fetch(`${MOCK_URL}/v1/payment_intents`, {
      method: 'POST',
      body: 'amount=1&currency=cny',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(res.status).toBe(401)
  })
})
