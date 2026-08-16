/**
 * 进程隔离的代价常量,以及由它推导容量的算法。
 *
 * ## 为什么是一个模块,而不是几处各写各的数
 *
 * `63 MB` 这个数原本散在五个地方:CI 的性能门禁、`server.ts` 的
 * `maxProcesses` 默认值、README 的规模对照表、`DEPLOYMENT.md` 的容量公式、
 * profiles 的注释。**散着放的必然结果是它们不同步** —— V0.4.7 的 Linux 复测
 * 就一次改了七处,而漏掉任何一处都不会有人发现:内存不在任何断言里。
 *
 * 现在只有这里一个来源。CI 的门禁脚本 `scripts/measure-process-cost.mjs`
 * 也从这里 import,所以「实测值」与「用来推导的值」在结构上不可能分叉。
 *
 * @module @dshwar/supervisor/cost
 */

/**
 * 一个 dsh 运行时子进程的常驻内存,单位 MB。
 *
 * **实测值,不是估算**:Linux(GitHub ubuntu-latest)· Node 22 ·
 * 装配 `GATEWAY_PLUGINS` 全部 11 个插件 · 五次采样中位数。
 * 两次独立 CI 采样为 63 / 62 MB,波动 ±1.6% —— 内存这个量很稳。
 *
 * ⚠️ **这个数只含子进程自己。** 不含网关进程、不含 Node 在网关侧的开销、
 * 更不含操作系统。容量推导里那个 {@link MEMORY_BUDGET_FRACTION} 正是
 * 留给它们的。
 *
 * 改这个值之前先跑 `node scripts/measure-process-cost.mjs` ——
 * 它同时是 CI 门禁的基准,改错会让门禁失去意义。
 */
export const RSS_PER_PROCESS_MB = 63

/**
 * 网关进程**自身**的空载常驻内存,单位 MB。
 *
 * 实测(`scripts/fixtures/gateway-baseline.mjs`):与真实网关同构的装配 ——
 * `assembleRuntime()` 的 11 个插件 + `createGateway()` 的路由、会话簿、
 * Admin / SCIM 接线。不起 HTTP 监听、不建子进程。
 *
 * ## 它为什么必须单独有个数
 *
 * 因为 {@link RSS_PER_PROCESS_MB} 不含它,而 README 的规模对照表是
 * 「N 人 × 63 MB」—— **网关自己不在那张表里**。
 *
 * 这个遗漏的后果很具体:旧的固定默认值 `maxProcesses: 64` 在一台 4 GB 的
 * 机器上,子进程要 64 × 63 = 4032 MB,**算术上塞得下**(4096 MB),
 * 于是看起来没问题;但剩下 64 MB 连网关自己(80 MB)都放不下,更别说操作系统。
 * **算得下、跑不起来** —— 这正是固定值最难被发现的失败形态。
 *
 * **80 MB 是 Linux 实测**(GitHub ubuntu-latest · Node 22),与
 * {@link RSS_PER_PROCESS_MB} 同一台机器、同一次运行 —— 生产在 Linux,
 * 容量推导就该用 Linux 的数。Windows 同日测得 78 MB,差 2 MB。
 *
 * CI 的 `进程隔离代价` job 每次都会打印它,与子进程那两个数同一条通路。
 */
export const GATEWAY_BASELINE_RSS_MB = 80

/**
 * 进程池最多能吃掉整机内存的多大一块。
 *
 * ## 为什么不是 1.0
 *
 * 因为 {@link RSS_PER_PROCESS_MB} **只算子进程**。剩下的 40% 要养活:
 *
 * | 吃内存的 | 量级 |
 * | --- | --- |
 * | 网关进程自身(见 {@link GATEWAY_BASELINE_RSS_MB},实测) | 80 MB |
 * | 操作系统与页缓存 | 数百 MB 起 |
 * | 突发:同一 principal 的并发会话、大文件读写、模型响应缓冲 | 不可预估 |
 *
 * 把这三样算进去,0.6 在小机器上是紧的、在大机器上是宽松的 ——
 * 而 {@link MAX_PROCESSES_CEILING} 负责后一半。
 *
 * ## 为什么不做得更聪明
 *
 * 试过想按「总内存越大、比例越高」做分段。空载的网关已经量到了(80 MB),
 * 但**负载下它怎么涨还没有实测** —— 而分段函数恰恰要靠那条曲线。
 * **没有数据支撑的分段只是把一个诚实的猜测包装成公式。**
 * 等有了网关侧的负载测量再说。
 */
export const MEMORY_BUDGET_FRACTION = 0.6

/**
 * 推导值的上限。
 *
 * 内存不是唯一的约束:每个子进程还占文件描述符、IPC 通道与调度器份额。
 * 一台 256 GB 的机器按公式能算出 2400 个进程,那个数在别的维度上早就不成立了,
 * 而**在这里截断比让部署方在生产里撞上另一个墙要好**。
 *
 * 需要更高的,请显式配 `isolation.maxProcesses` —— 显式配置不受本上限约束,
 * 因为那时是人做的决定,而不是一个默认值在替人做决定。
 */
export const MAX_PROCESSES_CEILING = 64

/** {@link deriveMaxProcesses} 的结果。`basis` 用于启动时打印,让默认值可追溯。 */
export interface DerivedCapacity {
  /** 推导出的进程上限,至少为 1。 */
  readonly value: number
  /** 人类可读的推导依据,含总内存、预算、每进程开销与是否被上限截断。 */
  readonly basis: string
  /** 是否被 {@link MAX_PROCESSES_CEILING} 截断 —— 截断说明内存不是当前瓶颈。 */
  readonly cappedByCeiling: boolean
  /** 是否被下限抬到 1 —— 抬升说明这台机器其实跑不动进程隔离。 */
  readonly raisedToFloor: boolean
}

/**
 * 按机器内存推导 `maxProcesses` 的默认值。
 *
 * ## 为什么不用固定值
 *
 * V0.4.5 起默认写死 `64`。**那个数对任何一台具体的机器都是猜的**:
 * 4 GB 机器上子进程就要 4032 MB,剩下的 64 MB 连网关自己(80 MB)都放不下;
 * 64 GB 机器上又白白闲置四分之三的内存。写死一个数等于假设所有部署方
 * 的机器规格相同,而那个假设从来没成立过。
 *
 * ⚠️ 它在 **8 GB 上恰好合适**(推导值也是 64)—— 这正是它一直看起来没问题
 * 的原因:开发机通常不小。固定值的错不在数值,在于它对所有机器给同一个数。
 *
 * ## 公式
 *
 * ```
 * min(MAX_PROCESSES_CEILING, floor(总内存 × MEMORY_BUDGET_FRACTION / RSS_PER_PROCESS_MB))
 * ```
 *
 * 下限 1:进程池为 0 谁也服务不了,那种「配置成功但一个请求都处理不了」
 * 比启动失败更难排查。返回 1 并在 `basis` 里说明,让人看得见这台机器不够。
 *
 * @param totalMemoryBytes 整机物理内存,通常来自 `os.totalmem()`。
 *   传进来而不是在函数里读,是为了可测 —— 单测要能喂各种规格的机器。
 */
export function deriveMaxProcesses(totalMemoryBytes: number): DerivedCapacity {
  const totalMb = totalMemoryBytes / 1024 / 1024
  const budgetMb = totalMb * MEMORY_BUDGET_FRACTION
  const byMemory = Math.floor(budgetMb / RSS_PER_PROCESS_MB)

  const cappedByCeiling = byMemory > MAX_PROCESSES_CEILING
  const raisedToFloor = byMemory < 1
  const value = Math.max(1, Math.min(MAX_PROCESSES_CEILING, byMemory))

  const head =
    `整机 ${Math.round(totalMb)} MB × ${MEMORY_BUDGET_FRACTION} ÷ ` +
    `${RSS_PER_PROCESS_MB} MB/进程 = ${byMemory}`
  const tail = cappedByCeiling
    ? `,受上限 ${MAX_PROCESSES_CEILING} 截断 → ${value}(内存不是瓶颈,需要更多请显式配置)`
    : raisedToFloor
      ? `,不足 1 个进程 → 抬到 ${value}。⚠️ 这台机器的内存跑不动进程隔离,` +
        `请扩容或改用单用户部署`
      : ` → ${value}`

  return { value, basis: head + tail, cappedByCeiling, raisedToFloor }
}
