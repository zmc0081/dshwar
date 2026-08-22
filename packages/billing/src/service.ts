import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { BillingPeriod, Invoice } from './invoice.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 计费服务:用量 → 发票。见 {@link Billing}。 */
    billing: Billing
  }
}

/**
 * 计费契约,注册为 `ctx.billing`。
 *
 * ## 职责边界:出账,不收款
 *
 * 本契约管到「一张状态正确、金额对得上的发票」为止。**怎么把钱收进来**
 * (Stripe Checkout、对公转账、月结)是支付适配器的事 —— 它们收完款调
 * {@link markPaid} 记账,本契约不知道钱走的哪条路。
 *
 * | 关切 | 谁负责 |
 * |---|---|
 * | 用量采集 | `@dshwar/metering`(观测不阻断) |
 * | 用量 × 价格 → 金额 | 本契约的实现方 |
 * | 发票生命周期 | 本契约(状态机见 `invoice.ts`) |
 * | 真实收款 | `@dshwar/billing-stripe` 等适配器(V0.6.0 Session 2) |
 * | 托管收款服务 | `billing-hosted`(闭源,不在本仓) |
 *
 * ## 所有接口都以 tenantId 开头
 *
 * 与 audit / metering 同一条理由:可选的租户过滤总有一天被忘掉,
 * 而计费数据跨租户泄漏等于把 A 公司的账单摊在 B 公司桌上。
 * 本契约不从 ctx 读 principal —— 调用方(网关)完成认证与租户裁决后
 * 显式传入,与 V0.5.5 工作台各服务的做法一致。
 *
 * ## 钱的纪律
 *
 * 全部金额字段是最小货币单位的非负安全整数(见 `money.ts`)。
 * 实现方在返回发票前必须对每个金额字段过一遍 `assertMinorUnits` ——
 * 宁可炸在出账,不要把浮点写进账本。
 */
export abstract class Billing extends Service {
  constructor(ctx: Context) {
    super(ctx, 'billing')
  }

  /**
   * 为一个租户生成(或取回)一个计费周期的发票。
   *
   * **幂等**:同一 (tenantId, period) 已存在非 void 发票时返回既有发票,
   * 不重复生成 —— 出两张账单比不出账单更糟,客户会同时收到并各付一张。
   * 要重出账,先 {@link voidInvoice} 旧的。
   *
   * 返回的发票是 `draft`:金额算好但未定稿,重新生成(void 后)可以反映
   * 迟到的用量记录;`issued` 之后金额冻结。
   *
   * ## ★ 卖方未配置时**必须拒绝出票**(实现方的义务)
   *
   * 抛 {@link SellerNotConfiguredError},**不得**返回一张卖方栏为空
   * 或填着占位符的发票。
   *
   * ⚠️ 这条区别不是措辞:一张卖方栏空白的发票流进会计系统,会被当成
   * **数据错误**处理 —— 它会进对账差异、进人工核查队列,而**不会**被
   * 报成一个配置错误。等有人查到根因时,已经离配置文件很远了。
   *
   * **拒绝发生在我们这边;静默降级的后果发生在客户的会计那边。**
   *
   * @throws {SellerNotConfiguredError} 卖方未配置
   */
  abstract generateInvoice(tenantId: string, period: BillingPeriod): Promise<Invoice>

  /** 取单张发票。查不到返回 undefined —— 「没有这张发票」是正常业务状态,不抛。 */
  abstract getInvoice(tenantId: string, invoiceId: string): Promise<Invoice | undefined>

  /** 该租户全部发票,按 createdAt 降序(最近的先看到)。 */
  abstract listInvoices(tenantId: string): Promise<Invoice[]>

  /**
   * 定稿:draft → issued。金额自此冻结,迟到的用量进下一期。
   * @throws {InvoiceStateError} 当前状态不允许
   */
  abstract issueInvoice(tenantId: string, invoiceId: string): Promise<Invoice>

  /**
   * 记账收款:issued → paid。
   *
   * ⚠️ 这是**记账**动作,不是收款动作 —— 调用方(支付适配器的 webhook、
   * 或人工核对对公转账的运营)负责确认钱真的到了。本方法不验证 paymentRef,
   * 只把它原样落进**发票**。
   *
   * ⚠️ **审计由调用方在本方法成功返回后写,不在这里。** 本契约不从 ctx 读
   * 任何东西(见类注释「租户由调用方显式传入」),因此拿不到 AuditSink ——
   * 它做不到自己记审计。Stripe 那条通路的接缝是 `@dshwar/billing-stripe`
   * 的 `ProcessInput.onApplied`,网关在 `registerStripeWebhook` 处接进 AuditSink。
   *
   * 这句话在 V0.8.0 之前写的是「原样落进发票**与审计**」,而三个 billing 包里
   * 一次审计写入都没有 —— 已兑现的前半句掩护了未兑现的后半句。
   * 改成现在这样之后,它描述的是**真实的分工**,而不是一个没人负责的承诺。
   *
   * @param paymentRef 外部凭证:支付网关的事件/意图 id,或线下转账的备注号
   * @throws {InvoiceStateError} 当前状态不允许(draft 不能直接 paid;paid 是终态)
   */
  abstract markPaid(tenantId: string, invoiceId: string, paymentRef: string): Promise<Invoice>

  /**
   * 作废:draft | issued → void。paid 不可作废 —— 已收的钱要退走退款流程,
   * 那是另一笔账,不是抹掉这笔。
   * @throws {InvoiceStateError} 当前状态不允许
   */
  abstract voidInvoice(tenantId: string, invoiceId: string): Promise<Invoice>
}
