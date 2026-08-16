/**
 * 工作区簿(V0.5.5)。
 *
 * ## 为什么工作区需要一张表,而产物不需要
 *
 * 这两个决定看起来矛盾,其实判据是同一条:**谁是唯一事实**。
 *
 * | | 唯一事实在哪 | 所以 |
 * | --- | --- | --- |
 * | **产物** | 文件系统 —— agent 随时在写 | 直接读目录,**不建表** |
 * | **工作区** | 没有别的地方 —— `name` 推导不出来 | 建表 |
 *
 * 给产物建表的话,「表说有、文件已经没了」是必然发生的漂移方向;
 * 而工作区的 `name` 不在文件系统里,不建表就只能拿 id 当名字显示。
 *
 * ⚠️ **表里存的是元数据,不是内容。** 工作区「存在」的判据仍然以表为准 ——
 * 目录可能因为还没写过任何文件而不存在,那不代表工作区没建。
 *
 * @module @dshwar/gateway/workspaces/store
 */
import type { Principal } from '@dshwar/principal'

/** 一个工作区。字段与契约的 `Workspace` 对齐。 */
export interface Workspace {
  readonly id: string
  readonly name: string
  /** 归属主体。**跨主体访问一律 404**,不是 403。 */
  readonly subjectId: string
  readonly tenantId: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface WorkspaceStore {
  create(principal: Principal, name: string): Promise<Workspace>
  /**
   * 按 id 取。
   *
   * @returns 该主体拥有的工作区;不存在**或不属于该主体**时 `undefined` ——
   *   两者刻意不可区分,调用方据此一律返回 404 而非 403。
   *   403 会泄漏「这个 id 存在」,而工作区 id 的存在性本身就是信息:
   *   它能被用来探测「某个租户有没有叫 X 的项目」。
   */
  get(principal: Principal, id: string): Promise<Workspace | undefined>
  list(principal: Principal): Promise<Workspace[]>
  /** @returns 删掉了返回 true;不存在或不属于该主体返回 false(调用方转 404)。 */
  remove(principal: Principal, id: string): Promise<boolean>
}

/**
 * 生成一个工作区 id。
 *
 * ## 为什么服务端生成,不接受客户端指定
 *
 * 因为 **id 同时是文件路径的一段**(`{root}/{tenant}/{user}/{id}`),
 * 而 `fs-tenant` 的白名单要求首字符是 `[A-Za-z0-9]` —— 不满足的会被
 * SHA-256 编码成 `_h_69dddf…` 这样的目录名。运维在服务器上 `ls`
 * 看到一堆哈希,排障时那个可读性是值钱的。
 *
 * 让客户端指定意味着要在入口处校验、拒绝、给错误信息 —— 三件事都可能
 * 被下一个入口忘掉。**服务端生成则是构造上安全的**:不存在「忘了校验」这回事。
 *
 * ⚠️ 代价:用户不能自己选一个好记的 id。这是刻意的取舍 ——
 * `name` 是给人看的,`id` 是给机器和文件系统用的,两者本来就不该是一个东西。
 */
function newWorkspaceId(): string {
  // 首字符固定为字母,满足 fs-tenant 白名单。
  return `w${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/** 内存实现。生产应换成持久化后端 —— 工作区元数据丢了等于项目列表全没了。 */
export class InMemoryWorkspaceStore implements WorkspaceStore {
  private readonly items = new Map<string, Workspace>()

  async create(principal: Principal, name: string): Promise<Workspace> {
    const now = new Date().toISOString()
    const workspace: Workspace = {
      id: newWorkspaceId(),
      name,
      subjectId: principal.id,
      tenantId: principal.tenantId,
      createdAt: now,
      updatedAt: now,
    }
    this.items.set(workspace.id, workspace)
    return workspace
  }

  async get(principal: Principal, id: string): Promise<Workspace | undefined> {
    const found = this.items.get(id)
    // ★ 归属判定做成**取的时候就判**,而不是「取出来再让调用方判」——
    //   后者可以被忘记,而忘记的后果是跨主体读到别人的工作区。
    //   这与 GatewaySessionStore.get 的判断是同一条纪律。
    if (found === undefined) return undefined
    if (found.subjectId !== principal.id || found.tenantId !== principal.tenantId) return undefined
    return found
  }

  async list(principal: Principal): Promise<Workspace[]> {
    return [...this.items.values()]
      .filter((w) => w.subjectId === principal.id && w.tenantId === principal.tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async remove(principal: Principal, id: string): Promise<boolean> {
    // 走 get 而不是直接 delete —— 归属判定只写一遍。
    const found = await this.get(principal, id)
    if (found === undefined) return false
    this.items.delete(id)
    return true
  }
}
