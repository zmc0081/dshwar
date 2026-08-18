import type { Context } from '@deepseek-ai/cordis'
import {
  Billing,
  InvoiceStateError,
  assertMinorUnits,
  assertSellerConfigured,
  canTransition,
  type InvoiceSeller,
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

/**
 * 卖方配置的位置,进错误信息。
 *
 * 错误信息里指出**去哪配**,是这条断言价值的一半 —— 另一半是拒绝本身。
 * 只说「未配置卖方」而不说去哪配,排查的人还得先找一遍。
 */
const SELLER_CONFIG_PATH =
  'gateway.config.json 的 governance.billing.seller,或程序化装配时 LocalBilling 的 options.seller'

export interface LocalBillingOptions {
  /**
   * 开票主体。**必填** —— 见类注释「为什么卖方拦在装配期」。
   *
   * ⚠️ 类型上必填只挡得住**程序化装配**;配置文件驱动的那条路
   * (JSON 反序列化)类型是被擦掉的,由构造函数的运行时断言兜住。
   */
  readonly seller: InvoiceSeller
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
 *
 * ## ★ 为什么卖方拦在**装配期**,而不是等到出票
 *
 * 这一档(开源自建)的卖方**天然是自建者自己** —— `billing-stripe` 开源之后
 * 他用的是自己的 Stripe 账号,钱进他的账户。所以「未配置」在这一档
 * **不是一个待定的业务选择,是纯粹的配置遗漏**,与逻辑档 + 多用户身份
 * 那条闸门同级(`assertSinglePrincipalCapable`)。
 *
 * **判据是「装了这个插件的人,意图是什么」**:`LocalBilling` 的全部方法都是
 * 发票 —— 只想看用量不出账的人根本不装它(走 `@dshwar/metering` 的
 * `summarizeLocalUsage` 就够)。⇒ 装了它 = 打算出票 = 卖方是必需配置。
 *
 * ⚠️ **时机差别很实际**:不拦在装配期的话,配置遗漏要到**第一次出票**才显形,
 * 而第一次出票通常是**月底**。月底是发现配置错误最糟的时刻 ——
 * 出账窗口有限,而能改配置的人可能正好不在。
 *
 * **出票时仍然再断言一次**,两条理由:契约要求所有实现方都拒绝出票
 * (对 `billing-hosted` 等同样成立),以及类型可以被 `as` 掉而断言不会。
 */
export class LocalBilling extends Billing {
  private readonly options: LocalBillingOptions

  constructor(ctx: Context, options: LocalBillingOptions) {
    super(ctx)
    // ★ 卖方拦在**装配期**,不等到出票 —— 理由见类注释。
    //   配置文件那条路类型是被擦掉的,所以这里必须是运行时断言。
    assertSellerConfigured(options.seller, SELLER_CONFIG_PATH)
    this.options = options
  }

  override async generateInvoice(tenantId: string, period: BillingPeriod): Promise<Invoice> {
    // ★ 拒绝出票,**不降级**。绝不能回落到占位卖方 —— 一张卖方栏是占位符的
    //   发票会被会计系统当成**数据错误**处理,而不是被报成配置错误。
    //   装配期已经断言过一次;这里是契约义务(所有实现方都要拒),
    //   而且它挡得住「类型被 as 掉」与「options 被事后改写」两条路。
    assertSellerConfigured(this.options.seller, SELLER_CONFIG_PATH)

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
      seller: this.options.seller,
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
