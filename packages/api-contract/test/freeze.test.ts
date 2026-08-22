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

describe('闭集枚举:加值相容,删值破坏', () => {
  // ⚠️ **这条断言在 V0.4.6 被翻转了,理由要连着看。**
  //
  // 原本是「加值也是破坏性的」,理由是:契约把错误码定成 z.enum 就是为了让
  // 客户端写出可穷举的 switch,多一个值下游立刻编译失败。**那个理由在当时
  // 是对的** —— 前提是契约没有规定客户端怎么处理未知值。
  //
  // V0.4.6 先在契约里立下「客户端必须优雅处理未知枚举值」(见
  // `common.ts` 的 ErrorCode 说明),再放宽这条检查。**顺序不能反** ——
  // 只放宽检查是把安全网剪个洞。
  //
  // 为什么值得翻转:不加值的代价是让语义失真。V0.4.5 曾把「进程池满」
  // 映射成 rate_limited(你请求太多),于是客户端错误地限制自己,
  // 运维照着 429 曲线去调客户端限额,而根因是容量不足。
  it('给错误码加一个值 → 相容,不拦', () => {
    const after = clone(REAL)
    const error = after.components.schemas['ErrorResponse'] as {
      properties: { error: { properties: { code: { enum: string[] } } } }
    }
    error.properties.error.properties.code.enum.push('teapot')

    const diff = diffContract(REAL, after)
    expect(diff.map((c) => c.code)).toContain('enum.value.added')
    // 出现在 diff 里(可见),但不进破坏性清单(不拦)
    expect(breakingChanges(diff)).toEqual([])
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

// ============================================================================
// 策略一致性 —— **新增分类码时必须核对它与既有码是否冲突**(V0.8.0)
//
// ## 它拦的是什么
//
// V0.8.0 加 `diffUnion` 时,把「联合多了一个分支」判成了**破坏性**。
// 而同一件事在 `enum.value.added` 上是**相容**的,依据是 `common.ts` 明写的
// 契约级要求:「本枚举会在 v1 内追加新值……**同样的要求适用于
// `StreamEventType` 与其余所有闭集枚举**」。
//
// 于是仓库里同时存在两条对同一件事给出相反答案的规则,而后来的那条是错的:
// **给 SSE 加一个事件类型会被契约冻结检查拦住** —— 那正是 V0.4.6 放宽
// `enum.value.added` 时点名要允许的演进。
//
// ⚠️ 这不是「规则写错了」,是「**新规则落地时没有核对既有规则**」。
// 修好这一次只值一次;把核对变成一条会红的断言,才管住下一次。
//
// ## 判据:同一族的码必须同向
//
// 「闭集加一个成员」是一族,「闭集删一个成员」是另一族。
// 族内任何一条与其余不同向,就是有人在没核对的情况下引入了新规则。
// ============================================================================
describe('策略一致性:同一族的分类码必须同向', () => {
  /**
   * 「往闭集里加一个成员」—— 全部必须是**相容**。
   *
   * 依据是 `common.ts` 的契约级要求(客户端必须有 default 分支、
   * 不得断言穷尽),它明写覆盖「其余所有闭集枚举」。
   */
  const MEMBER_ADDED: { readonly what: string; readonly mutate: (doc: never) => void }[] = [
    {
      what: 'enum.value.added —— 错误码加一个值',
      mutate: (doc) => {
        const d = doc as unknown as Record<string, never>
        const e = (d['components'] as never as { schemas: Record<string, never> }).schemas[
          'ErrorResponse'
        ] as never as { properties: { error: { properties: { code: { enum: string[] } } } } }
        e.properties.error.properties.code.enum.push('zz.policy.probe')
      },
    },
    {
      what: 'schema.variant.added —— SSE 加一个事件类型',
      mutate: (doc) => {
        const d = doc as unknown as { components: { schemas: Record<string, unknown> } }
        const se = d.components.schemas['StreamEvent'] as { oneOf: unknown[] }
        se.oneOf.push({
          type: 'object',
          properties: { type: { type: 'string', const: 'zz.policy.probe' } },
          required: ['type'],
        })
      },
    },
    {
      what: 'response.added —— 端点加一个响应码',
      mutate: (doc) => {
        const d = doc as unknown as {
          paths: Record<string, Record<string, { responses: Record<string, unknown> }>>
        }
        d.paths['/v1/sessions']!['get']!.responses['599'] = { description: '探针' }
      },
    },
    {
      what: 'media.type.added —— 响应加一个媒体类型',
      mutate: (doc) => {
        const d = doc as unknown as {
          paths: Record<
            string,
            Record<string, { responses: Record<string, { content: Record<string, unknown> }> }>
          >
        }
        d.paths['/v1/sessions']!['get']!.responses['200']!.content['text/plain'] = {
          schema: { type: 'string' },
        }
      },
    },
  ]

  it('★ 「闭集加一个成员」一族全部相容 —— 一条不同向就是没核对既有规则', () => {
    let asserted = 0
    const offenders: string[] = []
    for (const c of MEMBER_ADDED) {
      const after = clone(REAL)
      c.mutate(after as never)
      // 变异必须真的改到东西,否则本条是空跑
      expect(JSON.stringify(after), `${c.what}:变异无效,本条空跑了`).not.toBe(JSON.stringify(REAL))
      asserted += 1
      const broke = codes(REAL, after)
      if (broke.length > 0) offenders.push(`${c.what} → ${broke.join(',')}`)
    }
    expect(asserted).toBe(MEMBER_ADDED.length)
    expect(
      offenders,
      '这些「加一个成员」被判成了破坏性,而同族的 enum.value.added 是相容的。\n' +
        '⚠️ 依据是 common.ts 明写的契约级要求:客户端必须有 default 分支,' +
        '「同样的要求适用于 StreamEventType 与其余所有闭集枚举」。\n' +
        '新增分类码时要先核对它与既有码、以及 common.ts 的策略是否冲突 ——' +
        'V0.8.0 的 schema.variant.added 就是这么错的。',
    ).toEqual([])
  })

  it('★ 「闭集删一个成员」一族全部破坏 —— 删值会让下游分支变成死代码', () => {
    /** 与上一条成对:只验加值放行,一个「什么都放行」的实现照样全绿。 */
    const MEMBER_REMOVED: { readonly what: string; readonly mutate: (doc: never) => void }[] = [
      {
        what: 'enum.value.removed',
        mutate: (doc) => {
          const d = doc as unknown as { components: { schemas: Record<string, unknown> } }
          const e = d.components.schemas['ErrorResponse'] as {
            properties: { error: { properties: { code: { enum: string[] } } } }
          }
          e.properties.error.properties.code.enum.pop()
        },
      },
      {
        what: 'schema.variant.removed',
        mutate: (doc) => {
          const d = doc as unknown as { components: { schemas: Record<string, unknown> } }
          const se = d.components.schemas['StreamEvent'] as { oneOf: unknown[] }
          se.oneOf.pop()
        },
      },
      {
        what: 'response.removed',
        mutate: (doc) => {
          const d = doc as unknown as {
            paths: Record<string, Record<string, { responses: Record<string, unknown> }>>
          }
          delete d.paths['/v1/sessions']!['get']!.responses['400']
        },
      },
      {
        what: 'media.type.removed',
        mutate: (doc) => {
          const d = doc as unknown as {
            paths: Record<
              string,
              Record<string, { responses: Record<string, { content: Record<string, unknown> }> }>
            >
          }
          delete d.paths['/v1/sessions']!['get']!.responses['200']!.content['application/json']
        },
      },
    ]

    let asserted = 0
    const missed: string[] = []
    for (const c of MEMBER_REMOVED) {
      const after = clone(REAL)
      c.mutate(after as never)
      expect(JSON.stringify(after), `${c.what}:变异无效,本条空跑了`).not.toBe(JSON.stringify(REAL))
      asserted += 1
      if (codes(REAL, after).length === 0) missed.push(c.what)
    }
    expect(asserted).toBe(MEMBER_REMOVED.length)
    expect(missed, '这些「删一个成员」被放行了 —— 下游正在处理的分支会变成死代码').toEqual([])
  })
})

describe('advisory 档不参与破坏性判定', () => {
  it('★ 约束收紧只进 advisory,不进 breaking —— 它判得出「变了」,判不出「破坏了谁」', () => {
    const after = clone(REAL) as unknown as { components: { schemas: Record<string, unknown> } }
    const session = after.components.schemas['Session'] as {
      properties: { id: { maxLength?: number } }
    }
    session.properties.id.maxLength = 10

    const all = diffContract(REAL, after)
    const advisory = all.filter((c) => c.kind === 'advisory')

    expect(advisory.length, '约束收紧一条 advisory 都没有 —— 这一档空转了').toBeGreaterThan(0)
    expect(advisory.every((c) => c.code === 'schema.constraint.tightened')).toBe(true)
    expect(
      codes(REAL, after),
      'maxLength 收紧被判成了破坏性 —— 它对只发短串的调用方毫无影响,' +
        '而误报会训练人跳过整条契约冻结检查',
    ).toEqual([])
  })
})
