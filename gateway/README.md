# @dshwar/gateway

> API 平面服务。Hono,Web 标准,可跑 Node 与边缘。

契约来自 [`@dshwar/api-contract`](../packages/api-contract)。

## 会话路由 —— 本包的核心

```
Bearer token → ctx.auth.verify() → Principal → runWithPrincipal → handler
```

此下所有插件按 principal 解析,**消费方零改动** —— 这是 V0.1.0 证明的那件事
在 HTTP 层的落点。

```ts
const app = createGateway({
  ctx, // 已装好 auth 与运行时插件的 cordis context
  adminKeys: new InMemoryAdminKeyResolver([...]),
  runtimeRoutes,
  adminRoutes,
})
```

网关**不负责组装 harness**。进程内要拼哪七个插件见
[`docs/FEASIBILITY-REPORT-V2.md`](../docs/FEASIBILITY-REPORT-V2.md) §4.2 ——
那是部署方 profile 的事,网关只消费一个装好的 `ctx`。

### ⚠️ 用 `runWithPrincipal`,不是 `withPrincipal`

V0.1.0 实测:`withPrincipal` 每次调用在 `ctx.reflect.store` 留下一个隔离槽位,
200 次调用积累 200 个。网关是长命进程、按请求派生 —— 用错这个函数,
内存会随请求数线性增长,**而且不报任何错**。

有一条测试跑 100 个请求后断言隔离槽位数**零增长**。

## 令牌分离在中间件层,不在 handler 里

| 令牌                            | 用途            | 端点             |
| ------------------------------- | --------------- | ---------------- |
| `Authorization: Bearer <token>` | 终端用户        | `/v1/sessions/*` |
| `X-DSHWAR-Admin-Key: <key>`     | 运维 / 供给系统 | `/v1/admin/*`    |

**两者互斥**:Admin Key 访问运行时端点被拒,反之亦然,同时提供也被拒
(不允许「哪个能过算哪个」)。

在 handler 里判断意味着每个 handler 都要记得判断,而漏掉一个的后果是
运维的 Admin Key 能冒充用户发起会话 —— 这种漏洞在评审里极难看出来,
因为它表现为「少写了一行」而不是「多写了一行错的」。

**Admin Key 按租户签发**,`AdminIdentity.tenantId` 是**单个值不是数组** ——
横跨租户在类型层就写不出来。跨租户操作返回 403。

## 认证失败:形状完全一致

`@dshwar/auth` 的 `AuthError` 刻意不携带失败原因(认证接口是预言机),
网关**原样传递**这个语义:无 token / 错 token / 空 token / 大小写不符,
一律 401 + 完全相同的响应体。

把它翻译成「token 不存在」「token 已过期」会让上游那层刻意的沉默白费。

## 错误边界挂 `onError`,不能写成中间件

Hono 的 `compose` 内部自己 try/catch 并把异常路由到 `onError`,异常**不会**
传回中间件的 `await next()`。写成中间件的话 catch 永远不触发,所有错误都退化成
Hono 默认的 500 纯文本,契约里的统一错误形状就此失效。

这是实测出来的:第一版写成中间件,11 条测试全红,症状是「响应体不是 JSON」。

## 明确不做

**不管 TLS。** 证书由反向代理终结。网关自己管证书意味着每个部署都要处理续期、
SNI、OCSP —— 那是反向代理已经做得很好的事,重做一遍只会做得更差。

**不做限流实现。** 契约里有 `rate_limited` 与 429,但判定逻辑属于
`@dshwar/policy`(V0.4.0)。这里只留位置。

## 许可

MIT
