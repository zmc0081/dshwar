---
'@dshwar/api-contract': minor
---

新增 `@dshwar/api-contract` —— DSHWAR API v1 契约,本版本的护城河本体。

- Zod 4 为单一事实源,OpenAPI 3.1 由 `z.toJSONSchema` 生成,不引第三方转换器
- 命名 schema 走 `components/schemas` 引用而非逐处内联
- 运行时 API:`/v1/sessions` 创建/列出/查询/发起一轮/SSE 流式/取消
- Admin API 契约完整定下,`credentials` 本版本实现,其余标 `x-dshwar-status: planned` 返回 501
- 错误码闭集、游标分页、所有响应带 requestId —— 决定第三方后台能否自动生成
- SSE 事件词表由 DSHWAR 定义(点式命名),不 1:1 透传上游斜杠式词表
- `reasoning.delta` 默认关,按会话 `includeReasoning` opt-in
- `info.version` 纳入全仓版本一致性检查
