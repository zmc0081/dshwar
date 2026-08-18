/**
 * Kotlin SDK 与契约的同步 —— **三道断言,各防一种坏法**。
 *
 * 起手式(CLAUDE.md 设计准则):第一问不是「生成器跑没跑」,
 * 而是「生成器坏掉时谁会红」。四种坏法与对应防线见
 * `docs/DECISIONS/mobile-sdk-generation.md`:
 *
 * | 坏法 | 本文件的哪一条 |
 * | --- | --- |
 * | 改了契约没重新生成 | §同步 |
 * | 悄悄漏掉 schema | §覆盖(数**出口**) |
 * | 类型映射错 | §映射(逐条) |
 * | 输出语法不合法 | ⚠️ **本文件管不了** —— 需要 kotlinc,当前是明写的缺口 |
 *
 * ⚠️ **「只验 TS 那条」在结构上不成立**:TS 渲染器会红,与 Kotlin 渲染器
 * 会不会红没有任何关系。三种语言的漏洞面各有一份,断言也必须各有一份。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { objectSchemaNames } from '@dshwar/api-contract'
import { describe, expect, it } from 'vitest'
import { kotlinType, renderKotlin } from '../scripts/render.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(packageRoot, 'src', 'generated', 'Models.kt')
const contractPath = join(packageRoot, '..', '..', 'packages', 'api-contract', 'openapi.json')

const committed = readFileSync(generated, 'utf8')
const document = JSON.parse(readFileSync(contractPath, 'utf8')) as Record<string, unknown>

describe('同步:契约改了必须重新生成', () => {
  it('★ 重新生成的结果与已提交的一致', () => {
    // 复用生成脚本自己的渲染函数,而不是另写一遍:
    // 两条代码路径的输出哪怕只差一个换行,这个校验就会永远红或永远绿
    expect(
      committed.trim(),
      '契约已变更但 Kotlin SDK 未重新生成 —— 跑 pnpm --filter @dshwar/sdk-kotlin generate',
    ).toBe(renderKotlin(document).trim())
  })

  it('★ 契约变了而未重新生成时**真的**会被发现', () => {
    // 上面那条只在「生成器对契约变动有反应」时才有意义。这条确认它有。
    const mutated = JSON.parse(JSON.stringify(document)) as typeof document
    const schemas = (mutated['components'] as { schemas: Record<string, Record<string, unknown>> })
      .schemas
    const session = schemas['Session'] as { properties: Record<string, unknown> }
    session.properties = { ...session.properties, stowawayField: { type: 'string' } }

    expect(renderKotlin(mutated)).not.toBe(committed)
  })

  it('生成文件带「请勿手改」的标记', () => {
    expect(committed).toContain('auto-generated')
  })
})

describe('覆盖:生成器不得悄悄漏掉 schema', () => {
  it('★ 契约里每个 object schema 都有对应的 data class(数出口)', () => {
    const names = objectSchemaNames(document)
    // 判据在出口不在入口:数**真的断言过几次**,而不是数集合长度
    let asserted = 0
    for (const name of names) {
      asserted += 1
      expect(committed, `契约里有 ${name},而 Kotlin 产物里没有对应的 data class`).toContain(
        `data class ${name}(`,
      )
    }
    expect(asserted, '一个 schema 都没断言到 —— 本条空跑了').toBeGreaterThan(20)
  })

  it('产物里的 data class 数量与契约的 object schema 数量相等', () => {
    // 上一条只查「契约里有的产物里都有」;这条查反方向 ——
    // 产物里多出来的东西同样是 bug(生成器凭空造了一个模型)
    const emitted = (committed.match(/^data class /gm) ?? []).length
    expect(emitted).toBe(objectSchemaNames(document).length)
  })
})

describe('映射:契约类型 → Kotlin 类型,逐条钉死', () => {
  it('★ 整数映射成 Long,不是 Int', () => {
    // Int 是 32 位。契约里的整数含 token 计数与最小货币单位金额,
    // 两者都能轻易越过 21 亿 —— 用 Int 的后果是**大额账单静默溢出**。
    expect(kotlinType({ kind: 'integer' })).toBe('Long')
    expect(committed, '金额字段不是 Long —— 大额会静默溢出').toContain('val costMinorUnits: Long')
  })

  it('日期时间映射成 String,不引 kotlinx.datetime', () => {
    // SDK 要薄:强塞一个日期类型等于替客户的 App 选依赖
    expect(kotlinType({ kind: 'datetime' })).toBe('String')
  })

  it('可空字段带 ? 且有默认值 null', () => {
    expect(committed).toContain('val model: String? = null')
  })

  it('必填字段既不带 ? 也没有默认值', () => {
    expect(committed).toMatch(/val subjectId: String,?\n/)
    expect(committed).not.toContain('val subjectId: String?')
  })

  it('数组映射成 List<T>', () => {
    expect(kotlinType({ kind: 'array', items: { kind: 'string' } })).toBe('List<String>')
  })

  it('引用映射成对应的类名', () => {
    expect(kotlinType({ kind: 'ref', name: 'Session' })).toBe('Session')
  })

  it('不透明结构映射成 JsonElement,而不是 String', () => {
    // 映射成 String 会让调用方拿到一段 JSON 文本还得自己再解一次 ——
    // 而且那一次解析没有任何类型保护
    expect(kotlinType({ kind: 'unknown' })).toBe('JsonElement')
  })

  it('枚举渲染成 String,但取值闭集写进注释', () => {
    // 不渲染成 Kotlin enum 是刻意的:契约加一个枚举值属于相容变更,
    // 而 Kotlin enum 的反序列化会在遇到未知值时抛 —— 那会让一次相容的
    // 契约演进变成客户 App 的崩溃
    expect(kotlinType({ kind: 'enum', values: ['idle', 'running'] })).toBe('String')
    expect(committed).toContain('// 取值:idle | running')
  })
})
