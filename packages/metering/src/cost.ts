/**
 * 一笔消耗值多少钱 —— **三种情况,三个类型,没有一种能退化成 `0`**。
 *
 * ## 这个文件为什么存在(V0.9.0 Session 5.5)
 *
 * 同一个字段上曾经挂着两个洞,而它们互相牵制:
 *
 * | 洞 | 症状 | 谁受害 |
 * | --- | --- | --- |
 * | **语义折叠** | 「没配价」与「不计费」都产出 `costMinorUnits: 0` | 拿账单对账的人 |
 * | **单位假设** | 消费方一律 `÷ 100`,而 ISO 4217 的指数不都是 2 | JPY 差 100 倍 |
 *
 * ⚠️ 分两次动是错的:两者都要改**同一个字段的形状**,而第二次会发现
 * 第一次挑的形状不够用 —— 一个 `number | null` 装不下
 * 「多少钱 + 什么币种 + 几位小数 + 算不算得出来」这四件事。
 *
 * ## 洞一:`0` 曾经同时是两句完全相反的话
 *
 * | 情况 | 真实含义 | 对账的人该做什么 |
 * | --- | --- | --- |
 * | 模型**没配价** | 这笔消耗的钱**算不出来** | 去补配价,然后**重算** |
 * | 部署方**不计费** | 这笔消耗**不收费** | 什么都不用做,这就是终值 |
 *
 * 两者的处理方式**完全相反**,而账面上都是 `¥0.00`。
 * ⇒ 于是有了 {@link Cost} 的三个分支:`priced` / `unpriced` / `unbilled`。
 *
 * ## 洞二:指数由**部署方声明**,不由任何一张表推断
 *
 * 🚨 **本仓任何一处都不许有「币种 → 指数」对照表** —— 服务端也不许。
 * 理由不是嫌麻烦:
 *
 * 1. 前端自带一张 = **第二个事实源**,与服务端的计价口径迟早分家,
 *    而分家的表现是账目差 100 倍,且没人知道该信哪一边;
 * 2. 服务端自带一张 = 一份**会过期的数据**(币种改制真的发生过),
 *    而它一过期,正确的配置反而会被判成错的。
 *
 * ⇒ 正解:指数与价格**来自同一段配置**。部署方写 JPY 的价格时,
 * 那些数字就是以「円」为单位的,于是他声明 `currencyExponent: 0`;
 * 写 KWD 时以千分之一第纳尔为单位,声明 `3`。
 * 两者出自同一个人、同一次编辑 —— **不存在分家的路径**。
 *
 * 指数在这里的语义只有一个:**minor → major 的渲染参数**。
 * 它不参与任何计算,金额自始至终是最小单位的整数。
 *
 * @module @dshwar/metering/cost
 */

/**
 * 一笔消耗的成本。**三个分支,没有一个是 `0`**。
 *
 * ⚠️ 加分支前先问:它与现有三个中的哪一个**处理方式不同**?
 * 处理方式相同的不是新分支,是同一分支的一个原因 ——
 * 而「原因」属于错误信息,不属于类型。
 */
export type Cost =
  | {
      /** 算出来了。 */
      readonly kind: 'priced'
      /** 最小货币单位的非负整数。**永远不是浮点**,理由见 `@dshwar/billing` 的 money.ts。 */
      readonly amountMinor: number
      /** ISO 4217 三字母代码。 */
      readonly currency: string
      /** minor → major 的指数。**由部署方声明**,见模块注释「洞二」。 */
      readonly currencyExponent: number
    }
  | {
      /**
       * **算不出来** —— 这个模型没配价。
       *
       * 它不是 0。消费方要么显示「—」,要么拒绝出票(见 `billing-local`),
       * 但**绝不能**把它渲染成一个看起来像钱的数。
       */
      readonly kind: 'unpriced'
    }
  | {
      /**
       * **不收费** —— 部署方声明了这个 provider / 模型不计费(本地算力是典型)。
       *
       * 这一支的「零」是**终值**,与 `unpriced` 的区别是:对账的人对它无事可做。
       */
      readonly kind: 'unbilled'
    }

/**
 * {@link Cost} 在**线上**的样子 —— 扁平对象 + 判别字段。
 *
 * ## ⚠️ 为什么线上不是 `oneOf` 判别联合
 *
 * 契约里 `oneOf` 会被 `model-ir.ts` 按**不透明**处理(它的注释写明了理由:
 * 判别联合的正确映射三种语言各不相同,值得单独一版)。于是 Kotlin / Swift SDK
 * 里这个字段会退化成 `JsonElement` / `AnyCodable` —— **移动端拿到的成本字段没有类型**。
 *
 * 用「判别字段 + 可空载荷」换取三种语言都有类型,是刻意的取舍。
 * 代价是线上形状**允许**非法组合(`kind: 'priced'` 而 `amountMinor: null`),
 * 而那个代价由 {@link readCost} 兜住:它是唯一的入口,非法组合一律抛。
 */
export interface CostWire {
  readonly kind: Cost['kind']
  /** 仅 `priced` 非空。 */
  readonly amountMinor: number | null
  /** 仅 `priced` 非空。 */
  readonly currency: string | null
  /** 仅 `priced` 非空。 */
  readonly currencyExponent: number | null
}

/** 线上形状与领域形状对不上 —— 上游违约,不是业务状态。 */
export class MalformedCostError extends Error {
  constructor(detail: string) {
    super(
      `成本字段的线上形状非法:${detail}。\n` +
        '⚠️ 这里**不猜**:把一个残缺的成本读成 0 或读成「未计价」,\n' +
        '两种猜法各自会在账单上说一句不同的假话。',
    )
    this.name = 'MalformedCostError'
  }
}

/** 领域 → 线上。三个分支各自补齐三个 `null`,不留「这个字段可以省」的余地。 */
export function costToWire(cost: Cost): CostWire {
  return cost.kind === 'priced'
    ? {
        kind: 'priced',
        amountMinor: cost.amountMinor,
        currency: cost.currency,
        currencyExponent: cost.currencyExponent,
      }
    : { kind: cost.kind, amountMinor: null, currency: null, currencyExponent: null }
}

/**
 * 线上 → 领域。**唯一入口**,非法组合一律抛。
 *
 * ⚠️ 消费方不许自己读 `wire.amountMinor` —— 那等于每个消费方各判一次
 * 「这个 null 是什么意思」,而总有一个判错。判错的表现是账单上多一个 0。
 *
 * @throws {MalformedCostError} `priced` 缺载荷、非 `priced` 却带载荷、或 `kind` 认不出来
 */
export function readCost(wire: CostWire): Cost {
  switch (wire.kind) {
    case 'priced': {
      const { amountMinor, currency, currencyExponent } = wire
      if (amountMinor === null || currency === null || currencyExponent === null) {
        throw new MalformedCostError(`kind=priced 却缺载荷(${JSON.stringify(wire)})`)
      }
      return { kind: 'priced', amountMinor, currency, currencyExponent }
    }
    case 'unpriced':
    case 'unbilled':
      // ⚠️ 带了载荷也要抛,不是忽略:一个「不计费却带着金额」的对象说明
      //   产出它的那一侧对这三个分支的理解与这里不同 —— 忽略等于把那个分歧藏起来。
      if (wire.amountMinor !== null || wire.currency !== null || wire.currencyExponent !== null) {
        throw new MalformedCostError(`kind=${wire.kind} 却带着金额载荷(${JSON.stringify(wire)})`)
      }
      return { kind: wire.kind }
    default:
      // 认不出来就停下 —— 兜底分支判**破坏**,不放行。
      throw new MalformedCostError(`认不出的 kind:${JSON.stringify(wire.kind)}`)
  }
}

/**
 * 价格表:`provider/model` → 每百万 token 的价格(最小货币单位,整数)。
 *
 * ⚠️ **`currencyExponent` 是必填的**,而且它必须与 `prices` 里那些数字的单位一致 ——
 * 两者出自同一段配置正是它可信的全部理由(见模块注释「洞二」)。
 */
export interface PriceTable {
  /** ISO 4217 三字母代码。 */
  readonly currency: string
  /**
   * minor → major 的指数。CNY / USD = 2,**JPY = 0**,**KWD = 3**。
   *
   * 写错的后果不是崩溃,是一个**看起来完全正常**的、差 10 的整数次幂的账目。
   */
  readonly currencyExponent: number
  /**
   * 声明**不计费**的 provider 或模型。
   *
   * 每一项要么是 `provider`(整个 provider 都不计费),要么是 `provider/model`。
   * 本地算力是典型:给本地 provider 配价反而是错的(见 `docs/GOVERNANCE.md`)。
   *
   * ⚠️ **没有默认值。** 不声明的话,本地模型会落进 `unpriced`(算不出来)——
   * 那是刻意的:「这个部署不对本地算力收费」是一句**只有部署方能说**的话,
   * 而一个替他说了的默认值,正是这个 Session 要拆掉的那种沉默。
   */
  readonly unbilled?: readonly string[]
  readonly prices: Readonly<
    Record<
      string,
      {
        readonly inputPerMTokenMinor: number
        readonly outputPerMTokenMinor: number
      }
    >
  >
}

/** 价格表配置非法 —— 配置错误,拦在装配期。 */
export class PriceTableError extends Error {
  constructor(detail: string, configPath: string) {
    super(`价格表配置非法:${detail}。配置位置:${configPath}`)
    this.name = 'PriceTableError'
  }
}

/**
 * ISO 4217 指数的**取值范围**。0(JPY)到 4(CLF / UYW)。
 *
 * ⚠️ 这是一个**区间检查**,不是一张币种表 —— 区别很实际:
 * 区间不会过期,而对照表会。它挡的是「打错一位」,挡不住「JPY 写成 2」,
 * 而后者按设计就该由部署方自己保证:那些价格数字是他按同一个单位写的。
 */
const MAX_CURRENCY_EXPONENT = 4

/**
 * 装配期校验价格表。
 *
 * ★ **拦在装配期**,与 `billing-local` 的 `assertSellerConfigured` 同一条理由:
 * 不拦的话,配置错误要到**第一次看账**才显形,而那通常是月底。
 *
 * @throws {PriceTableError}
 */
export function assertPriceTable(table: PriceTable, configPath: string): PriceTable {
  if (!/^[A-Z]{3}$/.test(table.currency)) {
    throw new PriceTableError(
      `currency = ${JSON.stringify(table.currency)} 不是 ISO 4217 三字母代码`,
      configPath,
    )
  }
  if (
    !Number.isInteger(table.currencyExponent) ||
    table.currencyExponent < 0 ||
    table.currencyExponent > MAX_CURRENCY_EXPONENT
  ) {
    throw new PriceTableError(
      `currencyExponent = ${String(table.currencyExponent)} 不在 0–${String(MAX_CURRENCY_EXPONENT)} 之间;` +
        'JPY 是 0,CNY / USD 是 2,KWD 是 3',
      configPath,
    )
  }
  for (const [key, price] of Object.entries(table.prices)) {
    for (const [field, value] of [
      ['inputPerMTokenMinor', price.inputPerMTokenMinor],
      ['outputPerMTokenMinor', price.outputPerMTokenMinor],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new PriceTableError(
          `prices[${JSON.stringify(key)}].${field} = ${String(value)} 不是非负安全整数 —— ` +
            '价格与金额一样,一律用最小货币单位的整数',
          configPath,
        )
      }
    }
  }
  return table
}

/**
 * 这一格消耗算不算得出钱来 —— **`aggregateDaily` 与发票行共用的唯一判据**。
 *
 * ⚠️ 两处各写一遍是这个字段最初出问题的方式:用量页与发票对同一笔消耗
 * 给出不同的说法,而两边都「按自己的规则」是对的。
 *
 * 舍入**只在这里发生一次**,由调用方决定拿什么口径的 token 进来
 * (按日聚合传当日的,发票传整期的 —— 两者的舍入边界不同,那是有意的)。
 *
 * @param table 价格表。`undefined` = 这个部署**没有声明计价口径** →
 *   一律 `unpriced`,而不是一律 0。
 */
export function costFor(
  table: PriceTable | undefined,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Cost {
  if (table === undefined) return { kind: 'unpriced' }
  if (isUnbilled(table, provider, model)) return { kind: 'unbilled' }

  const price = table.prices[`${provider}/${model}`]
  if (price === undefined) return { kind: 'unpriced' }

  return {
    kind: 'priced',
    amountMinor: Math.round(
      (inputTokens * price.inputPerMTokenMinor + outputTokens * price.outputPerMTokenMinor) /
        1_000_000,
    ),
    currency: table.currency,
    currencyExponent: table.currencyExponent,
  }
}

/**
 * 命中「不计费」声明了吗。
 *
 * ⚠️ **不计费的判定排在查价之前。** 反过来的话,一个既在 `unbilled` 里、
 * 又被误配了价的模型会被计费 —— 而部署方的声明应当是更强的那一条。
 */
function isUnbilled(table: PriceTable, provider: string, model: string): boolean {
  const declared = table.unbilled ?? []
  return declared.includes(provider) || declared.includes(`${provider}/${model}`)
}

/**
 * 有模型算不出钱来,而调用方要的是一个**确定的金额** —— 拒绝,不降级。
 *
 * ★ 与 `billing-local` 的 `assertSellerConfigured` 是同一族:
 * 一张金额栏是「猜的」的发票会被会计系统当成**数据错误**处理,
 * 而不是被报成配置错误。宁可出不了票。
 */
export class UnpricedModelError extends Error {
  constructor(
    /** 没配价的 `provider/model`,去重后。错误信息里要指出**去哪补**。 */
    readonly priceKeys: readonly string[],
    configPath: string,
  ) {
    super(
      `有 ${String(priceKeys.length)} 个模型没配价,金额算不出来:${priceKeys.join(', ')}。\n` +
        `补配价的位置:${configPath}\n` +
        '⚠️ 这里**拒绝**而不是按 0 计:0 会让「算不出来」在账面上变成「不收费」,\n' +
        '而拿账单对账的人对这两者的处理完全相反 —— 前者要补配价再重算,后者无事可做。\n' +
        '若这些模型本来就不该收费(本地算力是典型),把它们写进价格表的 unbilled,\n' +
        '那是一句**声明**,与「忘了配」在类型上就分得开。',
    )
    this.name = 'UnpricedModelError'
  }
}

/**
 * 一组成本里若有 `unpriced`,抛 {@link UnpricedModelError}。
 *
 * ⚠️ **入参是「成本 + 它的名字」的成对结构,不是两个平行数组。**
 * 平行数组要靠索引对齐,而索引错位的表现是**错误信息点错模型** ——
 * 排查的人会去给一个本来配好价的模型「补配价」。
 * 成对之后那种错位在结构上不可能发生,顺带也不再需要一个
 * 「取不到名字时用什么」的兜底分支(那种分支永远不会进,
 * 却会让读的人以为它在挡什么)。
 *
 * @param priced 每一格:算出来的成本 + 它对应的 `provider/model`
 * @param configPath 去哪补配价 —— 说清这个是这条拒绝有用的另一半
 */
export function assertAllPriced(
  priced: readonly { readonly cost: Cost; readonly label: string }[],
  configPath: string,
): void {
  const unpriced = priced.filter((p) => p.cost.kind === 'unpriced').map((p) => p.label)
  if (unpriced.length > 0) throw new UnpricedModelError([...new Set(unpriced)], configPath)
}
