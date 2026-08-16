/**
 * Admin API —— `/v1/admin/*`。
 *
 * **契约完整定下,实现分期。** V0.2.0 只实现 `credentials`(有 `credentials-multiuser`
 * 可依托);`subjects` 需要 Subject Mirror(V0.3.0),`usage` / `quota` / `policies`
 * 需要 metering 与 policy(V0.4.0),`audit` 需要 `@dshwar/audit`(V0.3.0)。
 *
 * 未实现的端点返回 **501 而非 404** —— 404 会让第三方以为路径写错了,
 * 从而去猜别的路径;501 加上 OpenAPI 里的 `x-dshwar-status: planned` 与响应头
 * `x-dshwar-planned-version`,给出的是「这个端点是真的,只是还没到」。
 *
 * 契约先行的理由:契约是客户接进来之后换不掉的那一层,晚定一天成本高一天。
 * 而且定下来之后 Refine / Appsmith 现在就能吃 OpenAPI 生成后台骨架。
 *
 * @module @dshwar/api-contract/admin
 */
import { z } from 'zod'
import { RequestIdField, SubjectId } from './common.ts'

// ---------------------------------------------------------------------------
// 凭据 —— V0.2.0 唯一实现的 Admin 端点
// ---------------------------------------------------------------------------

/**
 * 凭据配置状态。
 *
 * ⚠️ **schema 里没有任何可以放「值」的字段。** 这是硬规则 5 在契约层的落点:
 * 不是「实现方记得别返回值」,而是**没地方放**。实现方即便想泄漏,
 * 也要先改契约 —— 而改契约是有评审的。
 *
 * 三个字段原样对应上游 `dsh-credentials` 的 `CredentialInfo`,不做任何扩展。
 * 一次「顺手多返回一个 lastFourChars 方便前端展示」就是泄漏的开始。
 */
export const CredentialDescriptor = z
  .object({
    ref: z.string().meta({ description: '凭据引用(POSIX 环境变量名形状)' }),
    configured: z.boolean().meta({ description: '当前能否解析出值' }),
    source: z.string().nullable().meta({ description: '当前供值的来源层;未配置时为 null' }),
    writable: z.boolean().meta({ description: '当前能否写入。被只读来源遮蔽时为 false' }),
  })
  .meta({
    id: 'CredentialDescriptor',
    description: '凭据的配置状态。**永不包含值** —— 本 schema 刻意不给值留字段(CLAUDE.md 硬规则 5)',
  })

export type CredentialDescriptor = z.infer<typeof CredentialDescriptor>

export const ListCredentialsResponse = z
  .object({
    data: z.array(CredentialDescriptor),
    nextCursor: z.string().nullable(),
    ...RequestIdField,
  })
  .meta({ id: 'ListCredentialsResponse' })

// ---------------------------------------------------------------------------
// 以下全部 [planned] —— 契约定下,V0.2.0 返回 501
// ---------------------------------------------------------------------------

/** 用户镜像。由 SCIM 或 Admin API 写入(V0.3.0)。 */
export const Subject = z
  .object({
    id: SubjectId,
    tenantId: z.string(),
    displayName: z.string().nullable(),
    active: z.boolean().meta({ description: 'IdP 侧停用后置 false,下次请求即被拒' }),
    roles: z.array(z.string()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Subject' })

export const ListSubjectsResponse = z
  .object({
    data: z.array(Subject),
    nextCursor: z.string().nullable(),
    ...RequestIdField,
  })
  .meta({ id: 'ListSubjectsResponse' })

export const GetSubjectResponse = z
  .object({ subject: Subject, ...RequestIdField })
  .meta({ id: 'GetSubjectResponse' })

/** 配额(V0.4.0 的 policy 包)。 */
export const Quota = z
  .object({
    subjectId: SubjectId,
    /** 计费周期内的 token 上限;null 表示不限。 */
    tokenLimit: z.number().int().min(0).nullable(),
    /** 本周期已消耗。 */
    tokenUsed: z.number().int().min(0),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
  })
  .meta({ id: 'Quota' })

export const GetQuotaResponse = z
  .object({ quota: Quota, ...RequestIdField })
  .meta({ id: 'GetQuotaResponse' })

export const UpdateQuotaRequest = z
  .object({ tokenLimit: z.number().int().min(0).nullable() })
  .meta({ id: 'UpdateQuotaRequest' })

/** 用量明细(V0.4.0 的 metering 包)。 */
export const UsageRecord = z
  .object({
    subjectId: SubjectId,
    tenantId: z.string(),
    date: z.iso.date(),
    provider: z.string(),
    model: z.string(),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    /** 成本,以最小货币单位计(分)。避免浮点。 */
    costMinorUnits: z.number().int().min(0),
    currency: z.string().length(3),
  })
  .meta({ id: 'UsageRecord' })

export const ListUsageResponse = z
  .object({
    data: z.array(UsageRecord),
    nextCursor: z.string().nullable(),
    ...RequestIdField,
  })
  .meta({ id: 'ListUsageResponse' })

/** 模型准入与预算策略(V0.4.0)。 */
export const Policy = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    /** 允许的 provider/model 组合;空数组表示全部允许。 */
    allowedModels: z.array(z.string()),
    /** 超预算后的降级目标;null 表示直接拒绝。 */
    fallbackModel: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Policy' })

export const ListPoliciesResponse = z
  .object({
    data: z.array(Policy),
    nextCursor: z.string().nullable(),
    ...RequestIdField,
  })
  .meta({ id: 'ListPoliciesResponse' })

/**
 * 部署容量(V0.5.0)。
 *
 * ## 它为什么是契约的一部分,而不是控制台自己算
 *
 * 因为**算错的后果是管理员照着一个错的上限去加人**,加到第 N 个时才发现
 * 起不来。这几个数必须与服务端**同一个来源**(`@dshwar/supervisor` 的
 * `deriveMaxProcesses`),不是各算各的。
 *
 * ⚠️ 它是**只读**的:`maxProcesses` 要改请改配置文件重启,不提供写端点。
 * 一个能在线改进程池上限的端点听起来方便,但它会让「当前生效的值」
 * 与「配置文件里的值」分叉 —— 而排障时人看的是配置文件。
 */
export const Capacity = z
  .object({
    /** `logical` | `process` | `container`。 */
    isolationLevel: z.string(),
    /**
     * 当前生效的进程上限。
     *
     * ⚠️ 逻辑档下为 `null` 而不是 0 —— 它不起子进程,这个数没有意义。
     * `null` 逼着前端去想「这一档该显示什么」,0 会被直接渲染成「上限 0」。
     */
    maxProcesses: z.number().int().nullable(),
    /** 可容纳的成员数上限。逻辑档恒为 1(V0.4.7 架构限制)。 */
    memberCap: z.number().int(),
    /** 当前已有的**启用**成员数。停用的不计 —— 他们不会起进程。 */
    memberCount: z.number().int(),
    /** 每进程常驻内存(MB),实测值。让管理员看得见代价。 */
    rssPerProcessMb: z.number().int(),
    /** 推导依据,人类可读。说不出理由的上限,管理员只能盲信或盲改。 */
    basis: z.string(),
    ...RequestIdField,
  })
  .meta({ id: 'Capacity' })

/** 审计记录(V0.3.0 的 `@dshwar/audit`)。 */
export const AuditEntry = z
  .object({
    id: z.string(),
    at: z.iso.datetime(),
    /** 调用者。Admin Key 的持有者或 SCIM 供给系统。 */
    actor: z.string(),
    action: z.string(),
    target: z.string(),
    /** 变更前后。凭据类操作只记录 `describe` 层面的事实,**不记录值**。 */
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    requestId: z.string(),
  })
  .meta({ id: 'AuditEntry' })

export const ListAuditResponse = z
  .object({
    data: z.array(AuditEntry),
    nextCursor: z.string().nullable(),
    ...RequestIdField,
  })
  .meta({ id: 'ListAuditResponse' })
