---
'@dshwar/sdk': minor
'@dshwar/gateway': minor
---

TypeScript SDK:类型由 OpenAPI 生成,不手写

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
