/**
 * V0.4.0 Session 0 · 用量可观测性 —— metering 依赖的上游接触点。
 *
 * 三条断言,对应 REPORT-V4 的验证 A/B/C:
 *
 * A. 适配器发出的 `usage` chunk 会被上游装配进 `assistant/message` 事件,
 *    与消息本体同行(上游原话:"the model output and its accounting travel
 *    together (there is no separate usage record)")。
 * B. 该事件走 `session/event` 信道,与网关 SSE 用的是同一条 —— 信封形状
 *    `{ type, seq, time, data }`(REPORT-V2 §4.3),`data.usage` 即计量输入。
 * C. 事件带 `turn` 序号,配合监听器挂在 agent 自己的 ctx 上(按 agent 作用域
 *    过滤),session → principal 的归属在网关侧闭环,不需要额外信道。
 *
 * 上游若改掉任何一条(usage 不再随消息、事件键改名、turn 消失),
 * 这个文件先红 —— 那正是契约测试的职责。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { beforeAll, describe, expect, it } from 'vitest'

/** 报告固定用量的假模型。用量的**数值**由我们指定,断言才有牙齿。 */
class MeteredFakeAdapter extends LlmAdapter {
  async *stream(_request: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '你好' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '你好' } }
    // 上游类型注释:"Adapters emit usage before the terminal finish and nothing afterward"
    yield {
      type: 'usage',
      usage: {
        inputTokens: 120,
        outputTokens: 7,
        cacheReadTokens: 30,
        reasoningTokens: 0,
      },
    }
    // 上游的 FinishReason 是对象而非字符串(`{ kind: 'stop' }`)——
    // 写成 'stop' 时下游读 `reason.kind` 拿到的是 undefined
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface CapturedEvent {
  readonly type: string
  readonly seq: number
  readonly data?: {
    readonly turn?: number
    readonly step?: number
    readonly usage?: TokenUsage
  }
}

let captured: CapturedEvent[]

beforeAll(async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['fake'], new MeteredFakeAdapter())

  const handle = await ctx.agents.create({
    sessionId: SessionId('usage-probe'),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })

  captured = []
  // 与网关同款:挂在 agent 自己的 ctx 上,按 agent 作用域过滤(验证 C 的前半)
  handle.agent.ctx.on('session/event', (_session: unknown, event: unknown) => {
    captured.push(event as CapturedEvent)
  })

  handle.agent.followup(
    createUserMessage({ content: [{ type: 'text', text: '试一下' }], source: { kind: 'user' } }),
  )
  await handle.agent.whenIdle()
  await handle.dispose()
})

describe('验证 A:usage 随 assistant/message 同行', () => {
  it('assistant/message 事件带 usage,数值与适配器报的一致', () => {
    const messages = captured.filter((e) => e.type === 'assistant/message')
    expect(messages.length).toBeGreaterThan(0)

    const usage = messages[0]!.data?.usage
    expect(usage, 'assistant/message 没带 usage —— metering 的输入信道断了').toBeDefined()
    expect(usage).toMatchObject({ inputTokens: 120, outputTokens: 7, cacheReadTokens: 30 })
  })

  it('TokenUsage 的口径:input 与 cacheRead 是不相交的(计费输入 = 相加)', () => {
    // 上游类型注释明写 "Counts are DISJOINT"。metering 的计费口径依赖这一条:
    // billedInput = inputTokens + cacheReadTokens + cacheWriteTokens。
    // 这里断言两个字段同时存在且独立 —— 上游哪天改成"含缓存的总量",这条会红。
    const usage = captured.find((e) => e.type === 'assistant/message')!.data!.usage!
    expect(usage.inputTokens).toBe(120)
    expect(usage.cacheReadTokens).toBe(30)
  })
})

describe('验证 B:走的是网关已经在用的 session/event 信道', () => {
  it('信封形状是 { type, seq, ... },seq 单调', () => {
    expect(captured.length).toBeGreaterThan(2)
    for (let i = 1; i < captured.length; i += 1) {
      expect(captured[i]!.seq).toBeGreaterThan(captured[i - 1]!.seq)
    }
  })

  it('assistant/chunk 里也能看到原始 usage 块(备用信道,粒度到 step)', () => {
    const chunks = captured.filter((e) => e.type === 'assistant/chunk')
    const usageChunk = chunks.find(
      (e) => (e.data as { chunk?: { type?: string } })?.chunk?.type === 'usage',
    )
    expect(usageChunk).toBeDefined()
  })
})

describe('验证 C:归属所需的键都在', () => {
  it('assistant/message 带 turn 与 step —— 归属到轮次不需要额外信道', () => {
    const message = captured.find((e) => e.type === 'assistant/message')!
    expect(message.data?.turn).toBeTypeOf('number')
    expect(message.data?.step).toBeTypeOf('number')
  })
})
