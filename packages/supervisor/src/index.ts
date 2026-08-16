/**
 * `@dshwar/supervisor` —— 进程隔离的进程池。
 *
 * ## 这个包换来什么
 *
 * 到 V0.4.1 为止,DSHWAR 只有**逻辑隔离**:所有 principal 跑在同一个进程里,
 * 靠 `ctx.isolate()` 划分作用域。README、CLAUDE.md 第七节、`fs-tenant` 的文档
 * 都写死了「逻辑隔离仅适用于互相信任的用户」。
 *
 * ⚠️ **那句话已被 V0.4.6 的实测推翻,而且是往更糟的方向。** 它说的是恶意方
 * 能不能越界;真实情况是逻辑档下 principal 到不了 agent 执行层,多用户的文件
 * 全落进 `anonymous/anonymous/` **互相静默覆盖** —— 根本没有分隔可言。
 *
 * 所以逻辑档只支持单个 principal(V0.4.7 起配多用户身份拒绝启动),
 * **本包是多用户的唯一可选项**,不再是「跨信任边界才需要的加强档」。
 * 一 principal 一进程之后,越界成本才从「一段提示词」升到「一个进程逃逸漏洞」。
 *
 * ## 这个包**不**换来什么
 *
 * - **不是容器。** 进程隔离不防内核提权,不限制 CPU/内存,不隔离网络。
 *   多租户 SaaS 仍需要容器档(部署方的编排系统提供,红线 4)。
 * - **不解决「上游没有 cancel」。** 那句话本身是错的:进程内的
 *   `Agent.cancel(cause)` 早在 V0.2.0 就实测可用。**进程隔离是把一个已经好用的
 *   取消变成需要重新解决的问题**,不是收益(`ARCHITECTURE.md` §2.4)。
 *
 * ## 代价
 *
 * 冷启动 ~115 ms、常驻 ~58 MB/进程(`docs/FEASIBILITY-REPORT-V45.md` §6)。
 * 冷启动里九成花在进程创建与模块加载上,优化装配代码没用 —— 只能压进程复用率,
 * 这正是本包选「一 principal 一进程」而非「一会话一进程」的原因。
 *
 * @module @dshwar/supervisor
 */

export {
  BOOTSTRAP_LEASE,
  forkLauncher,
  trackChild,
  trackedCount,
  type ChildProcessLike,
  type ForkOptions,
  type LaunchSpec,
  type ProcessLauncher,
} from './launcher.ts'

export {
  deriveMaxProcesses,
  GATEWAY_BASELINE_RSS_MB,
  MAX_PROCESSES_CEILING,
  MEMORY_BUDGET_FRACTION,
  RSS_PER_PROCESS_MB,
  type DerivedCapacity,
} from './cost.ts'

export {
  asChildMessage,
  HEALTH_LEASE,
  makeLeaseId,
  type ChildMessage,
  type ParentMessage,
} from './protocol.ts'

export {
  AnonymousNotAllowedError,
  AtCapacityError,
  Supervisor,
  type Lease,
  type SupervisorConfig,
  type SupervisorEvent,
} from './supervisor.ts'
