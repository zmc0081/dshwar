---
'@dshwar/audit': minor
'@dshwar/gateway': minor
'@dshwar/api-contract': patch
---

`@dshwar/audit`:仅追加审计;`/v1/admin/audit` 由 501 转实现

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
