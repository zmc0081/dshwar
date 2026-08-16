/**
 * 确定性假 LLM 适配器。
 *
 * 为什么用假的而不是真的调 DeepSeek:本 Session 验的是**网关能否驱动 harness**,
 * 不是模型质量。真模型会带来三个与结论无关的变量 —— 网络抖动、非确定输出、
 * 费用 —— 而其中前两个会让「取消是否真的停住了输出」这类断言变得不可判定。
 *
 * `LlmAdapter` 只有一个必需的抽象方法 `stream()`,这让替身成本极低。
 */
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

export interface FakeLlmOptions {
  /** 每个 text-delta 之间的间隔(毫秒)。用于给取消留出窗口。 */
  readonly delayMs?: number
  /** 要吐出的 token 序列。默认一句短话。 */
  readonly tokens?: readonly string[]
  /** 记录每次收到的请求,用于验证并发不串号。 */
  readonly onRequest?: (options: GenerateOptions) => void
}

/**
 * 按固定 token 序列逐个吐出 `text-delta`,可配间隔。
 *
 * 严格遵守 `options.signal`:上游对适配器的要求是
 * "implementations must honor `options.signal`" —— 验证 C 正是靠这条。
 */
export class FakeLlmAdapter extends LlmAdapter {
  // 不用参数属性:Node 的类型剥离(--experimental-strip-types)不支持它,
  // 而本目录的脚本刻意直接用 node 跑,不经 tsc。
  readonly options: FakeLlmOptions

  constructor(options: FakeLlmOptions = {}) {
    super()
    this.options = options
  }

  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.options.onRequest?.(request)

    const tokens = this.options.tokens ?? ['你好', ',', '我是', '假模型', '。']
    const delayMs = this.options.delayMs ?? 0

    yield { type: 'block-start', index: 0, blockType: 'text' }

    let text = ''
    for (const token of tokens) {
      // 取消检查放在产出之前 —— 取消之后不得再有任何输出
      if (request.signal?.aborted === true) return
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      if (request.signal?.aborted === true) return

      text += token
      yield { type: 'text-delta', index: 0, text: token }
    }

    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: 'stop' }
  }
}
