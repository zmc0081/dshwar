---
'@dshwar/storage-scoped': minor
---

新增 `@dshwar/storage-scoped` —— 租户维度的存储作用域。

R7 待确认项**已否决**:上游 `storage-domain` 的 `domain` 不能承载 tenantId
(schema 命名空间、单名单开、静态路由),评估见 `docs/DECISIONS/storage-scoping.md`。

- 记录键加**长度前缀** `<len>:<scope><key>`,而非分隔符 —— 上游契约写明键内容
  完全由调用方控制,任何分隔符都可被伪造
- `loadAll` 按前缀过滤并剥掉前缀,上层看到的是只有自己数据的普通 KV
- 作用域在 `open()` 时定格(上游存储句柄按契约长命,方法不接受上下文参数)
- `setGlobal` 直接拒绝:unit 级单例槽位没有键可加前缀
- 记录 `session-query-sqlite` 的跨租户风险与 `session-persistence-jsonl` 的自动隔离
