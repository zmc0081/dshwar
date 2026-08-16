# @dshwar/policy

## 0.5.0

### Minor Changes

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

- Updated dependencies [c70833f]
  - @dshwar/metering@0.5.0
