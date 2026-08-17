/**
 * `@dshwar/billing-local` —— 计费契约的本地实现:**只记账不收款**。
 *
 * 开源边界(CLAUDE.md 第八节):本包开源,是「开源用户拿到可用的完整基座」
 * 的一部分 —— 自建者用它出账,配合 `@dshwar/billing-stripe`(同样开源,D4)
 * 收款;闭源的只有托管收款服务 `billing-hosted`。
 *
 * @module @dshwar/billing-local
 */

export { LocalBilling, type LocalBillingOptions } from './service.ts'
export {
  INVOICE_TABLE,
  InMemoryInvoiceStore,
  KvInvoiceStore,
  type InvoiceStore,
  type KvUnitLike,
} from './store.ts'
