/**
 * 契约冻结的判定规则。
 *
 * 任务书要求的两条在最上面:破坏性变更必须红,加一个可选字段必须绿。
 * 后面几条是配套 —— 一条只会说「红」的规则和一条只会说「绿」的规则一样没用,
 * 两个方向都得验。
 */
import { describe, expect, it } from 'vitest'
import { breakingChanges, diffContract, type ContractChangeCode } from '../src/freeze.ts'
import { buildOpenApiDocument } from '../src/openapi.ts'

/**
 * 真实契约 —— 规则要对真东西成立,而不只是对手搓的小样本。
 *
 * 版本号在这里无关紧要:比对的两侧都由同一次调用克隆而来,`info.version`
 * 永远相等,判定只看结构。给个占位值即可,不必去读 package.json。
 */
const REAL = buildOpenApiDocument('0.0.0-freeze-test')

/** 深拷贝,免得改动泄漏到别的用例。 */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const codes = (before: unknown, after: unknown): ContractChangeCode[] =>
  breakingChanges(diffContract(before, after)).map((c) => c.code)

describe('任务书验收:两个方向都要成立', () => {
  it('人为做一次破坏性契约变更 → 必须红', () => {
    const after = clone(REAL)
    // 删掉一个已发布的端点。这是最直白的破坏:已接入的客户端立刻拿到 404。
    delete after.paths['/v1/sessions/{id}/turns']

    const breaking = breakingChanges(diffContract(REAL, after))
    expect(breaking.length).toBeGreaterThan(0)
    expect(breaking.map((c) => c.code)).toContain('path.removed')
  })

  it('加一个可选字段 → 必须绿', () => {
    const after = clone(REAL)
    const session = after.components.schemas['Session'] as {
      properties: Record<string, unknown>
      required?: string[]
    }
    session.properties['label'] = { type: 'string' }
    // 关键在于**不**把它加进 required

    const changes = diffContract(REAL, after)
    expect(breakingChanges(changes)).toEqual([])
    expect(changes.map((c) => c.code)).toContain('property.added')
  })
})

describe('破坏性的几种形态', () => {
  it('删端点', () => {
    const after = clone(REAL)
    delete after.paths['/v1/sessions']
    expect(codes(REAL, after)).toContain('path.removed')
  })

  it('删方法', () => {
    const after = clone(REAL)
    delete (after.paths['/v1/sessions/{id}'] as Record<string, unknown>)['delete']
    expect(codes(REAL, after)).toContain('operation.removed')
  })

  it('删类型', () => {
    const after = clone(REAL)
    delete after.components.schemas['Session']
    expect(codes(REAL, after)).toContain('schema.removed')
  })

  it('删字段', () => {
    const after = clone(REAL)
    const session = after.components.schemas['Session'] as { properties: Record<string, unknown> }
    delete session.properties['status']
    expect(codes(REAL, after)).toContain('property.removed')
  })

  it('新增的字段是必填的', () => {
    const after = clone(REAL)
    const session = after.components.schemas['Session'] as {
      properties: Record<string, unknown>
      required: string[]
    }
    session.properties['region'] = { type: 'string' }
    session.required.push('region')
    expect(codes(REAL, after)).toContain('property.required.added')
  })

  it('已有字段由可选改必填', () => {
    const before = {
      components: { schemas: { X: { properties: { a: { type: 'string' } }, required: [] } } },
    }
    const after = {
      components: { schemas: { X: { properties: { a: { type: 'string' } }, required: ['a'] } } },
    }
    expect(codes(before, after)).toContain('property.required.added')
  })

  it('已有字段由必填改可选 —— 响应侧同样是破坏', () => {
    const before = {
      components: { schemas: { X: { properties: { a: { type: 'string' } }, required: ['a'] } } },
    }
    const after = {
      components: { schemas: { X: { properties: { a: { type: 'string' } }, required: [] } } },
    }
    expect(codes(before, after)).toContain('property.required.relaxed')
  })

  it('字段换类型', () => {
    const before = { components: { schemas: { X: { properties: { a: { type: 'string' } } } } } }
    const after = { components: { schemas: { X: { properties: { a: { type: 'number' } } } } } }
    expect(codes(before, after)).toContain('property.type.changed')
  })

  it('查询参数变必填', () => {
    const before = {
      paths: { '/v1/sessions': { get: { parameters: [{ name: 'limit', in: 'query' }] } } },
    }
    const after = {
      paths: {
        '/v1/sessions': { get: { parameters: [{ name: 'limit', in: 'query', required: true }] } },
      },
    }
    expect(codes(before, after)).toContain('parameter.required.added')
  })
})

describe('闭集枚举:加值也是破坏性的', () => {
  // 这条最容易被误判成「加东西不算破坏」。契约把错误码定成 z.enum 就是为了让
  // 客户端写出可穷举的 switch —— 多一个值,下游已经写全的 switch 立刻编译失败。
  it('给错误码加一个值 → 红', () => {
    const after = clone(REAL)
    const error = after.components.schemas['ErrorResponse'] as {
      properties: { error: { properties: { code: { enum: string[] } } } }
    }
    error.properties.error.properties.code.enum.push('teapot')

    const breaking = breakingChanges(diffContract(REAL, after))
    expect(breaking.map((c) => c.code)).toContain('enum.value.added')
  })

  it('删一个枚举值 → 红', () => {
    const before = { components: { schemas: { X: { enum: ['a', 'b'] } } } }
    const after = { components: { schemas: { X: { enum: ['a'] } } } }
    expect(codes(before, after)).toContain('enum.value.removed')
  })
})

describe('相容变更必须放行 —— 否则规则等于禁止一切演进', () => {
  it('契约与自身比对没有任何差异', () => {
    expect(diffContract(REAL, clone(REAL))).toEqual([])
  })

  it('加端点', () => {
    const after = clone(REAL)
    after.paths['/v1/sessions/{id}/labels'] = { get: { responses: {} } }
    const changes = diffContract(REAL, after)
    expect(breakingChanges(changes)).toEqual([])
    expect(changes.map((c) => c.code)).toContain('path.added')
  })

  it('加类型', () => {
    const after = clone(REAL)
    after.components.schemas['Label'] = { type: 'object' }
    expect(breakingChanges(diffContract(REAL, after))).toEqual([])
  })

  it('加可选查询参数', () => {
    const before = { paths: { '/v1/sessions': { get: { parameters: [] } } } }
    const after = {
      paths: { '/v1/sessions': { get: { parameters: [{ name: 'q', in: 'query' }] } } },
    }
    expect(breakingChanges(diffContract(before, after))).toEqual([])
  })

  it('只改描述文案 —— 判定只看结构', () => {
    const before = {
      components: { schemas: { X: { type: 'object', description: '旧说法' } } },
    }
    const after = {
      components: { schemas: { X: { type: 'object', description: '新说法,写得清楚多了' } } },
    }
    expect(diffContract(before, after)).toEqual([])
  })
})
