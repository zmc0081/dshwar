/**
 * 一次完整会话 —— 只用 `@dshwar/sdk`。
 *
 * **这个文件是 M2 的验收标准本身。** 本包的 `package.json` 只有一个依赖:
 * `@dshwar/sdk`。没有 `@deepseek-ai/dsh-*`,没有 cordis,没有 `@dshwar/gateway`。
 * 第三方拿到的就是这么多东西 —— 如果这里写得出会话,那句「仅凭 SDK 完成一次
 * 完整会话,不接触 dsh」就是真的;写不出,就是假的。
 *
 * @module @dshwar/example-sdk-session
 */
import { DshwarApiError, DshwarClient, DshwarTransportError } from '@dshwar/sdk'

export interface RunSessionOptions {
  /** 网关基址。 */
  readonly baseUrl: string
  /** 终端用户令牌 —— 由部署方的 IdP 签发,不是 DSHWAR 发的。 */
  readonly token: string
  /** 说给模型听的话。 */
  readonly prompt: string
  /** 自定义 fetch。测试里注入,生产不用传。 */
  readonly fetch?: typeof globalThis.fetch
  /** 进度输出。默认丢弃 —— 库不该替调用方决定往哪打日志。 */
  readonly log?: (line: string) => void
}

export interface SessionTranscript {
  readonly sessionId: string
  /** 拼起来的完整回答。 */
  readonly text: string
  /** 收到的事件类型,按顺序。 */
  readonly eventTypes: readonly string[]
  readonly turn: number
  /** DELETE 时若有正在跑的一轮,这里是被取消的轮次;否则 null。 */
  readonly cancelledTurn: number | null
}

/**
 * 建会话 → 发一轮 → 收流 → 查状态 → 释放。
 *
 * @throws {DshwarApiError} 网关明确拒绝(鉴权、限流、未实现……)
 * @throws {DshwarTransportError} 连不上或响应不是约定的形状
 */
export async function runSession(options: RunSessionOptions): Promise<SessionTranscript> {
  const log = options.log ?? (() => undefined)
  const client = new DshwarClient({
    baseUrl: options.baseUrl,
    token: options.token,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })

  // ---- 1. 建会话 ----
  const session = await client.createSession({ metadata: { example: 'sdk-session' } })
  log(`会话已建立 ${session.id}(status=${session.status})`)

  try {
    // ---- 2. 发起一轮 ----
    // 这一步不等本轮跑完,只确认已受理。输出走 SSE。
    const { turn } = await client.createTurn(session.id, options.prompt)
    log(`第 ${turn} 轮已受理`)

    // ---- 3. 收流 ----
    // 先发起再建流是安全的:网关为每个会话保留了事件缓冲,新连上的流会
    // 从头补发。反过来「先建流再发起」也可以,但那样得并发驱动生成器,
    // 对示例来说不值当。
    const eventTypes: string[] = []
    let text = ''

    for await (const event of client.stream(session.id)) {
      eventTypes.push(event.type)

      // 事件词表是**闭集**且由生成的类型描述,所以这个 switch 能被编译器查漏。
      // 上游改事件名时受影响的是网关的翻译层,不是这段代码。
      switch (event.type) {
        case 'message.delta':
          text += event.text
          break
        case 'turn.completed':
          log(`第 ${event.turn} 轮结束:${event.reason}`)
          break
        case 'error':
          throw new Error(`会话内出错:${event.code} ${event.message}`)
        default:
          break
      }

      if (event.type === 'turn.completed') break
    }

    // ---- 4. 查状态 ----
    const after = await client.getSession(session.id)
    log(`收到 ${eventTypes.length} 个事件,累计 ${after.turns} 轮`)

    // ---- 5. 释放 ----
    const released = await client.deleteSession(session.id)
    log(
      `会话已释放${released.cancelledTurn === null ? '' : `(取消了第 ${released.cancelledTurn} 轮)`}`,
    )

    return {
      sessionId: session.id,
      text,
      eventTypes,
      turn: after.turns,
      cancelledTurn: released.cancelledTurn,
    }
  } catch (error) {
    // 失败路径也要释放 —— 否则网关侧留下一个还挂着订阅的会话。
    // 这里吞掉释放本身的错误:原始错误比清理失败更值得报出去。
    await client.deleteSession(session.id).catch(() => undefined)

    if (error instanceof DshwarApiError) {
      log(`网关拒绝:${error.code}(HTTP ${error.status},requestId=${error.requestId})`)
    } else if (error instanceof DshwarTransportError) {
      log(`传输失败:${error.message}`)
    }
    throw error
  }
}
