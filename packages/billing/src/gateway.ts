/**
 * 支付网关接缝 —— 「出账」与「收款」之间的那条线。
 *
 * `Billing` 管到一张 `issued` 的发票为止;把钱收进来的通道(Stripe、
 * 微信、支付宝、对公转账)各自实现本接口。收到钱之后调
 * `Billing.markPaid` 记账 —— 账本不知道钱走的哪条路,这是刻意的。
 */
import { assertMinorUnits } from './money.ts'
import type { Invoice } from './invoice.ts'

/** 一次支付的句柄:外部系统里那笔支付的引用。 */
export interface PaymentHandle {
  /** 通道名:`stripe` / `wechat` / …。审计与对账用。 */
  readonly provider: string
  /** 外部系统的 id(Stripe 的 `pi_…`)。回查与幂等的锚点。 */
  readonly externalId: string
  /**
   * 通道的原生状态,**契约不翻译**(Stripe 是 `requires_payment_method` /
   * `succeeded` 等)。翻译成统一词表意味着每接一个通道都要维护一张映射,
   * 而映射错一格就是「显示已支付实际没到账」。消费方要判断「是否已收到钱」,
   * 唯一可信的信号是 webhook 之后的 `Invoice.status === 'paid'`,不是这个字段。
   */
  readonly status: string
  /** 前端拉起支付所需的密钥(Stripe 的 client_secret)。没有交互流程的通道为 undefined。 */
  readonly clientSecret?: string
}

/** 对不可收款的发票发起支付。业务错误,信息里写明原因与出路。 */
export class PaymentNotAllowedError extends Error {
  constructor(invoiceId: string, reason: string) {
    super(`发票 ${invoiceId} 不能发起支付:${reason}`)
    this.name = 'PaymentNotAllowedError'
  }
}

/**
 * 「这张发票现在能收钱吗」的唯一判据 —— 所有通道适配器共用,
 * 不要在各自的 createPayment 里重写这段 if。
 *
 * - `draft` 没定稿:金额还会变,收了钱账对不上
 * - `paid` 已收讫:再收一次是重复扣款
 * - `void` 已作废
 * - 金额为 0:无须收款,直接 `markPaid` 即可 —— 让 0 元走支付通道,
 *   有的通道直接拒绝(Stripe 就是),有的会真的发起一笔 0 元交易
 */
export function assertPayable(invoice: Invoice): void {
  if (invoice.status !== 'issued') {
    throw new PaymentNotAllowedError(
      invoice.id,
      `状态是 ${invoice.status},只有 issued(已定稿)的发票能收款`,
    )
  }
  assertMinorUnits(invoice.totalMinor, `invoice(${invoice.id}).totalMinor`)
  if (invoice.totalMinor === 0) {
    throw new PaymentNotAllowedError(
      invoice.id,
      '金额为 0,无须走支付通道 —— 直接 markPaid 记账即可',
    )
  }
}

/**
 * 支付通道契约。实现方:`@dshwar/billing-stripe`(开源,D4)。
 *
 * 实现方职责:
 * 1. `createPayment` 前**必须**过 {@link assertPayable} —— 判据只有一份
 * 2. 以 `invoice.id` 做幂等键:网络重试不得产生第二笔支付
 * 3. 错误信息里**永不**包含 API key 或任何凭据
 */
export interface PaymentGateway {
  /** 为一张 issued 的发票在外部系统创建支付。 */
  createPayment(invoice: Invoice): Promise<PaymentHandle>
  /** 回查一笔支付的当前状态。 */
  getPayment(externalId: string): Promise<PaymentHandle>
}
