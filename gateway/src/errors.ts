/**
 * 统一错误处理。
 *
 * 契约里 `ErrorResponse` 的形状是 `{ error: { code, message, requestId } }`,
 * 这里是它在服务端的唯一出口 —— 任何 handler 都不该自己拼错误 JSON,
 * 否则「统一形状」会在第三个 handler 上失效。
 *
 * @module @dshwar/gateway/errors
 */
import type { ErrorCode } from '@dshwar/api-contract'
import type { Context as HonoContext } from 'hono'

/** 错误码 → HTTP 状态码。契约里的闭集在这里各就各位。 */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  not_implemented: 501,
  internal: 500,
}

/**
 * 网关抛出的错误。
 *
 * `message` 会原样进入响应体,因此**不得**包含内部细节、凭证或他人数据。
 * 需要给运维看的细节走日志,凭 `requestId` 对上。
 */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly code: ErrorCode
  /** 501 响应用:计划实现该端点的版本。 */
  readonly plannedVersion: string | undefined

  constructor(code: ErrorCode, message: string, plannedVersion?: string) {
    super(message)
    this.code = code
    this.plannedVersion = plannedVersion
  }

  get status(): number {
    return STATUS_BY_CODE[this.code]
  }
}

/**
 * 认证失败的统一出口。
 *
 * ⚠️ **调用方不得传入具体原因。** `@dshwar/auth` 的 `AuthError` 刻意不携带失败原因
 * (认证接口是预言机,区分原因等于给攻击者探针),网关必须**原样传递**这个语义 ——
 * 把它翻译成「token 不存在」「token 已过期」会让上游那层刻意的沉默白费。
 *
 * 这个函数不接受参数,和 `AuthError` 的构造函数同理:要让错误的用法写不出来。
 */
export function unauthorized(): ApiError {
  return new ApiError('unauthorized', 'authentication failed')
}

/**
 * 资源不存在 —— **跨主体访问也走这里**。
 *
 * 返回 404 而非 403:403 会泄漏「这个 id 存在」,而会话 id 的存在性本身就是信息。
 * 一个能枚举出「哪些会话 id 有效」的攻击者,已经拿到了一半。
 */
export function notFound(what = 'resource'): ApiError {
  return new ApiError('not_found', `${what} not found`)
}

/** 端点已在契约中定义但本版本未实现。 */
export function notImplemented(plannedVersion: string): ApiError {
  return new ApiError(
    'not_implemented',
    `endpoint is defined in the v1 contract but not implemented yet; planned for ${plannedVersion}`,
    plannedVersion,
  )
}

/** 把任意异常渲染成契约里的 `ErrorResponse`。 */
export function renderError(c: HonoContext, error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    if (error.plannedVersion !== undefined) {
      c.header('x-dshwar-planned-version', error.plannedVersion)
    }
    return c.json(
      { error: { code: error.code, message: error.message, requestId } },
      error.status as never,
    )
  }

  // 非预期异常:响应体不含任何内部细节,细节进日志,凭 requestId 对上
  return c.json({ error: { code: 'internal', message: 'internal server error', requestId } }, 500)
}
