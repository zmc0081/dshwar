/**
 * 进程内 harness 的最小组装。
 *
 * 本文件本身就是 Session 0 的一项产出:**网关要在进程内驱动 agent,
 * 到底需要拼哪些东西**。答案是七个插件,全部来自上游,零 fork。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { FakeLlmAdapter, type FakeLlmOptions } from './fake-llm.ts'

/** `AgentLoop.inject` 声明的依赖,加上它自己。顺序即加载顺序。 */
export const REQUIRED_PLUGINS = [
  '@deepseek-ai/dsh-session (SessionStore → ctx.sessions)',
  '@deepseek-ai/dsh-llm (LlmRuntime → ctx.llm)',
  '@deepseek-ai/dsh-tools (ToolRuntime → ctx.tools)',
  '@deepseek-ai/dsh-system-prompt (SystemPrompt → ctx.systemPrompt)',
  '@deepseek-ai/dsh-agent (AgentRegistry → ctx.agents)',
  '@deepseek-ai/dsh-agent-loop (AgentLoop → 提供 AgentFactory)',
] as const

/** session 事件的实际信封形状(实测,非文档推断)。 */
export interface SessionEventEnvelope {
  readonly type: string
  /** 单调序号 —— 可直接当 SSE 的 `id:`,支撑 Last-Event-ID 续传。 */
  readonly seq: number
  readonly time: number
  readonly data?: {
    readonly turn?: number
    readonly step?: number
    readonly chunk?: { readonly type: string; readonly text?: string }
    readonly message?: { readonly content?: readonly { type: string; text?: string }[] }
  }
}

export interface InProcessRuntime {
  readonly ctx: Context
  /** 注册假 provider,返回该 provider 名。 */
  registerFake(name: string, options?: FakeLlmOptions): string
}

/** 组装一个进程内 harness。 */
export async function createInProcessRuntime(): Promise<InProcessRuntime> {
  const ctx = new Context()

  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })

  return {
    ctx,
    registerFake(name, options) {
      ctx.llm.registerAdapter([name], new FakeLlmAdapter(options))
      return name
    },
  }
}

/** 造一条用户消息。 */
export function userText(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

export { SessionId }
