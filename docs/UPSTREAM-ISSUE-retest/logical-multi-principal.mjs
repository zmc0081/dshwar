/**
 * ★ 逻辑档多 principal 能不能解开 —— 走**真实驱动**路径,不直接调 stream()。
 *
 * ## 要回答的那句话
 *
 * 当初四条路要解决的是:一个 runtime、多个 principal 时,
 * 消费方(fs-tenant / storage-scoped / attachment-tenant)在操作时
 * **怎么知道「现在是谁在问」**。
 *
 * 0.1.1-rc.2 新增了 `Context.agent`,而重测确认它按 agent 不同、派生 ctx 继承。
 * ⇒ 那么一个服务在方法里读 `this.ctx.agent` → session id → principal,
 *   能不能拿到正确的租户?
 *
 * ## 三条纪律(都来自本仓踩过的坑)
 *
 * 1. **真实驱动**:`agent.followup()` + `whenIdle()`,穿过 agent loop 与工具层。
 *    当初 fs-tenant 那次实测是直接调的,而直接调不经过 loop。
 * 2. **并发多轮**:两个 principal 各跑多轮并发,确认不串号(当初的验证 C)。
 * 3. 🚨 **不依赖任何未测出的前提**:上一轮 Section B(isolate + provide 的可见性)
 *    出现过自相矛盾的结果,已记为**未测出**。本脚本**完全不用 isolate/provide**,
 *    只用 `Context.agent` 与工具层的 `exec.agent` —— 两者都是上游文档化的公开面。
 *
 * ## 关键的分辨:服务是**怎么被拿到**的
 *
 * 真实系统里,读文件的工具是**上游的**(`read_file` 之类),它拿 `ctx.fs`。
 * 那个 `ctx` 是工具注册时闭包住的那个,通常是根。所以本脚本分两路测:
 *
 * | 路径 | 谁能用 |
 * | --- | --- |
 * | 工具闭包住的**根 ctx** 上取服务 → `this.ctx.agent` | 上游工具走的就是这条 |
 * | `exec.agent`(工具执行上下文) | 只有**自己写的**工具能用 |
 *
 * 第一条成立,fs-tenant 不用改上游就能解身份;
 * 只有第二条成立,DSHWAR 就必须拥有那些工具 —— 而它不拥有。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

/** sessionId → principal。真实系统里这来自会话表。 */
const PRINCIPALS = new Map([
  ['sess-alice', { tenant: 'acme', subject: 'alice' }],
  ['sess-bob', { tenant: 'globex', subject: 'bob' }],
])

/** 每次工具执行观察到的东西。 */
const OBSERVED = []

/** 模拟 fs-tenant:在方法里靠 `this.ctx` 解析「现在是谁在问」。 */
class ProbeFs extends Service {
  constructor(ctx) {
    super(ctx, 'probeFs')
  }
  /** 与 fs-tenant 的 workspaceRoot 同形:身份 → 路径前缀。 */
  resolveRoot() {
    let sid
    let how
    try {
      sid = this.ctx.agent?.session?.id ?? this.ctx.agent?.id
      how = sid === undefined ? 'ctx.agent 是 undefined' : 'ctx.agent'
    } catch (e) {
      how = `读 ctx.agent 抛:${String(e).slice(0, 60)}`
    }
    const p = PRINCIPALS.get(String(sid))
    return {
      root: p ? `${p.tenant}/${p.subject}` : 'anonymous/anonymous',
      how,
      sid: String(sid),
    }
  }
}

/** 先发一次 tool-call,拿到结果之后再收尾 —— 两次模型往返,与真实一轮同形。 */
class ToolCallingFake extends LlmAdapter {
  async *stream(request) {
    // ⚠️ 判据必须是「**最后一条**是不是工具结果」——
    //    写成「整段历史里出现过 tool-result」的话,第一轮之后就再也不发工具调用了,
    //    于是并发多轮退化成每人一轮(上一次实测:期望 6 次,只跑了 2 次)。
    const msgs = request.messages ?? []
    const last = msgs[msgs.length - 1]
    const sawResult = JSON.stringify(last ?? {}).includes('tool-result')
    if (!sawResult) {
      const id = `call-${Math.abs(hash(JSON.stringify(request.messages ?? [])))}`
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'probe_ws', argumentsDelta: '{}' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: 'probe_ws', arguments: '{}' },
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

/** ⚠️ 不用 Math.random —— 同一份输入要得到同一个 callId。 */
function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

async function main() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ProbeFs) // ★ 服务装在**根**上,与今天的 fs-tenant 同款
  ctx.llm.registerAdapter(['fake'], new ToolCallingFake())

  // 工具闭包住的是**根 ctx** —— 上游的 read_file 之类走的就是这条路。
  const rootCtx = ctx
  ctx.tools.register({
    name: 'probe_ws',
    description: '返回当前调用方解析出的工作区根',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args, exec) {
      // ① 上游工具走的路:从闭包住的根 ctx 上取服务
      let viaRoot
      try {
        viaRoot = rootCtx.probeFs.resolveRoot()
      } catch (e) {
        viaRoot = { root: 'THROW', how: String(e).slice(0, 80), sid: '-' }
      }
      // ② 自己写的工具才能走的路:exec.agent
      const execSid = String(exec.agent?.session?.id ?? exec.agent?.id ?? 'undefined')
      // ③ 若拿得到 agent.ctx,从它上面取服务
      let viaAgentCtx
      try {
        const ac = exec.agent?.ctx
        const svc = ac?.get?.('probeFs')
        viaAgentCtx = svc === undefined ? { root: '(agent.ctx 上取不到服务)' } : svc.resolveRoot()
      } catch (e) {
        viaAgentCtx = { root: 'THROW', how: String(e).slice(0, 140) }
      }
      OBSERVED.push({ viaRoot, execSid, viaAgentCtx })
      return viaRoot.root
    },
  })

  // ── 两个 principal,一个 runtime ────────────────────────────────────
  const handles = {}
  for (const sid of ['sess-alice', 'sess-bob']) {
    handles[sid] = await ctx.agents.create({
      sessionId: SessionId(sid),
      agentOptions: { provider: 'fake', model: 'fake-1' },
    })
  }
  console.log('两个 agent 建好(同一个 runtime,服务只有一份,装在根上)')

  // ── 并发,各三轮 ───────────────────────────────────────────────────
  const ROUNDS = 3
  await Promise.all(
    Object.entries(handles).map(async ([sid, h]) => {
      for (let i = 0; i < ROUNDS; i += 1) {
        h.agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: `第${i}轮` }],
            source: { kind: 'user' },
          }),
        )
        await h.agent.whenIdle()
      }
    }),
  )

  // ── 结果 ───────────────────────────────────────────────────────────
  console.log(`\n工具一共执行了 ${OBSERVED.length} 次(期望 ${ROUNDS * 2} 次)`)
  if (OBSERVED.length === 0) {
    console.log('🚨 一次都没执行 —— 本次结论作废,是驱动没跑通,不是身份解不开')
    process.exit(2)
  }

  const byExec = new Map()
  for (const o of OBSERVED) {
    if (!byExec.has(o.execSid)) byExec.set(o.execSid, new Set())
    byExec.get(o.execSid).add(o.viaRoot.root)
  }

  console.log('\n① 上游工具走的路(根 ctx 上的服务读 this.ctx.agent):')
  for (const o of OBSERVED.slice(0, 4)) {
    console.log(
      `   exec.agent=${o.execSid.padEnd(12)} → 服务解出 ${o.viaRoot.root}  (${o.viaRoot.how})`,
    )
  }
  const rootPathDistinct = new Set(OBSERVED.map((o) => o.viaRoot.root))
  console.log(`   不同的结果:${JSON.stringify([...rootPathDistinct])}`)
  console.log(`   ⇒ ${rootPathDistinct.size >= 2 ? '✅ 分得开' : '❌ 分不开 —— 全部落进同一个根'}`)

  console.log('\n② 自己写的工具才能走的路(exec.agent):')
  console.log(`   看到的 session:${JSON.stringify([...byExec.keys()])}`)
  console.log(
    `   ⇒ ${byExec.size >= 2 && !byExec.has('undefined') ? '✅ 工具层拿得到调用方身份' : '❌ 拿不到'}`,
  )

  console.log('\n③ 从 exec.agent.ctx 上取服务:')
  const viaAgentDistinct = new Set(OBSERVED.map((o) => o.viaAgentCtx.root))
  console.log(`   不同的结果:${JSON.stringify([...viaAgentDistinct])}`)
  console.log(`   第一条的原文:${OBSERVED[0]?.viaAgentCtx?.how ?? '(无)'}`)

  console.log('\n④ 串号检查(每个 session 解出的根应当只有一个):')
  let crossed = false
  for (const [sid, roots] of byExec) {
    const ok = roots.size === 1
    if (!ok) crossed = true
    console.log(`   ${sid.padEnd(12)} → ${JSON.stringify([...roots])} ${ok ? '✅' : '❌ 串了'}`)
  }
  console.log(`   ⇒ ${crossed ? '❌ 有串号' : '✅ 无串号'}`)
}

main().catch((e) => {
  console.error('\n🚨 脚本自己炸了 —— 这不是结论:')
  console.error(e)
  process.exit(1)
})
