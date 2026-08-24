/**
 * 发票卖方 —— **拒绝出票**的负向验证(裁决 3)。
 *
 * ## 这里断言的是「拒绝」,不是「卖方字段非空」
 *
 * 两者差别不是措辞,是**故障会落在谁头上**:
 *
 * | 实现 | 现象 | 谁来收拾 |
 * | --- | --- | --- |
 * | 拒绝出票 | 出账报错,信息里写着「未配置卖方」+ 去哪配 | **我们这边的运维**,当场就能修 |
 * | 回落占位卖方 | 出一张**看起来正常**、卖方栏是占位符的发票 | **客户的会计** —— 而他会把它当成**数据错误**,进对账差异、进人工核查 |
 *
 * ⇒ 所以断言必须是 `rejects`,而不是 `expect(invoice.seller).toBeTruthy()`。
 * 后者在「回落占位卖方」的实现下**照样通过** —— 那正是本文件要防的那种实现。
 *
 * ## 两道断言,拦的是不同的时机
 *
 * 1. **装配期**(构造函数):自建档的卖方天然是自建者自己,「未配置」是纯粹的
 *    配置遗漏 —— 拦在启动比拦在月底出账好
 * 2. **出票期**(`generateInvoice`):契约对所有实现方的义务,且挡得住
 *    「类型被 as 掉」与「options 被事后改写」
 */
import { Context } from '@deepseek-ai/cordis'
import {
  EmptyLegalEntityError,
  legalEntity,
  SellerNotConfiguredError,
  type InvoiceSeller,
} from '@dshwar/billing'
import { InMemoryMeteringStore, type PriceTable } from '@dshwar/metering'
import { describe, expect, it } from 'vitest'
import { InMemoryInvoiceStore, LocalBilling } from '../src/index.ts'

const PRICES: PriceTable = {
  currency: 'CNY',
  currencyExponent: 2,
  prices: { 'deepseek/deepseek-chat': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 } },
}
const JULY = { start: '2026-07-01T00:00:00Z', end: '2026-08-01T00:00:00Z' }
const SELLER: InvoiceSeller = {
  legalName: legalEntity('Acme Inc.'),
  taxId: '91310000MA1K35NX7Y',
  address: '上海市…',
}

/** 造一个装好用量的 harness。`seller` 走 unknown 是为了模拟**配置文件**那条路 —— 类型被擦掉。 */
async function harness(seller: unknown) {
  const ctx = new Context()
  const metering = new InMemoryMeteringStore()
  await metering.record({
    subjectId: 'alice',
    tenantId: 'acme',
    sessionId: 's1',
    turn: 1,
    step: 1,
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
    unreported: false,
    at: '2026-07-03T10:00:00Z',
  })
  await ctx.plugin(LocalBilling, {
    seller: seller as InvoiceSeller,
    metering,
    prices: PRICES,
    invoices: new InMemoryInvoiceStore(),
  })
  return ctx
}

describe('★ 装配期拦截 —— 未配置卖方拒绝启动', () => {
  it('seller 缺席 → 装配就抛,不等到出票', async () => {
    await expect(harness(undefined)).rejects.toThrow(SellerNotConfiguredError)
  })

  it('legalName 是空串(配置文件里填了空)→ 装配就抛', async () => {
    await expect(harness({ legalName: '', taxId: null, address: null })).rejects.toThrow(
      SellerNotConfiguredError,
    )
  })

  it('legalName 是纯空白 → 同样抛(空格抬头在发票上与空白无异)', async () => {
    await expect(harness({ legalName: '   ', taxId: null, address: null })).rejects.toThrow(
      SellerNotConfiguredError,
    )
  })

  it('配好了就正常装配', async () => {
    await expect(harness(SELLER)).resolves.toBeDefined()
  })
})

describe('★ 出票期拦截 —— 断言的是**拒绝**,不是「卖方非空」', () => {
  /**
   * 绕过装配期检查,直接把卖方从已装好的实例上抹掉 ——
   * 模拟「类型被 as 掉」「options 被事后改写」「另一个实现方忘了拦」三种情形。
   */
  async function billingWithSellerStripped() {
    const ctx = await harness(SELLER)
    const service = ctx.billing as unknown as { options: { seller: InvoiceSeller | undefined } }
    service.options = { ...service.options, seller: undefined }
    return ctx.billing
  }

  it('★★ 卖方被抹掉 → generateInvoice **拒绝出票**(而不是出一张空卖方的发票)', async () => {
    const billing = await billingWithSellerStripped()

    // ⚠️ 断言是 rejects。若实现改成「回落占位卖方」,这条会红 ——
    //    而 `expect(invoice.seller).toBeTruthy()` 那种写法**不会**。
    await expect(billing.generateInvoice('acme', JULY)).rejects.toThrow(SellerNotConfiguredError)
  })

  it('★ 拒绝之后,账本里不该留下任何发票 —— 拒绝不是「出了再撤」', async () => {
    const billing = await billingWithSellerStripped()

    await expect(billing.generateInvoice('acme', JULY)).rejects.toThrow()
    expect(await billing.listInvoices('acme'), '拒绝出票却把发票落进了账本').toEqual([])
  })

  it('★ 错误信息说清「未配置卖方」并指向配置位置', async () => {
    const billing = await billingWithSellerStripped()

    // 显式收窄:`.catch` 的返回与 resolve 值是联合类型,而这里只可能走 catch
    const error = await billing
      .generateInvoice('acme', JULY)
      .then(() => undefined)
      .catch((e: unknown) => e as Error)

    expect(error, 'generateInvoice 竟然成功了 —— 它应该拒绝出票').toBeInstanceOf(
      SellerNotConfiguredError,
    )
    if (error === undefined) return

    // 只说「出错了」的信息,排查的人还得先找一遍配置在哪
    expect(error.message, '错误信息没说是卖方没配').toContain('未配置发票卖方')
    expect(error.message, '错误信息没指向配置位置').toContain('governance.billing.seller')
    // 它是配置错误,不是业务状态 —— 信息里要有这个判据
    expect(error.message).toContain('拒绝出票')
  })
})

describe('正路:卖方原样落进发票', () => {
  it('发票带上完整的卖方,三个字段都在', async () => {
    const ctx = await harness(SELLER)
    const invoice = await ctx.billing.generateInvoice('acme', JULY)

    expect(invoice.seller).toEqual(SELLER)
    expect(invoice.seller.legalName).toBe('Acme Inc.')
    expect(invoice.seller.taxId).toBe('91310000MA1K35NX7Y')
  })

  it('taxId / address 显式为 null 是合法的 —— 「不适用」不是「没填」', async () => {
    const ctx = await harness({ legalName: legalEntity('Solo Dev'), taxId: null, address: null })
    const invoice = await ctx.billing.generateInvoice('acme', JULY)

    expect(invoice.seller.taxId).toBeNull()
    expect(invoice.seller.address).toBeNull()
  })
})

describe('legalEntity · 类型层与运行时各管一段', () => {
  it('运行时拒绝空串', () => {
    // 编译期的那一半没法在运行时断言 —— 它由 typecheck 门禁保证:
    // `legalEntity('')` 的参数类型是 never,写出来就编译不过。
    // 这里验的是**动态字符串**那条路(配置文件读来的)。
    const fromConfig: string = ''
    expect(() => legalEntity(fromConfig)).toThrow(EmptyLegalEntityError)
  })

  it('运行时拒绝纯空白', () => {
    const fromConfig: string = '\t \n'
    expect(() => legalEntity(fromConfig)).toThrow(EmptyLegalEntityError)
  })

  it('合法名字原样返回', () => {
    expect(legalEntity('北京某某科技有限公司')).toBe('北京某某科技有限公司')
  })

  it('「填了空值」与「未配置」抛的是不同的错 —— 两者原因不同', () => {
    // EmptyLegalEntityError:有人以为空白是合法的
    // SellerNotConfiguredError:这一项还没填
    const fromConfig: string = ''
    expect(() => legalEntity(fromConfig)).toThrow(EmptyLegalEntityError)
    expect(() => legalEntity(fromConfig)).not.toThrow(SellerNotConfiguredError)
  })
})
