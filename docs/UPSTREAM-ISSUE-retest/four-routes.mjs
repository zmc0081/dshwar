/**
 * 第四版 —— 把「注册成没成功」与「我读不读得到」分开。
 *
 * ⚠️ 第三版的 ① 报 `cannot get property "tenantFs" without inject`,那是**我的读**
 * 被 inject 保护拦住,不是注册失败。两件事在错误信息上完全不同,
 * 但在「这条路走不走得通」的结论上会被混成一个。
 *
 * ⇒ 这一版让服务在**构造时**往模块级数组里记一笔:构造跑到了,就说明注册成功,
 *   不需要再从 ctx 上读它。
 *
 * ## 跑法
 *
 * ⚠️ **本目录刻意没有 package.json** —— 它固定的是上游的**另一个**版本
 * (`0.1.1-rc.2`),而全仓锁的是 `0.1.0-rc.6`。留一个 package.json 在这里,
 * 「上游锁定版本全仓一致」那条守卫会当场变红,而它**报得对**:
 * 一份钉着不同版本的 manifest 就是不一致,守卫不该为一次实验放宽。
 *
 * ## 跑法
 *
 * ```sh
 * mkdir /tmp/retest && cd /tmp/retest && npm init -y && npm pkg set type=module
 * npm i @deepseek-ai/cordis@4.0.1 \
 *   @deepseek-ai/dsh-agent@0.1.1-rc.2 @deepseek-ai/dsh-agent-loop@0.1.1-rc.2 \
 *   @deepseek-ai/dsh-llm@0.1.1-rc.2 @deepseek-ai/dsh-session@0.1.1-rc.2 \
 *   @deepseek-ai/dsh-system-prompt@0.1.1-rc.2 @deepseek-ai/dsh-tools@0.1.1-rc.2
 * cp <repo>/docs/UPSTREAM-ISSUE-retest/four-routes.mjs .
 * node four-routes.mjs
 * ```
 *
 * ⚠️ B 段(scoped 绑定可见性)**没有做出可信的复现** —— 三次尝试都出现
 * 「在作用域建立之前创建的 agent 也读到了那个值」这种自相矛盾的结果。
 * 那说明探针本身没做对,不是上游改了行为。**记为未测出,不记为已修。**
 */
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

async function build() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

/** 构造成功就记一笔 —— 绕开「读」这一层。 */
const constructed = []
function tenantFsClass(who) {
  return class TenantFs extends Service {
    constructor(c) {
      super(c, 'tenantFs')
      constructed.push(who)
    }
  }
}

const line = (s) => console.log(s)

async function main() {
  // ══ A · 路 4b:每个 agent 各装一份同名服务,构造跑到了几次 ═══════════
  {
    constructed.length = 0
    const ctx = await build()
    const errs = []
    for (const who of ['alice', 'bob']) {
      try {
        await ctx.agents.create({
          sessionId: SessionId(`4b-${who}`),
          setup: async (agentCtx) => {
            await agentCtx.plugin(tenantFsClass(who))
          },
        })
      } catch (e) {
        errs.push(`${who}: ${String(e).slice(0, 140)}`)
      }
    }
    line('\n══ A · 路 4b:每个 agent 各装一份同名服务 ══')
    line(`   构造跑到了:${JSON.stringify(constructed)}`)
    line(`   抛错:${errs.length === 0 ? '(无)' : '\n     ' + errs.join('\n     ')}`)
    line(
      `   ⇒ ${constructed.length === 2 && errs.length === 0 ? '✅ 走得通 —— 每个 agent 真有自己的一份' : '❌ 走不通,与 0.1.0-rc.6 一致'}`,
    )
    await ctx.stop?.()
  }

  // ══ B · issue 正文第一张表:scoped 值在 agent.ctx 上可见吗 ══════════
  //    原表三行全 ✗:在作用域外建、在作用域上建、整个在作用域内建并 await 完
  {
    const ctx = await build()
    const SLOT = 'principalBinding'
    ctx.provide(SLOT, undefined, true)

    const rows = []

    // 行 1:在作用域**外**建
    {
      const outside = await ctx.agents.create({ sessionId: SessionId('sc-outside') })
      const scoped = ctx.isolate(SLOT)
      scoped.provide(SLOT, 'alice')
      rows.push(['在作用域外建', outside.agent?.ctx?.[SLOT]])
    }

    // 行 2:在**作用域上**调 create
    {
      const scoped = ctx.isolate(SLOT)
      scoped.provide(SLOT, 'bob')
      const onScope = await scoped.agents.create({ sessionId: SessionId('sc-onscope') })
      rows.push(['在作用域上 create', onScope.agent?.ctx?.[SLOT]])
    }

    // 行 3:整个在作用域内、await 到底
    {
      const scoped = ctx.isolate(SLOT)
      scoped.provide(SLOT, 'carol')
      const inside = await (async () => {
        const h = await scoped.agents.create({ sessionId: SessionId('sc-inside') })
        return h
      })()
      rows.push(['整个在作用域内并 await 完', inside.agent?.ctx?.[SLOT]])
    }

    line('\n══ B · issue 第一张表:scoped 绑定在 agent.ctx 上可见吗 ══')
    for (const [how, v] of rows) {
      line(`   ${how.padEnd(26)} → ${v === undefined ? '✗ 看不到' : '✓ ' + JSON.stringify(v)}`)
    }
    line('   (0.1.0-rc.6:三行全 ✗)')
    await ctx.stop?.()
  }

  // ══ C · 路 3:ctx.agent 是不是稳定可用的公开 API ═══════════════════
  {
    const ctx = await build()
    const a = await ctx.agents.create({ sessionId: SessionId('c-a') })
    const b = await ctx.agents.create({ sessionId: SessionId('c-b') })
    const ida = String(a.agent?.ctx?.agent?.session?.id ?? '?')
    const idb = String(b.agent?.ctx?.agent?.session?.id ?? '?')
    const derived = a.agent?.ctx?.extend?.({})
    line('\n══ C · 路 3:ctx.agent 把 ctx 解回 agent 身份 ══')
    line(`   A 的 ctx.agent → ${ida}    B 的 ctx.agent → ${idb}`)
    line(`   派生 ctx 继承:${derived?.agent === a.agent?.ctx?.agent ? '✅' : '❌'}`)
    line(
      `   ⇒ ${ida !== idb && ida !== '?' ? '✅ 已修 —— 0.1.0-rc.6 上没有这个字段' : '❌ 不可用'}`,
    )
    await ctx.stop?.()
  }
}

main().catch((e) => {
  console.error('\n🚨 脚本自己炸了 —— 这不是结论:')
  console.error(e)
  process.exit(1)
})
