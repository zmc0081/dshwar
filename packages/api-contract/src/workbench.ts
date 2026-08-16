/**
 * 工作台契约 —— 工作区 / 产物 / 作业 / 附件(V0.5.5)。
 *
 * ## 为什么四类一次定完
 *
 * 契约是客户接进来之后换不掉的那一层,**晚定一天成本高一天**。
 * 而且这四类之间有引用关系:作业指向工作区、产物是工作区里的文件、
 * 附件挂在会话或作业上 —— 分四次定会让前三次不得不猜第四次的形状,
 * 而猜错的部分要么将来破坏性变更,要么一直别扭下去。
 *
 * ## 实现分期,契约不分期
 *
 * 与 V0.2.0 的 Admin API 同款:未实现的端点返回 **501 而非 404**,
 * 配 `x-dshwar-status: planned` 与响应头 `x-dshwar-planned-version`。
 * 404 会让第三方以为路径写错、去猜别的路径;501 说的是
 * 「这个端点是真的,只是还没到」。
 *
 * @module @dshwar/api-contract/workbench
 */
import { z } from 'zod'
import { RequestIdField } from './common.ts'

// ---------------------------------------------------------------------------
// 工作区
// ---------------------------------------------------------------------------

/**
 * 工作区 —— **项目容器**,每用户多个,不跨用户共享。
 *
 * 语义定案见 `docs/DECISIONS/workspace-semantics.md`。三条里最有分量的是
 * 「不跨用户共享」:`userId` 那一段同时是凭据解析、配额归属、审计 actor
 * 的边界,共享工作区意味着这四样要各自重新定义。
 */
export const Workspace = z
  .object({
    /**
     * 工作区 id。**同时是路径的一段** —— `{root}/{tenantId}/{userId}/{id}`。
     *
     * ⚠️ 因此它受 `fs-tenant` 的路径白名单约束:非 `[A-Za-z0-9]` 开头的
     * 会被编码成不可读的哈希目录。服务端负责在建的时候就拒掉那种 id,
     * 而不是让运维在服务器上 `ls` 出一堆 `_h_69dddf…`。
     */
    id: z.string(),
    name: z.string(),
    /** 归属主体。跨主体访问一律 404。 */
    subjectId: z.string(),
    tenantId: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Workspace' })

export const CreateWorkspaceRequest = z
  .object({ name: z.string().min(1).max(200) })
  .meta({ id: 'CreateWorkspaceRequest' })

export const ListWorkspacesResponse = z
  .object({ data: z.array(Workspace), nextCursor: z.string().nullable(), ...RequestIdField })
  .meta({ id: 'ListWorkspacesResponse' })

export const GetWorkspaceResponse = z
  .object({ workspace: Workspace, ...RequestIdField })
  .meta({ id: 'GetWorkspaceResponse' })

// ---------------------------------------------------------------------------
// 产物
// ---------------------------------------------------------------------------

/**
 * 产物 —— **就是工作区里的文件**,没有独立模型。
 *
 * ## 为什么不引入独立产物模型
 *
 * 引入意味着要维护「文件系统里有什么」与「产物表里有什么」的一致性,
 * 而 **agent 随时在写文件**。两者必然漂,且漂的方向是固定的:
 * **产物表说有、文件已经没了** —— 用户点下载拿到 404,而列表里还挂着它。
 *
 * 直接读文件系统没有这个问题:它就是唯一事实。代价是列目录比查表慢,
 * 而那个代价可以用分页和缓存处理 —— 一致性问题不能。
 */
export const Deliverable = z
  .object({
    /** 相对工作区根的路径。`a/b/c.txt`,不含前导斜杠。 */
    path: z.string(),
    /** 字节数。 */
    size: z.number().int(),
    /** 目录还是文件。目录不可下载。 */
    kind: z.enum(['file', 'directory']),
    modifiedAt: z.iso.datetime(),
  })
  .meta({ id: 'Deliverable' })

export const ListDeliverablesResponse = z
  .object({ data: z.array(Deliverable), nextCursor: z.string().nullable(), ...RequestIdField })
  .meta({ id: 'ListDeliverablesResponse' })

// ---------------------------------------------------------------------------
// 作业
// ---------------------------------------------------------------------------

/**
 * 作业状态。
 *
 * ⚠️ **`interrupted` 与 `failed` 分开。** 前者是「承载它的进程没了」
 * (空闲回收、崩溃、重启),后者是「它自己跑错了」。
 * 合成一个的话,用户看到 failed 会去查自己的输入 —— 而实际上重试一次就好。
 */
export const JobStatus = z
  .enum(['queued', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled'])
  .meta({ id: 'JobStatus' })

/**
 * 作业 —— 一次可跨重启恢复的长任务。
 *
 * ## 状态外置到 DSHWAR 库,dsh 进程只作执行器
 *
 * 状态留在 dsh 进程里的话,进程一死作业就没了 —— 而**进程隔离档下进程本来
 * 就会被空闲回收**。那不是异常路径,是正常运行的一部分。
 */
export const Job = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    subjectId: z.string(),
    tenantId: z.string(),
    status: JobStatus,
    /** 人类可读的作业类型。服务端不解释它,只透传与索引。 */
    kind: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    /** 终态才有。`null` 表示还没结束。 */
    finishedAt: z.iso.datetime().nullable(),
    /**
     * 失败原因。**只有 `failed` / `interrupted` 才非空。**
     *
     * ⚠️ 不塞原始异常 —— 它可能带请求 URL 甚至凭据片段。凭 requestId 查日志。
     */
    error: z.string().nullable(),
  })
  .meta({ id: 'Job' })

export const CreateJobRequest = z
  .object({ workspaceId: z.string(), kind: z.string().min(1).max(100) })
  .meta({ id: 'CreateJobRequest' })

export const ListJobsResponse = z
  .object({ data: z.array(Job), nextCursor: z.string().nullable(), ...RequestIdField })
  .meta({ id: 'ListJobsResponse' })

export const GetJobResponse = z
  .object({ job: Job, ...RequestIdField })
  .meta({ id: 'GetJobResponse' })

// ---------------------------------------------------------------------------
// 附件
// ---------------------------------------------------------------------------

/**
 * 附件 —— 用户上传的、不属于工作区产出的文件。
 *
 * ⚠️ **与产物是两回事,不要合并。** 产物是 agent 写出来的(工作区文件),
 * 附件是用户传进去的输入。两者的生命周期、权限、清理策略都不同:
 * 产物随工作区走,附件可能挂在一次会话上、会话结束就该回收。
 */
export const Attachment = z
  .object({
    id: z.string(),
    filename: z.string(),
    size: z.number().int(),
    contentType: z.string(),
    subjectId: z.string(),
    tenantId: z.string(),
    /** 挂在哪个会话上。`null` = 挂在租户级,不随会话回收。 */
    sessionId: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Attachment' })

export const ListAttachmentsResponse = z
  .object({ data: z.array(Attachment), nextCursor: z.string().nullable(), ...RequestIdField })
  .meta({ id: 'ListAttachmentsResponse' })

export const CreateAttachmentResponse = z
  .object({ attachment: Attachment, ...RequestIdField })
  .meta({ id: 'CreateAttachmentResponse' })

// ---------------------------------------------------------------------------
// 策略预授权
// ---------------------------------------------------------------------------

/**
 * 工作区的执行策略 —— **预授权,不是运行时弹窗**。
 *
 * ## 为什么不做运行时审批
 *
 * 上游 SDK 协议的 server→client 请求是**死能力**,交互式弹窗今天做不到。
 * 而且即使做得到,一个每次动作都要点「允许」的界面,用户三次之后就会
 * 无脑点允许 —— 那时审批只剩下摩擦,没有保护。
 *
 * 取而代之:在工作区设置里**事先**说清允许什么,**拒绝进审计**。
 *
 * ⚠️ 被拒绝的动作必须进审计,而不是静默失败 ——
 * 静默的拒绝会让用户以为是 bug,然后去想办法绕过它。
 */
export const WorkspacePolicy = z
  .object({
    workspaceId: z.string(),
    /** 允许的工具名。空数组 = 全部禁止(**不是全部允许**)。 */
    allowedTools: z.array(z.string()),
    /** 允许写入的路径前缀,相对工作区根。空数组 = 只读。 */
    writablePaths: z.array(z.string()),
    /** 允许访问的网络主机。空数组 = 断网。 */
    allowedHosts: z.array(z.string()),
    /** 允许执行 shell。默认 `false` —— 这是最危险的一个,默认必须是关的。 */
    allowShell: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'WorkspacePolicy' })

export const GetWorkspacePolicyResponse = z
  .object({ policy: WorkspacePolicy, ...RequestIdField })
  .meta({ id: 'GetWorkspacePolicyResponse' })

export const UpdateWorkspacePolicyRequest = z
  .object({
    allowedTools: z.array(z.string()).optional(),
    writablePaths: z.array(z.string()).optional(),
    allowedHosts: z.array(z.string()).optional(),
    allowShell: z.boolean().optional(),
  })
  .meta({ id: 'UpdateWorkspacePolicyRequest' })
