---
'@dshwar/api-contract': minor
'@dshwar/gateway': minor
'@dshwar/policy': minor
---

多工作区的连带影响面:契约、网关、配额

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
