/**
 * 由路由表与 Zod schema 装配 OpenAPI 3.1 文档。
 *
 * OpenAPI 3.1 的 schema 方言**就是** JSON Schema 2020-12,所以 Zod 4 的
 * `z.toJSONSchema(…, { target: 'draft-2020-12' })` 输出可以直接嵌入 ——
 * 不需要第三方转换器。少一个会滞后于 Zod 版本的活动部件。
 *
 * 命名 schema 走 `components/schemas` 引用而非内联,见 `registry.ts`。
 *
 * @module @dshwar/api-contract/openapi
 */
import { z } from 'zod'
import { buildComponentSchemas, nameOf, schemaRef } from './registry.ts'
import { ROUTES, type RouteDef } from './routes.ts'

/** OpenAPI 文档的最小结构类型。刻意不引 openapi-types —— 只用得到这几个字段。 */
export interface OpenApiDocument {
  openapi: string
  info: {
    title: string
    version: string
    description: string
    license: { name: string; identifier: string }
  }
  servers: { url: string; description: string; variables?: Record<string, unknown> }[]
  tags: { name: string; description: string }[]
  security: Record<string, string[]>[]
  paths: Record<string, Record<string, unknown>>
  components: {
    securitySchemes: Record<string, unknown>
    schemas: Record<string, unknown>
  }
}

/** 命名 schema 出 `$ref`,匿名的内联。 */
function schemaOrRef(schema: z.ZodType): Record<string, unknown> {
  const name = nameOf(schema)
  if (name !== undefined) return schemaRef(name)

  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as Record<
    string,
    unknown
  >
  delete json['$schema']
  return json
}

/** 把 Zod object 的每个字段拆成 OpenAPI 的 parameter 条目。 */
function toParameters(
  schema: z.ZodObject | undefined,
  location: 'path' | 'query',
): Record<string, unknown>[] {
  if (schema === undefined) return []
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<
    string,
    unknown
  >
  const properties = (json['properties'] ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set((json['required'] ?? []) as string[])

  return Object.entries(properties).map(([name, propSchema]) => {
    const { description, ...rest } = propSchema
    return {
      name,
      in: location,
      // path 参数按 OpenAPI 规范必须 required
      required: location === 'path' ? true : required.has(name),
      ...(description === undefined ? {} : { description }),
      schema: rest,
    }
  })
}

function buildOperation(route: RouteDef): Record<string, unknown> {
  const parameters = [
    ...toParameters(route.pathParams, 'path'),
    ...toParameters(route.query, 'query'),
    ...(route.headers ?? []).map((h) => ({
      name: h.name,
      in: 'header',
      required: h.required,
      description: h.description,
      schema: { type: 'string' },
    })),
  ]

  const responses: Record<string, unknown> = {}
  for (const [status, response] of Object.entries(route.responses)) {
    const isSse = response.contentType === 'text/event-stream'
    responses[status] = {
      description: response.description,
      ...(response.schema === undefined && !isSse
        ? {}
        : {
            content: isSse
              ? {
                  // OpenAPI 没有描述 SSE 分帧的一等语法。通行做法(OpenAI 的 spec
                  // 亦然)是让 text/event-stream 的 schema 指向**单条事件**的载荷,
                  // 由 description 说明分帧 —— SDK 生成器认这个形状。
                  //
                  // 早先试过 `type: string` + 扩展字段指向载荷,结果 redocly 的
                  // no-unused-components 报 StreamEvent 未被引用:工具不遍历扩展字段,
                  // 而「靠扩展字段传递关键语义」本来就会被工具链系统性忽略。
                  'text/event-stream': { schema: schemaRef('StreamEvent') },
                }
              : { 'application/json': { schema: schemaOrRef(response.schema as z.ZodType) } },
          }),
      ...(Number(status) === 501 && route.plannedVersion !== undefined
        ? {
            headers: {
              'x-dshwar-planned-version': {
                description: '计划实现该端点的版本',
                schema: { type: 'string', const: route.plannedVersion },
              },
            },
          }
        : {}),
    }
  }

  return {
    operationId: route.operationId,
    summary: route.summary,
    ...(route.description === undefined ? {} : { description: route.description }),
    tags: [...route.tags],
    security: [
      {
        [route.auth === 'admin'
          ? 'adminApiKey'
          : route.auth === 'signature'
            ? 'webhookSignature'
            : 'runtimeBearer']: [],
      },
    ],
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(route.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOrRef(route.body) } },
          },
        }),
    responses,
    // 第三方工具(Refine / Appsmith)据此跳过尚未实现的端点
    'x-dshwar-status': route.status,
    ...(route.plannedVersion === undefined
      ? {}
      : { 'x-dshwar-planned-version': route.plannedVersion }),
  }
}

/**
 * 生成 OpenAPI 3.1 文档。
 *
 * @param version `info.version`,必须与全仓版本号一致(CLAUDE.md 第四节)
 * @returns 完整文档
 */
export function buildOpenApiDocument(version: string): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of ROUTES) {
    const entry = paths[route.path] ?? {}
    entry[route.method] = buildOperation(route)
    paths[route.path] = entry
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'DSHWAR API',
      version,
      description: [
        'DeepSeek Harness 之上的 ToB 产品基座的 API 平面。',
        '',
        '**这份契约的稳定性承诺不依赖上游 dsh 版本。** 事件词表、错误码、资源形状',
        '全部由 DSHWAR 定义并版本化 —— 上游改接口时,受影响的是网关内部的翻译层,',
        '不是这份契约。',
        '',
        '标注 `x-dshwar-status: planned` 的端点契约完整但尚未实现,调用返回 501,',
        '响应头 `x-dshwar-planned-version` 指出计划版本。它们返回 501 而非 404,',
        '是为了让第三方知道「这个端点是真的,只是还没到」。',
      ].join('\n'),
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [
      {
        // 不写死域名:部署方各自的域。用变量而非 example.com 占位
        url: '{scheme}://{host}',
        description: '部署方自有域名。TLS 由反向代理终结,网关不自己管证书',
        variables: {
          scheme: { default: 'https', enum: ['https', 'http'] },
          host: { default: 'dshwar.localhost:3000' },
        },
      },
    ],
    tags: [
      { name: 'sessions', description: '运行时 API:会话与流式输出' },
      { name: 'admin', description: '管理 API。与运行时令牌分离签发' },
      { name: 'credentials', description: '凭据配置状态。永不返回值' },
      { name: 'subjects', description: '用户镜像(V0.3.0)' },
      { name: 'quota', description: '配额(V0.4.0)' },
      { name: 'usage', description: '用量(V0.4.0)' },
      { name: 'policies', description: '模型准入与预算策略(V0.4.0)' },
      { name: 'audit', description: '审计查询(V0.3.0)' },
    ],
    security: [{ runtimeBearer: [] }],
    paths,
    components: {
      securitySchemes: {
        runtimeBearer: {
          type: 'http',
          scheme: 'bearer',
          description: '终端用户令牌。由部署方的 IdP 签发,DSHWAR 只验证与映射',
        },
        adminApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-DSHWAR-Admin-Key',
          description:
            '**按租户签发**,一把钥匙不得横跨租户。与运行时令牌分离 —— 供给系统只能写身份镜像,不能读用量与凭据配置',
        },
        webhookSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'Stripe-Signature',
          description:
            'webhook 专用(V0.6.0):凭证是请求体的 HMAC-SHA256 签名,时间戳参与签名以抗重放。无签名或签名无效统一 401,不区分原因',
        },
      },
      schemas: buildComponentSchemas(),
    },
  }
}
