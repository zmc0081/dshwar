# @dshwar/api-contract

## 0.5.0

### Minor Changes

- d877523: 新增 `@dshwar/api-contract` —— DSHWAR API v1 契约,本版本的护城河本体。
  
  - Zod 4 为单一事实源,OpenAPI 3.1 由 `z.toJSONSchema` 生成,不引第三方转换器
  - 命名 schema 走 `components/schemas` 引用而非逐处内联
  - 运行时 API:`/v1/sessions` 创建/列出/查询/发起一轮/SSE 流式/取消
  - Admin API 契约完整定下,`credentials` 本版本实现,其余标 `x-dshwar-status: planned` 返回 501
  - 错误码闭集、游标分页、所有响应带 requestId —— 决定第三方后台能否自动生成
  - SSE 事件词表由 DSHWAR 定义(点式命名),不 1:1 透传上游斜杠式词表
  - `reasoning.delta` 默认关,按会话 `includeReasoning` opt-in
  - `info.version` 纳入全仓版本一致性检查
- 4a985d8: 契约冻结:把「契约不能随便改」变成机制
  
  - `diffContract()` / `breakingChanges()` 落在契约包里而非某个构建脚本里 ——
    「哪种改动算破坏性」是契约的语义,不是工具的实现细节。18 个单测覆盖两个方向:
    破坏性必须红、相容必须绿。一条只会说「红」的规则和一条只会说「绿」的规则一样没用。
  - `pnpm check:contract` 拿**上一次提交里的 OpenAPI** 做基线,而不是仓库里另存的
    快照文件。另存快照行不通:改契约的人必然顺手更新快照,检查恒绿。
  - 破坏性变更的放行条件是一份点名 `@dshwar/api-contract` 的 `major` changeset ——
    它同时满足「显式声明」(躺在 PR diff 里)与「升大版」两个要求。
  - **给闭集枚举加值判为破坏性。** 错误码定成 `z.enum` 就是为了让下游写出可穷举的
    `switch`;多一个值,已写全的 `switch` 立刻编译失败。这是设计后果,不是判定过严。
  - CI 里契约冻结单独成 job,用 `fetch-depth: 0` —— 浅克隆取不到基线,
    检查会变成「跳过」而不是「通过」。
  
  其余交付:
  
  - `profiles/gateway.yml`:= `team.yml` + 驱动 agent 的三个上游插件。
    身份与隔离部分与 `team.yml` 逐行相同,由 profile-parity 测试断言差异集。
  - `docs/DEPLOYMENT.md`:拓扑、两种令牌、反向代理必须改的默认值(关缓冲、调长超时、
    透传 `Last-Event-ID`)、断线续传、隔离边界。
  - README 新增 API 平面一节与 SDK 快速上手;兼容矩阵加 API 契约版本列。
- 6712a70: 多工作区的连带影响面:契约、网关、配额
  
  **两份决策文档**(任务书要求「先评估再决定」的两项):
  
  - `docs/DECISIONS/storage-workspace-scoping.md`(R5)—— **结论:不加**。
    storage 的键对我们不透明,一刀切会把用户级数据也切开;同一用户的两个工作区
    之间不是信任边界;且作用域在 `open()` 时定格,那时还没有请求作用域。
    将来真有需要时用 per-unit 的 opt-in,不用一刀切。**不为对称而加。**
  - `docs/DECISIONS/workspace-in-api.md`(R6)—— **选项 A′**:只在建会话时传一次,
    此后由会话 id 承载。不选路径段(会话不是工作区的子资源,且废弃旧路径是破坏性
    变更);不选纯查询参数(每个端点都要带,漏带一次就静默落到 default)。
  
  **契约兼容性声明已被实测证实**(风险 11 至此降级为已处置):
  
  ```
  差异: 破坏性 0 处,相容 2 处
    相容  [property.added] Session.workspaceId              新增可选字段
    相容  [property.added] CreateSessionRequest.workspaceId 新增可选字段
  ```
  
  `Session.workspaceId` **必须可选** —— 语义上恒有值,但进 `required` 会让老客户端
  响应校验失败,那是破坏性变更。可选但恒有值是 API 兼容演进的标准做法。
  
  其余:
  
  - 会话簿记 `workspaceId`,与 `subjectId` 同级 —— 它是归属信息不是可选标签。
  - `GET /v1/sessions?workspaceId=` 可选过滤,省略即返回全部(R2 在 API 层的延续)。
  - `@dshwar/policy` 加工作区配额(R7):数量与容量两条上限,与 token 配额同一套
    allow/deny 形状、同样的「未设置即不限」。**但刻意不 fail open** ——
    数据源不同:token 用量来自可能挂掉的 metering,工作区数来自调用方现场统计,
    读不到就是调用方的 bug,不该伪装成「计量暂时不可用」。
  
  **R3 / R4 与任务书假设不符,据实处理**:`attachment-local` 与 `session-query`
  在本仓从未接入、上游包也没安装,没有可改的东西。`session-persistence-jsonl`
  按目录存储,接 `fs-tenant` 后随工作区自动分层,无需额外处理 ——
  这一条 `storage-scoping.md` 早已记录。详见 Session 1 的报告。

### Patch Changes

- cabfdce: 网关接入 SCIM,三类令牌彻底分开;/v1/admin/subjects 由 501 转实现
  
  三类令牌:运行时 token(终端用户)· Admin Key(按租户)· SCIM token(按身份源)。
  互斥由各自的中间件保证,并有五条负向测试钉住:SCIM token 打 /v1/* 401、
  运行时 token 与 Admin Key 打 /scim/* 401、别的身份源的 SCIM token 打本挂载点
  401 且与无效 token 不可区分 —— 区分它们等于告诉拿到 token 的人这把钥匙在别处有效。
  
  - SCIM 挂 /scim/v2,不占用 /v1/:SCIM 有自己的错误格式与版本节奏。
    鉴权失败返回 SCIM 自己的错误格式 —— 读它的是供给方的同步引擎。
  - ScimTokenResolver 与 AdminKeyResolver 同构但刻意不复用同一个接口:
    复用意味着一把钥匙可以同时出现在两张表里,而分离签发正是要杜绝这件事。
  - /v1/admin/subjects 与 /v1/admin/subjects/{id} 转实现,check:contract 确认
    planned → implemented 不构成契约变更;契约里这两个端点不再声明 501
    (与 credentials 端点的写法一致)。列表端点在查询层就按租户圈死 ——
    它不接收 subjectId,没有 assertTenant 可挂,是最容易漏的一处。
  - 网关对 @dshwar/subject 只依赖一个结构性只读子集(SubjectMirrorReader),
    未配置镜像的部署回落 501,不强迫拉进整个包。
  - server.ts:静态令牌表的用户也进镜像,SCIM 推进来的用户与静态用户走同一张表。
  
  修一处只有真跑才暴露的错:把中文塞进 x-dshwar-planned-version 响应头会直接抛
  (头部值不允许非 ASCII)—— 版本号进头,解释进正文。
- 227ae36: `@dshwar/audit`:仅追加审计;`/v1/admin/audit` 由 501 转实现
  
  - AuditStore 只有 append 与 query,**没有 update 没有 delete** —— 类型层就
    写不出修改,且有结构断言钉住。改得掉的审计等于没有审计:出事后第一个想改
    记录的人恰恰是有权限改的那个。KV 实现声明的存储接口子集连 deleteRecord
    都不含。
  - query 的 tenantId 是强制参数:做成可选,总有一天有人忘了传,那次查询
    返回的就是全部客户的操作史。端点侧租户由 Admin Key 决定,不接受参数指定。
  - id 由 store 生成(零填充单调序号,字典序=追加序);KV 实现重启后续号,
    游标分页不断裂。
  - 网关 StoreAuditSink:追加失败不抛(审计是治理组件不是安全闸门),
    退化到 console 兜底。
  - /v1/admin/audit 转正,check:contract 确认零契约变更;线上形状是契约
    AuditEntry 的八个字段,tenantId 是过滤键不上线。审计链闭环有测试:
    Admin 操作产生的审计能从审计端点自己查回来。
  
  19 个单测(包 14 + 网关 5)。
- c70833f: `@dshwar/metering`:用量归属;usage 两端点由 501 转实现
  
  - 采集挂在会话簿的 session/event 监听上(REPORT-V4 实测的信道:上游把用量
    随 assistant/message 一起发,没有独立用量流),挂在翻译之前 ——
    该事件不在对外词表里,但正是携带用量的那个。
  - **红线 1 观测不阻断**,两层兜底都有测试:safeRecord 吞掉 store 异常交给
    失败回调;连回调炸了也不向上抛。端到端测试用必炸的 store 证明一轮照常跑完。
  - **计费口径只有一处**:billedInputTokens 实现 DISJOINT 加法
    (input + cacheRead + cacheWrite),直接用 inputTokens 会少计费,
    聚合与配额取数都从它走。
  - 缺席容忍:适配器没报用量计 0 标 unreported,不估算 —— 估算值混进账目
    比缺口更难审。测试 harness 的假适配器恰好不发 usage,正好覆盖这条路径。
  - 会计恒等式有测试:聚合行 token 总和 = 明细逐条相加。
  - 成本整数分、桶级一次舍入;查不到价计 0(是「没配价」不是「免费」,
    README 加粗警告)。
  - /v1/admin/usage 与 /v1/admin/subjects/{id}/usage 转正,check:contract
    零变更;行形状为契约 UsageRecord 九字段,不多不少。
  
  23 个新单测,全仓 543 绿。
- 0b3557b: `@dshwar/policy`:配额判定;quota 两端点转正;网关发轮前置 429
  
  - 判定与执行分离(红线 2):包内没有任何 HTTP 概念,deny 由网关翻成
    429 rate_limited,判定逻辑可被控制平面原样复用。
  - **fail open,理由写死在文档里**:计量是账目组件不是安全组件,读不到账就
    拒绝等于把计量故障升级成全员服务中断;放行的代价只是几轮没被限额,
    账目可从审计补。与身份层 fail closed(硬规则 6)方向相反、互不冲突 ——
    保护的东西不同。不限流的主体连 metering 都不读,有测试证明 metering
    全挂时它们不受影响。
  - deny 只有 quota_exhausted 一种,类型层可穷举(红线 3):降级是
    model-router 的显式配置,本包永远不回答「换个便宜模型继续」。
  - 余额不缓存:tokenUsed 每次判定现算。端到端测试:烧完配额下一轮 429,
    PATCH 提额后立即恢复 —— 缓存的余额会让「提额」变成「提额并等缓存过期」。
  - 周期为 UTC 自然月,上周期用量不计入,可注入 BillingPeriod 换合同周期。
  - PATCH 的变更进审计,before/after 都在 ——「谁在什么时候把限额从多少改到
    多少」是账务纠纷时的第一个问题。
  - quota GET/PATCH 转正,check:contract 零变更;planned 只剩 policies。
  
  20 个新单测。
- 31aff31: `@dshwar/model-router`:模型准入与预算降级;policies 端点转正,planned 清零
  
  - 裁决不路由:只在 createAgent 入口回答「许不许用、用哪个」,交回上游。
  - 准入 opt-in:没配策略默认放行 —— 默认封锁会让治理变成「上来先配全通」的仪式。
    清单外 403 不静默换;空清单 = 全部允许(契约语义)。
  - 降级显式且三处可见(红线 3),端到端逐一断言:响应头
    x-dshwar-model-downgraded、会话记录用裁决后的模型(计量要对上真正在跑的)、
    审计 model.downgraded 带 before/after。
  - 边界:没配 fallback 超阈值不降级(超限走 429);预算水位未知不降级
    (依据必须是真数);降级目标配成清单外 → 拒绝(先准入后降级)。
  - /v1/admin/policies 转正(只读;写入口留给控制平面的审批流)。
    **契约里 planned 至此清零** —— v1 定义的每个端点都有实现,有测试钉住;
    「planned 端点」测试块换代为「部署级降级回落 501」,机制保留数据清空。
  
  17 个新单测。
