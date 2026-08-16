/**
 * 网关**自身**的常驻内存夹具 —— 回答一个容量规划上的口径问题。
 *
 * ## 它存在的理由
 *
 * `RSS_PER_PROCESS_MB`(63 MB)量的是**子进程**:`child-agent.mjs` 装完
 * 11 个插件之后报自己的 RSS。于是 README 那张规模对照表
 * (50 人 ≈ 3.2 GB)算的也只是**子进程的总和**。
 *
 * **网关进程自己不在里面,操作系统更不在。** 一个部署方看到「50 人 3.2 GB」
 * 去配一台 4 GB 的机器,会在网关加 OS 上撞穿 —— 而那正是容量表最该防住的事。
 *
 * 这个夹具量出网关侧的那一块,让 `MEMORY_BUDGET_FRACTION = 0.6` 里
 * 那 40% 的留白**有据可查**,而不是一个看起来稳妥的分数。
 *
 * ## 量的是什么
 *
 * 与真实网关同构的装配:`assembleRuntime()`(同样 11 个插件)+ `createGateway()`
 * (Hono 路由、会话簿、Admin/SCIM 接线)。刻意**不**起 HTTP 监听、
 * 不建 Supervisor 的子进程 —— 前者的开销可以忽略,后者是子进程那一块,
 * 已经被 `RSS_PER_PROCESS_MB` 算过了,再算一次就是重复计数。
 *
 * 由 `measure-process-cost.mjs` fork 起来,协议:
 *   子 → 父:{ type: 'ready', rssBytes }
 *          { type: 'error', message }
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

try {
  const { assembleRuntime } = await import('@dshwar/gateway/runtime')
  const {
    createGateway,
    createIsolatedRuntime,
    GatewaySessionStore,
    InMemoryAdminKeyResolver,
    registerRuntimeRoutes,
  } = await import('@dshwar/gateway')

  const root = mkdtempSync(join(tmpdir(), 'dshwar-gwbase-'))
  const runtime = await assembleRuntime({
    workspaceRoot: root,
    sessionRoot: join(root, 'sessions'),
    authEntries: [{ token: 'baseline', id: 'baseline', tenantId: 'baseline' }],
    defaultProvider: 'none',
    defaultModel: 'none',
    quiet: true,
  })

  const store = new GatewaySessionStore()
  createGateway({
    ctx: runtime.ctx,
    adminKeys: new InMemoryAdminKeyResolver([
      { key: 'k', tenantId: 'baseline', label: 'baseline' },
    ]),
    runtimeRoutes: registerRuntimeRoutes({
      store,
      ...createIsolatedRuntime({ level: 'logical', inProcess: runtime }),
      heartbeatMs: 15_000,
    }),
  })

  // 装配完就量。不跑请求 —— 「常驻」指的是空载基线,负载下的峰值是另一个量,
  // 而把两者混成一个数会让容量规划两头都不对。
  process.send?.({ type: 'ready', rssBytes: process.memoryUsage().rss })
} catch (error) {
  process.send?.({ type: 'error', message: error instanceof Error ? error.message : `${error}` })
  process.exitCode = 1
}
