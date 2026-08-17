/**
 * `@dshwar/billing-stripe` —— Stripe 支付适配器。
 *
 * ## 本包开源(D4,2026-08)
 *
 * 原定闭源,后裁决改为开源:支付适配器没有护城河价值,闭源它等于让
 * 自建者收不了钱,直接违背「开源用户拿到可用的完整基座」。闭源只剩
 * 托管收款服务 `billing-hosted`(不在本仓)。
 *
 * ## 测试策略(D5)
 *
 * | 层 | 打谁 | 进 `check:all`? |
 * | --- | --- | --- |
 * | 单测 | 注入的 fetch spy | ✅ 永远跑 |
 * | 集成 | 官方 stripe-mock(`localhost:12111`) | ✅ 探测到才跑,探不到显式 skip |
 * | live smoke | 真实 test key(`gateway/test/stripe-live-smoke.test.ts`) | ❌ 无 key 自动 skip |
 *
 * @module @dshwar/billing-stripe
 */

export { StripeGateway, StripeGatewayError, type StripeGatewayOptions } from './gateway.ts'
