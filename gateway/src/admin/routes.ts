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
  /**
   * 身份镜像(V0.3.0 Session 6)。`/v1/admin/subjects*` 从这里读。
   *
   * 可选:没有 Subject Mirror 的部署(纯 auth-static)不强迫拉进 `@dshwar/subject`,
   * 这两个端点在缺席时回落到 501 —— 与「契约先行,实现分期」的既有语义一致。
   */
  readonly subjectStore?: SubjectMirrorReader
  /**
   * 审计存储(V0.4.0 Session 1)。`/v1/admin/audit` 从这里读。
   * 与 subjectStore 同款:结构性只读子集,缺席回落 501。
   */
  readonly auditStore?: AuditReaderLike
  /**
   * 用量读取(V0.4.0 Session 2)。`/v1/admin/usage*` 从这里读。
   * 返回的行已是契约 `UsageRecord` 的按日聚合形状 —— 聚合与计价在
   * `@dshwar/metering` 里做,端点只分页,不再碰口径。
   */
  readonly usageReader?: UsageReaderLike
  /**
   * 配额读写(V0.4.0 Session 3)。`/v1/admin/subjects/{id}/quota` 从这里走。
   * 判定逻辑在 `@dshwar/policy`,这里只暴露状态查询与上限设置。
   */
  readonly quotaAdmin?: QuotaAdminLike
}

/** `@dshwar/policy` 的管理面子集。 */
export interface QuotaAdminLike {
  /** 契约 `Quota` 形状的状态;主体的租户未知时 `undefined`(→ 404)。 */
  quotaOf(subjectId: string): Promise<QuotaStateLike | undefined>
  setLimit(subjectId: string, tokenLimit: number | null): Promise<void>
}

export interface QuotaStateLike {
  readonly subjectId: string
  readonly tokenLimit: number | null
  readonly tokenUsed: number
  readonly periodStart: string
  readonly periodEnd: string
}

/** `@dshwar/metering` 聚合结果的只读入口。 */
export interface UsageReaderLike {
  daily(filter: { tenantId: string; subjectId?: string }): Promise<UsageRowLike[]>
}

/** 契约 `UsageRecord` 的行形状。 */
export interface UsageRowLike {
  readonly subjectId: string
  readonly tenantId: string
  readonly date: string
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costMinorUnits: number
  readonly currency: string
}

/** `@dshwar/audit` 的 `AuditStore` 里本模块只读的那一小块。 */
export interface AuditReaderLike {
  query(filter: {
    tenantId: string
    cursor?: string
    limit?: number
  }): Promise<{ data: StoredAuditRecord[]; nextCursor: string | null }>
}

/** 审计记录里本模块用到的字段。 */
export interface StoredAuditRecord {
  readonly id: string
  readonly at: string
  readonly actor: string
  readonly tenantId: string
  readonly action: string
  readonly target: string
  readonly before: unknown
  readonly after: unknown
  readonly requestId: string
}

/**
 * `@dshwar/subject` 的 `SubjectStore` 里,本模块只读的那一小块。
 *
 * 结构性子集而不是直接 import 那个接口:网关不该因为两个只读端点
 * 就把 `@dshwar/subject` 变成硬依赖。
 */
export interface SubjectMirrorReader {
  get(id: string): Promise<MirrorSubject | undefined>
  list(filter?: { tenantId?: string }): Promise<MirrorSubject[]>
}

/** 镜像记录里本模块用到的字段。 */
export interface MirrorSubject {
  readonly id: string
  readonly tenantId: string
  readonly displayName: string | null
  readonly active: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** 镜像记录 → 契约的 `Subject` 形状。字段一一对应,不多不少 —— 多给一个
 * 字段就是契约外的泄漏面,少给一个会挂在响应校验上。
 *
 * `roles` 恒为空数组:镜像不存角色 —— 角色是**认证时**从 token 的 claims 里来的
 * (见 auth-jwt),供给方推的镜像里没有这个概念。契约里它是数组,空数组合法。 */
function toWireSubject(subject: MirrorSubject) {
  return {
    id: subject.id,
    tenantId: subject.tenantId,
    displayName: subject.displayName,
    active: subject.active,
    roles: [] as string[],
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  }
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

    // ---- 用户镜像(V0.3.0 Session 6,由 planned 转实现)----
    // ⚠️ 响应形状必须与冻结的契约逐字段一致 —— check:contract 已确认
    // planned → implemented 不构成契约变更,这里不许再引入任何偏差。
    const store = options.subjectStore

    app.get('/v1/admin/subjects', async (c) => {
      if (store === undefined) throw notImplemented('V0.3.0')
      const admin = c.get('admin')!
      const requestId = c.get('requestId')

      const parsed = PaginationQuery.safeParse(c.req.query())
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid query')
      }

      // 只列本租户 —— 一把 Admin Key 不得横跨租户,列表端点是最容易漏的一处:
      // 它不接收 subjectId,没有 assertTenant 可挂,必须在查询层就圈死。
      const all = await store.list({ tenantId: admin.tenantId })

      const cursor = parsed.data.cursor
      const start = cursor === undefined ? 0 : all.findIndex((s) => s.id === cursor) + 1
      const page = all.slice(start, start + parsed.data.limit)
      const nextCursor = start + parsed.data.limit < all.length ? (page.at(-1)?.id ?? null) : null

      options.audit.record({
        at: new Date().toISOString(),
        actor: admin.label,
        tenantId: admin.tenantId,
        action: 'admin.listSubjects',
        target: `tenant:${admin.tenantId}`,
        requestId,
      })

      return c.json({ data: page.map(toWireSubject), nextCursor, requestId })
    })

    app.get('/v1/admin/subjects/:id', async (c) => {
      if (store === undefined) throw notImplemented('V0.3.0')
      const admin = c.get('admin')!
      const requestId = c.get('requestId')
      const subjectId = c.req.param('id')

      const subject = await store.get(subjectId)
      if (subject === undefined) throw new ApiError('not_found', 'subject not found')
      assertTenant(admin, subject.tenantId)

      options.audit.record({
        at: new Date().toISOString(),
        actor: admin.label,
        tenantId: admin.tenantId,
        action: 'admin.getSubject',
        target: subjectId,
        requestId,
      })

      return c.json({ subject: toWireSubject(subject), requestId })
    })

    // ---- 用量(V0.4.0 Session 2,由 planned 转实现)----
    const usage = options.usageReader

    /** 两个 usage 端点共用的分页;行键 = date|subjectId|provider|model。 */
    const usagePage = (rows: UsageRowLike[], cursor: string | undefined, limit: number) => {
      const keyOf = (r: UsageRowLike) => `${r.date}|${r.subjectId}|${r.provider}|${r.model}`
      const start = cursor === undefined ? 0 : rows.findIndex((r) => keyOf(r) === cursor) + 1
      const page = rows.slice(start, start + limit)
      const nextCursor =
        start + limit < rows.length
          ? page.at(-1) === undefined
            ? null
            : keyOf(page.at(-1)!)
          : null
      return { page, nextCursor }
    }

    app.get('/v1/admin/usage', async (c) => {
      if (usage === undefined) throw notImplemented('V0.4.0')
      const admin = c.get('admin')!
      const requestId = c.get('requestId')

      const parsed = PaginationQuery.safeParse(c.req.query())
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid query')
      }

      const rows = await usage.daily({ tenantId: admin.tenantId })
      const { page, nextCursor } = usagePage(rows, parsed.data.cursor, parsed.data.limit)
      return c.json({ data: page, nextCursor, requestId })
    })

    app.get('/v1/admin/subjects/:id/usage', async (c) => {
      if (usage === undefined) throw notImplemented('V0.4.0')
      const admin = c.get('admin')!
      const requestId = c.get('requestId')
      const subjectId = c.req.param('id')

      const parsed = PaginationQuery.safeParse(c.req.query())
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid query')
      }

      // 有镜像就走 404/403 语义(与 getSubject 一致);没有镜像时行本身已按
      // 租户过滤,查不到只会得到空表,不会跨租户泄漏
      if (options.subjectStore !== undefined) {
        const subject = await options.subjectStore.get(subjectId)
        if (subject === undefined) throw new ApiError('not_found', 'subject not found')
        assertTenant(admin, subject.tenantId)
      }

      const rows = await usage.daily({ tenantId: admin.tenantId, subjectId })
      const { page, nextCursor } = usagePage(rows, parsed.data.cursor, parsed.data.limit)
      return c.json({ data: page, nextCursor, requestId })
    })

    // ---- 配额(V0.4.0 Session 3,由 planned 转实现)----
    const quotaAdmin = options.quotaAdmin

    /** 两个 quota 端点共用:404/403 语义与其它 subject 端点一致。 */
    const quotaOf404 = async (c: HonoContext<GatewayEnv>, subjectId: string) => {
      const admin = c.get('admin')!

      if (options.subjectStore !== undefined) {
        const subject = await options.subjectStore.get(subjectId)
        if (subject === undefined) throw new ApiError('not_found', 'subject not found')
        assertTenant(admin, subject.tenantId)
      }

      const quota = await quotaAdmin!.quotaOf(subjectId)
      if (quota === undefined) throw new ApiError('not_found', 'subject not found')
      return quota
    }

    app.get('/v1/admin/subjects/:id/quota', async (c) => {
      if (quotaAdmin === undefined) throw notImplemented('V0.4.0')
      const quota = await quotaOf404(c, c.req.param('id'))
      return c.json({ quota, requestId: c.get('requestId') })
    })

    app.patch('/v1/admin/subjects/:id/quota', async (c) => {
      if (quotaAdmin === undefined) throw notImplemented('V0.4.0')
      const admin = c.get('admin')!
      const requestId = c.get('requestId')

      const body = (await c.req.json().catch(() => ({}))) as { tokenLimit?: unknown }
      const tokenLimit = body.tokenLimit
      if (
        tokenLimit !== null &&
        (typeof tokenLimit !== 'number' || tokenLimit < 0 || !Number.isInteger(tokenLimit))
      ) {
        throw new ApiError('invalid_request', 'tokenLimit 需要非负整数或 null')
      }

      const before = await quotaOf404(c, c.req.param('id'))
      await quotaAdmin.setLimit(before.subjectId, tokenLimit)
      const after = await quotaAdmin.quotaOf(before.subjectId)

      // 提额/降额是钱的事,before/after 必须都在审计里 ——
      // 「谁在什么时候把限额从多少改到多少」是账务纠纷时的第一个问题
      options.audit.record({
        at: new Date().toISOString(),
        actor: admin.label,
        tenantId: admin.tenantId,
        action: 'admin.updateSubjectQuota',
        target: before.subjectId,
        before: { tokenLimit: before.tokenLimit },
        after: { tokenLimit },
        requestId,
      })

      return c.json({ quota: after, requestId })
    })

    // ---- 审计查询(V0.4.0 Session 1,由 planned 转实现)----
    const auditStore = options.auditStore

    app.get('/v1/admin/audit', async (c) => {
      if (auditStore === undefined) throw notImplemented('V0.4.0')
      const admin = c.get('admin')!
      const requestId = c.get('requestId')

      const parsed = PaginationQuery.safeParse(c.req.query())
      if (!parsed.success) {
        throw new ApiError('invalid_request', parsed.error.issues[0]?.message ?? 'invalid query')
      }

      // 租户由 Admin Key 决定,不接受查询参数指定 —— 可指定的过滤键
      // 等于把跨租户查询做成了一个参数
      const { data, nextCursor } = await auditStore.query({
        tenantId: admin.tenantId,
        limit: parsed.data.limit,
        ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
      })

      // 契约 AuditEntry 的八个字段,不多不少 —— tenantId 是过滤键,不在线上形状里
      return c.json({
        data: data.map((r) => ({
          id: r.id,
          at: r.at,
          actor: r.actor,
          action: r.action,
          target: r.target,
          before: r.before ?? null,
          after: r.after ?? null,
          requestId: r.requestId,
        })),
        nextCursor,
        requestId,
      })
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
