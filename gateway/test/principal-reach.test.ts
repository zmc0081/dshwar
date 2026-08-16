/**
 * **V0.4.7 的验收门槛。**
 *
 * 在此之前,「principal 到不了 agent 执行层」这件事的证据链止于
 * 「`agent.ctx` 上没有绑定」—— 那是个中间事实。改完三个调用点之后,
 * 凭它只能说「我改了三处」,不能说「跨租户串目录不会再发生」。
 *
 * 本文件补上缺的那一环:**真实驱动一轮,然后看工作区落在谁的目录下**。
 *
 * ⚠️ **第一组现在断言的是「坏掉的现状」。** V0.4.7 修好后它必须被翻转 ——
 * 失败信息里写了这一点,别把它当成回归。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { TenantFileSystem, tenantWorkspaceRoot } from '@dshwar/fs-tenant'
import {
  ANONYMOUS,
  createPrincipal,
  PRINCIPAL_BINDING,
  PrincipalService,
  type Principal,
} from '@dshwar/principal'
import { describe, expect, it } from 'vitest'
import { FakeLlmAdapter } from './harness.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })

interface AgentLike {
  agent: { ctx: Context; followup(m: unknown): void; whenIdle(): Promise<void> }
}

/** 照 `assembleRuntime()` 的顺序装一套。 */
async function assemble(options: { provideAtRoot?: Principal } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dshwar-reach-'))
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  if (options.provideAtRoot !== undefined) {
    ctx.provide(PRINCIPAL_BINDING, options.provideAtRoot)
  }
  const inner = ctx.isolate('fs')
  await inner.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(TenantFileSystem, { inner: inner.fs as FileSystem, root })
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['fake'], new FakeLlmAdapter({ tokens: ['好'] }))
  return { ctx, root }
}

/**
 * 驱动**真实一轮**,返回 agent 的 ctx 在那之后看到的绑定。
 *
 * 读 `agent.ctx` 而不是根 ctx:工具与适配器都跑在前者上,而这正是
 * V0.4.6 Session 0 第一版探针踩的坑 —— 在根 ctx 上读,永远是匿名,
 * 与作用域有没有生效无关。
 */
async function makeAgentOn(ctx: Context, id: string): Promise<AgentLike> {
  return (await ctx.agents.create({
    sessionId: SessionId(id),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })) as unknown as AgentLike
}

async function driveAndReadBinding(ctx: Context, sessionId: string): Promise<Principal> {
  const handle = (await ctx.agents.create({
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'fake', model: 'fake-1' },
  })) as unknown as AgentLike
  handle.agent.followup(
    createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
  )
  await handle.agent.whenIdle()
  return (handle.agent.ctx.get(PRINCIPAL_BINDING) as Principal | undefined) ?? ANONYMOUS
}

describe('V0.4.7 验收门槛:真实驱动一轮之后的工作区落点', () => {
  it('🚨【待修】现状落在 anonymous/anonymous —— 跨租户共用', async () => {
    const { ctx, root } = await assemble()
    const bound = await driveAndReadBinding(ctx, 's-now')
    const landing = tenantWorkspaceRoot(root, bound)

    expect(
      bound.id,
      'agent 驱动一轮之后读到的不再是匿名 —— **说明 V0.4.7 已修好,请翻转本组断言**',
    ).toBe('anonymous')
    expect(landing).toContain(join('anonymous', 'anonymous'))
  }, 30_000)

  it('正确的落点长什么样 —— 修好之后上面那条应当变成这个', async () => {
    const { root } = await assemble()
    expect(tenantWorkspaceRoot(root, alice)).toContain(join('acme', 'alice-e6f1'))
    expect(tenantWorkspaceRoot(root, bob)).toContain(join('globex', 'bob-a2b3'))
  }, 30_000)
})

/**
 * 进程隔离档的修法 —— **实测可行,且不需要逐点回调**。
 *
 * 一进程一 principal,所以可以在装配时直接把它钉在根上:
 * 插件 fiber 派生自这个根,agent.ctx 于是看得到。
 */
describe('进程隔离档:装配时把 principal 钉到根上就够了', () => {
  it('★ 根上 provide → agent 驱动一轮后落在正确的租户目录', async () => {
    const { ctx, root } = await assemble({ provideAtRoot: alice })
    const bound = await driveAndReadBinding(ctx, 's-rooted')

    expect(bound.id).toBe('alice-e6f1')
    expect(tenantWorkspaceRoot(root, bound)).toContain(join('acme', 'alice-e6f1'))
  }, 30_000)

  it('顺序不要紧 —— 装配之后再 provide 同样生效', async () => {
    // 这一条决定这个修法是不是脆弱的顺序依赖。不是:
    // 绑定读的是槽位的当前值,而不是插件加载时的快照。
    const { ctx, root } = await assemble()
    ctx.provide(PRINCIPAL_BINDING, alice)

    const bound = await driveAndReadBinding(ctx, 's-late')
    expect(bound.id).toBe('alice-e6f1')
    expect(tenantWorkspaceRoot(root, bound)).toContain(join('acme', 'alice-e6f1'))
  }, 30_000)

  it('⚠️ 但这个修法**只对进程档成立** —— 逻辑档会把所有人绑成同一个人', async () => {
    // 不是「能不能」的问题,是「为什么逻辑档不能照抄」。
    // 一进程多 principal 时,根上的绑定对每个 agent 都生效 ——
    // 那不是修好了隔离,是把 bob 的会话也算成 alice 的。
    const { ctx } = await assemble({ provideAtRoot: alice })
    const first = await driveAndReadBinding(ctx, 's-multi-1')
    const second = await driveAndReadBinding(ctx, 's-multi-2')

    expect(first.id).toBe('alice-e6f1')
    expect(
      second.id,
      '若这里不再等于 alice,说明 cordis 的绑定语义变了 —— 本条的警告需要重写',
    ).toBe('alice-e6f1')
  }, 30_000)
})

/**
 * 🪤 **留给下一个人的陷阱。**
 *
 * 「给每个 agent 的 ctx 单独 provide 一个 principal」看起来完全合理,而且
 * **第一个 agent 会成功** —— 只有第二个报错。而 `try/catch` 吞掉注册错误
 * 是很常见的写法。
 *
 * 那时的失败形态比现在隐蔽得多:现在所有人掉进 `anonymous/anonymous`,
 * 一眼看得出不对;那样是 **bob 的数据算进 alice 的租户**,看起来一切正常。
 *
 * 所以把它固化成断言,而不只是写进文档。
 */
describe('🪤 陷阱:per-agent provide 会让第二个 agent 静默继承第一个的身份', () => {
  it('第一个 provide 成功,第二个抛错 —— 错误一旦被吞,身份就串了', async () => {
    const { ctx } = await assemble()
    const a = await makeAgentOn(ctx, 's-trap-a')
    const b = await makeAgentOn(ctx, 's-trap-b')

    // 第一个:成功
    expect(() => a.agent.ctx.provide(PRINCIPAL_BINDING, alice)).not.toThrow()

    // 第二个:抛 —— 槽位已被第一个占住
    expect(
      () => b.agent.ctx.provide(PRINCIPAL_BINDING, bob),
      '第二个 agent 也 provide 成功了 —— cordis 的语义变了,本陷阱需要重新评估',
    ).toThrow(/registered/)

    // ★ 关键:错误被吞掉之后会发生什么 —— B 读到的是 A 的身份
    const seenByB = (b.agent.ctx.get(PRINCIPAL_BINDING) as Principal | undefined)?.id
    expect(
      seenByB,
      'bob 的 agent 读到了 alice —— 这正是「看起来一切正常」的跨租户串号',
    ).toBe('alice-e6f1')
  }, 30_000)

  it('per-agent 装第二份服务实例也不行 —— 遮蔽不成立', async () => {
    // 另一条看似可行的路:给每个 agent 在它自己的 ctx 上装一份 fs-tenant。
    // cordis 同样拒绝 —— 与上面是同一个机制(祖先已注册该服务名)。
    const { ctx } = await assemble()
    const a = await makeAgentOn(ctx, 's-trap-c')

    await expect(
      a.agent.ctx.plugin(TenantFileSystem, {
        inner: ctx.get('fs') as FileSystem,
        root: mkdtempSync(join(tmpdir(), 'trap-')),
      }),
    ).rejects.toThrow(/registered/)
  }, 30_000)
})
