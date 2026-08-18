/**
 * 纯渲染函数 —— 无副作用,由生成脚本与校验测试**共用**。
 *
 * 两者必须走同一条代码路径:输出哪怕只差一个换行,
 * 「是否已重新生成」的校验就会永远红或永远绿。
 * (与 `sdk/typescript/scripts/render.ts` 同一条不变式。)
 *
 * ## 映射表是这里唯一的判断
 *
 * IR 已经把「契约里是什么形状」答完了(`@dshwar/api-contract` 的 `model-ir`),
 * 本文件只答「Kotlin 里写成什么」。两件事分开,是为了让**漏字段**与
 * **映射错**成为两类可以分别断言的错 —— 混在一起的话,断言红的时候
 * 你不知道是哪一件。
 */
import { extractModels, type IrModel, type IrType } from '@dshwar/api-contract'

export const HEADER = [
  '// 由 packages/api-contract/openapi.json 自动生成 —— auto-generated,请勿手改。',
  '// 重新生成:pnpm --filter @dshwar/sdk-kotlin generate',
  '',
  'package ai.dshwar.sdk',
  '',
  'import kotlinx.serialization.SerialName',
  'import kotlinx.serialization.Serializable',
  'import kotlinx.serialization.json.JsonElement',
  '',
].join('\n')

/**
 * IR 类型 → Kotlin 类型。
 *
 * ⚠️ **`datetime` 映射成 `String` 而不是 `Instant`,是刻意的。**
 * `kotlinx.datetime` 是一个额外依赖,而 SDK 的定位是**薄**:
 * 时间戳按 ISO 8601 字符串原样交给调用方,由 App 自己决定用什么日期库。
 * 强塞一个日期类型等于替客户的 App 选依赖。
 *
 * ⚠️ **`integer` 映射成 `Long` 而不是 `Int`。** 契约里的整数含
 * token 计数与最小货币单位金额 —— 两者都能轻易越过 `Int` 的 21 亿。
 * 用 `Int` 的后果是**大额账单静默溢出**,而那是最不该出错的一处。
 */
export function kotlinType(type: IrType): string {
  switch (type.kind) {
    case 'string':
      return 'String'
    case 'datetime':
      return 'String'
    case 'integer':
      return 'Long'
    case 'boolean':
      return 'Boolean'
    case 'ref':
      return type.name
    case 'array':
      return `List<${kotlinType(type.items)}>`
    case 'enum':
      return 'String'
    case 'unknown':
      return 'JsonElement'
  }
}

/** `snake_case` / 保留字不做转换 —— 契约里的字段名已经是 lowerCamelCase。 */
function fieldName(name: string): string {
  return name
}

function renderModel(model: IrModel): string {
  const lines: string[] = []
  if (model.description !== undefined) lines.push(`/** ${model.description} */`)
  lines.push('@Serializable')
  lines.push(`data class ${model.name}(`)

  for (const [i, field] of model.fields.entries()) {
    const last = i === model.fields.length - 1
    if (field.description !== undefined) lines.push(`    /** ${field.description} */`)
    // 枚举渲染成 String 但把闭集写进注释 —— 调用方看得到取值范围,
    // 而 SDK 不因为契约加一个枚举值就变成破坏性升级
    if (field.type.kind === 'enum') {
      lines.push(`    // 取值:${field.type.values.join(' | ')}`)
    }
    const kt = kotlinType(field.type)
    const nullable = field.nullable ? '?' : ''
    const def = field.nullable ? ' = null' : ''
    lines.push(`    @SerialName("${field.name}")`)
    lines.push(`    val ${fieldName(field.name)}: ${kt}${nullable}${def}${last ? '' : ','}`)
  }

  lines.push(')')
  return lines.join('\n')
}

/**
 * 把 OpenAPI 文档渲染成 Kotlin 模型源码。
 *
 * 入参写 `Record<string, unknown>` 与 TS SDK 同一条理由:调用方拿到的就是
 * `JSON.parse` 的结果,让它们各自去断言等于把同一个断言抄两遍。
 */
export function renderKotlin(document: Record<string, unknown>): string {
  const models = extractModels(document)
  return `${HEADER}\n${models.map(renderModel).join('\n\n')}\n`
}
