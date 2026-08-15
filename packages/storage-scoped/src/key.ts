/**
 * 键前缀编码。纯逻辑,与 cordis / 上游存储解耦 —— 安全逻辑必须能独立穷尽测试。
 *
 * @module @dshwar/storage-scoped/key
 */
import { encodeSegment } from '@dshwar/fs-tenant'
import type { Principal } from '@dshwar/principal'

/** 跨租户访问或前缀伪造。 */
export class ScopeViolationError extends Error {
  override readonly name = 'ScopeViolationError'
  constructor(message: string) {
    super(message)
  }
}

/**
 * 由 principal 派生租户作用域标签。
 *
 * ⚠️ **前缀必须由 principal 派生,绝不接受调用方传入。** 一旦作用域可以由调用方
 * 指定,整层隔离就退化成一个建议 —— 任何一个插件、任何一段被提示词注入影响的
 * 代码,都可以把作用域改成别人的。
 *
 * 复用 `fs-tenant` 的 {@link encodeSegment} 而不是另写一套:两处对同一个
 * tenantId 必须得出同一个标签,否则排障时人要在脑子里维护两套映射。
 *
 * @param principal 当前主体
 * @returns 该主体所属租户的作用域标签
 */
export function tenantScope(principal: Principal): string {
  return encodeSegment(principal.tenantId)
}

/**
 * 给一个记录键打上作用域前缀。
 *
 * ## 为什么是长度前缀而不是分隔符
 *
 * 上游 `KvUnit` 的契约明写:记录键 **"any string is safe (keys never reach file
 * paths)"** —— 也就是说键的内容**完全由调用方控制**,任何分隔符都可能出现在键里。
 *
 * 天真的 `${scope}:${key}` 会被伪造:只要分隔符能出现在 scope 或 key 中,
 * 构造碰撞就只是时间问题。
 *
 * 长度前缀 `${scope.length}:${scope}${key}` 则与两者的内容完全无关 ——
 * 先读长度就精确知道 scope 在哪结束。没有任何字符串能伪造出别人的前缀。
 *
 * 这比「选一个不会出现的分隔符」更强:后者依赖一个跨包的字符集不变式,
 * 而不变式会随重构悄悄失效,失效时没有任何报错。
 *
 * @param scope 作用域标签(由 {@link tenantScope} 派生)
 * @param key 调用方的记录键,内容不受限
 * @returns 带前缀的键
 */
export function encodeKey(scope: string, key: string): string {
  return `${scope.length}:${scope}${key}`
}

/**
 * 从带前缀的键中还原调用方的原始键。
 *
 * @param scope 期望的作用域标签
 * @param encoded 存储层里的完整键
 * @returns 原始键;若该键不属于本作用域则返回 `undefined`
 */
export function decodeKey(scope: string, encoded: string): string | undefined {
  const separator = encoded.indexOf(':')
  if (separator <= 0) return undefined

  const lengthPart = encoded.slice(0, separator)
  if (!/^[0-9]+$/.test(lengthPart)) return undefined

  const length = Number(lengthPart)
  const scopeStart = separator + 1
  const actualScope = encoded.slice(scopeStart, scopeStart + length)

  // 长度不足说明这个键根本不是本编码产生的
  if (actualScope.length !== length) return undefined
  if (actualScope !== scope) return undefined

  return encoded.slice(scopeStart + length)
}

/**
 * 断言一个**已解码**的键确实属于给定作用域。
 *
 * 用于写路径的最后一道复查:即便 {@link encodeKey} 的调用点写错了,
 * 这里也会拦住 —— 隔离不该依赖单一调用点的正确性。
 *
 * @param scope 期望的作用域标签
 * @param encoded 待写入的完整键
 * @throws {ScopeViolationError} 该键不属于本作用域
 */
export function assertInScope(scope: string, encoded: string): void {
  if (decodeKey(scope, encoded) === undefined) {
    throw new ScopeViolationError(
      `键 ${JSON.stringify(encoded)} 不属于作用域 ${JSON.stringify(scope)} —— 跨租户访问已拦截`,
    )
  }
}
