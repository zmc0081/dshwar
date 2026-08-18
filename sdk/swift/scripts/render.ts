/**
 * 纯渲染函数 —— 无副作用,由生成脚本与校验测试**共用**。
 *
 * 与 `sdk/typescript` / `sdk/kotlin` 同一条不变式:输出哪怕只差一个换行,
 * 「是否已重新生成」的校验就会永远红或永远绿。
 *
 * ## 与 Kotlin 发射器**刻意不共用映射表**
 *
 * 共用的只有 IR(`@dshwar/api-contract` 的 `model-ir`)—— 那是「契约里是
 * 什么形状」。而「目标语言里写成什么」两边**必须各写各的**:
 * `Long` 与 `Int64`、`JsonElement` 与 `AnyCodable` 不是同一个决定,
 * 硬凑成一张表会逼出一个谁都不合适的抽象层。
 */
import { extractModels, type IrModel, type IrType } from '@dshwar/api-contract'

export const HEADER = [
  '// 由 packages/api-contract/openapi.json 自动生成 —— auto-generated,请勿手改。',
  '// 重新生成:pnpm --filter @dshwar/sdk-swift generate',
  '',
  'import Foundation',
  '',
].join('\n')

/**
 * IR 类型 → Swift 类型。
 *
 * ⚠️ **`datetime` 映射成 `String` 而不是 `Date`。** 与 Kotlin 同一条理由:
 * SDK 要薄。`Date` 还会引入 `JSONDecoder.dateDecodingStrategy` 的配置耦合 ——
 * 解码策略配错的表现是**日期静默偏移**,而不是报错。
 *
 * ⚠️ **`integer` 映射成 `Int64` 而不是 `Int`。** `Int` 在 32 位平台上是 32 位;
 * 契约里的整数含 token 计数与最小货币单位金额,两者都能越过 21 亿 ——
 * 后果是**大额账单静默溢出**。
 *
 * ⚠️ **`unknown` 映射成 `AnyCodable`** —— 一个随 SDK 一起提供的小类型
 * (见 `Support.swift`)。Swift 标准库没有对应物,而 `Any` 不是 `Codable`。
 */
export function swiftType(type: IrType): string {
  switch (type.kind) {
    case 'string':
      return 'String'
    case 'datetime':
      return 'String'
    case 'integer':
      return 'Int64'
    case 'boolean':
      return 'Bool'
    case 'ref':
      return type.name
    case 'array':
      return `[${swiftType(type.items)}]`
    case 'enum':
      return 'String'
    case 'unknown':
      return 'AnyCodable'
  }
}

function renderModel(model: IrModel): string {
  const lines: string[] = []
  if (model.description !== undefined) lines.push(`/// ${model.description}`)
  lines.push(`public struct ${model.name}: Codable, Sendable {`)

  for (const field of model.fields) {
    if (field.description !== undefined) lines.push(`    /// ${field.description}`)
    if (field.type.kind === 'enum') {
      lines.push(`    /// 取值:${field.type.values.join(' | ')}`)
    }
    const sw = swiftType(field.type)
    lines.push(`    public let ${field.name}: ${sw}${field.nullable ? '?' : ''}`)
  }

  // 显式构造器:Swift 的合成 memberwise initializer 是 internal 的,
  // 跨模块用不了 —— 不写这一段,SDK 的使用方造不出这些结构体。
  lines.push('')
  lines.push('    public init(')
  for (const [i, field] of model.fields.entries()) {
    const last = i === model.fields.length - 1
    const sw = swiftType(field.type)
    const opt = field.nullable ? '?' : ''
    const def = field.nullable ? ' = nil' : ''
    lines.push(`        ${field.name}: ${sw}${opt}${def}${last ? '' : ','}`)
  }
  lines.push('    ) {')
  for (const field of model.fields) lines.push(`        self.${field.name} = ${field.name}`)
  lines.push('    }')
  lines.push('}')
  return lines.join('\n')
}

/** 把 OpenAPI 文档渲染成 Swift 模型源码。 */
export function renderSwift(document: Record<string, unknown>): string {
  const models = extractModels(document)
  return `${HEADER}\n${models.map(renderModel).join('\n\n')}\n`
}
