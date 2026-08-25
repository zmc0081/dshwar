/**
 * ② 今天的 DSHWAR 网关**一个工具都没注册**。
 *    一个用户让 agent 读文件时,到底发生什么?
 *
 * 关键分辨(这正是本项目一路在追的那一族):
 *   · **拒绝** —— 有东西说「我做不到」,可核对
 *   · **静默无能力** —— 没有任何东西表态,模型自由发挥,
 *     而它可能**说自己读完了**
 *
 * 本脚本只测**结构事实**:模型被告知有哪些工具、请求里 tools 字段长什么样、
 * 以及当模型仍然发出一个工具调用时会怎样。模型自己会不会撒谎不由本仓决定,
 * 但**有没有东西挡在中间**由本仓决定。
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

const SEEN = []

/** 记录模型收到了什么;并且**故意**发一个不存在的工具调用,看谁来管。 */
class ProbeFake extends LlmAdapter {
  constructor(emitToolCall) {
    super()
    this.emitToolCall = emitToolCall
  }
  async *stream(request) {
    SEEN.push({
      toolsField: request.tools === undefined ? '(没有 tools 字段)' : request.tools.length,
      names: (request.tools ?? []).map((t) => t.name),
      systemMentionsTools: /tool/i.test(String(request.system ?? '')),
    })
    const msgs = request.messages ?? []
    const last = msgs[msgs.length - 1]
    if (this.emitToolCall && !JSON.stringify(last ?? {}).includes('tool-result')) {
      const id = `x${msgs.length}`
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id,
        name: 'read',
        argumentsDelta: '{"file_path":"note.txt"}',
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: 'read', arguments: '{"file_path":"note.txt"}' },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    // 「说自己读完了」的那一种 —— 模型完全可以这么答,而没有工具调用发生
    const text = '我已经读完了 note.txt,内容是:今天天气不错。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function run(label, emitToolCall) {
  SEEN.length = 0
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['fake'], new ProbeFake(emitToolCall))

  const events = []
  ctx.on('session/event', (_s, e) => events.push({ t: e?.type, d: e?.data }))

  const h = await ctx.agents.create({
    sessionId: SessionId(`nt-${label}`),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })
  h.agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: '帮我读一下 note.txt' }],
      source: { kind: 'user' },
    }),
  )
  await h.agent.whenIdle()

  console.log(`\n══ ${label} ══`)
  console.log(`   注册的工具数:${ctx.tools.schemas().length}`)
  console.log(`   模型收到的 tools 字段:${JSON.stringify(SEEN[0]?.toolsField)}`)
  console.log(`   系统提示里提到 tool 吗:${SEEN[0]?.systemMentionsTools}`)
  const results = events.filter((e) => e.t === 'tool/result')
  const assistant = events.filter((e) => e.t === 'assistant/message')
  console.log(`   tool/call 事件:${events.filter((e) => e.t === 'tool/call').length} 条`)
  for (const r of results.slice(0, 2)) {
    const c = r.d?.message?.content?.[0]
    console.log(
      `   tool/result isError=${c?.isError} → ${String(c?.content?.[0]?.text).slice(0, 120)}`,
    )
  }
  for (const a of assistant.slice(-1)) {
    const text = (a.d?.message?.content ?? []).map((b) => b.text ?? '').join('')
    console.log(`   最后一条 assistant 文本:${JSON.stringify(text.slice(0, 60))}`)
  }
  await ctx.stop?.()
}

await run('A · 零工具,模型老实用文字回答(它说自己读完了)', false)
await run('B · 零工具,模型仍然发出 read 调用', true)
