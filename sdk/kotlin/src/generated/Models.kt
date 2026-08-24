// 由 packages/api-contract/openapi.json 自动生成 —— auto-generated,请勿手改。
// 重新生成:pnpm --filter @dshwar/sdk-kotlin generate

package ai.dshwar.sdk

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class Attachment(
    @SerialName("contentType")
    val contentType: String,
    @SerialName("createdAt")
    val createdAt: String,
    @SerialName("filename")
    val filename: String,
    @SerialName("id")
    val id: String,
    @SerialName("sessionId")
    val sessionId: String? = null,
    @SerialName("size")
    val size: Long,
    @SerialName("subjectId")
    val subjectId: String,
    @SerialName("tenantId")
    val tenantId: String
)

@Serializable
data class AuditEntry(
    @SerialName("action")
    val action: String,
    @SerialName("actor")
    val actor: String,
    @SerialName("after")
    val after: JsonElement? = null,
    @SerialName("at")
    val at: String,
    @SerialName("before")
    val before: JsonElement? = null,
    @SerialName("id")
    val id: String,
    @SerialName("requestId")
    val requestId: String,
    @SerialName("target")
    val target: String
)

@Serializable
data class Capacity(
    @SerialName("basis")
    val basis: String,
    @SerialName("isolationLevel")
    val isolationLevel: String,
    @SerialName("maxProcesses")
    val maxProcesses: Long? = null,
    @SerialName("memberCap")
    val memberCap: Long,
    @SerialName("memberCount")
    val memberCount: Long,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String,
    @SerialName("rssPerProcessMb")
    val rssPerProcessMb: Long
)

@Serializable
data class Cost(
    @SerialName("amountMinor")
    val amountMinor: Long? = null,
    @SerialName("currency")
    val currency: String? = null,
    @SerialName("currencyExponent")
    val currencyExponent: Long? = null,
    // 取值:priced | unpriced | unbilled
    @SerialName("kind")
    val kind: String
)

@Serializable
data class CreateAttachmentResponse(
    @SerialName("attachment")
    val attachment: Attachment,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class CreateJobRequest(
    @SerialName("kind")
    val kind: String,
    @SerialName("workspaceId")
    val workspaceId: String
)

@Serializable
data class CreateSessionRequest(
    /** 是否在流中包含推理增量(思维链)。默认关闭 */
    @SerialName("includeReasoning")
    val includeReasoning: Boolean,
    /** 调用方自定义标签,原样回显。不参与任何服务端逻辑 */
    @SerialName("metadata")
    val metadata: JsonElement? = null,
    /** 模型 id。省略则用部署方配置的默认值 */
    @SerialName("model")
    val model: String? = null,
    /** 模型提供方路由。省略则用默认 */
    @SerialName("provider")
    val provider: String? = null,
    /** 工作区 id。省略则落到 default */
    @SerialName("workspaceId")
    val workspaceId: String? = null
)

@Serializable
data class CreateSessionResponse(
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String,
    @SerialName("session")
    val session: Session
)

@Serializable
data class CreateTurnRequest(
    /** 本轮的用户输入 */
    @SerialName("input")
    val input: String
)

@Serializable
data class CreateTurnResponse(
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String,
    // 取值:idle | running
    @SerialName("status")
    val status: String,
    /** 本轮的序号,与 SSE 事件里的 turn 对应 */
    @SerialName("turn")
    val turn: Long
)

@Serializable
data class CreateWorkspaceRequest(
    @SerialName("name")
    val name: String
)

/** 凭据的配置状态。**永不包含值** —— 本 schema 刻意不给值留字段(CLAUDE.md 硬规则 5) */
@Serializable
data class CredentialDescriptor(
    /** 当前能否解析出值 */
    @SerialName("configured")
    val configured: Boolean,
    /** 凭据引用(POSIX 环境变量名形状) */
    @SerialName("ref")
    val ref: String,
    /** 当前供值的来源层;未配置时为 null */
    @SerialName("source")
    val source: String? = null,
    /** 当前能否写入。被只读来源遮蔽时为 false */
    @SerialName("writable")
    val writable: Boolean
)

@Serializable
data class DeleteSessionResponse(
    @SerialName("cancelledTurn")
    val cancelledTurn: Long? = null,
    /** 会话标识,服务端生成 */
    @SerialName("id")
    val id: String,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class Deliverable(
    // 取值:file | directory
    @SerialName("kind")
    val kind: String,
    @SerialName("modifiedAt")
    val modifiedAt: String,
    @SerialName("path")
    val path: String,
    @SerialName("size")
    val size: Long
)

/** 所有非 2xx 响应的统一形状 */
@Serializable
data class ErrorResponse(
    @SerialName("error")
    val error: JsonElement
)

@Serializable
data class GetJobResponse(
    @SerialName("job")
    val job: Job,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class GetQuotaResponse(
    @SerialName("quota")
    val quota: Quota,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class GetSessionResponse(
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String,
    @SerialName("session")
    val session: Session
)

@Serializable
data class GetSubjectResponse(
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String,
    @SerialName("subject")
    val subject: Subject
)

@Serializable
data class GetWorkspacePolicyResponse(
    @SerialName("policy")
    val policy: WorkspacePolicy,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class GetWorkspaceResponse(
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String,
    @SerialName("workspace")
    val workspace: Workspace
)

@Serializable
data class Job(
    @SerialName("createdAt")
    val createdAt: String,
    @SerialName("error")
    val error: String? = null,
    @SerialName("finishedAt")
    val finishedAt: String? = null,
    @SerialName("id")
    val id: String,
    @SerialName("kind")
    val kind: String,
    @SerialName("status")
    val status: JobStatus,
    @SerialName("subjectId")
    val subjectId: String,
    @SerialName("tenantId")
    val tenantId: String,
    @SerialName("updatedAt")
    val updatedAt: String,
    @SerialName("workspaceId")
    val workspaceId: String
)

@Serializable
data class ListAttachmentsResponse(
    @SerialName("data")
    val data: List<Attachment>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListAuditResponse(
    @SerialName("data")
    val data: List<AuditEntry>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListCredentialsResponse(
    @SerialName("data")
    val data: List<CredentialDescriptor>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListDeliverablesResponse(
    @SerialName("data")
    val data: List<Deliverable>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListJobsResponse(
    @SerialName("data")
    val data: List<Job>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListPoliciesResponse(
    @SerialName("data")
    val data: List<Policy>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListSessionsResponse(
    @SerialName("data")
    val data: List<Session>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListSubjectsResponse(
    @SerialName("data")
    val data: List<Subject>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListUsageResponse(
    @SerialName("data")
    val data: List<UsageRecord>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class ListWorkspacesResponse(
    @SerialName("data")
    val data: List<Workspace>,
    @SerialName("nextCursor")
    val nextCursor: String? = null,
    /** 与服务端日志和审计记录对得上的调用标识 */
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class Policy(
    @SerialName("allowedModels")
    val allowedModels: List<String>,
    @SerialName("fallbackModel")
    val fallbackModel: String? = null,
    @SerialName("id")
    val id: String,
    @SerialName("tenantId")
    val tenantId: String,
    @SerialName("updatedAt")
    val updatedAt: String
)

@Serializable
data class Quota(
    @SerialName("periodEnd")
    val periodEnd: String,
    @SerialName("periodStart")
    val periodStart: String,
    /** 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
    @SerialName("subjectId")
    val subjectId: String,
    @SerialName("tokenLimit")
    val tokenLimit: Long? = null,
    @SerialName("tokenUsed")
    val tokenUsed: Long
)

@Serializable
data class Session(
    @SerialName("createdAt")
    val createdAt: String,
    /** 会话标识,服务端生成 */
    @SerialName("id")
    val id: String,
    @SerialName("includeReasoning")
    val includeReasoning: Boolean,
    @SerialName("metadata")
    val metadata: JsonElement,
    @SerialName("model")
    val model: String? = null,
    @SerialName("provider")
    val provider: String? = null,
    // 取值:idle | running
    @SerialName("status")
    val status: String,
    /** 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
    @SerialName("subjectId")
    val subjectId: String,
    @SerialName("turns")
    val turns: Long,
    /** 会话所属工作区 */
    @SerialName("workspaceId")
    val workspaceId: String? = null
)

@Serializable
data class StripeWebhookEventBody(
    @SerialName("id")
    val id: String,
    @SerialName("type")
    val type: String
)

@Serializable
data class Subject(
    /** IdP 侧停用后置 false,下次请求即被拒 */
    @SerialName("active")
    val active: Boolean,
    @SerialName("createdAt")
    val createdAt: String,
    @SerialName("displayName")
    val displayName: String? = null,
    /** 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
    @SerialName("id")
    val id: String,
    @SerialName("roles")
    val roles: List<String>,
    @SerialName("tenantId")
    val tenantId: String,
    @SerialName("updatedAt")
    val updatedAt: String
)

@Serializable
data class UpdateQuotaRequest(
    @SerialName("tokenLimit")
    val tokenLimit: Long? = null
)

@Serializable
data class UpdateWorkspacePolicyRequest(
    @SerialName("allowShell")
    val allowShell: Boolean? = null,
    @SerialName("allowedHosts")
    val allowedHosts: List<String>? = null,
    @SerialName("allowedTools")
    val allowedTools: List<String>? = null,
    @SerialName("writablePaths")
    val writablePaths: List<String>? = null
)

@Serializable
data class UsageRecord(
    @SerialName("cost")
    val cost: Cost,
    @SerialName("date")
    val date: String,
    @SerialName("inputTokens")
    val inputTokens: Long,
    @SerialName("model")
    val model: String,
    @SerialName("outputTokens")
    val outputTokens: Long,
    @SerialName("provider")
    val provider: String,
    /** 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
    @SerialName("subjectId")
    val subjectId: String,
    @SerialName("tenantId")
    val tenantId: String
)

@Serializable
data class WebhookAck(
    // 取值:applied | duplicate | already-paid | ignored
    @SerialName("outcome")
    val outcome: String,
    @SerialName("received")
    val received: Boolean,
    @SerialName("requestId")
    val requestId: String
)

@Serializable
data class Workspace(
    @SerialName("createdAt")
    val createdAt: String,
    @SerialName("id")
    val id: String,
    @SerialName("name")
    val name: String,
    @SerialName("subjectId")
    val subjectId: String,
    @SerialName("tenantId")
    val tenantId: String,
    @SerialName("updatedAt")
    val updatedAt: String
)

@Serializable
data class WorkspacePolicy(
    @SerialName("allowShell")
    val allowShell: Boolean,
    @SerialName("allowedHosts")
    val allowedHosts: List<String>,
    @SerialName("allowedTools")
    val allowedTools: List<String>,
    @SerialName("updatedAt")
    val updatedAt: String,
    @SerialName("workspaceId")
    val workspaceId: String,
    @SerialName("writablePaths")
    val writablePaths: List<String>
)
