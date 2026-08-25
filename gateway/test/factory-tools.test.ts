/**
 * 出厂到底带不带文件工具,以及模型知不知道自己有哪些工具。
 *
 * ## 它守的那两件事
 *
 * **① 出厂带文件工具。** 不带的话 `fs-tenant` 守的是一件出厂做不了的事 ——
 * 工作区、路径钉死、逃逸测试、V0.4.7 那个发布阻塞项,全部围着它转。
 * 实测过那个状态:V0.9.0 之前网关**一个工具都没注册**
 * (`docs/DECISIONS/gateway-registers-no-tools.md`)。
 *
 * **② 模型必须被告知这个部署有哪些工具。** 零工具是合法配置(纯对话部署),
 * 所以不 fail closed;但「没有工具」与「模型不知道有没有工具」是两回事。
 * 实测过后者:零工具时请求里连 `tools` 字段都没有,系统提示也不提,
 * 于是模型说「我已经读完了 note.txt」而**没有任何东西能反驳它**。
 *
 * ## ⚠️ 一处与直觉相反、必须写下来的实测结果
 *
 * `meta.cwd` **不是**租户隔离的防线,加它之前也没有「落回 anonymous」这回事:
 * `fs-tenant` 的 `resolve()` 在 `opts.cwd === undefined` 时**默认用当前主体的
 * 工作区根**,所以不传 `meta.cwd`,文件照样落在正确的租户目录。
 *
 * ⇒ 它是**默认值**,不是防线。价值在两处:
 *   1. 不用 `fs-tenant` 的部署(直接 fs-local)靠它把会话分开;
 *   2. 将来 opt-in 的 `dsh-tool-bash` 用同一个 session cwd 定 workdir,
 *      而那条路上**没有** fs-tenant 兜底。
 *
 * 所以本文件断言的是它**可观察的那一面**:会话头里的 cwd 等于该主体的工作区根。
 * 这条断言在 `createAgent` 不传 `meta` 时会红 —— 那才是它真正的负向验证。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { tenantWorkspaceRoot } from '@dshwar/fs-tenant'
import { createPrincipal, type Principal } from '@dshwar/principal'
import { beforeEach, describe, expect, it } from 'vitest'

import { assembleRuntime, renderToolInventory } from '../src/runtime.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })

/** 先发一次 `read` 调用,拿到结果就收尾 —— 与真实一轮同形(两次模型往返)。 */
class ReadingFake extends LlmAdapter {
  readonly seen: { tools: string[] | undefined; system: string; history: string }[] = []

  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push({
      tools: request.tools?.map((t) => t.name),
      system: String(request.system ?? ''),
      // ★ 工具结果**穿过 agent loop 之后**回到模型的历史 —— 断言要打在这里,
      //   而不是我们自己去读文件(那样测的是文件系统,不是这条链路)。
      history: JSON.stringify(request.messages ?? []),
    })
    const msgs = request.messages ?? []
    const last = msgs[msgs.length - 1]
    if (!JSON.stringify(last ?? {}).includes('tool-result')) {
      const id = `c${msgs.length}` as never
      const args = JSON.stringify({ file_path: 'note.txt' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'read', argumentsDelta: args }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: 'read', arguments: args },
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

interface Driven {
  readonly agent: {
    readonly session: { readonly header: { readonly cwd?: string } }
    followup(m: unknown): void
    whenIdle(): Promise<void>
  }
}

/** 起一套**出厂**运行时(走 assembleRuntime,不手工拼),并备好该主体的工作区。 */
async function boot(principal: Principal) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'dshwar-ft-'))
  const sessionRoot = mkdtempSync(join(tmpdir(), 'dshwar-ft-s-'))
  const mine = tenantWorkspaceRoot(workspaceRoot, principal)
  mkdirSync(mine, { recursive: true })
  writeFileSync(join(mine, 'note.txt'), `我属于 ${principal.tenantId}/${principal.id}\n`, 'utf8')

  const runtime = await assembleRuntime({
    workspaceRoot,
    sessionRoot,
    authEntries: [],
    defaultProvider: 'fake',
    defaultModel: 'fake-1',
    principal,
    quiet: true,
  })
  const fake = new ReadingFake()
  runtime.ctx.llm.registerAdapter(['fake'], fake)
  return { runtime, fake, workspaceRoot, mine }
}

describe('① 出厂带文件工具', () => {
  it('assembleRuntime 之后 read / write / edit 都在', async () => {
    const { runtime } = await boot(alice)
    const names = runtime.ctx.tools.schemas().map((t) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('edit')
    await runtime.dispose()
  })

  it('★ 只带文件工具 —— bash / 网络不出厂(那是部署方的安全决定)', async () => {
    const { runtime } = await boot(alice)
    const names = runtime.ctx.tools.schemas().map((t) => t.name)
    // ⚠️ 断言的是「没有能跑命令的工具」,不是「工具数恰好是 3」——
    //    后者会因为上游给 tool-fs 加一个工具而无谓变红。
    for (const forbidden of ['bash', 'pwsh', 'run_command', 'web_fetch', 'web_search']) {
      expect(names, `${forbidden} 不该出厂`).not.toContain(forbidden)
    }
    await runtime.dispose()
  })
})

describe('② 模型必须知道这个部署有哪些工具', () => {
  it('有工具时,清单进系统提示', () => {
    const text = renderToolInventory(['read', 'write'])
    expect(text).toContain('read')
    expect(text).toContain('write')
    expect(text).toContain('清单之外没有别的工具')
  })

  it('★ 零工具时**明说**没有,并且点名「不要声称做过」', () => {
    const text = renderToolInventory([])
    expect(text).toContain('未注册任何工具')
    // 这一句守的正是「模型自由发挥」那条路径 —— 实测里模型会说
    // 「我已经读完了 note.txt」,而当时没有任何东西反驳它。
    expect(text).toContain('不要声称你做过这些操作')
  })

  it('★ 出厂装配真的把这段挂上去了(不是「函数写对了」)', async () => {
    const { runtime, fake } = await boot(alice)
    const handle = (await runtime.createAgent({
      sessionId: 's-prompt',
      model: undefined,
      provider: undefined,
    })) as unknown as Driven
    handle.agent.followup(runtime.userMessage('hi'))
    await handle.agent.whenIdle()

    expect(fake.seen.length, '一次模型请求都没发出 —— 本条空跑了').toBeGreaterThan(0)
    const first = fake.seen[0]
    expect(first?.system, '系统提示里没有工具清单').toContain('本部署可用的工具')
    // 有工具时 tools 字段必须真的送出去
    expect(first?.tools, 'tools 字段没送给模型').toContain('read')
    await runtime.dispose()
  })
})

describe('③ 每个会话的工作区经 meta.cwd 到达上游', () => {
  it('★ 会话头里的 cwd = 该主体的工作区根', async () => {
    const { runtime, workspaceRoot } = await boot(alice)
    const handle = (await runtime.createAgent({
      sessionId: 's-cwd',
      model: undefined,
      provider: undefined,
    })) as unknown as Driven
    // ⚠️ 这是 meta.cwd **唯一可观察**的一面:fs-tenant 在 cwd 缺省时
    //    会用工作区根兜底,所以文件落点测不出差别。删掉 createAgent 里的
    //    `meta` 之后,红的是这一条。
    expect(handle.agent.session.header.cwd).toBe(tenantWorkspaceRoot(workspaceRoot, alice))
    await runtime.dispose()
  })
})

describe('④ 真实驱动:两个主体并发多轮,各读各的', () => {
  let a: Awaited<ReturnType<typeof boot>>
  let b: Awaited<ReturnType<typeof boot>>

  beforeEach(async () => {
    a = await boot(alice)
    b = await boot(bob)
  })

  it('★ 各自读到自己那份,无串号', async () => {
    const results = { acme: [] as string[], globex: [] as string[] }

    const drive = async (
      who: 'acme' | 'globex',
      env: Awaited<ReturnType<typeof boot>>,
      sid: string,
    ) => {
      const handle = (await env.runtime.createAgent({
        sessionId: sid,
        model: undefined,
        provider: undefined,
      })) as unknown as Driven
      for (let i = 0; i < 2; i += 1) {
        handle.agent.followup(env.runtime.userMessage('读 note.txt'))
        await handle.agent.whenIdle()
      }
      // 工具结果回到模型时带着文件内容 —— 从模型收到的历史里取,
      // 这是**穿过 agent loop 之后**的东西,不是我们自己读的文件。
      results[who].push(env.fake.seen.map((x) => x.history).join(''))
    }

    await Promise.all([drive('acme', a, 's-a'), drive('globex', b, 's-b')])

    const acme = results.acme.join('')
    const globex = results.globex.join('')
    // ★ 出口断言:各自看见自己的内容,且**看不见对方的**
    expect(acme, 'alice 没读到自己的文件').toContain('acme/alice-e6f1')
    expect(acme, '★ alice 读到了 bob 的文件 —— 串号了').not.toContain('globex/bob-a2b3')
    expect(globex, 'bob 没读到自己的文件').toContain('globex/bob-a2b3')
    expect(globex, '★ bob 读到了 alice 的文件 —— 串号了').not.toContain('acme/alice-e6f1')

    await a.runtime.dispose()
    await b.runtime.dispose()
  })
})
