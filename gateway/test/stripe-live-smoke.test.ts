/**
 * Stripe live smoke —— 用**真实 test key** 打真实 Stripe API(D5 第三层)。
 *
 * ## 怎么跑
 *
 * ```bash
 * echo "STRIPE_TEST_KEY=sk_test_..." >> .env    # .env 已在 .gitignore 里
 * pnpm vitest run gateway/test/stripe-live-smoke.test.ts
 * ```
 *
 * 无 key 时本文件被 `vitest.config.ts` 按条件**排除**(与 DEEPSEEK_API_KEY
 * 的 live smoke 同一套机制)—— 不进 `check:all`,不产生永远 skip 的噪音。
 *
 * ⚠️ 只接受 `sk_test_` 前缀。live key 在这里没有任何正当用途 ——
 * 冒烟不需要真钱,而一个写错的 key 前缀不该变成一笔真实扣款。
 *
 * 这里读 `process.env` 是允许的:CLAUDE.md 的 `grep process.env packages/ → 0`
 * 只管 `packages/`,本文件在 `gateway/test/`,先例是 `live-smoke.test.ts`。
 *
 * ## 状态
 *
 * 🟠 **本文件从未在 CI 中运行过**,也不会:它是发布清单上的人工待办
 * (`docs/RELEASE-CHECKLIST.md`),不是自动化门禁。
 */
import type { BillingPeriod, Invoice } from '@dshwar/billing'
import { StripeGateway } from '@dshwar/billing-stripe'
import { describe, expect, it } from 'vitest'

const KEY = process.env['STRIPE_TEST_KEY']

const PERIOD: BillingPeriod = { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' }

describe.skipIf(KEY === undefined || KEY === '')('Stripe live smoke(真实 test 环境)', () => {
  it('拒绝非 test key —— 防手滑,这条在 key 存在时必跑', () => {
    expect(
      KEY!.startsWith('sk_test_'),
      'STRIPE_TEST_KEY 必须是 sk_test_ 前缀 —— live key 不进冒烟',
    ).toBe(true)
  })

  it('创建 + 回查一笔 PaymentIntent(test 模式,无真实资金)', async () => {
    const gw = new StripeGateway({ apiKey: KEY! })
    const invoice: Invoice = {
      id: `inv_smoke_${Date.now()}`,
      tenantId: 'smoke-test',
      period: PERIOD,
      currency: 'usd', // test key 的账户未必开通 CNY;USD 是全账户默认
      status: 'issued',
      lines: [],
      totalMinor: 100, // $1.00 —— test 模式,不产生真实扣款
      createdAt: new Date().toISOString(),
      issuedAt: new Date().toISOString(),
    }

    const created = await gw.createPayment(invoice)
    expect(created.externalId).toMatch(/^pi_/)
    expect(created.clientSecret).toBeDefined()

    const fetched = await gw.getPayment(created.externalId)
    expect(fetched.externalId).toBe(created.externalId)
    expect(fetched.status).toBe(created.status)
  })
})
