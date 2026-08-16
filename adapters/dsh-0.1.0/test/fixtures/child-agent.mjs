/**
 * V0.4.5 Session 0 的子进程夹具 —— 在**独立进程**里装配 harness 并驱动一个 agent。
 *
 * 父进程通过 IPC 送指令、收事件。这个文件存在的意义是回答一个问题:
 * **进程隔离之后,网关还能不能像进程内那样驱动会话?**
 *
 * 刻意用 `.mjs` 而不是 `.ts`:子进程由 `child_process.fork` 拉起,
 * 走的是 Node 的原生模块解析,不经过 Vitest 的转译。
 *
 * 协议(父 → 子):
 *   { type: 'start', principalId, tenantId, tokens, delayMs }
 *   { type: 'cancel' }
 * 协议(子 → 父):
 *   { type: 'ready', bootMs }
 *   { type: 'event', name, seq, data }
 *   { type: 'idle' }
 *   { type: 'error', message }
 *
 * ⚠️ 本文件受 `checkJs` 检查(见 `../../tsconfig.test.json`)。V0.4.6 之前它
 * 完全在检查之外,于是 `reason: 'stop'` 这个形状错误活了一整个版本 ——
 * 同款错误在 7 个 `.ts` 测试文件里是被类型检查一次抓出来的。
 * JS 推断较弱,跨 IPC 边界的入参用 JSDoc 补形状,成本很低。
 */

/** @typedef {{ type: 'start' | 'cancel' | 'crash', principalId?: string, tenantId?: string, tokens?: string[], delayMs?: number }} ParentMessage */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { StaticAuth } from '@dshwar/auth-static'
import { MultiuserCredentials } from '@dshwar/credentials-multiuser'
import { TenantFileSystem } from '@dshwar/fs-tenant'
import { PrincipalService } from '@dshwar/principal'

const t0 = Date.now()

/** 可控速度的假模型 —— 慢到足以让父进程在中途发取消。 */
class PacedAdapter extends LlmAdapter {
  /**
   * @param {string[]} tokens
   * @param {number} delayMs
   */
  constructor(tokens, delayMs) {
    super()
    this.tokens = tokens
    this.delayMs = delayMs
  }

  /**
   * ★ `@returns` 不能省。JS 会把 `{ type: 'block-start' }` 里的 type 推成
   * `string` 而不是字面量 `'block-start'`,于是每个 yield 都与 `StreamChunk`
   * 的判别联合对不上 —— **标上返回类型,判别才生效**,而那正是能抓住
   * `reason: 'stop'` 这类形状错误的那道约束。
   *
   * @param {import('@deepseek-ai/dsh-llm').GenerateOptions} request
   * @returns {AsyncGenerator<import('@deepseek-ai/dsh-llm').StreamChunk>}
   */
  async *stream(request) {
    // 包成函数调用而不是每处直接读 `request.signal?.aborted`:`aborted` 是
    // readonly,TypeScript 认定它读过一次就不会变,于是 await 之后的第二次
    // 检查被判成恒假。而这里要的恰恰是**重新读一次** —— 取消就发生在那个
    // await 期间。与 gateway/test/harness.ts 同款处理。
    const aborted = () => request.signal?.aborted === true

    yield { type: 'block-start', index: 0, blockType: 'text' }
    let text = ''
    for (const token of this.tokens) {
      // 严格遵守 signal —— 取消测试全靠这一条
      if (aborted()) return
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
      if (aborted()) return
      text += token
      yield { type: 'text-delta', index: 0, text: token }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 42, outputTokens: this.tokens.length } }
    // 上游的 FinishReason 是对象而非字符串(`{ kind: 'stop' }`)——
    // 写成 'stop' 时下游读 `reason.kind` 拿到的是 undefined。
    // ⚠️ 本文件是 `.mjs`,`tsconfig.test.json` 那套机制结构上够不到它,
    // 所以这个错误只能靠人看出来 —— 同款错误在 7 个 `.ts` 测试文件里
    // 是被类型检查抓出来的(见 V0.4.6 立项时合并的 b635a2d)。
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** @type {Awaited<ReturnType<import('@deepseek-ai/dsh-agent').AgentRegistry['create']>> | undefined} */
let handle
/** @type {Context | undefined} */
let ctx

/**
 * 装配 `gateway/src/runtime.ts` 的 `GATEWAY_PLUGINS` 全集(11 个),顺序与之一致。
 *
 * **装全集而不是只装上游核心**,是因为本 Session 要交出的冷启动与内存数字
 * 会被 Session 4 的部署文档引用。少装 4 个插件量出来的数字偏乐观,
 * 而采用者据此做容量规划。
 */
/** @param {ParentMessage} msg */
async function start(msg) {
  const root = mkdtempSync(join(tmpdir(), 'dshwar-xproc-'))
  ctx = new Context()

  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, {
    entries: [{ token: 'tok', id: msg.principalId ?? '', tenantId: msg.tenantId ?? '' }],
    quiet: true,
  })
  // 不传 store —— 缺 principal 一律 fail closed(硬规则 6)
  await ctx.plugin(MultiuserCredentials, {})

  // fs-tenant 包 fs-local,不替代它(与 runtime.ts 同款接线)
  const inner = ctx.isolate('fs')
  await inner.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(TenantFileSystem, { inner: inner.fs, root })

  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions') })

  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['fake'], new PacedAdapter(msg.tokens ?? [], msg.delayMs ?? 0))

  handle = await ctx.agents.create({
    sessionId: SessionId(`child-${msg.principalId}`),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })

  // 事件挂在 agent 自己的 ctx 上 —— 与网关进程内驱动同一处挂载点,
  // 这样「跨进程与进程内事件序列一致」的对照才有意义
  handle.agent.ctx.on('session/event', (_session, event) => {
    // 上游的 SessionEvent 是个大联合,每个成员的 data 形状都不同。
    // 这里只读我们关心的那几个字段,收窄集中在这一处 —— 与
    // gateway/src/sessions/events.ts 的 asUpstreamEvent 同款做法。
    const data = /** @type {{ turn?: number, step?: number, chunk?: { type?: string, text?: string }, usage?: unknown } | undefined} */ (
      event.data
    )
    process.send?.({
      type: 'event',
      name: event.type,
      seq: event.seq,
      data: {
        turn: data?.turn,
        step: data?.step,
        chunkType: data?.chunk?.type,
        text: data?.chunk?.text,
        usage: data?.usage,
      },
    })
  })

  // `t0` 在模块体顶部取,而 ESM 的 import 在此之前就求值完了 —— 所以这个数
  // **只包含插件装配**,不含进程创建与模块加载。真正的冷启动由父进程侧的
  // 墙钟测量(fork → ready),两个数在报告里分开列。
  process.send?.({
    type: 'ready',
    assembleMs: Date.now() - t0,
    rssBytes: process.memoryUsage().rss,
  })

  handle.agent.followup(
    createUserMessage({ content: [{ type: 'text', text: '跨进程' }], source: { kind: 'user' } }),
  )
  await handle.agent.whenIdle()
  process.send?.({ type: 'idle' })
}

process.on('message', (/** @type {ParentMessage} */ msg) => {
  if (msg?.type === 'start') {
    start(msg).catch((/** @type {unknown} */ e) =>
      process.send?.({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
  } else if (msg?.type === 'cancel') {
    // 验证 C 的手段 a:IPC 发指令,子进程内部调进程内的 cancel
    handle?.agent.cancel({ kind: 'user' })
    process.send?.({ type: 'cancelled' })
  } else if (msg?.type === 'crash') {
    // 验证 D:制造一次真崩溃(非正常退出)
    process.exit(7)
  }
})
