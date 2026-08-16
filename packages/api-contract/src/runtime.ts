/**
 * 运行时 API —— `/v1/sessions`。
 *
 * 验收标准是「第三方仅凭 SDK 完成一次完整会话,不接触 dsh」。
 * 这几个 schema 就是那条路径的全部。
 *
 * @module @dshwar/api-contract/runtime
 */
import { z } from 'zod'
import { RequestIdField, SessionId, SubjectId } from './common.ts'

/** 会话状态。与上游 `AgentStatus` 同构,但这是**我们的**词表。 */
export const SessionStatus = z.enum([
  /** 空闲,可发起下一轮。 */
  'idle',
  /** 正在处理某一轮。 */
  'running',
])

export type SessionStatus = z.infer<typeof SessionStatus>

/** 创建会话。 */
export const CreateSessionRequest = z
  .object({
    model: z.string().optional().meta({ description: '模型 id。省略则用部署方配置的默认值' }),
    provider: z.string().optional().meta({ description: '模型提供方路由。省略则用默认' }),
    /**
     * 推理增量开关 —— **默认 false**。
     *
     * 开启后 SSE 流里会出现 `reasoning.delta` 事件。默认关的理由见
     * `events.ts` 的 `ReasoningDeltaEvent` 文档:思维链可能含运营方不愿暴露的
     * 推理过程,且 token 量对移动端是真实负担。
     */
    includeReasoning: z
      .boolean()
      .default(false)
      .meta({ description: '是否在流中包含推理增量(思维链)。默认关闭' }),
    metadata: z
      .record(z.string(), z.string())
      .optional()
      .meta({ description: '调用方自定义标签,原样回显。不参与任何服务端逻辑' }),
  })
  .meta({ id: 'CreateSessionRequest' })

export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>

/** 会话表示。 */
export const Session = z
  .object({
    id: SessionId,
    /**
     * 会话归属的主体。
     *
     * 跨主体访问一律返回 **404 而非 403** —— 403 会泄漏「这个 id 存在」,
     * 而会话 id 的存在性本身就是信息。
     */
    subjectId: SubjectId,
    status: SessionStatus,
    model: z.string().nullable(),
    provider: z.string().nullable(),
    includeReasoning: z.boolean(),
    /** 已完成的轮次数。 */
    turns: z.number().int().min(0),
    createdAt: z.iso.datetime(),
    metadata: z.record(z.string(), z.string()),
  })
  .meta({ id: 'Session' })

export type Session = z.infer<typeof Session>

export const CreateSessionResponse = z
  .object({ session: Session, ...RequestIdField })
  .meta({ id: 'CreateSessionResponse' })

export const GetSessionResponse = z
  .object({ session: Session, ...RequestIdField })
  .meta({ id: 'GetSessionResponse' })

/** 发起一轮。 */
export const CreateTurnRequest = z
  .object({
    input: z.string().min(1).meta({ description: '本轮的用户输入' }),
  })
  .meta({ id: 'CreateTurnRequest' })

export type CreateTurnRequest = z.infer<typeof CreateTurnRequest>

/**
 * 发起一轮的响应。
 *
 * ⚠️ **这个端点不等待本轮跑完就返回。** 它只确认「已受理」,输出走 SSE。
 *
 * 同步等待完整回复是个诱人但错误的设计:一轮可能跑几分钟(工具调用、多步推理),
 * 而任何中间的反向代理都会在 60 秒左右掐断连接。让发起与消费分开,
 * 客户端可以先建 SSE 再发起,断线重连也不丢内容。
 */
export const CreateTurnResponse = z
  .object({
    turn: z.number().int().meta({ description: '本轮的序号,与 SSE 事件里的 turn 对应' }),
    status: SessionStatus,
    ...RequestIdField,
  })
  .meta({ id: 'CreateTurnResponse' })

/**
 * 取消并释放会话。
 *
 * 语义对应 V0.2.0 Session 0 实测的两条上游路径:先 `agent.cancel()` 截断
 * 正在跑的一轮,再 `handle.dispose()` 彻底释放。**幂等** —— 删除一个不存在的
 * 会话返回 404,删除一个已删除的会话也是 404,不区分。
 */
export const DeleteSessionResponse = z
  .object({
    id: SessionId,
    /** 被取消的轮次序号;删除时正好空闲则为 null。 */
    cancelledTurn: z.number().int().nullable(),
    ...RequestIdField,
  })
  .meta({ id: 'DeleteSessionResponse' })

/** 列出当前主体的会话。 */
export const ListSessionsResponse = z
  .object({
    data: z.array(Session),
    nextCursor: z.string().nullable(),
    ...RequestIdField,
  })
  .meta({ id: 'ListSessionsResponse' })
