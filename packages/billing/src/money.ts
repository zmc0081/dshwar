/**
 * 钱的纪律 —— 本包所有金额字段的唯一判据。
 *
 * **钱一律用最小货币单位的整数**(人民币是分,美元是 cent)。
 * 契约里不出现浮点:`0.1 + 0.2 !== 0.3` 在账单上就是对不上账,
 * 而对不上账的账单会被客户拿去质疑整个系统 —— 不是质疑这一行,
 * 是质疑所有行。
 *
 * 命名约定:凡金额字段一律以 `Minor` 结尾(`totalMinor` / `amountMinor`),
 * 让「这是分不是元」在字段名上就可见,而不是靠读文档。
 */

/** 金额校验失败 —— 这是编程错误(有人把浮点或负数当钱传进来),不是业务状态。 */
export class InvalidMinorUnitsError extends Error {
  constructor(label: string, value: number) {
    super(
      `${label} = ${value} 不是合法的金额:金额必须是最小货币单位的非负安全整数(分,不是元)。` +
        `若你手上是浮点,说明上游已经用错了单位 —— 修上游,不要在这里 round。`,
    )
    this.name = 'InvalidMinorUnitsError'
  }
}

/**
 * 断言一个数是合法的金额(最小货币单位、非负、安全整数)。
 *
 * 在**边界**上调用(构造发票、录入支付),不在算术中间步骤反复调 ——
 * 中间步骤的正确性由「输入全是整数 + 只做加法与一次 round」保证。
 *
 * ⚠️ 为什么抛而不是 round:round 会把「上游用错单位」这个 bug 变成
 * 每张账单里一笔查不出来源的尾差。宁可炸在边界。
 */
export function assertMinorUnits(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidMinorUnitsError(label, value)
  }
  return value
}
