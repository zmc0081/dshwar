/**
 * Admin API 的端点实现 —— `/v1/admin/*`。
 *
 * **契约完整,实现分期。** 本版本只实现 `credentials`(有 `credentials-multiuser`
 * 可依托),其余按契约返回 501。
 *
 * @module @dshwar/gateway/admin/routes
 */
import { PaginationQuery, ROUTES } from '@dshwar/api-contract'
import type { Principal } from '@dshwar/principal'
import { runWithPrincipal } from '@dshwar/principal'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
// 把上游对 cordis `Context` 的模块增强(`ctx.credentials`)带进来。
// 空的 `import type {}` 完全擦除,不产生运行时依赖。
import type {} from '@deepseek-ai/dsh-credentials'
import type { Context as HonoContext, Hono } from 'hono'
import { ApiError, notImplemented } from '../errors.ts'
import { assertTenant, type GatewayEnv } from '../middleware.ts'
import type { AuditSink } from './audit.ts'

/**
 * 主体查找 —— 网关据此判断某个 subjectId 属于哪个租户。
 *
 * Subject Mirror 在 V0.3.0。本版本由部署方注入一个最小实现;
 * 没有它,跨租户校验就无从谈起(不知道目标属于谁,怎么判断越权)。
 */
export interface SubjectLookup {
  /** @returns 该主体;不存在时 `undefined` */
  find(subjectId: string): Promise<Principal | undefined>
}

export interface AdminRouteOptions {
  /** 根上下文,用于在目标主体的作用域内调 `credentials.describe()`。 */
  readonly ctx: CordisContext
  readonly subjects: SubjectLookup
  readonly audit: AuditSink
  /**
   * 要 describe 哪些凭据引用。
   *
   * 上游 `credentials` 没有「列出全部 ref」的能力(那会需要枚举来源层),
   * 所以由部署方声明关心哪些。这也符合契约:`describe` 是按 ref 查询的。
   */
  readonly credentialRefs: readonly string[]
}

/** 注册 Admin 端点。 */
export function registerAdminRoutes(options: AdminRouteOptions) {
  return (app: Hono<GatewayEnv>): void => {
    // ---- 凭据配置状态:本版本唯一实现的 Admin 端点 ----
    app.get('/v1/admin/subjects/:id/credentials', async (c) => {
      const admin = c.get('admin')!
      const requestId = c.get('requestId')
      const subjectId = c.req.param('id')

      const parsed = PaginationQuery.safeParse(c.req.query())
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid query')
      }

      const subject = await options.subjects.find(subjectId)
      // 主体不存在 → 404。存在但不在本 Admin Key 的租户 → 403。
      // 与运行时端点的取舍不同:调用方是运维,「有这么个租户但你无权」
      // 比「查无此物」更有助于排查配置错误,且运维不是攻击面的主要来源。
      if (subject === undefined) throw new ApiError('not_found', 'subject not found')
      assertTenant(admin, subject.tenantId)

      // 在**目标主体的作用域**内调用 —— credentials 是 per-principal 的,
      // 不派生作用域就会读到匿名(fail closed,永远是 unconfigured)
      const descriptors = await runWithPrincipal(options.ctx, subject, async (scoped) => {
        const out = []
        for (const ref of options.credentialRefs) {
          const info = await scoped.credentials.describe(ref as never)
          out.push({
            ref,
            // ⚠️ 只取这三个字段。上游 CredentialInfo 本来也只有这三个,
            // 但显式列出来意味着上游哪天多返回一个字段时,不会被无意间透传。
            configured: info.configured,
            source: info.source ?? null,
            writable: info.writable,
          })
        }
        return out
      })

      options.audit.record({
        at: new Date().toISOString(),
        actor: admin.label,
        tenantId: admin.tenantId,
        action: 'admin.credentials.describe',
        target: subjectId,
        // 只记录 describe 层面的事实。绝不记录值 ——
        // 审计日志的保留期比凭据轮换周期长得多。
        after: descriptors.map((d) => ({ ref: d.ref, configured: d.configured })),
        requestId,
      })

      const cursor = parsed.data.cursor
      const start = cursor === undefined ? 0 : descriptors.findIndex((d) => d.ref === cursor) + 1
      const page = descriptors.slice(start, start + parsed.data.limit)
      const nextCursor =
        start + parsed.data.limit < descriptors.length ? (page.at(-1)?.ref ?? null) : null

      return c.json({ data: page, nextCursor, requestId })
    })

    // ---- planned 端点:从契约里读,不手写清单 ----
    // 手写会漂移:契约加了端点而这里忘了,第三方就会撞上 404 而不是 501。
    for (const route of ROUTES) {
      if (route.status !== 'planned') continue

      const honoPath = route.path.replace(/\{(\w+)\}/g, ':$1')
      const version = route.plannedVersion ?? 'a future version'

      const handler = (c: HonoContext<GatewayEnv>): never => {
        options.audit.record({
          at: new Date().toISOString(),
          actor: c.get('admin')?.label ?? 'unknown',
          tenantId: c.get('admin')?.tenantId ?? 'unknown',
          action: `admin.${route.operationId}`,
          target: c.req.path,
          requestId: c.get('requestId'),
        })
        // 501 而非 404 —— 404 会让第三方以为路径写错了,从而去猜别的路径
        throw notImplemented(version)
      }

      if (route.method === 'get') app.get(honoPath, handler)
      else if (route.method === 'post') app.post(honoPath, handler)
      else if (route.method === 'patch') app.patch(honoPath, handler)
      else if (route.method === 'delete') app.delete(honoPath, handler)
    }
  }
}
