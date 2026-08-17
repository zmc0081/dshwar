import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  buildOpenApiDocument,
  CredentialDescriptor,
  ErrorCode,
  ROUTES,
  SCHEMA_REGISTRY,
  StreamEventType,
} from '../src/index.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  version: string
}
const doc = buildOpenApiDocument(manifest.version)

describe('凭据端点:契约层就不给「值」留位置(硬规则 5)', () => {
  // 不是「实现方记得别返回值」，而是**没地方放**。
  // 实现方即便想泄漏，也要先改契约 —— 而改契约是有评审的。
  it('CredentialDescriptor 恰好只有 ref / configured / source / writable', () => {
    const json = z.toJSONSchema(CredentialDescriptor, { target: 'draft-2020-12' }) as {
      properties: Record<string, unknown>
    }
    expect(Object.keys(json.properties).sort()).toEqual(['configured', 'ref', 'source', 'writable'])
  })

  it('schema 里不存在任何名字像「值」的字段', () => {
    const serialized = JSON.stringify(doc.components.schemas['CredentialDescriptor']).toLowerCase()
    for (const forbidden of [
      '"value"',
      '"secret"',
      '"token"',
      '"key"',
      '"plaintext"',
      '"lastfour',
    ]) {
      expect(serialized, `字段名含 ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('additionalProperties 为 false —— 实现方不能塞额外字段', () => {
    const schema = doc.components.schemas['CredentialDescriptor'] as {
      additionalProperties?: unknown
    }
    expect(schema.additionalProperties).toBe(false)
  })

  it('凭据端点的响应链路上没有任何自由形状的对象', () => {
    const listSchema = doc.components.schemas['ListCredentialsResponse'] as {
      additionalProperties?: unknown
    }
    expect(listSchema.additionalProperties).toBe(false)
  })
})

describe('错误码是闭集', () => {
  // 闭集意味着 SDK 可以穷举成联合类型，调用方 switch 时编译器能查漏
  it('ErrorCode 是有限枚举,SDK 可穷举', () => {
    const values = ErrorCode.options
    expect(values.length).toBeGreaterThan(0)
    expect(new Set(values).size).toBe(values.length)
  })

  it('错误码集合与契约文档中出现的完全一致', () => {
    const inDocument = JSON.stringify(doc.components.schemas['ErrorResponse'])
    // 集合非空前置:枚举若被清空,下面的循环一次都不跑而测试仍「通过」。
    expect(ErrorCode.options.length, '错误码集合是空的,本条会空跑').toBeGreaterThan(0)
    for (const code of ErrorCode.options) {
      expect(inDocument, `文档缺少错误码 ${code}`).toContain(`"${code}"`)
    }
  })

  it('每个 planned 端点都能返回 not_implemented', () => {
    expect(ErrorCode.options).toContain('not_implemented')
  })

  // V0.4.6 起:**删**错误码是破坏性变更,**加**是相容的
  // (前提是契约规定了客户端必须有 default 分支,见 common.ts)。
  // 这条清单仍然钉死,但目的变了:不再是「不许动」,而是
  // **让每一次增删都必须是有人明确决定的**,而不是顺手改出来的。
  it('错误码清单被钉死 —— 删是破坏性变更,加需明确决定', () => {
    expect(ErrorCode.options).toEqual([
      'unauthorized',
      'forbidden',
      'not_found',
      'invalid_request',
      'conflict',
      'rate_limited',
      'unavailable',
      'not_implemented',
      'internal',
    ])
  })

  it('rate_limited 与 unavailable 是两个码 —— 语义相反,不得合并', () => {
    // 「你请求太多」vs「这台机器满了」。客户端的处置看起来一样(退避重试),
    // 含义却相反:前者该自我节流,后者该等扩容或换实例。
    // 合并会让客户端错误地限制自己,也会让运维照着 429 曲线调错东西。
    expect(ErrorCode.options).toContain('rate_limited')
    expect(ErrorCode.options).toContain('unavailable')
  })
})

describe('SSE 事件词表是闭集,且由 DSHWAR 定义', () => {
  it('事件类型被钉死', () => {
    expect(StreamEventType.options).toEqual([
      'turn.started',
      'message.delta',
      'reasoning.delta',
      'message.completed',
      'tool.started',
      'tool.completed',
      'turn.completed',
      'error',
      'ping',
    ])
  })

  // ARCHITECTURE.md §2.5：v1 的稳定性承诺不依赖 dsh 版本。
  // 事件名若沿用上游词表，上游改一个名字就逼我们升 v2。
  it('事件名不沿用上游词表(上游是 turn/start 斜杠式,我们是 turn.started 点式)', () => {
    expect(StreamEventType.options.length, '事件词表是空的,本条会空跑').toBeGreaterThan(0)
    for (const type of StreamEventType.options) {
      expect(type, `${type} 用了上游的斜杠式命名`).not.toContain('/')
    }
  })

  it('内部实现细节不出现在事件词表里', () => {
    // step/* 与 request/* 是 agent loop 的内部结构，暴露出去就变成我们要维护的契约
    for (const leaked of ['step', 'request.header', 'request.context', 'todo']) {
      expect(StreamEventType.options.join(' ')).not.toContain(leaked)
    }
  })
})

describe('横切约定 —— 决定第三方后台能不能自动生成', () => {
  it('所有列表端点用同一套游标分页参数', () => {
    const listRoutes = ROUTES.filter((r) => r.query !== undefined)
    expect(listRoutes.length).toBeGreaterThan(0)

    for (const route of listRoutes) {
      const params = z.toJSONSchema(route.query!, { target: 'draft-2020-12', io: 'input' }) as {
        properties: Record<string, unknown>
      }
      expect(
        Object.keys(params.properties).sort(),
        `${route.operationId} 的分页参数不一致`,
      ).toEqual(['cursor', 'limit', 'sort'])
    }
  })

  it('没有任何端点用 offset 分页', () => {
    expect(JSON.stringify(doc.paths)).not.toContain('"offset"')
  })

  it('所有 2xx 响应体都带 requestId', () => {
    // ★ 嵌套 continue 的循环最容易空跑:外层非空**不代表**内层跑过。
    //   数真正断言过的次数,而不是数集合长度。
    let asserted = 0
    for (const route of ROUTES) {
      for (const [status, response] of Object.entries(route.responses)) {
        if (Number(status) >= 300 || response.schema === undefined) continue
        asserted += 1
        const json = z.toJSONSchema(response.schema, { target: 'draft-2020-12', io: 'output' }) as {
          properties?: Record<string, unknown>
        }
        expect(
          Object.keys(json.properties ?? {}),
          `${route.operationId} 的 ${status} 响应缺 requestId`,
        ).toContain('requestId')
      }
    }
    expect(asserted, '一条 2xx 响应都没断言到 —— 本条空跑了').toBeGreaterThan(0)
  })

  it('所有错误响应用同一个 ErrorResponse', () => {
    let asserted = 0
    for (const route of ROUTES) {
      for (const [status, response] of Object.entries(route.responses)) {
        if (Number(status) < 400) continue
        asserted += 1
        expect(response.schema, `${route.operationId} 的 ${status} 没有错误 schema`).toBeDefined()
      }
    }
    expect(asserted, '一条错误响应都没断言到 —— 本条空跑了').toBeGreaterThan(0)
  })
})

describe('OpenAPI 文档结构', () => {
  it('是 3.1.0', () => {
    expect(doc.openapi).toBe('3.1.0')
  })

  it('info.version 与包版本一致(纳入 check-version)', () => {
    expect(doc.info.version).toBe(manifest.version)
  })

  it('三种鉴权方式分离声明(V0.6.0 起含 webhook 签名)', () => {
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual([
      'adminApiKey',
      'runtimeBearer',
      'webhookSignature',
    ])
  })

  // 一把 Admin Key 不得横跨租户;运维的 Key 不能冒充用户发起会话;
  // webhook 的凭证是签名,三者互不相认
  it('端点鉴权方式与声明一一对应,不混用', () => {
    const expected = {
      admin: 'adminApiKey',
      runtime: 'runtimeBearer',
      signature: 'webhookSignature',
    } as const
    for (const route of ROUTES) {
      const op = (doc.paths[route.path] as Record<string, { security: Record<string, unknown>[] }>)[
        route.method
      ]!
      const scheme = Object.keys(op.security[0]!)[0]
      expect(scheme, `${route.operationId} 的鉴权方式不对`).toBe(expected[route.auth])
    }
  })

  it('planned 端点(若有)标了 x-dshwar-status 与计划版本', () => {
    // V0.4.0 Session 4 起 planned 清零 —— 「契约完整,实现分期」走完了。
    // 断言从「必须有 planned」改为条件校验:契约将来再加 planned 端点时,
    // 标注纪律仍被钉住;现在为空不是缺陷,是里程碑。
    const planned = ROUTES.filter((r) => r.status === 'planned')

    for (const route of planned) {
      const op = (doc.paths[route.path] as Record<string, Record<string, unknown>>)[route.method]!
      expect(op['x-dshwar-status']).toBe('planned')
      expect(op['x-dshwar-planned-version']).toBeDefined()
      // 返回 501 而非 404 —— 404 会让第三方以为路径写错了
      expect(Object.keys(op['responses'] as object)).toContain('501')
    }
  })

  it('implemented 端点不返回 501', () => {
    for (const route of ROUTES.filter((r) => r.status === 'implemented')) {
      expect(Object.keys(route.responses), `${route.operationId} 不该有 501`).not.toContain('501')
    }
  })

  it('命名 schema 走 $ref,不逐处内联', () => {
    // 内联会让同一个 Session 在文档里出现多份副本，
    // 第三方生成器据此生成多个互不相干的类型
    const serialized = JSON.stringify(doc.paths)
    expect(serialized).toContain('#/components/schemas/')
    // Session 只应在 components 里有一份完整定义
    const inlineSessionDefs = serialized.split('"createdAt"').length - 1
    expect(inlineSessionDefs, 'Session 被内联进了 paths').toBe(0)
  })

  it('每个注册的 schema 都出现在 components 里', () => {
    for (const name of Object.keys(SCHEMA_REGISTRY)) {
      expect(doc.components.schemas[name], `${name} 未出现在 components`).toBeDefined()
    }
  })

  it('servers 不用 example.com 占位', () => {
    expect(JSON.stringify(doc.servers)).not.toContain('example.com')
  })
})

describe('openapi.json 与源码同步', () => {
  // 契约改了却忘了重新生成，第三方拿到的就是过期文档
  it('提交的 openapi.json 与当前 schema 生成结果逐字节一致', () => {
    const committed = readFileSync(join(packageRoot, 'openapi.json'), 'utf8')
    const regenerated = `${JSON.stringify(buildOpenApiDocument(manifest.version), null, 2)}\n`
    expect(
      committed,
      '契约已变更但 openapi.json 未重新生成 —— 跑 pnpm --filter @dshwar/api-contract generate',
    ).toBe(regenerated)
  })
})

describe('路由表自洽', () => {
  it('operationId 全局唯一', () => {
    const ids = ROUTES.map((r) => r.operationId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('同一路径的同一方法不重复', () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('全部路径以 /v1/ 开头 —— 路径版本化', () => {
    for (const route of ROUTES) {
      expect(route.path.startsWith('/v1/'), `${route.path} 未版本化`).toBe(true)
    }
  })

  it('每个端点都声明了 401', () => {
    for (const route of ROUTES) {
      expect(Object.keys(route.responses), `${route.operationId} 缺 401`).toContain('401')
    }
  })
})
