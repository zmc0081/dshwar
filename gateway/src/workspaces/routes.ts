/**
 * 工作区与产物的路由(V0.5.5)。
 *
 * ## 跨主体一律 404,不是 403
 *
 * 这条贯穿全部端点。403 会泄漏「这个 id 存在」—— 而工作区 id 的存在性
 * 本身就是信息:它能被用来探测「某个租户有没有叫 X 的项目」。
 * `WorkspaceStore.get` 把「不存在」与「不属于你」合并成同一个 `undefined`,
 * 就是为了让这条在调用点上**没法写错**。
 *
 * ## 产物直接读文件系统
 *
 * 不建产物表。判据是「谁是唯一事实」—— agent 随时在写文件,
 * 表与文件必然漂,且方向固定:**表说有、文件已经没了**。
 *
 * @module @dshwar/gateway/workspaces/routes
 */
import { tenantWorkspaceRoot } from '@dshwar/fs-tenant'
import type { Hono } from 'hono'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { ApiError, notFound } from '../errors.ts'
import type { GatewayEnv } from '../middleware.ts'
import type { WorkspaceStore } from './store.ts'

export interface WorkspaceRouteOptions {
  readonly store: WorkspaceStore
  /**
   * 工作区文件的全局根。产物列表从这里往下解析。
   *
   * ⚠️ 必须与运行时装配 `fs-tenant` 时用的是**同一个根** ——
   * 两个根的话,agent 写进 A、控制台从 B 列,列表永远是空的而且不报错。
   */
  readonly workspaceRoot: string
  /** 单次列目录的上限。防一个几万文件的工作区把响应撑爆。 */
  readonly maxEntries?: number
}

/** 一条产物记录。与契约的 `Deliverable` 对齐。 */
interface DeliverableRow {
  readonly path: string
  readonly size: number
  readonly kind: 'file' | 'directory'
  readonly modifiedAt: string
}

/**
 * 递归列出工作区里的文件。
 *
 * ⚠️ **不跟随符号链接。** `readdir` 的 `withFileTypes` 给的是 lstat 语义,
 * 所以链接本身被当成条目而不是被展开 —— 那正是我们要的:
 * 一个指向 `/etc` 的链接不该让整个系统出现在产物列表里。
 */
async function listFiles(root: string, limit: number): Promise<DeliverableRow[]> {
  const rows: DeliverableRow[] = []

  const walk = async (dir: string): Promise<void> => {
    if (rows.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // 目录不存在是正常的:工作区刚建、还没写过任何文件。
      // 这不是错误 —— 返回空列表,而不是 500。
      return
    }
    for (const entry of entries) {
      if (rows.length >= limit) return
      const full = join(dir, entry.name)
      const rel = relative(root, full).split(sep).join('/')

      if (entry.isDirectory()) {
        rows.push({ path: rel, size: 0, kind: 'directory', modifiedAt: await mtimeOf(full) })
        await walk(full)
      } else if (entry.isFile()) {
        const info = await stat(full).catch(() => undefined)
        rows.push({
          path: rel,
          size: info?.size ?? 0,
          kind: 'file',
          modifiedAt: info?.mtime.toISOString() ?? new Date(0).toISOString(),
        })
      }
      // 符号链接、设备、管道等一概跳过 —— 它们不是产物。
    }
  }

  await walk(root)
  return rows
}

async function mtimeOf(path: string): Promise<string> {
  const info = await stat(path).catch(() => undefined)
  return info?.mtime.toISOString() ?? new Date(0).toISOString()
}

/** 挂载工作区与产物端点。 */
export function registerWorkspaceRoutes(options: WorkspaceRouteOptions) {
  const limit = options.maxEntries ?? 1000

  return (app: Hono<GatewayEnv>): void => {
    app.get('/v1/workspaces', async (c) => {
      const principal = c.get('principal')!
      const requestId = c.get('requestId')
      const data = await options.store.list(principal)
      // 分页留位:当前一次返回全部。工作区是「项目」粒度,
      // 一个人有几百个项目本身就是产品问题,不是分页问题。
      return c.json({ data, nextCursor: null, requestId })
    })

    app.post('/v1/workspaces', async (c) => {
      const principal = c.get('principal')!
      const requestId = c.get('requestId')

      const body = (await c.req.json().catch(() => ({}))) as { name?: unknown }
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '' || name.length > 200) {
        throw new ApiError('invalid_request', 'name 必须是 1–200 字符的字符串')
      }

      const workspace = await options.store.create(principal, name)
      return c.json({ workspace, requestId }, 201)
    })

    app.get('/v1/workspaces/:id', async (c) => {
      const principal = c.get('principal')!
      const requestId = c.get('requestId')
      const workspace = await options.store.get(principal, c.req.param('id'))
      if (workspace === undefined) throw notFound()
      return c.json({ workspace, requestId })
    })

    app.delete('/v1/workspaces/:id', async (c) => {
      const principal = c.get('principal')!
      const removed = await options.store.remove(principal, c.req.param('id'))
      if (!removed) throw notFound()
      // ⚠️ **只删元数据,不删文件。**
      //
      // 删目录是不可逆的,而「删错工作区」是个很容易犯的错。留着文件意味着
      // 运维还能从磁盘上捞回来 —— 而磁盘空间是可以事后回收的,数据不是。
      // 真正的文件清理该是一个显式的、带确认的运维动作,不是一次 DELETE 的副作用。
      return c.body(null, 204)
    })

    app.get('/v1/workspaces/:id/deliverables', async (c) => {
      const principal = c.get('principal')!
      const requestId = c.get('requestId')
      const id = c.req.param('id')

      // ★ 先查归属再碰文件系统。反过来的话,一个不属于你的 id 会先触发
      //   一次真实的目录读取 —— 而读取耗时的差异本身就是一个侧信道:
      //   「存在的工作区」比「不存在的」慢,足以探测出 id 是否存在。
      const workspace = await options.store.get(principal, id)
      if (workspace === undefined) throw notFound()

      // 路径由 fs-tenant 钉死:`{root}/{tenantId}/{userId}/{workspaceId}`。
      // 这里**不自己拼路径** —— 拼错一段就是跨租户。
      const root = tenantWorkspaceRoot(options.workspaceRoot, principal, workspace.id)
      const data = await listFiles(root, limit)
      return c.json({ data, nextCursor: null, requestId })
    })
  }
}
