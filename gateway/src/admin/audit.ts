/**
 * Admin 调用的审计埋点。
 *
 * CLAUDE.md 第七节:**所有 Admin 与 SCIM 调用进入审计,记录调用者 / 目标 /
 * 变更前后**。`@dshwar/audit` 在 V0.3.0,本版本先把接口与调用点固定下来 ——
 * 埋点补在事后是最容易漏的:漏掉的那个端点通常正是出事的那个。
 *
 * @module @dshwar/gateway/admin/audit
 */

/** 一条审计记录。 */
export interface AuditRecord {
  readonly at: string
  /** 调用者。Admin Key 的标签,不是 key 本身。 */
  readonly actor: string
  readonly tenantId: string
  readonly action: string
  readonly target: string
  /**
   * 变更前后。
   *
   * ⚠️ **凭据类操作只记录 `describe` 层面的事实,绝不记录值。**
   * 审计日志的保留期通常比凭据的轮换周期长得多 —— 把值写进去等于
   * 造了一个长期留存的密钥副本。
   */
  readonly before?: unknown
  readonly after?: unknown
  readonly requestId: string
}

/** 审计接收器。V0.3.0 换成 `@dshwar/audit` 的实现。 */
export interface AuditSink {
  record(entry: AuditRecord): void
}

/**
 * 落日志的实现。
 *
 * 不是最终形态,但**比不埋点强得多**:出事时至少有一条时间线,
 * 而不是从「大概几点、大概谁」开始。
 */
export class ConsoleAuditSink implements AuditSink {
  record(entry: AuditRecord): void {
    // 结构化输出,便于日志系统解析
    console.info(JSON.stringify({ kind: 'dshwar.audit', ...entry }))
  }
}

/** 丢弃一切。仅测试用。 */
export class NullAuditSink implements AuditSink {
  readonly entries: AuditRecord[] = []
  record(entry: AuditRecord): void {
    this.entries.push(entry)
  }
}
