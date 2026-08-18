/**
 * Swift SDK 与契约的同步 —— **三道断言,各防一种坏法**。
 *
 * 结构与 `sdk/kotlin/test/generated.test.ts` 平行,而**内容不共用**:
 * 共用一份参数化测试会让「Kotlin 的断言」与「Swift 的断言」变成同一条 ——
 * 而那正是「只验 TS 那条不算数」要避免的形状。**三种语言各红各的。**
 *
 * ⚠️ 语法合法性(第四种坏法)本文件管不了 —— 需要 swift 编译器,
 * 当前是明写的缺口,见 `docs/DECISIONS/mobile-sdk-generation.md` §四。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { objectSchemaNames } from '@dshwar/api-contract'
import { describe, expect, it } from 'vitest'
import { renderSwift, swiftType } from '../scripts/render.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(packageRoot, 'src', 'generated', 'Models.swift')
const contractPath = join(packageRoot, '..', '..', 'packages', 'api-contract', 'openapi.json')

const committed = readFileSync(generated, 'utf8')
const document = JSON.parse(readFileSync(contractPath, 'utf8')) as Record<string, unknown>

describe('同步:契约改了必须重新生成', () => {
  it('★ 重新生成的结果与已提交的一致', () => {
    expect(
      committed.trim(),
      '契约已变更但 Swift SDK 未重新生成 —— 跑 pnpm --filter @dshwar/sdk-swift generate',
    ).toBe(renderSwift(document).trim())
  })

  it('★ 契约变了而未重新生成时**真的**会被发现', () => {
    const mutated = JSON.parse(JSON.stringify(document)) as typeof document
    const schemas = (mutated['components'] as { schemas: Record<string, Record<string, unknown>> })
      .schemas
    const session = schemas['Session'] as { properties: Record<string, unknown> }
    session.properties = { ...session.properties, stowawayField: { type: 'string' } }

    expect(renderSwift(mutated)).not.toBe(committed)
  })

  it('生成文件带「请勿手改」的标记', () => {
    expect(committed).toContain('auto-generated')
  })
})

describe('覆盖:生成器不得悄悄漏掉 schema', () => {
  it('★ 契约里每个 object schema 都有对应的 struct(数出口)', () => {
    let asserted = 0
    for (const name of objectSchemaNames(document)) {
      asserted += 1
      expect(committed, `契约里有 ${name},而 Swift 产物里没有对应的 struct`).toContain(
        `public struct ${name}: Codable, Sendable {`,
      )
    }
    expect(asserted, '一个 schema 都没断言到 —— 本条空跑了').toBeGreaterThan(20)
  })

  it('产物里的 struct 数量与契约的 object schema 数量相等', () => {
    const emitted = (committed.match(/^public struct /gm) ?? []).length
    expect(emitted).toBe(objectSchemaNames(document).length)
  })
})

describe('映射:契约类型 → Swift 类型,逐条钉死', () => {
  it('★ 整数映射成 Int64,不是 Int', () => {
    // Int 在 32 位平台上是 32 位。契约里的整数含 token 计数与最小货币单位
    // 金额,两者都能越过 21 亿 —— 后果是**大额账单静默溢出**。
    expect(swiftType({ kind: 'integer' })).toBe('Int64')
    expect(committed, '金额字段不是 Int64 —— 大额会静默溢出').toContain(
      'public let costMinorUnits: Int64',
    )
  })

  it('日期时间映射成 String,不用 Date', () => {
    // 用 Date 会引入 JSONDecoder.dateDecodingStrategy 的配置耦合 ——
    // 策略配错的表现是**日期静默偏移**,而不是报错
    expect(swiftType({ kind: 'datetime' })).toBe('String')
  })

  it('可空字段带 ?,构造器参数默认 nil', () => {
    expect(committed).toContain('public let model: String?')
    expect(committed).toContain('model: String? = nil')
  })

  it('数组映射成 [T]', () => {
    expect(swiftType({ kind: 'array', items: { kind: 'string' } })).toBe('[String]')
  })

  it('不透明结构映射成 AnyCodable —— Any 不是 Codable', () => {
    expect(swiftType({ kind: 'unknown' })).toBe('AnyCodable')
  })

  it('★ 每个 struct 都有 public 构造器 —— 否则跨模块造不出来', () => {
    // Swift 合成的 memberwise initializer 是 internal 的,
    // SDK 使用方(另一个模块)用不了。少了这一段,SDK 能编译但不能用。
    const structs = (committed.match(/^public struct /gm) ?? []).length
    const inits = (committed.match(/^ {4}public init\(/gm) ?? []).length
    expect(inits, 'struct 数与 public init 数对不上 —— 有模型跨模块造不出来').toBe(structs)
  })

  it('声明 Sendable —— 移动端要跨并发域传', () => {
    expect(committed).toContain(': Codable, Sendable {')
  })
})
