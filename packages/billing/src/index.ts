/**
 * `@dshwar/billing` —— 计费契约:计量 → 计费 → 出账。
 *
 * 一句话职责:**把 `@dshwar/metering` 的用量按价格表变成一张状态正确、
 * 金额对得上的发票**。收款不在此 —— 见 `Billing` 类注释的职责表。
 *
 * ## 钱的纪律(全包唯一红线)
 *
 * 金额一律最小货币单位的非负安全整数,字段名以 `Minor` 结尾。
 * 契约里不出现浮点。校验器 {@link assertMinorUnits} 抛而不 round ——
 * round 会把上游的单位错误变成账单里查不出来源的尾差。
 *
 * 实现方:`@dshwar/billing-local`(只记账不收款,开源)。
 * 支付适配器:`@dshwar/billing-stripe`(D4:开源)。
 *
 * @module @dshwar/billing
 */

export { InvalidMinorUnitsError, assertMinorUnits } from './money.ts'
export {
  INVOICE_TRANSITIONS,
  InvoiceStateError,
  canTransition,
  type BillingPeriod,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
} from './invoice.ts'
export { Billing } from './service.ts'
export {
  PaymentNotAllowedError,
  assertPayable,
  type PaymentGateway,
  type PaymentHandle,
} from './gateway.ts'
