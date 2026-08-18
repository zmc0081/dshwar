// 由 packages/api-contract/openapi.json 自动生成 —— auto-generated,请勿手改。
// 重新生成:pnpm --filter @dshwar/sdk-swift generate

import Foundation

public struct Attachment: Codable, Sendable {
    public let contentType: String
    public let createdAt: String
    public let filename: String
    public let id: String
    public let sessionId: String?
    public let size: Int64
    public let subjectId: String
    public let tenantId: String

    public init(
        contentType: String,
        createdAt: String,
        filename: String,
        id: String,
        sessionId: String? = nil,
        size: Int64,
        subjectId: String,
        tenantId: String
    ) {
        self.contentType = contentType
        self.createdAt = createdAt
        self.filename = filename
        self.id = id
        self.sessionId = sessionId
        self.size = size
        self.subjectId = subjectId
        self.tenantId = tenantId
    }
}

public struct AuditEntry: Codable, Sendable {
    public let action: String
    public let actor: String
    public let after: AnyCodable?
    public let at: String
    public let before: AnyCodable?
    public let id: String
    public let requestId: String
    public let target: String

    public init(
        action: String,
        actor: String,
        after: AnyCodable? = nil,
        at: String,
        before: AnyCodable? = nil,
        id: String,
        requestId: String,
        target: String
    ) {
        self.action = action
        self.actor = actor
        self.after = after
        self.at = at
        self.before = before
        self.id = id
        self.requestId = requestId
        self.target = target
    }
}

public struct Capacity: Codable, Sendable {
    public let basis: String
    public let isolationLevel: String
    public let maxProcesses: Int64?
    public let memberCap: Int64
    public let memberCount: Int64
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String
    public let rssPerProcessMb: Int64

    public init(
        basis: String,
        isolationLevel: String,
        maxProcesses: Int64? = nil,
        memberCap: Int64,
        memberCount: Int64,
        requestId: String,
        rssPerProcessMb: Int64
    ) {
        self.basis = basis
        self.isolationLevel = isolationLevel
        self.maxProcesses = maxProcesses
        self.memberCap = memberCap
        self.memberCount = memberCount
        self.requestId = requestId
        self.rssPerProcessMb = rssPerProcessMb
    }
}

public struct CreateAttachmentResponse: Codable, Sendable {
    public let attachment: Attachment
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        attachment: Attachment,
        requestId: String
    ) {
        self.attachment = attachment
        self.requestId = requestId
    }
}

public struct CreateJobRequest: Codable, Sendable {
    public let kind: String
    public let workspaceId: String

    public init(
        kind: String,
        workspaceId: String
    ) {
        self.kind = kind
        self.workspaceId = workspaceId
    }
}

public struct CreateSessionRequest: Codable, Sendable {
    /// 是否在流中包含推理增量(思维链)。默认关闭
    public let includeReasoning: Bool
    /// 调用方自定义标签,原样回显。不参与任何服务端逻辑
    public let metadata: AnyCodable?
    /// 模型 id。省略则用部署方配置的默认值
    public let model: String?
    /// 模型提供方路由。省略则用默认
    public let provider: String?
    /// 工作区 id。省略则落到 default
    public let workspaceId: String?

    public init(
        includeReasoning: Bool,
        metadata: AnyCodable? = nil,
        model: String? = nil,
        provider: String? = nil,
        workspaceId: String? = nil
    ) {
        self.includeReasoning = includeReasoning
        self.metadata = metadata
        self.model = model
        self.provider = provider
        self.workspaceId = workspaceId
    }
}

public struct CreateSessionResponse: Codable, Sendable {
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String
    public let session: Session

    public init(
        requestId: String,
        session: Session
    ) {
        self.requestId = requestId
        self.session = session
    }
}

public struct CreateTurnRequest: Codable, Sendable {
    /// 本轮的用户输入
    public let input: String

    public init(
        input: String
    ) {
        self.input = input
    }
}

public struct CreateTurnResponse: Codable, Sendable {
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String
    /// 取值:idle | running
    public let status: String
    /// 本轮的序号,与 SSE 事件里的 turn 对应
    public let turn: Int64

    public init(
        requestId: String,
        status: String,
        turn: Int64
    ) {
        self.requestId = requestId
        self.status = status
        self.turn = turn
    }
}

public struct CreateWorkspaceRequest: Codable, Sendable {
    public let name: String

    public init(
        name: String
    ) {
        self.name = name
    }
}

/// 凭据的配置状态。**永不包含值** —— 本 schema 刻意不给值留字段(CLAUDE.md 硬规则 5)
public struct CredentialDescriptor: Codable, Sendable {
    /// 当前能否解析出值
    public let configured: Bool
    /// 凭据引用(POSIX 环境变量名形状)
    public let ref: String
    /// 当前供值的来源层;未配置时为 null
    public let source: String?
    /// 当前能否写入。被只读来源遮蔽时为 false
    public let writable: Bool

    public init(
        configured: Bool,
        ref: String,
        source: String? = nil,
        writable: Bool
    ) {
        self.configured = configured
        self.ref = ref
        self.source = source
        self.writable = writable
    }
}

public struct DeleteSessionResponse: Codable, Sendable {
    public let cancelledTurn: Int64?
    /// 会话标识,服务端生成
    public let id: String
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        cancelledTurn: Int64? = nil,
        id: String,
        requestId: String
    ) {
        self.cancelledTurn = cancelledTurn
        self.id = id
        self.requestId = requestId
    }
}

public struct Deliverable: Codable, Sendable {
    /// 取值:file | directory
    public let kind: String
    public let modifiedAt: String
    public let path: String
    public let size: Int64

    public init(
        kind: String,
        modifiedAt: String,
        path: String,
        size: Int64
    ) {
        self.kind = kind
        self.modifiedAt = modifiedAt
        self.path = path
        self.size = size
    }
}

/// 所有非 2xx 响应的统一形状
public struct ErrorResponse: Codable, Sendable {
    public let error: AnyCodable

    public init(
        error: AnyCodable
    ) {
        self.error = error
    }
}

public struct GetJobResponse: Codable, Sendable {
    public let job: Job
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        job: Job,
        requestId: String
    ) {
        self.job = job
        self.requestId = requestId
    }
}

public struct GetQuotaResponse: Codable, Sendable {
    public let quota: Quota
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        quota: Quota,
        requestId: String
    ) {
        self.quota = quota
        self.requestId = requestId
    }
}

public struct GetSessionResponse: Codable, Sendable {
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String
    public let session: Session

    public init(
        requestId: String,
        session: Session
    ) {
        self.requestId = requestId
        self.session = session
    }
}

public struct GetSubjectResponse: Codable, Sendable {
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String
    public let subject: Subject

    public init(
        requestId: String,
        subject: Subject
    ) {
        self.requestId = requestId
        self.subject = subject
    }
}

public struct GetWorkspacePolicyResponse: Codable, Sendable {
    public let policy: WorkspacePolicy
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        policy: WorkspacePolicy,
        requestId: String
    ) {
        self.policy = policy
        self.requestId = requestId
    }
}

public struct GetWorkspaceResponse: Codable, Sendable {
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String
    public let workspace: Workspace

    public init(
        requestId: String,
        workspace: Workspace
    ) {
        self.requestId = requestId
        self.workspace = workspace
    }
}

public struct Job: Codable, Sendable {
    public let createdAt: String
    public let error: String?
    public let finishedAt: String?
    public let id: String
    public let kind: String
    public let status: JobStatus
    public let subjectId: String
    public let tenantId: String
    public let updatedAt: String
    public let workspaceId: String

    public init(
        createdAt: String,
        error: String? = nil,
        finishedAt: String? = nil,
        id: String,
        kind: String,
        status: JobStatus,
        subjectId: String,
        tenantId: String,
        updatedAt: String,
        workspaceId: String
    ) {
        self.createdAt = createdAt
        self.error = error
        self.finishedAt = finishedAt
        self.id = id
        self.kind = kind
        self.status = status
        self.subjectId = subjectId
        self.tenantId = tenantId
        self.updatedAt = updatedAt
        self.workspaceId = workspaceId
    }
}

public struct ListAttachmentsResponse: Codable, Sendable {
    public let data: [Attachment]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [Attachment],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListAuditResponse: Codable, Sendable {
    public let data: [AuditEntry]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [AuditEntry],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListCredentialsResponse: Codable, Sendable {
    public let data: [CredentialDescriptor]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [CredentialDescriptor],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListDeliverablesResponse: Codable, Sendable {
    public let data: [Deliverable]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [Deliverable],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListJobsResponse: Codable, Sendable {
    public let data: [Job]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [Job],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListPoliciesResponse: Codable, Sendable {
    public let data: [Policy]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [Policy],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListSessionsResponse: Codable, Sendable {
    public let data: [Session]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [Session],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListSubjectsResponse: Codable, Sendable {
    public let data: [Subject]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [Subject],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListUsageResponse: Codable, Sendable {
    public let data: [UsageRecord]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [UsageRecord],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct ListWorkspacesResponse: Codable, Sendable {
    public let data: [Workspace]
    public let nextCursor: String?
    /// 与服务端日志和审计记录对得上的调用标识
    public let requestId: String

    public init(
        data: [Workspace],
        nextCursor: String? = nil,
        requestId: String
    ) {
        self.data = data
        self.nextCursor = nextCursor
        self.requestId = requestId
    }
}

public struct Policy: Codable, Sendable {
    public let allowedModels: [String]
    public let fallbackModel: String?
    public let id: String
    public let tenantId: String
    public let updatedAt: String

    public init(
        allowedModels: [String],
        fallbackModel: String? = nil,
        id: String,
        tenantId: String,
        updatedAt: String
    ) {
        self.allowedModels = allowedModels
        self.fallbackModel = fallbackModel
        self.id = id
        self.tenantId = tenantId
        self.updatedAt = updatedAt
    }
}

public struct Quota: Codable, Sendable {
    public let periodEnd: String
    public let periodStart: String
    /// 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱
    public let subjectId: String
    public let tokenLimit: Int64?
    public let tokenUsed: Int64

    public init(
        periodEnd: String,
        periodStart: String,
        subjectId: String,
        tokenLimit: Int64? = nil,
        tokenUsed: Int64
    ) {
        self.periodEnd = periodEnd
        self.periodStart = periodStart
        self.subjectId = subjectId
        self.tokenLimit = tokenLimit
        self.tokenUsed = tokenUsed
    }
}

public struct Session: Codable, Sendable {
    public let createdAt: String
    /// 会话标识,服务端生成
    public let id: String
    public let includeReasoning: Bool
    public let metadata: AnyCodable
    public let model: String?
    public let provider: String?
    /// 取值:idle | running
    public let status: String
    /// 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱
    public let subjectId: String
    public let turns: Int64
    /// 会话所属工作区
    public let workspaceId: String?

    public init(
        createdAt: String,
        id: String,
        includeReasoning: Bool,
        metadata: AnyCodable,
        model: String? = nil,
        provider: String? = nil,
        status: String,
        subjectId: String,
        turns: Int64,
        workspaceId: String? = nil
    ) {
        self.createdAt = createdAt
        self.id = id
        self.includeReasoning = includeReasoning
        self.metadata = metadata
        self.model = model
        self.provider = provider
        self.status = status
        self.subjectId = subjectId
        self.turns = turns
        self.workspaceId = workspaceId
    }
}

public struct StripeWebhookEventBody: Codable, Sendable {
    public let id: String
    public let type: String

    public init(
        id: String,
        type: String
    ) {
        self.id = id
        self.type = type
    }
}

public struct Subject: Codable, Sendable {
    /// IdP 侧停用后置 false,下次请求即被拒
    public let active: Bool
    public let createdAt: String
    public let displayName: String?
    /// 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱
    public let id: String
    public let roles: [String]
    public let tenantId: String
    public let updatedAt: String

    public init(
        active: Bool,
        createdAt: String,
        displayName: String? = nil,
        id: String,
        roles: [String],
        tenantId: String,
        updatedAt: String
    ) {
        self.active = active
        self.createdAt = createdAt
        self.displayName = displayName
        self.id = id
        self.roles = roles
        self.tenantId = tenantId
        self.updatedAt = updatedAt
    }
}

public struct UpdateQuotaRequest: Codable, Sendable {
    public let tokenLimit: Int64?

    public init(
        tokenLimit: Int64? = nil
    ) {
        self.tokenLimit = tokenLimit
    }
}

public struct UpdateWorkspacePolicyRequest: Codable, Sendable {
    public let allowShell: Bool?
    public let allowedHosts: [String]?
    public let allowedTools: [String]?
    public let writablePaths: [String]?

    public init(
        allowShell: Bool? = nil,
        allowedHosts: [String]? = nil,
        allowedTools: [String]? = nil,
        writablePaths: [String]? = nil
    ) {
        self.allowShell = allowShell
        self.allowedHosts = allowedHosts
        self.allowedTools = allowedTools
        self.writablePaths = writablePaths
    }
}

public struct UsageRecord: Codable, Sendable {
    public let costMinorUnits: Int64
    public let currency: String
    public let date: String
    public let inputTokens: Int64
    public let model: String
    public let outputTokens: Int64
    public let provider: String
    /// 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱
    public let subjectId: String
    public let tenantId: String

    public init(
        costMinorUnits: Int64,
        currency: String,
        date: String,
        inputTokens: Int64,
        model: String,
        outputTokens: Int64,
        provider: String,
        subjectId: String,
        tenantId: String
    ) {
        self.costMinorUnits = costMinorUnits
        self.currency = currency
        self.date = date
        self.inputTokens = inputTokens
        self.model = model
        self.outputTokens = outputTokens
        self.provider = provider
        self.subjectId = subjectId
        self.tenantId = tenantId
    }
}

public struct WebhookAck: Codable, Sendable {
    /// 取值:applied | duplicate | already-paid | ignored
    public let outcome: String
    public let received: Bool
    public let requestId: String

    public init(
        outcome: String,
        received: Bool,
        requestId: String
    ) {
        self.outcome = outcome
        self.received = received
        self.requestId = requestId
    }
}

public struct Workspace: Codable, Sendable {
    public let createdAt: String
    public let id: String
    public let name: String
    public let subjectId: String
    public let tenantId: String
    public let updatedAt: String

    public init(
        createdAt: String,
        id: String,
        name: String,
        subjectId: String,
        tenantId: String,
        updatedAt: String
    ) {
        self.createdAt = createdAt
        self.id = id
        self.name = name
        self.subjectId = subjectId
        self.tenantId = tenantId
        self.updatedAt = updatedAt
    }
}

public struct WorkspacePolicy: Codable, Sendable {
    public let allowShell: Bool
    public let allowedHosts: [String]
    public let allowedTools: [String]
    public let updatedAt: String
    public let workspaceId: String
    public let writablePaths: [String]

    public init(
        allowShell: Bool,
        allowedHosts: [String],
        allowedTools: [String],
        updatedAt: String,
        workspaceId: String,
        writablePaths: [String]
    ) {
        self.allowShell = allowShell
        self.allowedHosts = allowedHosts
        self.allowedTools = allowedTools
        self.updatedAt = updatedAt
        self.workspaceId = workspaceId
        self.writablePaths = writablePaths
    }
}
