/**
 * 支付相关的线上契约(V0.6.0)。
 *
 * 目前只有一个端点:Stripe webhook 的接收口。发票的查询与管理端点
 * 属于后续版本 —— 收款闭环(webhook → markPaid)先立起来,
 * 查询是控制台的事,不阻塞钱。
 */
import { z } from 'zod'

/**
 * webhook 的确认响应。
 *
 * `outcome` 面向**运维排查**,不面向 Stripe —— Stripe 只看状态码。
 * `duplicate` / `already-paid` 都是 2xx:幂等成功必须让 Stripe 停止重试,
 * 把它们做成错误码的系统都经历过「一个事件重试了三天」。
 */
export const WebhookAck = z.object({
  received: z.literal(true),
  outcome: z.enum(['applied', 'duplicate', 'already-paid', 'ignored']),
  // Stripe 不读它,但排查读:Stripe 后台展示的响应体里带上 requestId,
  // 「某次投递发生了什么」就能对到我们的日志 —— 与全 API 同一条横切约定
  requestId: z.string(),
})
export type WebhookAck = z.infer<typeof WebhookAck>

/**
 * Stripe 事件体 —— **刻意宽松**。
 *
 * 这个形状由 Stripe 定义并随其 API 版本演进,DSHWAR 校验它没有意义:
 * 真正的准入判据是**签名**(不是 schema),而验签必须发生在原始字节上、
 * 在任何解析之前。这里只声明路由消费的两个字段,其余透传。
 */
export const StripeWebhookEventBody = z.looseObject({
  id: z.string(),
  type: z.string(),
})
export type StripeWebhookEventBody = z.infer<typeof StripeWebhookEventBody>
