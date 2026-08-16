/**
 * 测试用的进程内 harness 装配 + 确定性假 LLM。
 *
 * 用**真实上游**而不是 mock:Session 3 的验收标准是「第三方仅凭 HTTP 就能
 * 完成一次完整会话」,而 mock 掉 agent 之后这句话就没被证明过。
 *
 * 七个插件的清单来自 `docs/FEASIBILITY-REPORT-V2.md` §4.2。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { StaticAuth } from '@dshwar/auth-static'
import { PrincipalService } from '@dshwar/principal'
import type { AgentHandleLike } from '../src/index.ts'

export interface FakeLlmOptions {
  readonly tokens?: readonly string[]
  readonly delayMs?: number
  readonly reasoning?: readonly string[]
}

/** 确定性假模型。严格遵守 `options.signal` —— 取消测试靠这条。 */
export class FakeLlmAdapter extends LlmAdapter {
  readonly options: FakeLlmOptions

  constructor(options: FakeLlmOptions = {}) {
    super()
    this.options = options
  }

  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    const tokens = this.options.tokens ?? ['你好', ',', '世界']
    const delayMs = this.options.delayMs ?? 0

    yield { type: 'block-start', index: 0, blockType: 'text' }

    for (const think of this.options.reasoning ?? []) {
      if (request.signal?.aborted === true) return
      yield { type: 'reasoning-delta', index: 0, text: think }
    }

    let text = ''
    for (const token of tokens) {
      if (request.signal?.aborted === true) return
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      if (request.signal?.aborted === true) return
      text += token
      yield { type: 'text-delta', index: 0, text: token }
    }

    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: 'stop' }
  }
}

export const AUTH_ENTRIES = [
  { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] },
  { token: 'dev-bob', id: 'bob-a2b3', tenantId: 'globex', roles: ['member'] },
]

export interface TestHarness {
  readonly ctx: Context
  readonly createAgent: (input: {
    sessionId: string
    model: string | undefined
    provider: string | undefined
  }) => Promise<AgentHandleLike>
  readonly userMessage: (text: string) => unknown
}

/** 装配一个可驱动的进程内 harness,并注册若干假 provider。 */
export async function createTestHarness(
  providers: Readonly<Record<string, FakeLlmOptions>> = { fake: {} },
): Promise<TestHarness> {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, { entries: AUTH_ENTRIES, quiet: true })
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })

  for (const [name, options] of Object.entries(providers)) {
    ctx.llm.registerAdapter([name], new FakeLlmAdapter(options))
  }

  return {
    ctx,
    createAgent: async (input) =>
      (await ctx.agents.create({
        sessionId: SessionId(input.sessionId),
        agentOptions: {
          provider: input.provider ?? 'fake',
          model: input.model ?? 'fake-1',
        },
      })) as unknown as AgentHandleLike,
    userMessage: (text) =>
      createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
  }
}

/** 解析 SSE 响应体为事件数组。 */
export async function readSSE(
  response: Response,
  options: { until?: (event: { type: string }) => boolean; maxMs?: number } = {},
): Promise<{ id: string | undefined; type: string; data: Record<string, unknown> }[]> {
  const events: { id: string | undefined; type: string; data: Record<string, unknown> }[] = []
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + (options.maxMs ?? 5000)
  let buffer = ''

  while (Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      let id: string | undefined
      let type = 'message'
      let data = '{}'
      for (const line of frame.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim()
        else if (line.startsWith('event:')) type = line.slice(6).trim()
        else if (line.startsWith('data:')) data = line.slice(5).trim()
      }
      const parsed = { id, type, data: JSON.parse(data) as Record<string, unknown> }
      events.push(parsed)
      if (options.until?.(parsed as unknown as { type: string })) {
        await reader.cancel()
        return events
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
  await reader.cancel()
  return events
}
