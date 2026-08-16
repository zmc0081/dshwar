---
'@dshwar/gateway': minor
---

新增 `@dshwar/gateway` —— API 平面服务骨架与会话路由。

- Hono,Web 标准;契约来自 `@dshwar/api-contract`
- 会话路由:Bearer → `ctx.auth.verify()` → `runWithPrincipal` 派生会话作用域,
  用 `runWithPrincipal` 而非 `withPrincipal`(后者按请求派生会累积隔离槽位)
- 令牌分离在中间件层:Admin Key 与 Bearer 互斥,同时提供也拒
- Admin Key 按租户签发,`AdminIdentity.tenantId` 是单值 —— 横跨租户在类型层写不出来
- `AuthError` 的「不携带原因」语义原样传递:五种失败输入响应体完全一致
- 错误边界挂 `app.onError()` 而非中间件(Hono 的 compose 自己 catch,
  写成中间件永远不触发)
