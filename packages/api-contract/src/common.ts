/**
 * 横切约定:错误形状、分页、requestId。
 *
 * 这一层决定第三方后台(Refine / Appsmith / AdminJS)能不能**自动**生成界面。
 * 每个端点各写一套分页参数、各返回一种错误形状,自动生成就退化成手工适配 ——
 * 而「对方后台点几下就通了」正是 API 平面作为护城河的一半价值。
 *
 * @module @dshwar/api-contract/common
 */
import { z } from 'zod'

/**
 * 错误码 —— **闭集**。
 *
 * 闭集意味着 SDK 可以把它穷举成一个联合类型,调用方 `switch` 时编译器能查漏。
 * 开放的字符串错误码等于让每个调用方各自猜哪些值可能出现,而猜错的代价
 * 通常是一条永远不会命中的 `else` 分支。
 *
 * **加错误码是破坏性变更**:调用方的穷举 `switch` 会因此漏掉新分支。
 * 新增必须升 v2,或者在 v1 里复用既有码。这条约束刻意写死在这里,
 * 而不是留给「以后注意点」。
 */
export const ErrorCode = z.enum([
  /** 凭证缺失、无效或已过期。**刻意不区分原因** —— 认证接口是预言机。 */
  'unauthorized',
  /** 已认证,但该主体无权访问此资源。 */
  'forbidden',
  /** 资源不存在,或存在但不属于该主体(两者刻意不可区分)。 */
  'not_found',
  /** 请求体或参数不满足 schema。`message` 指出哪个字段。 */
  'invalid_request',
  /** 与资源当前状态冲突(如向已结束的会话发起一轮)。 */
  'conflict',
  /** 触发限流。 */
  'rate_limited',
  /** 端点已在契约中定义,但本版本尚未实现。见 `x-dshwar-status: planned`。 */
  'not_implemented',
  /** 服务端内部错误。`message` 不含内部细节,凭 `requestId` 查日志。 */
  'internal',
])

export type ErrorCode = z.infer<typeof ErrorCode>

/**
 * 统一错误形状。
 *
 * `requestId` 是这个形状里最实用的字段:客户报障时给一个 id,运维就能在日志与
 * 审计里精确定位那一次调用。没有它,排障要从「大概几点、大概什么操作」开始。
 */
export const ErrorResponse = z
  .object({
    error: z.object({
      code: ErrorCode.meta({ description: '闭集错误码,SDK 可穷举' }),
      message: z
        .string()
        .meta({ description: '面向开发者的说明。不含内部细节、不含凭证、不含他人数据' }),
      requestId: z.string().meta({ description: '与服务端日志和审计记录对得上的调用标识' }),
    }),
  })
  .meta({
    id: 'ErrorResponse',
    description: '所有非 2xx 响应的统一形状',
  })

export type ErrorResponse = z.infer<typeof ErrorResponse>

/**
 * 列表端点的分页参数 —— **游标分页,不用 offset**。
 *
 * offset 分页在数据变动时会漏项与重项:翻到第 2 页时第 1 页插入了一条,
 * 第 2 页的首项就是刚才看过的那条,而末尾那条被挤到了第 3 页且永远不会被看到。
 * 对「列出用量」「列出审计」这类持续追加的数据,这不是理论问题。
 */
export const PaginationQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .meta({ description: '本页最多返回多少条' }),
  cursor: z.string().optional().meta({ description: '上一页返回的 nextCursor;首页省略' }),
  sort: z.string().optional().meta({ description: '排序字段,前缀 `-` 表示降序(如 `-createdAt`)' }),
})

export type PaginationQuery = z.infer<typeof PaginationQuery>

/**
 * 列表响应的信封。
 *
 * @param item 单条记录的 schema
 */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    /** 下一页游标;为 `null` 表示已到末页。 */
    nextCursor: z.string().nullable(),
    requestId: z.string(),
  })
}

/** 所有 2xx 响应都带 `requestId`,与错误响应对称。 */
export const RequestIdField = {
  requestId: z.string().meta({ description: '与服务端日志和审计记录对得上的调用标识' }),
}

/**
 * 主体标识 —— 稳定、不可轮换。
 *
 * 与 `@dshwar/principal` 的约束一致:**不得使用邮箱**。契约层不做正则校验
 * (合法形状五花八门,见 `packages/principal` 的说明),但在文档里写死这条要求。
 */
export const SubjectId = z.string().min(1).max(256).meta({
  description:
    '主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱',
})

/** 会话标识,由服务端生成。 */
export const SessionId = z.string().min(1).max(256).meta({ description: '会话标识,服务端生成' })
