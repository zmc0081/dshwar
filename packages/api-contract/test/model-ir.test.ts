/**
 * IR 的**引用**这一维 —— 它是 V0.9.0 里唯一一个「生成得出来、编译不过」的洞。
 *
 * ## 那次发生了什么
 *
 * `Job.status` 是 `$ref: JobStatus`,而 `JobStatus` 是一个**顶层字符串枚举**,
 * 不是 object。`extractModels` 只给 object 出模型,`readType` 却无条件把
 * 任何 `$ref` 变成 `{kind:'ref'}` —— 于是 Kotlin / Swift 的产物里
 * `JobStatus` **被引用却从未声明**,两种语言都编译不过。
 *
 * 🚨 **两个版本里没有任何东西发现它**,而当时已有的断言看起来很密:
 *
 * | 已有的断言 | 为什么没抓到 |
 * | --- | --- |
 * | 三道「与契约同步」断言 | 比的是**文本** —— 那个引用被忠实地生成了 |
 * | 覆盖断言(每个 object schema 都出模型) | 两侧用**同一个谓词**,JobStatus 被同时排除 |
 * | TS SDK 的 tsc | openapi-typescript 会发射全部 components,它没这个洞 |
 *
 * ⇒ 所以这里断言的是**另一个方向**:引用 ⊆ 声明。
 * 覆盖断言问「object 都出模型了吗」,这条问「被引用的名字都存在吗」——
 * 后者才是当时坏掉的那个。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { extractModels, objectSchemaNames, UnsupportedSchemaError } from '../src/index.js'

// 与 contract.test.ts 同款:**读文件**而不是 import JSON。
// JSON import 要把 openapi.json 挂进 tsconfig.test.json 的 include,
// 而那份配置刻意只收 test/**/*.ts(理由写在它自己的注释里)。
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const openapi = JSON.parse(readFileSync(join(packageRoot, 'openapi.json'), 'utf8'))

/** 造一份最小文档 —— 只放这条测试关心的那几个键。 */
function doc(schemas: Record<string, unknown>): Record<string, unknown> {
  return { components: { schemas } }
}

describe('IR 的引用完整性', () => {
  it('指向顶层字符串枚举的 $ref 展开成内联枚举,不留下一个悬空的类型名', () => {
    const models = extractModels(
      doc({
        Status: { type: 'string', enum: ['a', 'b'] },
        Job: { type: 'object', properties: { status: { $ref: '#/components/schemas/Status' } } },
      }),
    )
    const job = models.find((m) => m.name === 'Job')
    expect(job).toBeDefined()
    expect(job?.fields[0]?.type).toEqual({ kind: 'enum', values: ['a', 'b'] })
    // ★ 关键:不能是 ref —— 那个名字不会有声明。
    expect(job?.fields[0]?.type.kind).not.toBe('ref')
  })

  it('指向 object 的 $ref 仍然是 ref(修法不是「所有 $ref 都展开」)', () => {
    const models = extractModels(
      doc({
        Inner: { type: 'object', properties: { x: { type: 'string' } } },
        Outer: { type: 'object', properties: { inner: { $ref: '#/components/schemas/Inner' } } },
      }),
    )
    expect(models.find((m) => m.name === 'Outer')?.fields[0]?.type).toEqual({
      kind: 'ref',
      name: 'Inner',
    })
  })

  it('数组元素里的 $ref 走同一条路', () => {
    const models = extractModels(
      doc({
        Status: { type: 'string', enum: ['a'] },
        Job: {
          type: 'object',
          properties: {
            history: { type: 'array', items: { $ref: '#/components/schemas/Status' } },
          },
        },
      }),
    )
    expect(models.find((m) => m.name === 'Job')?.fields[0]?.type).toEqual({
      kind: 'array',
      items: { kind: 'enum', values: ['a'] },
    })
  })

  it('悬空的 $ref 抛,而不是生成一个引用不存在类型的字段', () => {
    expect(() =>
      extractModels(
        doc({ Job: { type: 'object', properties: { x: { $ref: '#/components/schemas/Nope' } } } }),
      ),
    ).toThrow(UnsupportedSchemaError)
  })

  it('别名成环时抛,不无限递归', () => {
    expect(() =>
      extractModels(
        doc({
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
          Job: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
        }),
      ),
    ).toThrow(UnsupportedSchemaError)
  })

  it('★ 真实契约:每个 ref 都指向一个真的出了模型的名字', () => {
    const models = extractModels(openapi as Record<string, unknown>)
    const declared = new Set(models.map((m) => m.name))

    // ★ 出口计数:真实契约里必须**真的有** ref,否则这条断言空跑 ——
    //   而空跑与通过在输出上一模一样。
    let checked = 0
    const walk = (t: { kind: string; name?: string; items?: unknown }): void => {
      if (t.kind === 'ref') {
        checked += 1
        expect(declared, `${String(t.name)} 被引用却没有声明`).toContain(t.name)
      }
      if (t.kind === 'array') walk(t.items as { kind: string; name?: string; items?: unknown })
    }
    for (const m of models) for (const f of m.fields) walk(f.type)

    expect(checked, '真实契约里一个 ref 都没数到 —— 本条空跑了').toBeGreaterThan(0)
  })

  it('★ 覆盖断言与引用断言问的不是同一件事(JobStatus 证明过这一点)', () => {
    const document = openapi as Record<string, unknown>
    const schemas = (document['components'] as { schemas: Record<string, unknown> }).schemas
    const named = objectSchemaNames(document)

    // 契约里确实存在「不出模型、但被引用」的 schema —— 若哪天不存在了,
    // 上面那些用例就都是在防一个不再发生的事,而这条会提醒重新想一遍。
    const notModels = Object.keys(schemas).filter((n) => !named.includes(n))
    expect(
      notModels.length,
      '契约里已经没有非 object 的 schema 了 —— 重新想一遍这一族断言',
    ).toBeGreaterThan(0)
    expect(notModels).toContain('JobStatus')
  })
})
