# @dshwar/gateway

## 0.5.0

### Minor Changes

- 95b86e0: 新增 `@dshwar/gateway` —— API 平面服务骨架与会话路由。
  
  - Hono,Web 标准;契约来自 `@dshwar/api-contract`
  - 会话路由:Bearer → `ctx.auth.verify()` → `runWithPrincipal` 派生会话作用域,
    用 `runWithPrincipal` 而非 `withPrincipal`(后者按请求派生会累积隔离槽位)
  - 令牌分离在中间件层:Admin Key 与 Bearer 互斥,同时提供也拒
  - Admin Key 按租户签发,`AdminIdentity.tenantId` 是单值 —— 横跨租户在类型层写不出来
  - `AuthError` 的「不携带原因」语义原样传递:五种失败输入响应体完全一致
  - 错误边界挂 `app.onError()` 而非中间件(Hono 的 compose 自己 catch,
    写成中间件永远不触发)
- 3d52ef5: 运行时 API 与 SSE —— 第三方仅凭 HTTP 就能完成一次完整会话。
  
  - `/v1/sessions` 创建/列出/查询/发起一轮/SSE 流式/取消并释放
  - 会话归属 principal,跨 principal 一律 404(不是 403 —— 403 会泄漏 id 存在性),
    且与「不存在」的响应完全一致
  - 上游事件 → DSHWAR 契约词表的翻译层,`step/*` 与 `request/*` 刻意不透传
  - SSE 带单调 `id`,支持 `Last-Event-ID` 断线续传;有界事件缓冲避免长连接 OOM
  - 断连即移除订阅(有度量测试,不靠肉眼);DELETE 先 `cancel()` 截断再 `dispose()` 释放
  - 端到端测试对着**真实上游 harness**跑,不是 mock
- ec65ec7: 网关可执行入口:`docs/DEPLOYMENT.md` 里那条启动命令终于有对应的文件了
  
  在此之前,唯一跑通过完整装配的地方是测试的 harness —— 部署文档写了启动命令,
  但仓库里没有能被它执行的东西。
  
  - `gateway/src/runtime.ts`:把 harness 的接线提升成产品代码。`createGateway()`
    仍然只消费一个装好的 ctx(那条边界要留着),装配是它旁边**另一个**模块。
  - `gateway/src/server.ts`:`startServer()` + CLI。配置只从一个 JSON 文件读,
    只有 `--port` / `--host` 能覆盖 —— 令牌散在环境变量里,轮换时没人知道该改哪几台机器。
    `--host` 默认 127.0.0.1,要对外必须显式传 0.0.0.0。
  - `GATEWAY_PLUGINS` 与 `profiles/gateway.yml` 的漂移由测试拦住:profile 里出现而
    装配里没有、又没写进 `DELIBERATELY_OMITTED` 的插件,测试直接红。三条默认不装的
    各自写明理由(node-pty 在 win32 抛错 / 用不到 / storage-scoped 根本不是根插件)。
  - 11 个单测,含起真实端口后的 401、200、Admin describe 不返回凭据值、跨租户 403。
  
  两处只有真跑起来才暴露的问题:
  
  - 端口回显的是配置值而非实际绑定结果,传 0 时拿到连不上的 URL
  - 入口守卫手拼 `file://${argv[1]}`,在 Windows 上少一个斜杠、非 ASCII 目录还会被
    百分号编码,于是 `node dist/server.js` 静默什么都不做。改用 `pathToFileURL`。
- afbf3c2: Admin API —— 契约完整,实现分期。
  
  - `/v1/admin/subjects/{id}/credentials` 调 `credentials.describe()`,
    只返回 configured / source / writable;显式列字段,上游哪天多返回一个也不会被透传
  - 在**目标主体的作用域内**查询 —— 不派生作用域会读到匿名,永远 unconfigured
  - 8 个 planned 端点返回 501(非 404)+ `x-dshwar-planned-version` 响应头,
    清单**从契约里读**而非手写(手写会漂移)
  - 跨租户 Admin Key 403,且被拒时不泄漏目标主体的任何凭据信息
  - 审计埋点:调用者 / 目标 / 变更前后;凭据类只记 describe 层面的事实,
    绝不记值(审计保留期比凭据轮换周期长得多)
  - 审计记录不含 Admin Key 本身,只有标签
- 107f1bd: TypeScript SDK:类型由 OpenAPI 生成,不手写
  
  - `sdk/typescript` 新包 `@dshwar/sdk`。`src/generated/schema.d.ts` 由
    `packages/api-contract/openapi.json` 生成并提交;测试重新生成一遍逐字节比对,
    契约改了而 SDK 没跟上即变红。生成与校验共用同一个渲染函数,避免两条代码路径
    的输出差一个换行就让校验永远红或永远绿。
  - `DshwarClient`(运行时)与 `DshwarAdminClient`(Admin)分开两个类 ——
    令牌不同,分开让「拿错令牌」在类型层就写不出来。
  - SSE 传输手写,但事件类型仍来自契约,`switch (event.type)` 能被编译器查漏。
    支持 `lastEventId` 断线续传与 `AbortSignal` 主动断开。
  - 错误码闭集映射为可穷举的联合类型,`DshwarErrorCode` 从生成的类型派生而非手写。
  - `examples/sdk-session`:只依赖 `@dshwar/sdk` 的完整会话示例(M2 验收)。
    依赖面由 `gateway/test/sdk-example.test.ts` 钉住,对着绑真实端口的 HTTP 网关跑通。
  
  修复网关的类型错误(此前未被 typecheck 覆盖):
  
  - `gateway/src/sessions/store.ts` 缺少上游 `session/event` 的模块增强导入
  - `gateway/src/admin/routes.ts` 缺少 `ctx.credentials` 的模块增强导入,
    planned 端点 handler 的类型表达式失效
  - 上游 `SessionEvent` 到网关自有信封的收窄集中到 `asUpstreamEvent()`
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
- 101f864: 治理链路串联与发布收尾
  
  - `server.ts` 一次接全四个治理包:审计、计量、配额、准入降级。
    `governance` 配置段整段可选 —— 不配就是「不计量、不限额、不管准入」。
  - 端到端(R9)`gateway/test/governance-e2e.test.ts` 六步单一叙事:
    设配额入审计 → 两轮烧到 200/250 → 水位 0.8 新会话被降级(三处可见)→
    烧穿后 429 → 用量可查且会计恒等 → 审计可查且 before/after 都在。
    验的是**环环相扣**:降级水位来自计量,429 判定来自计量,审计串起全部变更。
  - 文档:`docs/GOVERNANCE.md`(四条红线、DISJOINT 计费口径、fail open 的理由、
    价格表必须配全的警告);README 加计量与治理一节;
    `profiles/enterprise.yml` 加四个治理包;示例配置补 governance 段。
  
  **编译产物冒烟抓到两个测试没覆盖的接线 bug,均已修复并补回归测试:**
  
  1. **id 空间不一致**:Subject Mirror 的内部 id 由 `(source, externalId)` 派生,
     而 auth-static 的 principal id 是条目 id —— 运维查配额永远 404。
     两侧单测各自都绿,因为没有一个同时配了 subjectStore 与 quotaAdmin。
  2. **审计写 console 而端点读 store**:PATCH 配额成功,审计端点却永远是空的。
     改为同时写两处;SCIM 的审计同样接进 store,且 tenantId 从镜像查回来 ——
     写死 `'-'` 会让 SCIM 记录对每个租户都不可见,等于没记。
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

- fd01987: `@dshwar/webhooks`:出站投递 + V0.3.0 端到端验收
  
  - HMAC-SHA256 签名,时间戳参与签名(签名防篡改,时间窗防重发)。
    测试用 node:crypto 从头实现验证、不 import 本包代码 ——
    只有我们自己算得对的签名等于没有签名。恒定时间比较。
  - 重试指数退避,每次重试**重签**(复用首签会让重试在下游看来像重放)。
    重试耗尽落审计,不静默丢弃。端点互不拖累。
  - **明确不做投递保证**:那需要持久队列,属于控制平面(V0.5.0)。
    在库层伪装可靠性比明说「尽力而为」更糟 —— 进程一重启保证就静默蒸发。
    文档写明下游按最终一致设计,定期拉 /v1/admin/subjects 兜底。
  - 载荷只有 id 与元数据,没有用户资料:webhook 会经过下游的日志与代理。
  - scim-server 新增 onSubjectChange 事件(created/updated/deactivated),
    词表由 DSHWAR 定义,与供给方用 PUT 还是 PATCH 解耦。
  
  端到端验收(gateway/test/identity-e2e.test.ts):供给方推两个用户 → JWT 认证
  通过 → authentik 的 PUT 形状停用其一 → 同一个 token 下一次被拒 → 另一人不受
  影响 → webhook 出站且签名可独立验证 → Entra 的 PATCH 形状走完同一条链。
  authentik 容器版验收手册在 scripts/e2e-authentik.md(代码就绪待外部资源,
  它验证的增量只有 REPORT-V3 标 ⚠️ 的三条实测)。
- Updated dependencies [d877523]
- Updated dependencies [4a985d8]
- Updated dependencies [cabfdce]
- Updated dependencies [227ae36]
- Updated dependencies [c70833f]
- Updated dependencies [0b3557b]
- Updated dependencies [31aff31]
- Updated dependencies [0b5fe40]
- Updated dependencies [6712a70]
- Updated dependencies [2927766]
  - @dshwar/api-contract@0.5.0
  - @dshwar/audit@0.5.0
  - @dshwar/metering@0.5.0
  - @dshwar/policy@0.5.0
  - @dshwar/model-router@0.5.0
  - @dshwar/fs-tenant@0.5.0
  - @dshwar/auth@0.5.0
  - @dshwar/principal@0.5.0
