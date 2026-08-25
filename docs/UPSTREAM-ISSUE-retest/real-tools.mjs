/**
 * ★ 装上**上游真实的文件工具**(`@deepseek-ai/dsh-tool-fs`)实测:
 *   工具触到 `ctx.fs` 时,身份是怎么到达的?
 *
 * 上一轮用自写工具测出:根 ctx 上的服务读 `this.ctx.agent` 拿不到身份。
 * 但那是**我模拟的**上游工具行为 —— 读源码不等于跑过,所以这次装真的。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'

/** 每次 fs.resolve 观察到的东西 —— 这是本实验的全部证据。 */
const RESOLVES = []

const ROOT = join(tmpdir(), 'dshwar-realtools')
const WS = {
  'sess-alice': join(ROOT, 'acme', 'alice'),
  'sess-bob': join(ROOT, 'globex', 'bob'),
}
for (const [sid, dir] of Object.entries(WS)) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'note.txt'), `我是 ${sid} 的文件\n`, 'utf8')
}

/** 与 fs-tenant 同形:包住 fs-local,只多记一笔「这次调用带了什么身份线索」。 */
class ProbeFs extends LocalFileSystem {
  async resolve(path, opts) {
    RESOLVES.push({ path, cwd: opts?.cwd, ctxAgent: safeCtxAgent(this) })
    return super.resolve(path, opts)
  }
}

function safeCtxAgent(self) {
  try {
    const a = self.ctx?.agent
    return a === undefined ? 'undefined' : String(a.session?.id ?? a.id ?? '?')
  } catch (e) {
    return `THROW:${String(e).slice(0, 50)}`
  }
}

/** 让模型发一次 read 调用,拿到结果就收尾。 */
class ReadingFake extends LlmAdapter {
  async *stream(request) {
    const msgs = request.messages ?? []
    const last = msgs[msgs.length - 1]
    if (!JSON.stringify(last ?? {}).includes('tool-result')) {
      const id = `c${msgs.length}`
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id,
        name: 'read',
        argumentsDelta: JSON.stringify({ file_path: 'note.txt' }),
      }
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id,
          name: 'read',
          arguments: JSON.stringify({ file_path: 'note.txt' }),
        },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function main() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ProbeFs, { cwd: ROOT })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolFs, {}) // ★ 上游真实的 read / write / edit 工具
  ctx.llm.registerAdapter(['fake'], new ReadingFake())

  // 诊断:工具到底跑没跑,跑出了什么
  const EVENTS = []
  ctx.on('session/event', (_s, e) => EVENTS.push({ t: e?.type, d: e?.data }))
  globalThis.__EVENTS = EVENTS

  const names = ctx.tools.schemas().map((t) => t.name)
  console.log(`注册到的工具:${JSON.stringify(names)}`)
  if (names.length === 0) throw new Error('一个工具都没注册上 —— 本次结论作废')

  // ★ 关键:每个 session 各自的工作区,通过 meta.cwd 交给上游
  const handles = {}
  for (const [sid, dir] of Object.entries(WS)) {
    handles[sid] = await ctx.agents.create({
      sessionId: SessionId(sid),
      meta: { cwd: dir },
      agentOptions: { provider: 'fake', model: 'fake-1' },
    })
  }
  console.log('两个 agent 建好,各自 meta.cwd 指向自己的工作区')

  await Promise.all(
    Object.values(handles).map(async (h) => {
      for (let i = 0; i < 2; i += 1) {
        h.agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: '读 note.txt' }],
            source: { kind: 'user' },
          }),
        )
        await h.agent.whenIdle()
      }
    }),
  )

  const ev = globalThis.__EVENTS ?? []
  console.log(`\n会话事件类型(前 24 条):`)
  console.log(`   ${JSON.stringify(ev.slice(0, 24).map((x) => x.t))}`)
  // 工具失败的话,失败原因在事件的 data 里 —— 那正是「跑没跑通」与
  // 「跑通了但身份丢了」的分水岭,不能混。
  const bad = ev.filter((x) => /error|fail|denied|result/i.test(String(x.t ?? '')))
  for (const b of bad.slice(0, 4)) {
    console.log(`   ${b.t} → ${JSON.stringify(b.d).slice(0, 400)}`)
  }
  console.log(`\nfs.resolve 被调用 ${RESOLVES.length} 次`)
  if (RESOLVES.length === 0) {
    console.log('🚨 一次都没到 fs —— 结论作废,是驱动没跑通')
    process.exit(2)
  }
  for (const r of RESOLVES.slice(0, 8)) {
    console.log(
      `   path=${String(r.path).padEnd(10)} cwd=${String(r.cwd)}\n              this.ctx.agent=${r.ctxAgent}`,
    )
  }
  const cwds = new Set(RESOLVES.map((r) => String(r.cwd)))
  const agents = new Set(RESOLVES.map((r) => r.ctxAgent))
  console.log(`\n① this.ctx.agent 的取值集合:${JSON.stringify([...agents])}`)
  console.log(`② opts.cwd 的取值集合:${JSON.stringify([...cwds])}`)
  console.log(
    `\n⇒ 身份到达 fs 的方式:${
      cwds.size >= 2 ? '✅ **作为调用参数**(opts.cwd),按会话分开' : '❌ cwd 没有分开'
    }`,
  )
  console.log(
    `⇒ 经 ctx 到达:${agents.size >= 2 && !agents.has('undefined') ? '✅' : '❌ 拿不到(与上一轮一致)'}`,
  )
}

main().catch((e) => {
  console.error('\n🚨 脚本自己炸了 —— 这不是结论:')
  console.error(e)
  process.exit(1)
})
