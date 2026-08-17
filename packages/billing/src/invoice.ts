/**
 * 发票模型:计量 → 计费 → 出账 的「出账」一端。
 *
 * 状态机刻意小:
 *
 * ```
 * draft ──issue──▶ issued ──markPaid──▶ paid
 *   │                │
 *   └───void─────────┘          (paid 是终态,不可 void —— 已收的钱
 *                                要退走退款流程,那是另一笔账,不是抹掉这笔)
 * ```
 *
 * 没有 `overdue` / `partial` / `refunded`:它们各自都是真实需求,但每加一个
 * 状态,所有消费方(网关、控制台、支付适配器)都要多处理一个分支。
 * V0.6.0 先把最小闭环立住,扩状态是相容变更(enum 加值,消费方按未知值兜底)。
 */

/** 发票状态。 */
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void'

/** 合法的状态迁移表 —— 判据的唯一实现,消费方不要自己写 if。 */
export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ['issued', 'void'],
  issued: ['paid', 'void'],
  paid: [],
  void: [],
}

/** 计费周期。半开区间 `[start, end)`,ISO 8601 UTC —— 月账单的 end 是下月一号零点。 */
export interface BillingPeriod {
  readonly start: string
  readonly end: string
}

/**
 * 一行账目:某主体在某模型上的用量与金额。
 *
 * 粒度定在 (subjectId, provider, model):再粗(只到模型)客户问「这钱谁花的」
 * 答不上来;再细(逐日)发票就成了流水 —— 流水走 `/v1/admin/usage`,发票是汇总。
 */
export interface InvoiceLine {
  readonly subjectId: string
  readonly provider: string
  readonly model: string
  /** 计费输入 token(billedInputTokens 口径:未命中缓存 + 缓存读 + 缓存写)。 */
  readonly inputTokens: number
  readonly outputTokens: number
  /** 该行金额,最小货币单位整数。**每行只 round 一次**,行内不累加已舍入的中间值。 */
  readonly amountMinor: number
}

/** 一张发票。 */
export interface Invoice {
  readonly id: string
  readonly tenantId: string
  readonly period: BillingPeriod
  readonly currency: string
  readonly status: InvoiceStatus
  readonly lines: readonly InvoiceLine[]
  /** 全部行金额之和。整数加法,无舍入。 */
  readonly totalMinor: number
  /** ISO 8601,生成时刻。 */
  readonly createdAt: string
  /** issue 时刻;draft 阶段为 undefined。 */
  readonly issuedAt?: string
  /** 支付完成时刻与外部凭证号(支付网关的 id 或线下转账备注)。 */
  readonly paidAt?: string
  readonly paymentRef?: string
}

/** 非法状态迁移。业务错误 —— 调用方可以据此给用户可读提示。 */
export class InvoiceStateError extends Error {
  constructor(invoiceId: string, from: InvoiceStatus, to: InvoiceStatus) {
    super(
      `发票 ${invoiceId} 不能从 ${from} 迁移到 ${to}。合法迁移:${
        INVOICE_TRANSITIONS[from].length === 0
          ? `${from} 是终态`
          : `${from} → ${INVOICE_TRANSITIONS[from].join(' | ')}`
      }`,
    )
    this.name = 'InvoiceStateError'
  }
}

/** 迁移是否合法 —— 消费方与实现方共用这一个判据。 */
export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to)
}
