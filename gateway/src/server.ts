#!/usr/bin/env node
/**
 * 网关可执行入口 —— `docs/DEPLOYMENT.md` 里那条启动命令的落点。
 *
 * ```bash
 * node dist/server.js --config gateway.config.json
 * ```
 *
 * ## 配置只从一个文件来
 *
 * 不读 `process.env`(CLAUDE.md「配置只经 profile 注入,不散落 env 读取」)。
 * 端口这类纯运维参数可以用命令行覆盖,但**身份与凭据一律只从配置文件读** ——
 * 令牌散在环境变量里,轮换时没人知道该改哪几台机器。
 *
 * ## 它不做 TLS
 *
 * 证书由反向代理终结。理由见 `docs/DEPLOYMENT.md` §1:自己管证书意味着每个部署
 * 都要处理续期、SNI、OCSP,那是反向代理已经做得很好的事。
 *
 * @module @dshwar/gateway/server
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { serve } from '@hono/node-server'
import { InMemoryPrincipalCredentialStore } from '@dshwar/credentials-multiuser'
import { createScimApp } from '@dshwar/scim-server'
import { InMemorySubjectStore } from '@dshwar/subject'
import type { TenantMapConfig } from '@dshwar/tenant-map'
import { createPrincipal, type Principal } from '@dshwar/principal'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGateway } from './app.ts'
import { InMemoryAdminKeyResolver } from './admin-keys.ts'
import { InMemoryScimTokenResolver } from './scim-keys.ts'
import { ConsoleAuditSink } from './admin/audit.ts'
import { registerAdminRoutes } from './admin/routes.ts'
import { assembleRuntime, type StaticAuthEntry } from './runtime.ts'
import { registerRuntimeRoutes } from './sessions/routes.ts'
import { GatewaySessionStore } from './sessions/store.ts'

/** 配置文件的形状。字段少是刻意的 —— 每加一个都是一处要长期维护的兼容面。 */
export interface ServerConfig {
  readonly host?: string
  readonly port?: number
  /** 工作区根。每个主体的实际根是 `{workspaceRoot}/{tenantId}/{userId}`。 */
  readonly workspaceRoot: string
  /** 会话日志根。 */
  readonly sessionRoot: string
  readonly defaultProvider: string
  readonly defaultModel: string
  /**
   * 静态令牌表。
   *
   * ⚠️ **明文令牌,禁止用于生产。** 它在这里是为了让部署方能先把管道跑通,
   * 再换成 `@dshwar/auth-jwt` / `auth-oidc`(V0.3.0)。启动时会打警告。
   */
  readonly authEntries: readonly StaticAuthEntry[]
  /** Admin Key → 租户。一把钥匙不得横跨租户(CLAUDE.md 第七节)。 */
  readonly adminKeys?: readonly { key: string; label: string; tenantId: string }[]
  /** 每个主体的凭据。仅用于开发;生产应接真正的凭据后端。 */
  readonly credentials?: readonly {
    subjectId: string
    tenantId: string
    ref: string
    value: string
  }[]
  /** SSE 心跳间隔(毫秒)。默认 15000。 */
  readonly heartbeatMs?: number
  /**
   * SCIM 供给(V0.3.0)。配了它,身份源就能把用户推进来。
   *
   * ⚠️ SCIM token 与 Admin Key 分离签发:供给系统只能写身份镜像,
   * 不能读用量与凭据配置(CLAUDE.md 第七节)。
   */
  readonly scim?: {
    /** 身份源标识,同时是 token 的绑定对象。 */
    readonly source: string
    /** 供给方界面里配的那个 Bearer token。 */
    readonly token: string
    readonly tenantMap: TenantMapConfig
  }
}

/** 极简参数解析。刻意不引 CLI 框架 —— 四个参数不值得一个依赖。 */
export function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else {
      const next = argv[i + 1]
      out[arg.slice(2)] = next === undefined || next.startsWith('--') ? 'true' : next
      if (next !== undefined && !next.startsWith('--')) i += 1
    }
  }
  return out
}

const USAGE = `
用法: node dist/server.js --config <配置文件>

  --config <path>   配置文件(JSON)。必填。
  --port <n>        覆盖配置里的端口。
  --host <addr>     覆盖配置里的监听地址。默认 127.0.0.1 ——
                    只听本地是刻意的:网关前面必须有反向代理终结 TLS。
                    要直接对外请显式传 0.0.0.0,并确认你知道自己在做什么。

配置文件示例与反向代理设置见 docs/DEPLOYMENT.md。
`.trim()

/** 启动一个网关。返回关闭函数,便于测试与优雅停机。 */
export async function startServer(
  config: ServerConfig,
): Promise<{ url: string; close: () => Promise<void> }> {
  if (config.authEntries.length === 0) {
    throw new Error('配置里没有任何 authEntries —— 没有令牌表,所有请求都会被拒绝。')
  }

  const credentialStore = new InMemoryPrincipalCredentialStore()
  const runtime = await assembleRuntime({
    workspaceRoot: resolve(config.workspaceRoot),
    sessionRoot: resolve(config.sessionRoot),
    authEntries: config.authEntries,
    credentialStore,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
  })

  for (const entry of config.credentials ?? []) {
    const subject: Principal = createPrincipal({ id: entry.subjectId, tenantId: entry.tenantId })
    await credentialStore.put(subject, credentialRef(entry.ref), entry.value)
  }

  const store = new GatewaySessionStore()
  const adminKeys = new InMemoryAdminKeyResolver((config.adminKeys ?? []).map((k) => ({ ...k })))

  // Subject Mirror:静态令牌表的用户也进镜像,让 /v1/admin/subjects 有东西可看,
  // 且 SCIM 推进来的用户与静态用户走同一张表
  const subjects = new InMemorySubjectStore()
  for (const entry of config.authEntries) {
    await subjects.upsert({
      source: 'static',
      externalId: entry.id,
      userName: entry.id,
      tenantId: entry.tenantId,
    })
  }

  const app = createGateway({
    ctx: runtime.ctx,
    adminKeys,
    runtimeRoutes: registerRuntimeRoutes({
      store,
      createAgent: runtime.createAgent,
      userMessage: runtime.userMessage,
      heartbeatMs: config.heartbeatMs ?? 15_000,
    }),
    ...(config.scim === undefined
      ? {}
      : {
          scim: {
            source: config.scim.source,
            app: createScimApp({
              source: config.scim.source,
              subjects,
              tenantMap: config.scim.tenantMap,
              onAudit: (r) =>
                new ConsoleAuditSink().record({
                  at: new Date().toISOString(),
                  actor: `scim:${config.scim!.source}`,
                  tenantId: '-',
                  action: r.action,
                  target: r.target,
                  requestId: r.detail,
                }),
            }),
            tokens: new InMemoryScimTokenResolver([
              {
                token: config.scim.token,
                source: config.scim.source,
                label: `${config.scim.source} 供给`,
              },
            ]),
          },
        }),
    adminRoutes: registerAdminRoutes({
      ctx: runtime.ctx,
      audit: new ConsoleAuditSink(),
      credentialRefs: [...new Set((config.credentials ?? []).map((c) => c.ref))],
      subjectStore: subjects,
      subjects: {
        find: async (subjectId) => {
          const entry = config.authEntries.find((e) => e.id === subjectId)
          return entry === undefined
            ? undefined
            : createPrincipal({ id: entry.id, tenantId: entry.tenantId })
        },
      },
    }),
  })

  const host = config.host ?? '127.0.0.1'
  const port = config.port ?? 8787

  // 端口从**实际绑定结果**读回,而不是回显配置值:传 0 时由内核挑一个空闲端口,
  // 回显 0 会得到一个连不上的 URL。测试正是靠传 0 来避免并行时互撞端口。
  const { server, boundPort } = await new Promise<{
    server: ReturnType<typeof serve>
    boundPort: number
  }>((ready, fail) => {
    const s = serve({ fetch: app.fetch, hostname: host, port }, (info) =>
      ready({ server: s, boundPort: info.port }),
    )
    s.once('error', fail)
  })

  return {
    url: `http://${host}:${boundPort}`,
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()))
      await runtime.dispose()
    },
  }
}

/* c8 ignore start -- 进程级引导,由 test/server.test.ts 通过 startServer 覆盖 */
// 手拼 `file://${argv[1]}` 不行:Windows 要三斜杠,而路径里的非 ASCII 目录
// 在 import.meta.url 里是百分号编码的。pathToFileURL 两件事都替我们做对。
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2))

  if (args['help'] !== undefined || args['config'] === undefined) {
    console.log(USAGE)
    process.exit(args['config'] === undefined ? 2 : 0)
  }

  const config = JSON.parse(readFileSync(args['config']!, 'utf8')) as ServerConfig
  const merged: ServerConfig = {
    ...config,
    ...(args['host'] === undefined ? {} : { host: args['host'] }),
    ...(args['port'] === undefined ? {} : { port: Number(args['port']) }),
  }

  const { url, close } = await startServer(merged)

  console.log(`DSHWAR 网关已启动  ${url}`)
  console.log('  TLS 由反向代理终结 —— 本进程只说明文 HTTP,见 docs/DEPLOYMENT.md')
  console.log(`  ⚠️ auth-static 用的是明文令牌(${merged.authEntries.length} 条),禁止用于生产`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`\n收到 ${signal},正在停止……`)
      void close().then(() => process.exit(0))
    })
  }
}
/* c8 ignore stop */
