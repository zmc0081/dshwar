/**
 * `@dshwar/fs-tenant` —— 工作区根按租户钉死。
 *
 * ⚠️ **`credentials` 解决的是「用谁的钱」,`fs` 解决的才是「能看谁的数据」。**
 * 本包是整个版本安全性的重心。
 *
 * ## 它不是什么
 *
 * **不是沙箱。** 本包只做路径钉死,策略结果喂给上游 `sandbox-policy` / `fs-sandbox`,
 * 不另起炉灶(CLAUDE.md 第七节)。
 *
 * **不是强边界。** Harness agent 能执行 shell —— 路径钉死抬高了越界成本,
 * 但一个能跑 `bash` 的 agent 不受本包约束。
 *
 * ⚠️ **逻辑隔离只支持单个 principal**(V0.4.7)——不是「仅适用于互相信任的用户」。
 * 后者说的是恶意方能否越界;而逻辑档下多用户时 **本包拿不到区分用的 principal**,
 * 所有人的工作区都解析到 `anonymous/anonymous/`,同名文件静默互相覆盖。
 * 多用户必须用进程隔离,跨信任边界还要加容器。
 *
 * @module @dshwar/fs-tenant
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  FileSystem,
  type FsDirEntry,
  type FsEditOutcome,
  type FsEditRequest,
  type FsInfo,
  type FsObservation,
  type FsPathInfo,
  type FsTarget,
  type FsVersion,
  type FsWriteIntent,
  type FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { Principal } from '@dshwar/principal'
import {
  DEFAULT_WORKSPACE_ID,
  isWithin,
  PathEscapeError,
  pinPath,
  tenantWorkspaceRoot,
} from './path.ts'

export {
  DEFAULT_WORKSPACE_ID,
  encodeSegment,
  isWithin,
  PathEscapeError,
  pinPath,
  tenantUserRoot,
  tenantWorkspaceRoot,
  toPathSegment,
} from './path.ts'
export type { PathField } from './path.ts'

/** {@link TenantFileSystem} 的配置。 */
export interface TenantFileSystemConfig {
  /**
   * 内层文件系统,通常是上游 `@deepseek-ai/dsh-fs-local`。
   *
   * 本包**包装**它而不是替代它 —— 真实的读写、编码、二进制拒绝、原子写
   * 全部由上游负责。我们只在路径进入的那一刻把它钉进租户目录,
   * 并在解析出来之后复查一次。
   */
  readonly inner: FileSystem
  /**
   * 全局工作区根,绝对路径。
   * 每个主体的实际根是 `{root}/{tenantId}/{userId}/{workspaceId}`(V0.4.1 起四段)。
   */
  readonly root: string
  /**
   * 当前操作属于哪个工作区。**每次操作现场求值,不缓存。**
   *
   * 省略时一律落到 {@link DEFAULT_WORKSPACE_ID},这让改造前的调用方零改动仍能工作
   * (R2)。缺省只发生在**取值**阶段 —— 返回值仍走与任何 workspaceId 完全相同的
   * 校验路径,不存在「缺省值走旁路」。
   *
   * ⚠️ **工作区来源的决定权不在本包。** 它是 `/v1` 契约的问题(查询参数还是路径段),
   * 由 V0.4.1 Session 1 裁决;这里只留注入点,免得本包替网关做决定。
   */
  readonly workspaceOf?: () => string | undefined
}

/**
 * 按租户钉死工作区的文件系统,注册为 `ctx.fs`。
 *
 * ## 两道防线,缺一不可
 *
 * 1. **字面层**({@link pinPath}):拦 `../`、绝对路径、UNC、盘符、空字节。
 *    快、错误可读、覆盖绝大多数尝试 —— 但挡不住符号链接。
 * 2. **realpath 层**:委托内层 `resolve()` 解析出稳定身份(上游 `fs-local`
 *    会 realpath),再用 {@link isWithin} 复查它是否仍在租户根内。
 *    这道兜住符号链接 —— 但对不存在的路径无能为力(realpath 会失败)。
 *
 * 两道的失效场景正好互补,所以都要有。
 *
 * ⚠️ 本类**刻意不使用** ECMAScript `#private` 字段:cordis 通过 Proxy 包装服务
 * 以重绑 `this.ctx`,`#private` 在 wrapper 上必抛 `TypeError`。
 * 见 `docs/FEASIBILITY-REPORT.md` §4.1。
 */
export class TenantFileSystem extends FileSystem {
  private readonly inner: FileSystem
  private readonly root: string
  private readonly workspaceOf: (() => string | undefined) | undefined

  constructor(ctx: Context, config: TenantFileSystemConfig) {
    super(ctx)
    this.inner = config.inner
    this.root = config.root
    this.workspaceOf = config.workspaceOf
  }

  /**
   * 内层后端默认强制的沙箱模式,原样透传。
   *
   * 本包不改变沙箱语义 —— 谎报会让工具层向模型广告一个不存在的能力。
   */
  override get sandboxMode(): FileSystem['sandboxMode'] {
    return this.inner.sandboxMode
  }

  /**
   * 当前作用域主体的工作区根。
   *
   * 每次操作现场计算,不缓存 —— 同一个运行时里相邻两次操作可能属于不同的人。
   */
  private currentWorkspaceRoot(): string {
    const principal: Principal = this.ctx.principal.current()
    // 工作区与 principal 同样现场求值:同一个运行时里相邻两次操作
    // 可能属于不同的人,也可能属于同一个人的不同工作区。
    const workspaceId = this.workspaceOf?.() ?? DEFAULT_WORKSPACE_ID
    return tenantWorkspaceRoot(this.root, principal, workspaceId)
  }

  /**
   * 复查一个已解析的 target 仍落在当前主体的工作区根内。
   *
   * 这是符号链接的兜底:字面层可能完全合法,而链接指向根外。
   */
  private assertTargetContained(target: FsTarget, workspaceRoot: string, what: string): void {
    const actual = this.inner.processPath(target)
    if (!isWithin(workspaceRoot, actual)) {
      throw new PathEscapeError(
        `${what} 解析后落在工作区根之外(根 ${JSON.stringify(workspaceRoot)},` +
          `实际 ${JSON.stringify(actual)})—— 符号链接逃逸已拦截`,
      )
    }
  }

  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const workspaceRoot = this.currentWorkspaceRoot()

    // cwd 也必须钉死。允许调用方自带 cwd 而不校验,等于把整道防线拱手让人。
    const cwd = opts?.cwd === undefined ? workspaceRoot : pinPath(workspaceRoot, opts.cwd)

    const pinned = pinPath(workspaceRoot, path)
    const target = await this.inner.resolve(pinned, {
      cwd,
      ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
    })

    // realpath 之后复查 —— symlink 在这里现形
    this.assertTargetContained(target, workspaceRoot, `路径 ${JSON.stringify(path)}`)
    return target
  }

  async lstat(
    path: string,
    opts?: { cwd?: string },
    signal?: AbortSignal,
  ): Promise<FsPathInfo | undefined> {
    const workspaceRoot = this.currentWorkspaceRoot()
    const cwd = opts?.cwd === undefined ? workspaceRoot : pinPath(workspaceRoot, opts.cwd)
    const pinned = pinPath(workspaceRoot, path)

    // lstat 刻意不跟随最后一跳的符号链接,所以这里**不能**做 realpath 复查 ——
    // 那会把 lstat 变成 stat,消费方就再也无法在跟随之前拒绝一个链接。
    // 字面层已经保证 pinned 在根内,这正是 lstat 该有的语义。
    return this.inner.lstat(pinned, { cwd }, signal)
  }

  processPath(target: FsTarget): string {
    return this.inner.processPath(target)
  }

  fileUrl(target: FsTarget): string {
    return this.inner.fileUrl(target)
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    return this.inner.contains(parent, child)
  }

  async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    this.assertTargetContained(target, this.currentWorkspaceRoot(), 'stat 的 target')
    return this.inner.stat(target, signal)
  }

  async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    this.assertTargetContained(target, this.currentWorkspaceRoot(), 'readText 的 target')
    return this.inner.readText(target, signal)
  }

  async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    this.assertTargetContained(target, this.currentWorkspaceRoot(), 'streamText 的 target')
    return this.inner.streamText(target, signal)
  }

  async readBytes(
    target: FsTarget,
    signal: AbortSignal | undefined,
    maxBytes: number,
  ): Promise<Uint8Array> {
    this.assertTargetContained(target, this.currentWorkspaceRoot(), 'readBytes 的 target')
    return this.inner.readBytes(target, signal, maxBytes)
  }

  async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    this.assertTargetContained(target, this.currentWorkspaceRoot(), 'listDir 的 target')
    return this.inner.listDir(target, signal)
  }

  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: Parameters<FileSystem['writeText']>[4],
  ): Promise<FsWriteOutcome> {
    // 写路径的复查比读路径更要紧:读错文件是泄漏,写错文件是破坏,且不可逆
    this.assertTargetContained(target, this.currentWorkspaceRoot(), 'writeText 的 target')
    return this.inner.writeText(target, content, expected, signal, sandboxPolicy)
  }

  async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: Parameters<FileSystem['editText']>[4],
  ): Promise<FsEditOutcome> {
    this.assertTargetContained(target, this.currentWorkspaceRoot(), 'editText 的 target')
    return this.inner.editText(target, edit, expected, signal, sandboxPolicy)
  }
}

export type { FsObservation }
export default TenantFileSystem
