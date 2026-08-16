/**
 * 由 packages/api-contract/openapi.json 自动生成 —— auto-generated,请勿手改。
 * 重新生成:pnpm --filter @dshwar/sdk generate
 */
export interface paths {
    "/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 列出当前主体的会话 */
        get: operations["listSessions"];
        put?: never;
        /** 创建会话 */
        post: operations["createSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 会话状态 */
        get: operations["getSession"];
        put?: never;
        post?: never;
        /**
         * 取消并释放会话
         * @description 先截断正在跑的一轮,再彻底释放会话。删除不存在或已删除的会话都返回 404,不区分。
         */
        delete: operations["deleteSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{id}/turns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 发起一轮
         * @description **不等待本轮跑完就返回**,只确认已受理;输出走 SSE。一轮可能跑几分钟(工具调用、多步推理),而中间的反向代理通常在 60 秒左右掐断连接 —— 让发起与消费分开,客户端可以先建 SSE 再发起,断线重连也不丢内容。
         */
        post: operations["createTurn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sessions/{id}/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * SSE 流式输出
         * @description 每条事件形如 `id: <seq>` / `event: <type>` / `data: <StreamEvent JSON>`。`id` 单调递增;断线重连时带 `Last-Event-ID` 请求头,服务端从该序号之后重放。`reasoning.delta` 仅在会话创建时 `includeReasoning: true` 才会出现。
         */
        get: operations["streamSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/subjects/{id}/credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 凭据配置状态
         * @description **永不返回值。** 只暴露 configured / source / writable —— 本端点的 schema 里没有任何可以放值的字段(CLAUDE.md 硬规则 5)。
         */
        get: operations["listSubjectCredentials"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/subjects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 列出用户镜像 */
        get: operations["listSubjects"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/subjects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取一个用户镜像 */
        get: operations["getSubject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/subjects/{id}/quota": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取配额 */
        get: operations["getSubjectQuota"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 修改配额 */
        patch: operations["updateSubjectQuota"];
        trace?: never;
    };
    "/v1/admin/subjects/{id}/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 单个主体的用量明细 */
        get: operations["listSubjectUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 聚合用量
         * @description 支持按租户、时间、模型分组。
         */
        get: operations["listUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/capacity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 部署容量:隔离档、进程上限、成员上限 */
        get: operations["getCapacity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 模型准入与预算策略 */
        get: operations["listPolicies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 审计查询 */
        get: operations["listAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description 所有非 2xx 响应的统一形状 */
        ErrorResponse: {
            error: {
                /**
                 * @description 闭集错误码,SDK 可穷举
                 * @enum {string}
                 */
                code: "unauthorized" | "forbidden" | "not_found" | "invalid_request" | "conflict" | "rate_limited" | "unavailable" | "not_implemented" | "internal";
                /** @description 面向开发者的说明。不含内部细节、不含凭证、不含他人数据 */
                message: string;
                /** @description 与服务端日志和审计记录对得上的调用标识 */
                requestId: string;
            };
        };
        /** @description SSE `data:` 字段的 JSON 载荷。事件类型是闭集,SDK 可穷举 */
        StreamEvent: {
            /** @constant */
            type: "turn.started";
            turn: number;
        } | {
            /** @constant */
            type: "message.delta";
            turn: number;
            text: string;
        } | {
            /** @constant */
            type: "reasoning.delta";
            turn: number;
            text: string;
        } | {
            /** @constant */
            type: "message.completed";
            turn: number;
            text: string;
        } | {
            /** @constant */
            type: "tool.started";
            turn: number;
            callId: string;
            name: string;
        } | {
            /** @constant */
            type: "tool.completed";
            turn: number;
            callId: string;
            isError: boolean;
        } | {
            /** @constant */
            type: "turn.completed";
            turn: number;
            /** @enum {string} */
            reason: "completed" | "cancelled" | "error";
        } | {
            /** @constant */
            type: "error";
            turn?: number;
            code: string;
            message: string;
        } | {
            /** @constant */
            type: "ping";
        };
        Session: {
            /** @description 会话标识,服务端生成 */
            id: string;
            /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
            subjectId: string;
            /** @description 会话所属工作区 */
            workspaceId?: string;
            /** @enum {string} */
            status: "idle" | "running";
            model: string | null;
            provider: string | null;
            includeReasoning: boolean;
            turns: number;
            /** Format: date-time */
            createdAt: string;
            metadata: {
                [key: string]: string;
            };
        };
        CreateSessionRequest: {
            /** @description 模型 id。省略则用部署方配置的默认值 */
            model?: string;
            /** @description 模型提供方路由。省略则用默认 */
            provider?: string;
            /** @description 工作区 id。省略则落到 default */
            workspaceId?: string;
            /**
             * @description 是否在流中包含推理增量(思维链)。默认关闭
             * @default false
             */
            includeReasoning: boolean;
            /** @description 调用方自定义标签,原样回显。不参与任何服务端逻辑 */
            metadata?: {
                [key: string]: string;
            };
        };
        CreateSessionResponse: {
            session: components["schemas"]["Session"];
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        GetSessionResponse: {
            session: components["schemas"]["Session"];
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        ListSessionsResponse: {
            data: components["schemas"]["Session"][];
            nextCursor: string | null;
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        CreateTurnRequest: {
            /** @description 本轮的用户输入 */
            input: string;
        };
        CreateTurnResponse: {
            /** @description 本轮的序号,与 SSE 事件里的 turn 对应 */
            turn: number;
            /** @enum {string} */
            status: "idle" | "running";
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        DeleteSessionResponse: {
            /** @description 会话标识,服务端生成 */
            id: string;
            cancelledTurn: number | null;
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        /** @description 凭据的配置状态。**永不包含值** —— 本 schema 刻意不给值留字段(CLAUDE.md 硬规则 5) */
        CredentialDescriptor: {
            /** @description 凭据引用(POSIX 环境变量名形状) */
            ref: string;
            /** @description 当前能否解析出值 */
            configured: boolean;
            /** @description 当前供值的来源层;未配置时为 null */
            source: string | null;
            /** @description 当前能否写入。被只读来源遮蔽时为 false */
            writable: boolean;
        };
        ListCredentialsResponse: {
            data: components["schemas"]["CredentialDescriptor"][];
            nextCursor: string | null;
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        Subject: {
            /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
            id: string;
            tenantId: string;
            displayName: string | null;
            /** @description IdP 侧停用后置 false,下次请求即被拒 */
            active: boolean;
            roles: string[];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ListSubjectsResponse: {
            data: components["schemas"]["Subject"][];
            nextCursor: string | null;
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        GetSubjectResponse: {
            subject: components["schemas"]["Subject"];
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        Quota: {
            /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
            subjectId: string;
            tokenLimit: number | null;
            tokenUsed: number;
            /** Format: date-time */
            periodStart: string;
            /** Format: date-time */
            periodEnd: string;
        };
        GetQuotaResponse: {
            quota: components["schemas"]["Quota"];
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        UpdateQuotaRequest: {
            tokenLimit: number | null;
        };
        UsageRecord: {
            /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
            subjectId: string;
            tenantId: string;
            /** Format: date */
            date: string;
            provider: string;
            model: string;
            inputTokens: number;
            outputTokens: number;
            costMinorUnits: number;
            currency: string;
        };
        ListUsageResponse: {
            data: components["schemas"]["UsageRecord"][];
            nextCursor: string | null;
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        Policy: {
            id: string;
            tenantId: string;
            allowedModels: string[];
            fallbackModel: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        ListPoliciesResponse: {
            data: components["schemas"]["Policy"][];
            nextCursor: string | null;
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
        AuditEntry: {
            id: string;
            /** Format: date-time */
            at: string;
            actor: string;
            action: string;
            target: string;
            before: unknown | null;
            after: unknown | null;
            requestId: string;
        };
        ListAuditResponse: {
            data: components["schemas"]["AuditEntry"][];
            nextCursor: string | null;
            /** @description 与服务端日志和审计记录对得上的调用标识 */
            requestId: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listSessions: {
        parameters: {
            query?: {
                /** @description 本页最多返回多少条 */
                limit?: number;
                /** @description 上一页返回的 nextCursor;首页省略 */
                cursor?: string;
                /** @description 排序字段,前缀 `-` 表示降序(如 `-createdAt`) */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 会话列表 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListSessionsResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSessionRequest"];
            };
        };
        responses: {
            /** @description 会话已创建 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateSessionResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description 会话标识,服务端生成 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 会话 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetSessionResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    deleteSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description 会话标识,服务端生成 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已取消并释放 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteSessionResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    createTurn: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description 会话标识,服务端生成 */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTurnRequest"];
            };
        };
        responses: {
            /** @description 本轮已受理,输出走 SSE */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateTurnResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 会话正忙或已结束 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    streamSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description 上次收到的最后一个事件序号;服务端从该序号之后重放 */
                "Last-Event-ID"?: string;
            };
            path: {
                /** @description 会话标识,服务端生成 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description SSE 事件流 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": components["schemas"]["StreamEvent"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listSubjectCredentials: {
        parameters: {
            query?: {
                /** @description 本页最多返回多少条 */
                limit?: number;
                /** @description 上一页返回的 nextCursor;首页省略 */
                cursor?: string;
                /** @description 排序字段,前缀 `-` 表示降序(如 `-createdAt`) */
                sort?: string;
            };
            header?: never;
            path: {
                /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 凭据配置状态列表 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListCredentialsResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Admin Key 不属于该主体所在租户 */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listSubjects: {
        parameters: {
            query?: {
                /** @description 本页最多返回多少条 */
                limit?: number;
                /** @description 上一页返回的 nextCursor;首页省略 */
                cursor?: string;
                /** @description 排序字段,前缀 `-` 表示降序(如 `-createdAt`) */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 用户镜像列表 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListSubjectsResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getSubject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 用户镜像 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetSubjectResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getSubjectQuota: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 配额 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetQuotaResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    updateSubjectQuota: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateQuotaRequest"];
            };
        };
        responses: {
            /** @description 配额已更新 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GetQuotaResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listSubjectUsage: {
        parameters: {
            query?: {
                /** @description 本页最多返回多少条 */
                limit?: number;
                /** @description 上一页返回的 nextCursor;首页省略 */
                cursor?: string;
                /** @description 排序字段,前缀 `-` 表示降序(如 `-createdAt`) */
                sort?: string;
            };
            header?: never;
            path: {
                /** @description 主体标识。必须是 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id),不得使用邮箱 */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 用量明细 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListUsageResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 资源不存在,或存在但不属于该主体(两者刻意不可区分) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listUsage: {
        parameters: {
            query?: {
                /** @description 本页最多返回多少条 */
                limit?: number;
                /** @description 上一页返回的 nextCursor;首页省略 */
                cursor?: string;
                /** @description 排序字段,前缀 `-` 表示降序(如 `-createdAt`) */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 聚合用量 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListUsageResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getCapacity: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 当前部署的容量 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        isolationLevel: string;
                        maxProcesses: number | null;
                        memberCap: number;
                        memberCount: number;
                        rssPerProcessMb: number;
                        basis: string;
                        /** @description 与服务端日志和审计记录对得上的调用标识 */
                        requestId: string;
                    };
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listPolicies: {
        parameters: {
            query?: {
                /** @description 本页最多返回多少条 */
                limit?: number;
                /** @description 上一页返回的 nextCursor;首页省略 */
                cursor?: string;
                /** @description 排序字段,前缀 `-` 表示降序(如 `-createdAt`) */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 策略列表 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListPoliciesResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listAudit: {
        parameters: {
            query?: {
                /** @description 本页最多返回多少条 */
                limit?: number;
                /** @description 上一页返回的 nextCursor;首页省略 */
                cursor?: string;
                /** @description 排序字段,前缀 `-` 表示降序(如 `-createdAt`) */
                sort?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 审计记录 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListAuditResponse"];
                };
            };
            /** @description 请求体或参数不满足 schema */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 凭证缺失、无效或已过期 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 触发限流 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description 服务端内部错误 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}
