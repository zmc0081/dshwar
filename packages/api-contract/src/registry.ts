/**
 * 命名 schema 的注册表。
 *
 * OpenAPI 里的 schema 应当**引用** `components/schemas` 而不是逐处内联:
 * 内联会让同一个 `Session` 在文档里出现四份副本,而第三方生成器
 * (Refine / Appsmith / openapi-typescript)会据此生成四个互不相干的类型。
 *
 * Zod 4 的 `z.toJSONSchema(registry, { uri })` 正好产出这个形状。
 *
 * @module @dshwar/api-contract/registry
 */
import { z } from 'zod'
import {
  AuditEntry,
  CredentialDescriptor,
  GetQuotaResponse,
  GetSubjectResponse,
  ListAuditResponse,
  ListCredentialsResponse,
  ListPoliciesResponse,
  ListSubjectsResponse,
  ListUsageResponse,
  Policy,
  Quota,
  Subject,
  UpdateQuotaRequest,
  UsageRecord,
} from './admin.ts'
import { ErrorResponse } from './common.ts'
import { StreamEvent } from './events.ts'
import {
  CreateSessionRequest,
  CreateSessionResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  DeleteSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
  Session,
} from './runtime.ts'

/**
 * 全部命名 schema。**新增 schema 必须在此登记** —— 漏登记的会在生成时
 * 被内联进每个引用它的地方,而那正是本模块要避免的事。
 * `openapi.test.ts` 有一条断言盯着这件事。
 */
export const SCHEMA_REGISTRY: Readonly<Record<string, z.ZodType>> = {
  // 横切
  ErrorResponse,
  // 流式
  StreamEvent,
  // 运行时
  Session,
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
  CreateTurnRequest,
  CreateTurnResponse,
  DeleteSessionResponse,
  // Admin
  CredentialDescriptor,
  ListCredentialsResponse,
  Subject,
  ListSubjectsResponse,
  GetSubjectResponse,
  Quota,
  GetQuotaResponse,
  UpdateQuotaRequest,
  UsageRecord,
  ListUsageResponse,
  Policy,
  ListPoliciesResponse,
  AuditEntry,
  ListAuditResponse,
}

/** OpenAPI 里引用某个命名 schema 的 `$ref`。 */
export function schemaRef(name: keyof typeof SCHEMA_REGISTRY | string): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` }
}

/** 反查一个 schema 的注册名;未登记则返回 undefined。 */
export function nameOf(schema: z.ZodType): string | undefined {
  for (const [name, registered] of Object.entries(SCHEMA_REGISTRY)) {
    if (registered === schema) return name
  }
  return undefined
}

/**
 * 生成 `components.schemas`。
 *
 * @returns 每个命名 schema 的 JSON Schema,内部互相引用已改写为
 *   `#/components/schemas/X`
 */
export function buildComponentSchemas(): Record<string, unknown> {
  const registry = z.registry<{ id: string }>()
  for (const [name, schema] of Object.entries(SCHEMA_REGISTRY)) {
    registry.add(schema, { id: name })
  }

  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io: 'output',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, Record<string, unknown>> }

  // `$schema` 与 `$id` 是文档级/顶层声明,嵌进 components 条目里是噪音,
  // 且 redocly 会对 components 内的 $id 报警
  const cleaned: Record<string, unknown> = {}
  for (const [name, schema] of Object.entries(schemas)) {
    const { $schema, $id, ...rest } = schema
    cleaned[name] = rest
  }
  return cleaned
}
