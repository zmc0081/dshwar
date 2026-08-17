import type { Context } from '@deepseek-ai/cordis'
import {
  Billing,
  InvoiceStateError,
  assertMinorUnits,
  canTransition,
  type BillingPeriod,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
} from '@dshwar/billing'
import {
  billedInputTokens,
  type MeteringStore,
  type PriceTable,
  type RawUsage,
} from '@dshwar/metering'
import { randomUUID } from 'node:crypto'
import type { InvoiceStore } from './store.ts'

export interface LocalBillingOptions {
  /** 用量来源。出账时按周期过滤其明细。 */
  readonly metering: MeteringStore
  /** 价格表。查不到价的模型计 0 —— 是「没配价」不是「免费」,见 metering 的说明。 */
  readonly prices: PriceTable
  /** 发票落哪。 */
  readonly invoices: InvoiceStore
  /** 时钟注入,测试用。默认真实时间。 */
  readonly now?: () => string
}

/**
 * `@dshwar/billing` 的本地实现:**只记账不收款**。
 *
 * 「只记账」的含义:它出的发票、记的支付,都只是**账本状态** ——
 * 没有任何代码路径会触碰真实的资金渠道。`markPaid` 相信调用方
 * (支付适配器或人工核账)已经确认了钱,自己只负责把状态与凭证号写对。
 *
 * ## 金额计算的舍入纪律
 *
 * 每行:先把整个周期的 token **整数累加**,再乘价格、除 1e6、round ——
 * **一行只 round 一次**。不复用 `aggregateDaily` 的行金额正是因为它按日
 * round:30 个已舍入日值相加,与整期一次 round,能差出几分钱 ——
 * 几分钱不多,但「发票对不上用量页」这件事本身就是客诉。
 */
export class LocalBilling extends Billing {
  private readonly options: LocalBillingOptions

  constructor(ctx: Context, options: LocalBillingOptions) {
    super(ctx)
    this.options = options
  }

  override async generateInvoice(tenantId: string, period: BillingPeriod): Promise<Invoice> {
    // 幂等:同一周期已有非 void 发票 → 返回既有的,不重复出账
    const existing = (await this.options.invoices.listByTenant(tenantId)).find(
      (i) => i.status !== 'void' && i.period.start === period.start && i.period.end === period.end,
    )
    if (existing !== undefined) return existing

    const records = (await this.options.metering.query({ tenantId })).filter(
      // 半开区间 [start, end):ISO 8601 UTC 的字典序即时间序
      (r) => r.at >= period.start && r.at < period.end,
    )

    const invoice: Invoice = {
      id: `inv_${randomUUID()}`,
      tenantId,
      period,
      currency: this.options.prices.currency,
      status: 'draft',
      lines: this.rateLines(records),
      totalMinor: 0,
      createdAt: (this.options.now ?? (() => new Date().toISOString()))(),
    }
    // 总额 = 行金额的整数加法,无舍入;边界上过一遍金额纪律
    const total = invoice.lines.reduce(
      (sum, line) => sum + assertMinorUnits(line.amountMinor, `line(${line.model}).amountMinor`),
      0,
    )
    const finalized = { ...invoice, totalMinor: assertMinorUnits(total, 'totalMinor') }

    await this.options.invoices.put(finalized)
    return finalized
  }

  override async getInvoice(tenantId: string, invoiceId: string): Promise<Invoice | undefined> {
    return this.options.invoices.get(tenantId, invoiceId)
  }

  override async listInvoices(tenantId: string): Promise<Invoice[]> {
    const all = await this.options.invoices.listByTenant(tenantId)
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  override async issueInvoice(tenantId: string, invoiceId: string): Promise<Invoice> {
    return this.transition(tenantId, invoiceId, 'issued', (i) => ({
      ...i,
      status: 'issued' as const,
      issuedAt: (this.options.now ?? (() => new Date().toISOString()))(),
    }))
  }

  override async markPaid(
    tenantId: string,
    invoiceId: string,
    paymentRef: string,
  ): Promise<Invoice> {
    return this.transition(tenantId, invoiceId, 'paid', (i) => ({
      ...i,
      status: 'paid' as const,
      paidAt: (this.options.now ?? (() => new Date().toISOString()))(),
      paymentRef,
    }))
  }

  override async voidInvoice(tenantId: string, invoiceId: string): Promise<Invoice> {
    return this.transition(tenantId, invoiceId, 'void', (i) => ({ ...i, status: 'void' as const }))
  }

  /** 状态迁移的唯一通路:查 → 验迁移表 → 变换 → 落盘。 */
  private async transition(
    tenantId: string,
    invoiceId: string,
    to: InvoiceStatus,
    apply: (invoice: Invoice) => Invoice,
  ): Promise<Invoice> {
    const invoice = await this.options.invoices.get(tenantId, invoiceId)
    if (invoice === undefined) {
      // 查不到就抛 —— 迁移接口与 getInvoice 不同,调用方已经拿着 id,
      // 「id 失效」对它是异常而不是正常分支
      throw new InvoiceStateError(invoiceId, 'void', to)
    }
    if (!canTransition(invoice.status, to)) {
      throw new InvoiceStateError(invoiceId, invoice.status, to)
    }
    const next = apply(invoice)
    await this.options.invoices.put(next)
    return next
  }

  /**
   * 明细 → 发票行。分桶 (subjectId, provider, model),整期 token 整数累加,
   * 每行 round 一次。
   */
  private rateLines(records: readonly RawUsage[]): InvoiceLine[] {
    const buckets = new Map<
      string,
      { subjectId: string; provider: string; model: string; input: number; output: number }
    >()
    for (const r of records) {
      const key = `${r.subjectId}|${r.provider}|${r.model}`
      const prev = buckets.get(key) ?? {
        subjectId: r.subjectId,
        provider: r.provider,
        model: r.model,
        input: 0,
        output: 0,
      }
      buckets.set(key, {
        ...prev,
        input: prev.input + billedInputTokens(r.usage),
        output: prev.output + r.usage.outputTokens,
      })
    }

    return (
      [...buckets.values()]
        .map((b) => {
          const price = this.options.prices.prices[`${b.provider}/${b.model}`]
          const amount =
            price === undefined
              ? 0
              : Math.round(
                  (b.input * price.inputPerMTokenMinor + b.output * price.outputPerMTokenMinor) /
                    1_000_000,
                )
          return {
            subjectId: b.subjectId,
            provider: b.provider,
            model: b.model,
            inputTokens: b.input,
            outputTokens: b.output,
            amountMinor: amount,
          }
        })
        // 稳定排序:金额降序(大头先看到),同额按主体 —— 发票是给人看的
        .sort((a, b) =>
          a.amountMinor === b.amountMinor
            ? a.subjectId.localeCompare(b.subjectId)
            : b.amountMinor - a.amountMinor,
        )
    )
  }
}
