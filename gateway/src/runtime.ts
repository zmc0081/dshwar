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
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { StaticAuth } from '@dshwar/auth-static'
import { MultiuserCredentials, type PrincipalCredentialStore } from '@dshwar/credentials-multiuser'
import { TenantFileSystem } from '@dshwar/fs-tenant'
import { PrincipalService } from '@dshwar/principal'
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

  return {
    ctx,
    createAgent: async (input) =>
      (await ctx.agents.create({
        sessionId: SessionId(input.sessionId),
        agentOptions: {
          provider: input.provider ?? options.defaultProvider,
          model: input.model ?? options.defaultModel,
        },
      })) as unknown as AgentHandleLike,
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
