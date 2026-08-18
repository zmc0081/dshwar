/**
 * 发票卖方 —— 开票主体的法律身份。
 *
 * ## 为什么它单独一个模块,而不是 `Invoice` 上的几个字符串字段
 *
 * 因为**发票是法律文件**,而卖方栏是它上面最不能出错的一格。
 * 单独成模块是为了让「未配置」这件事有地方被显式表达与显式拒绝 ——
 * 散成三个可选字符串的话,「没填」与「填了空的」在类型上是同一个东西。
 *
 * ## 与 `TenantBranding.legalEntityName` 刻意不复用
 *
 * 那个是**页脚版权行的显示名**,填错只是难看;这个是**开票主体**,
 * 填错是开错发票。两者在现实里常常相同,但**相同不等于同一个字段** ——
 * 合成一个之后,改页脚的人会顺手改掉开票抬头。
 *
 * 决策记录见 `docs/DECISIONS/branding-variables.md` 裁决 3。
 *
 * @module @dshwar/billing/seller
 */

declare const legalEntityBrand: unique symbol

/**
 * 非空的法律实体名。
 *
 * ★ **裸 `string` 赋不进来** —— 必须过 {@link legalEntity}。
 * 这不是风格洁癖:它让「一个没校验过的字符串」在类型上就到不了卖方栏,
 * 而不是等运行时校验去拦(而运行时校验总有一条路径会被绕过)。
 */
export type LegalEntityName = string & { readonly [legalEntityBrand]: 'LegalEntityName' }

/**
 * 编译期把空字符串字面量映射成 `never`。
 *
 * ⚠️ **它只拦得住字面量。** 传一个 `string` 类型的变量(比如从 JSON 配置读来的)
 * 时,`string extends ''` 为假,于是照常通过 —— 那条路径由
 * {@link legalEntity} 的运行时校验兜住。
 *
 * **两层各管一段,谁都不要冒充另一个**:类型层管「代码里写死了空串」,
 * 运行时管「配置里填了空串」。
 */
type NonEmpty<T extends string> = T extends '' ? never : T

/** 显式配置了空值 —— 这不是合法的卖方名,与「未配置」是两回事。 */
export class EmptyLegalEntityError extends Error {
  constructor() {
    super(
      '法律实体名不能为空。' +
        '⚠️ 「填了空值」与「未配置」是两回事:前者说明有人以为空白是合法的,' +
        '后者说明这一项还没填 —— 两者都拒绝,但原因不同,别把它们合成一个。',
    )
    this.name = 'EmptyLegalEntityError'
  }
}

/**
 * 造一个法律实体名。
 *
 * ```ts
 * legalEntity('Acme Inc.')   // ✅
 * legalEntity('')            // ❌ 编译期就不过 —— 参数类型是 never
 * legalEntity(fromConfig)    // 编译期放行(类型是 string),运行时校验
 * ```
 *
 * @throws {EmptyLegalEntityError} 运行时拿到空串或纯空白
 */
export function legalEntity<T extends string>(name: NonEmpty<T>): LegalEntityName {
  // 纯空白同样不算 —— 一个由空格组成的抬头在发票上与空白无异
  if (typeof name !== 'string' || name.trim() === '') throw new EmptyLegalEntityError()
  // 经过上面的校验才允许打上品牌;走 unknown 是因为条件类型与品牌类型无重叠
  return name as unknown as LegalEntityName
}

/**
 * 开票主体。
 *
 * `taxId` 与 `address` 用 `null` 表示**明示不适用**(有的法域、有的形态确实没有),
 * 与「整个 `seller` 缺席 = 未配置」区分开。
 */
export interface InvoiceSeller {
  /** 开票抬头。**不是** `TenantBranding.legalEntityName`(那个只管页脚显示)。 */
  readonly legalName: LegalEntityName
  /** 税号 / 统一社会信用代码。`null` = 明示不适用,不是「还没填」。 */
  readonly taxId: string | null
  /** 开票地址。`null` = 明示不适用。 */
  readonly address: string | null
}

/**
 * 卖方未配置 —— **配置错误**,不是业务状态。
 *
 * ⚠️ 信息里必须说清两件事:**是卖方没配**,以及**去哪配**。
 * 一张卖方栏空白的发票流到会计系统里会被当成**数据错误**处理,
 * 而不是被当成配置错误报上来 —— 那时排查的人离配置文件已经很远了。
 */
export class SellerNotConfiguredError extends Error {
  constructor(where: string) {
    super(
      `未配置发票卖方(seller)——拒绝出票。发票是法律文件,不能有空白的卖方栏。\n` +
        `  配置位置:${where}\n` +
        `  至少要给 legalName(开票抬头);taxId 与 address 若不适用请显式填 null,` +
        `不要留空 —— 「不适用」与「没填」在账务上不是一回事。`,
    )
    this.name = 'SellerNotConfiguredError'
  }
}

/**
 * 断言卖方已配置。**拒绝出票,不降级**。
 *
 * ⚠️ 绝不能改成「回落到一个占位卖方」:那样出去的是一张**看起来正常、
 * 卖方栏是占位符**的发票,而它会被下游当成数据问题而不是配置问题。
 * 拒绝发生在我们这边,静默降级的后果发生在客户的会计那边。
 *
 * @param where 人类可读的配置位置,进错误信息
 */
export function assertSellerConfigured(
  seller: InvoiceSeller | undefined,
  where: string,
): asserts seller is InvoiceSeller {
  if (seller === undefined) throw new SellerNotConfiguredError(where)
  // 类型层已经拦住裸 string,这里兜的是「类型被 as 掉」与 JSON 反序列化两条路
  if (typeof seller.legalName !== 'string' || seller.legalName.trim() === '') {
    throw new SellerNotConfiguredError(where)
  }
}
