/**
 * `@dshwar/attachment-tenant` —— 附件的租户隔离存储(V0.5.5 Session 4)。
 *
 * ## 附件与产物是两回事
 *
 * | | 谁写的 | 生命周期 | 存哪 |
 * | --- | --- | --- | --- |
 * | **产物** | agent | 随工作区 | 工作区目录(就是文件,无独立模型) |
 * | **附件** | 用户上传 | 可随会话回收 | **本包** |
 *
 * 合并它们看起来能省一套代码,但两者的**清理策略相反**:
 * 产物是成果,删工作区才该删;附件是输入,会话结束就该回收。
 * 放一起之后,任何一个清理动作都要先分辨「这个文件是哪一类」——
 * 而那个信息在文件系统里不存在。
 *
 * ## 路径与工作区同款钉死
 *
 * `{root}/{tenantId}/{userId}/{attachmentId}`。
 * **复用 `@dshwar/fs-tenant` 的 `toPathSegment` 与 `isWithin`**,
 * 不自己写一套编码 —— 两套编码规则迟早在某个边界字符上分叉,
 * 而分叉的那一刻就是跨租户。
 *
 * ## 为什么只做 fs 后端
 *
 * `attachment-object`(S3 兼容:MinIO / OSS / COS)**本版本只定契约不实现** ——
 * 它需要一个真实的对象存储才能验证,而那是外部资源。
 * 契约先定的理由与 V0.2.0 的 Admin API 一样:**换不掉的那一层要早定**。
 *
 * @module @dshwar/attachment-tenant
 */
import { isWithin, PathEscapeError, toPathSegment } from '@dshwar/fs-tenant'
import type { Principal } from '@dshwar/principal'
import { isAbsolute, resolve as resolvePath } from 'node:path'

/** 一条附件的元数据。字段与契约的 `Attachment` 对齐。 */
export interface Attachment {
  readonly id: string
  readonly filename: string
  readonly size: number
  readonly contentType: string
  readonly subjectId: string
  readonly tenantId: string
  /** 挂在哪个会话上。`null` = 租户级,不随会话回收。 */
  readonly sessionId: string | null
  readonly createdAt: string
}

/**
 * 算出一条附件在磁盘上的位置。
 *
 * ⚠️ **三段全部经 `toPathSegment` 校验+编码**,与 `tenantWorkspaceRoot` 同款。
 * 这不是防御性编程的冗余 —— `attachmentId` 若来自用户输入,
 * 一个 `../..` 就能写到别的租户目录下。
 *
 * ⚠️ 最后那道 `isWithin` 断言**不依赖编码正确**:它直接检查结果。
 * 编码哪天被改坏,这里先炸,而不是静默越权。
 */
export function attachmentPath(root: string, principal: Principal, attachmentId: string): string {
  if (!isAbsolute(root)) {
    throw new PathEscapeError(`附件根必须是绝对路径(收到 ${JSON.stringify(root)})`)
  }

  const tenant = toPathSegment(principal.tenantId, 'tenantId')
  const user = toPathSegment(principal.id, 'userId')
  // 复用 workspaceId 那一档的规则 —— 附件 id 与工作区 id 在路径里的地位相同。
  const attachment = toPathSegment(attachmentId, 'workspaceId')

  const pinned = resolvePath(root, tenant, user, attachment)

  if (!isWithin(resolvePath(root), pinned)) {
    throw new PathEscapeError(
      `附件路径拼接后逃出根(root ${JSON.stringify(root)},结果 ${JSON.stringify(pinned)})`,
    )
  }
  return pinned
}

/** 附件存储。**契约先定,后端分期** —— 本版本只有 fs 实现。 */
export interface AttachmentStore {
  put(
    principal: Principal,
    input: {
      filename: string
      contentType: string
      sessionId?: string | null
      body: Uint8Array
    },
  ): Promise<Attachment>
  get(principal: Principal, id: string): Promise<Attachment | undefined>
  read(principal: Principal, id: string): Promise<Uint8Array | undefined>
  list(principal: Principal, filter?: { sessionId?: string | null }): Promise<Attachment[]>
  remove(principal: Principal, id: string): Promise<boolean>
  /**
   * 回收挂在某个会话上的全部附件。
   *
   * ⚠️ **`sessionId: null` 的不回收** —— 那是租户级附件,
   * 它们的生命周期与会话无关。把它们一起删掉是一次静默的数据丢失。
   */
  reclaimSession(principal: Principal, sessionId: string): Promise<number>
}

function newAttachmentId(): string {
  // 首字符固定为字母,满足 fs-tenant 白名单 —— 否则目录名会被编码成
  // 不可读的哈希,运维在服务器上 `ls` 就看不懂了。
  return `a${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/**
 * 文件系统后端。
 *
 * ⚠️ 元数据存在内存里,**内容存在磁盘上** —— 这是刻意的分工:
 * 内容大且不可放内存,元数据小且需要索引。生产要把元数据换成持久化后端,
 * 而那时磁盘上的内容不用动。
 */
export class FsAttachmentStore implements AttachmentStore {
  private readonly meta = new Map<string, Attachment>()

  constructor(
    private readonly root: string,
    private readonly fs: {
      mkdir(path: string, options: { recursive: true }): Promise<unknown>
      writeFile(path: string, data: Uint8Array): Promise<void>
      readFile(path: string): Promise<Uint8Array>
      rm(path: string, options: { force: true }): Promise<void>
    },
  ) {}

  async put(
    principal: Principal,
    input: { filename: string; contentType: string; sessionId?: string | null; body: Uint8Array },
  ): Promise<Attachment> {
    const id = newAttachmentId()
    const path = attachmentPath(this.root, principal, id)
    await this.fs.mkdir(path.slice(0, path.lastIndexOf(path.includes('\\') ? '\\' : '/')), {
      recursive: true,
    })
    await this.fs.writeFile(path, input.body)

    const attachment: Attachment = {
      id,
      filename: input.filename,
      size: input.body.byteLength,
      contentType: input.contentType,
      subjectId: principal.id,
      tenantId: principal.tenantId,
      sessionId: input.sessionId ?? null,
      createdAt: new Date().toISOString(),
    }
    this.meta.set(id, attachment)
    return attachment
  }

  async get(principal: Principal, id: string): Promise<Attachment | undefined> {
    const found = this.meta.get(id)
    // 归属判定做进 get —— 与 WorkspaceStore / JobStore 同一条纪律。
    // 「不存在」与「不属于你」合并成同一个 undefined,调用方一律 404。
    if (found === undefined) return undefined
    if (found.subjectId !== principal.id || found.tenantId !== principal.tenantId) return undefined
    return found
  }

  async read(principal: Principal, id: string): Promise<Uint8Array | undefined> {
    // ★ 先查归属再碰磁盘。反过来的话,一个不属于你的 id 会先触发一次
    //   真实的文件读取 —— 读取耗时的差异本身就是探测 id 是否存在的侧信道。
    const found = await this.get(principal, id)
    if (found === undefined) return undefined
    return this.fs.readFile(attachmentPath(this.root, principal, id))
  }

  async list(principal: Principal, filter?: { sessionId?: string | null }): Promise<Attachment[]> {
    return [...this.meta.values()]
      .filter((a) => a.subjectId === principal.id && a.tenantId === principal.tenantId)
      .filter((a) => filter?.sessionId === undefined || a.sessionId === filter.sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async remove(principal: Principal, id: string): Promise<boolean> {
    const found = await this.get(principal, id)
    if (found === undefined) return false
    await this.fs.rm(attachmentPath(this.root, principal, id), { force: true })
    this.meta.delete(id)
    return true
  }

  async reclaimSession(principal: Principal, sessionId: string): Promise<number> {
    // ⚠️ 显式比对 sessionId,**不**用 `?? null` 之类的宽松匹配 ——
    // 那会把租户级附件(sessionId === null)一起卷进来删掉。
    const doomed = (await this.list(principal)).filter((a) => a.sessionId === sessionId)
    for (const attachment of doomed) await this.remove(principal, attachment.id)
    return doomed.length
  }
}
