/**
 * 进程内运行时装配 —— 把 `profiles/gateway.yml` 那份清单变成可执行的代码。
 *
 * ## 为什么这一层单独存在
 *
 * `createGateway()` 刻意**只消费一个装好的 `ctx`**(见 `app.ts`)。那条边界要留着:
 * 把网关当库用的人可以自带运行时,边缘环境可以完全不引上游。
 *
 * 但「网关不组装」不等于「没人组装」。在 V0.2.0 之前,唯一跑通过完整装配的地方是
 * 测试的 harness —— 于是 `docs/DEPLOYMENT.md` 写的启动命令没有对应的可执行文件。
 * 这个模块就是把那份 harness 的接线提升成产品代码。
 *
 * ## 插件清单的事实源
 *
 * 清单在 {@link GATEWAY_PLUGINS} 里声明一次,`profiles/gateway.yml` 是同一份清单的
 * 声明式表达(给用 dsh 自带 loader 的人看)。两者漂移由
 * `gateway/test/runtime.test.ts` 断言拦住 —— 否则文档里的 profile 会慢慢变成装饰品。
 *
 * @module @dshwar/gateway/runtime
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { StaticAuth } from '@dshwar/auth-static'
import { MultiuserCredentials, type PrincipalCredentialStore } from '@dshwar/credentials-multiuser'
import { TenantFileSystem, tenantWorkspaceRoot } from '@dshwar/fs-tenant'
import { ANONYMOUS, PRINCIPAL_BINDING, PrincipalService, type Principal } from '@dshwar/principal'
import type { AgentHandleLike } from './sessions/store.ts'

/**
 * 本进程装哪些插件 —— 是 `profiles/gateway.yml` 那份清单的可执行表达。
 *
 * 漂移由 `gateway/test/runtime.test.ts` 拦住:profile 里出现而这里没有、
 * 又不在 {@link DELIBERATELY_OMITTED} 里的插件,测试直接红。否则 profile 会
 * 慢慢变成没人维护的装饰品。
 */
export const GATEWAY_PLUGINS = [
  '@dshwar/principal',
  '@dshwar/auth-static',
  '@dshwar/credentials-multiuser',
  '@dshwar/fs-tenant',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
] as const

/**
 * `profiles/gateway.yml` 里有、但本装配**刻意不装**的。
 *
 * 每一条都得给出理由 —— 一份「反正就是没装」的清单会掩盖真正的遗漏:
 *
 * - `@deepseek-ai/cordis-plugin-timer` —— 上游某些插件的可选依赖,本装配用不到。
 * - `@deepseek-ai/dsh-subprocess-local` —— 依赖 node-pty 原生构建,且上游
 *   `ProcessInspector` 只实现了 linux / darwin,win32 直接抛错
 *   (`docs/FEASIBILITY-REPORT.md` 验证 D)。让默认部署在 Windows 上起不来,
 *   代价大于收益。需要 shell 工具的部署自行加装。
 * - `@dshwar/storage-scoped` —— 它导出的是 `scopedBackend(ctx, inner)` 包装函数,
 *   **不是根上下文插件**:作用域在 `open()` 的那一刻定格,必须在会话作用域内套用
 *   (见该包 §scopedBackend 的说明)。profile 里那一行是给 dsh 自带 loader 的
 *   声明式表达,程序化装配走的是另一条路。会话流本身不读 `ctx.storage`,
 *   所以不装它不影响本版本的任何端点。
 */
export const DELIBERATELY_OMITTED = [
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-subprocess-local',
  '@dshwar/storage-scoped',
] as const

/** 一个终端用户的静态令牌条目。生产请换 auth-jwt / auth-oidc(V0.3.0)。 */
export interface StaticAuthEntry {
  readonly token: string
  readonly id: string
  readonly tenantId: string
  readonly roles?: readonly string[]
}

/**
 * 工具清单提示段的正文 —— **纯函数,可直接断言**。
 *
 * 抽出来是为了让「零工具时说了什么」测得到:留在装配里的话,
 * 要验它就得再装一套没有工具的运行时,而那等于把同一段逻辑抄两遍。
 *
 * @param names 当前注册到的工具名(顺序即呈现顺序)
 */
export function renderToolInventory(names: readonly string[]): string {
  if (names.length === 0) {
    return [
      '## 本部署未注册任何工具',
      '',
      '你**没有**读写文件、执行命令或访问网络的能力。',
      '不要声称你做过这些操作 —— 做不到就直说做不到。',
    ].join('\n')
  }
  return [
    '## 本部署可用的工具',
    '',
    names.map((n) => `- \`${n}\``).join('\n'),
    '',
    '**清单之外没有别的工具。** 需要清单外的能力时直说做不到,不要假装完成。',
  ].join('\n')
}

export interface RuntimeOptions {
  /** 工作区根。每个主体的实际根是 `{workspaceRoot}/{tenantId}/{userId}`。 */
  readonly workspaceRoot: string
  /** 会话日志根(JSONL 持久化)。 */
  readonly sessionRoot: string
  /** 静态令牌表。 */
  readonly authEntries: readonly StaticAuthEntry[]
  /** per-principal 凭据存储。不传则没有任何主体能解析到凭据(fail closed)。 */
  readonly credentialStore?: PrincipalCredentialStore
  /** 默认模型与 provider。请求里没指定时用它。 */
  readonly defaultProvider: string
  readonly defaultModel: string
  /**
   * **本进程只服务这一个主体** —— 装配时把它钉在根上下文。
   *
   * ## 为什么这一行是必需的(V0.4.7)
   *
   * principal 的绑定活在 cordis 的上下文槽位上,而 **agent 拿到的是
   * `AgentRegistry` 插件 fiber 派生的自有 ctx**,与调用方传进去的作用域无关。
   * 于是工具与适配器在执行时读到的是 `ANONYMOUS` —— `fs-tenant` 会老老实实
   * 往 `anonymous/anonymous/` 里写文件,**跨租户共用一个目录,且没有任何报错**。
   *
   * 实测:插件 fiber 派生自根,所以**在根上 provide 就够了** ——
   * agent.ctx 继承得到,工具于是落在正确的租户目录。
   * 顺序不要紧(装配前后都行),绑定读的是槽位当前值而非加载时快照。
   *
   * ⚠️ **只在进程隔离档下传它。** 一个进程多个主体时,根上的绑定对**每个**
   * agent 都生效 —— 那不是修好了隔离,是把 bob 的会话算成 alice 的。
   * 逻辑档必须留空,并由 {@link assertSinglePrincipalCapable} 在配置层拦住
   * 多用户组合。全部实测钉在 `gateway/test/principal-reach.test.ts`。
   */
  readonly principal?: Principal
  /** 静默启动日志。测试用。 */
  readonly quiet?: boolean
}

export interface AssembledRuntime {
  readonly ctx: Context
  readonly createAgent: (input: {
    sessionId: string
    model: string | undefined
    provider: string | undefined
  }) => Promise<AgentHandleLike>
  readonly userMessage: (text: string) => unknown
  readonly dispose: () => Promise<void>
}

/**
 * 装配一个可驱动的进程内运行时。
 *
 * 装配**顺序有意义**:`fs-tenant` 要包住一个 `fs-local`,所以内层先在隔离作用域里
 * 起来再交给外层。这不是风格问题 —— 直接把 `fs-local` 装在根上,`fs-tenant` 就会
 * 覆盖掉它自己要用的那个后端。
 */
export async function assembleRuntime(options: RuntimeOptions): Promise<AssembledRuntime> {
  const ctx = new Context()

  await ctx.plugin(PrincipalService)

  // ★ V0.4.7:进程隔离档在这里把本进程唯一的主体钉在根上。
  // 不钉的话,agent 执行时读到的是 ANONYMOUS —— 见 RuntimeOptions.principal。
  //
  // ★★ V0.6.0:改成**无条件** provide —— 单用户档也显式 provide ANONYMOUS。
  //
  // 这一行是「把缺失变显式」的全部实现。改之前,单用户档什么都不 provide,
  // 于是 `ctx.get(PRINCIPAL_BINDING)` 返回 undefined —— 而那个 undefined
  // **同时**意味着「合法的单用户」与「装配根本没跑」,两者在槽位层面分不出来。
  //
  // 显式 provide 之后,undefined 只剩一个含义:**没人表过态**。
  // `PrincipalService.current()` 据此抛 PrincipalUnboundError。
  //
  // ⚠️ 这**不防**漏挂认证中间件 —— 那种情形会回落到这里 provide 的根绑定,
  // 不抛。防线是 gateway/test/auth-coverage.test.ts。见
  // docs/DECISIONS/undefined-vs-anonymous.md。
  ctx.provide(PRINCIPAL_BINDING, options.principal ?? ANONYMOUS)
  await ctx.plugin(StaticAuth, {
    entries: options.authEntries.map((e) => ({ ...e })),
    quiet: options.quiet ?? false,
  })

  // 不传 store 时也照样装:缺 principal 一律 fail closed(硬规则 6),
  // 而「没装 credentials」会让下游拿到 undefined service 而不是干净的 undefined 值。
  await ctx.plugin(MultiuserCredentials, {
    ...(options.credentialStore === undefined ? {} : { store: options.credentialStore }),
  })

  // fs-tenant 包 fs-local,不替代它
  const inner = ctx.isolate('fs')
  await inner.plugin(LocalFileSystem, { cwd: options.workspaceRoot })
  await ctx.plugin(TenantFileSystem, {
    inner: inner.fs as FileSystem,
    root: options.workspaceRoot,
  })

  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionPersistenceJsonl, { root: options.sessionRoot })

  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })

  // ★ **出厂带文件工具。** 不带的话 `fs-tenant` 守的是一件出厂做不了的事 ——
  //   工作区、路径钉死、逃逸测试、V0.4.7 那个发布阻塞项,全部围着它转。
  //   **发一把锁而没有门**,是这一版之前的实际状态(实测见
  //   docs/DECISIONS/gateway-registers-no-tools.md)。
  //
  // ⚠️ 只带**文件**工具。bash / 网络 / 其余一律 opt-in ——
  //   它们不是本基座的隔离对象,而带上它们等于替部署方做了一次安全决定。
  await ctx.plugin(ToolFs, {})

  // ★ **模型必须知道这个部署有哪些工具。**
  //
  //   零工具是合法配置(纯对话部署),所以这里**不 fail closed**。
  //   但「没有工具」与「模型不知道有没有工具」是两回事,后者是缺陷:
  //   实测过,零工具时请求里**连 tools 字段都没有**,系统提示也不提 ——
  //   一个被训练成「我有文件工具」的模型得不到任何相反信号,
  //   于是它会说「我已经读完了 note.txt」,而**没有任何东西能反驳它**。
  //
  //   这比拒绝更坏:拒绝是有东西表了态(billing 落 401 是那一族),
  //   这里是没有任何东西表态。
  ctx.systemPrompt.section({
    name: 'dshwar/tool-inventory',
    // 上游约定:工具相关的说明用 100–199。
    order: 100,
    text: () => renderToolInventory(ctx.tools.schemas().map((t) => t.name)),
  })

  return {
    ctx,
    createAgent: async (input) => {
      // ★ **每个会话的工作区靠 `meta.cwd` 交给上游。**
      //
      //   上游的文件工具用 `exec.agent.session.header.cwd` 决定相对路径解析到哪
      //   (`dsh-tool-fs` 的 sessionCwd;`dsh-tool-bash` 的 workdir 同款)。
      //   不传的话,相对路径解析到**服务器的启动目录**,而不是这个人的工作区。
      //
      // ⚠️ 这不是隔离防线,是**默认值**。防线仍在 `fs-tenant`:
      //   它把任何 cwd(包括这一个)`pinPath` 进当前主体的工作区根,
      //   并在 realpath 之后复查。两层的失效场景不同,所以都要有。
      const principal = ctx.principal.current()
      const cwd = tenantWorkspaceRoot(options.workspaceRoot, principal)
      return (await ctx.agents.create({
        sessionId: SessionId(input.sessionId),
        meta: { cwd },
        agentOptions: {
          provider: input.provider ?? options.defaultProvider,
          model: input.model ?? options.defaultModel,
        },
      })) as unknown as AgentHandleLike
    },
    userMessage: (text) =>
      createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    // cordis 的 Context 没有 stop();拆卸走拥有它的 fiber。
    // 根 fiber dispose 会级联卸载全部插件 —— 会话日志的 flush 挂在
    // session-persistence 的 disposer 上,不 dispose 就会丢掉最后一段。
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}
