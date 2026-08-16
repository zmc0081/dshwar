---
'@dshwar/gateway': minor
---

运行时 API 与 SSE —— 第三方仅凭 HTTP 就能完成一次完整会话。

- `/v1/sessions` 创建/列出/查询/发起一轮/SSE 流式/取消并释放
- 会话归属 principal,跨 principal 一律 404(不是 403 —— 403 会泄漏 id 存在性),
  且与「不存在」的响应完全一致
- 上游事件 → DSHWAR 契约词表的翻译层,`step/*` 与 `request/*` 刻意不透传
- SSE 带单调 `id`,支持 `Last-Event-ID` 断线续传;有界事件缓冲避免长连接 OOM
- 断连即移除订阅(有度量测试,不靠肉眼);DELETE 先 `cancel()` 截断再 `dispose()` 释放
- 端到端测试对着**真实上游 harness**跑,不是 mock
