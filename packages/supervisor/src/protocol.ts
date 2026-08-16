/**
 * 父子进程之间的消息信封。
 *
 * ## 为什么消息要打 `leaseId`
 *
 * 一 principal 一进程,而**同一 principal 的多个并发会话共用这一个进程**
 * (R1;一会话一进程是数量级的差别,见 `docs/FEASIBILITY-REPORT-V45.md` §6:
 * 58 MB/进程)。共用就意味着一条 IPC 通道上跑着多路会话 —— 不打标签,
 * 父进程收到一个 `assistant/chunk` 无从知道它属于哪一路。
 *
 * 取消尤其依赖这个标签:取消**一路会话**不能波及同进程的其他会话,
 * 否则「隔离」反而制造了新的越界。
 *
 * @module @dshwar/supervisor/protocol
 */

/** 父 → 子。`leaseId` 标明这条消息属于哪一路会话。 */
export interface ParentMessage {
  readonly leaseId: string
  /** `ping` 由健康检查发出,不属于任何会话 —— 但仍走同一通道,免得两套协议。 */
  readonly kind: 'work' | 'cancel' | 'ping'
  readonly payload?: unknown
}

/** 子 → 父。 */
export interface ChildMessage {
  readonly leaseId: string
  readonly kind: 'event' | 'pong' | 'error'
  readonly payload?: unknown
}

/** 健康检查专用的 lease id。不会与真实 lease 撞号 —— 真实 id 带前缀 `L`。 */
export const HEALTH_LEASE = '#health'

/** 生成 lease id。进程内单调即可,不跨进程比较。 */
export function makeLeaseId(seq: number): string {
  return `L${seq}`
}

/** 收窄未知 IPC 消息 —— 子进程可能被换成任何实现,不能假定它守规矩。 */
export function asChildMessage(raw: unknown): ChildMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const m = raw as Record<string, unknown>
  if (typeof m['leaseId'] !== 'string') return undefined
  if (m['kind'] !== 'event' && m['kind'] !== 'pong' && m['kind'] !== 'error') return undefined
  return { leaseId: m['leaseId'], kind: m['kind'], payload: m['payload'] }
}
