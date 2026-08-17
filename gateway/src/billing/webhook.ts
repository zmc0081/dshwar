/**
 * Stripe webhook 的 HTTP 端点 —— 契约 `POST /v1/billing/webhooks/stripe`。
 *
 * ## 鉴权模型与其它 /v1 端点不同,但结论相同
 *
 * 调用方是 Stripe,不持有 Bearer;凭证是 **Stripe-Signature 头**。
 * 验签失败统一 401 **不带原因** —— 与 `@dshwar/auth` 的 AuthError 同一条
 * 纪律:认证接口是预言机,区分「签名错」「过期」「没配 secret」等于
 * 给攻击者一支探针。详细原因(`WebhookVerificationError.reason`)只进
 * 服务端日志与审计。
 *
 * 于是 auth-coverage 的遍历断言(每个 /v1 端点无凭证 401)对本端点
 * **自然成立**,不需要豁免 —— 无签名头就是无凭证。
 *
 * ## 为什么读原始 body
 *
 * 签名盖住的是**原始字节**。任何「先解析、后序列化」都会破坏它 ——
 * 所以 handler 用 `c.req.text()`,解析发生在验签之后(billing-stripe 内)。
 */
import type { Hono } from 'hono'
import type { Billing } from '@dshwar/billing'
import type { GatewayEnv } from '../middleware.ts'
import {
  WebhookVerificationError,
  processStripeEvent,
  verifyStripeSignature,
  type ProcessedEventStore,
} from '@dshwar/billing-stripe'
import { unauthorized } from '../errors.ts'

export interface StripeWebhookOptions {
  /** endpoint secret(`whsec_…`)。经部署方凭据通道注入,不落配置文件。 */
  readonly secret: string
  readonly billing: Billing
  readonly processed: ProcessedEventStore
  /**
   * 验签失败的通报(落审计用)。拒绝不能只是拒绝 —— 打到这个端点的
   * 伪造请求是安全信号,值得被看见。
   */
  readonly onRejected?: (reason: string) => void
}

/** 把 webhook 端点挂到 app 上。 */
export function registerStripeWebhook(options: StripeWebhookOptions) {
  return (app: Hono<GatewayEnv>): void => {
    app.post('/v1/billing/webhooks/stripe', async (c) => {
      const payload = await c.req.text()
      let event
      try {
        event = verifyStripeSignature({
          payload,
          header: c.req.header('stripe-signature') ?? null,
          secret: options.secret,
        })
      } catch (cause) {
        if (cause instanceof WebhookVerificationError) {
          options.onRejected?.(cause.message)
          // 统一 401,无原因 —— reason 只进日志与审计
          throw unauthorized()
        }
        throw cause
      }

      const outcome = await processStripeEvent({
        event,
        billing: options.billing,
        processed: options.processed,
      })
      return c.json({ received: true, outcome, requestId: c.get('requestId') }, 200)
    })
  }
}

/**
 * 未配置支付时的兜底:同一路径,一律 401。
 *
 * 为什么不是「不挂路由」:契约里宣告了这个路径,不挂就是 404 ——
 * 而 404 会告诉探测者「这个部署没接支付」。fail closed 的形状是
 * 「无论配没配,没有有效签名就是 401」,配没配从外面看不出来。
 * (auth-coverage 的遍历断言也依赖这一点:它构造的网关没配支付。)
 */
export function stripeWebhookFailClosed() {
  return (app: Hono<GatewayEnv>): void => {
    app.post('/v1/billing/webhooks/stripe', () => {
      throw unauthorized()
    })
  }
}
