/**
 * `@dshwar/sdk` —— DSHWAR API v1 的 TypeScript SDK。
 *
 * **类型由 OpenAPI 生成,不手写。** 生成链:
 *
 * ```
 * Zod schema → OpenAPI 3.1 → src/generated/schema.ts → 这里
 * ```
 *
 * 手写任何一层类型都会引入第二个事实源。SSE 的**传输**是手写的
 * (生成器不管流式),但事件类型仍来自契约。
 *
 * @module @dshwar/sdk
 */

export { DshwarAdminClient, DshwarClient } from './client.ts'
export type {
  CreateSessionInput,
  CredentialDescriptor,
  Deliverable,
  DshwarClientOptions,
  Session,
  StreamEvent,
  Workspace,
  WorkspacePolicy,
} from './client.ts'

export { DshwarApiError, DshwarTransportError } from './errors.ts'
export type { DshwarErrorBody, DshwarErrorCode } from './errors.ts'

export type { components, operations, paths } from './generated/schema.ts'
