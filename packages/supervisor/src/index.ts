/**
 * `@dshwar/supervisor` —— 进程隔离的进程池。
 *
 * ## 这个包换来什么
 *
 * 到 V0.4.1 为止,DSHWAR 只有**逻辑隔离**:所有 principal 跑在同一个进程里,
 * 靠 `ctx.isolate()` 划分作用域。README、CLAUDE.md 第七节、`fs-tenant` 的文档
 * 都写死了「逻辑隔离仅适用于互相信任的用户」—— 那句话是对的,因为 Harness 的
 * agent 能执行 shell、读写文件系统,提示词注入、恶意 MCP、污染 skill 都可越界。
 *
 * 一 principal 一进程之后,越界成本从「一段提示词」升到「一个进程逃逸漏洞」。
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
