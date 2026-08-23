/**
 * SDK 侧的错误类型。
 *
 * 错误码是**闭集**,因此这里能把它映射成可穷举的联合类型 ——
 * 调用方 `switch` 时编译器能查漏。这正是契约把错误码定成 `z.enum`
 * 而不是 `z.string()` 换来的东西。
 *
 * @module @dshwar/sdk/errors
 */
import type { components } from './generated/schema.ts'

/**
 * 闭集错误码,直接来自生成的类型。
 *
 * ⚠️ **不要在这里手写联合类型。** 手写等于第二个事实源:契约加了一个码
 * 而这里忘了,调用方的 `switch` 就会在编译期通过、运行期落空。
 */
export type DshwarErrorCode = components['schemas']['ErrorResponse']['error']['code']

/** 契约里的错误响应体。 */
export type DshwarErrorBody = components['schemas']['ErrorResponse']

/**
 * API 返回的错误。
 *
 * `requestId` 是报障时唯一有用的东西:给运维一个 id,他们就能在日志与审计里
 * 精确定位那一次调用。
 */
export class DshwarApiError extends Error {
  override readonly name = 'DshwarApiError'
  readonly code: DshwarErrorCode
  readonly status: number
  readonly requestId: string
  /** 端点是 `planned` 时,服务端会告诉你哪个版本会实现。 */
  readonly plannedVersion: string | undefined

  constructor(input: {
    code: DshwarErrorCode
    message: string
    status: number
    requestId: string
    plannedVersion?: string | undefined
  }) {
    super(input.message)
    this.code = input.code
    this.status = input.status
    this.requestId = input.requestId
    this.plannedVersion = input.plannedVersion
  }
}

/** 网络层失败(连不上、超时、响应不是 JSON)。与 API 错误分开,便于重试判定。 */
export class DshwarTransportError extends Error {
  override readonly name = 'DshwarTransportError'
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
  }
}
