# @dshwar/api-contract

> DSHWAR API v1 契约。★ **护城河本体。**

运行时插件可替换,控制面是标准 SaaS —— 只有这份契约是客户接进来之后**换不掉**的。

## 单一事实源

```
Zod schema  →  OpenAPI 3.1  →  SDK
```

**任何一处手写都会引入第二个事实源**,而两个事实源迟早分叉 ——
分叉的表现是客户按文档写的客户端在生产上炸掉。

```bash
pnpm --filter @dshwar/api-contract generate      # 重新生成 openapi.json
pnpm --filter @dshwar/api-contract lint:openapi  # redocly lint
```

`openapi.json` **提交进仓库**:`redocly lint` 与契约冻结检查(Session 6)需要一个
可 diff 的文件,第三方工具也可以直接指向它而不必先跑构建。
有一条测试逐字节比对提交的产物与当前 schema 的生成结果 —— 契约改了忘了重新生成,
CI 就会红。

`info.version` 取自本包 `package.json`,自动参与全仓版本一致性检查(`pnpm check:version`)。

## 与上游解耦 —— 事件词表是 DSHWAR 自己的

`ARCHITECTURE.md` §2.5:**v1 的稳定性承诺不依赖 dsh 版本**。

上游还在 rc,其 `SessionEventMap` 会变。1:1 透传等于把 v1 的稳定性外包给一个 rc 项目:
上游改一个事件名,我们要么被迫升 v2(客户接进来之后换不掉的那层被破坏),
要么在网关里长期维护一层翻译 —— 而后者正是这里做的事,区别只在**现在做还是被迫做**。

| 上游                                  | DSHWAR                              |
| ------------------------------------- | ----------------------------------- |
| `turn/start`                          | `turn.started`                      |
| `assistant/chunk` (`text-delta`)      | `message.delta`                     |
| `assistant/chunk` (`reasoning-delta`) | `reasoning.delta`                   |
| `assistant/message`                   | `message.completed`                 |
| `tool/call` · `tool/result`           | `tool.started` · `tool.completed`   |
| `step/*` · `request/*` · `todo/*`     | _(不透传 —— agent loop 的内部结构)_ |

## 三条钉死的约定

**1. 错误码是闭集。** SDK 可以穷举成联合类型,调用方 `switch` 时编译器能查漏。
**加错误码是破坏性变更** —— 已写好穷举的调用方会漏掉新分支。有测试钉住这个列表。

**2. 游标分页,不用 offset。** offset 在数据变动时会漏项与重项:翻到第 2 页时
第 1 页插入了一条,第 2 页首项就是刚看过的那条,而末尾那条被挤到第 3 页且永远
不会被看到。对「列出用量」「列出审计」这类持续追加的数据,这不是理论问题。

**3. 所有响应带 `requestId`。** 客户报障时给一个 id,运维就能在日志与审计里
精确定位那一次调用。没有它,排障要从「大概几点、大概什么操作」开始。

## 凭据端点:契约层就不给「值」留位置

`CredentialDescriptor` 只有 `ref` / `configured` / `source` / `writable`,
`additionalProperties: false`。

这是硬规则 5 在契约层的落点:不是「实现方记得别返回值」,而是**没地方放**。
实现方即便想泄漏,也要先改契约 —— 而改契约是有评审的。

有测试扫描 schema,断言不存在任何名字像「值」的字段(`value` / `secret` / `token` /
`lastFour` …)。一次「顺手多返回四位方便前端展示」就是泄漏的开始。

## planned 端点返回 501 而非 404

`subjects` / `quota` / `usage` / `policies` / `audit` 的**契约完整定下**,
但后端服务在 V0.3.0 与 V0.4.0 —— 本版本调用返回 501,响应头
`x-dshwar-planned-version` 指出计划版本,OpenAPI 里标 `x-dshwar-status: planned`。

404 会让第三方以为路径写错了,从而去猜别的路径;501 给出的是
「这个端点是真的,只是还没到」。

契约先行的理由:契约是换不掉的那一层,晚定一天成本高一天。而且定下来之后
Refine / Appsmith 现在就能吃 OpenAPI 生成后台骨架。

## SSE

```
id: 42
event: message.delta
data: {"type":"message.delta","turn":1,"text":"你好"}
```

- `id` 单调递增。V0.2.0 Session 0 实测:上游 session 事件自带单调 `seq`,直接映射
- 断线重连带 `Last-Event-ID` 请求头,服务端从该序号之后重放
- `reasoning.delta` **默认不发**,仅在会话创建时 `includeReasoning: true` 才出现

OpenAPI 没有描述 SSE 分帧的一等语法。这里按通行做法让 `text/event-stream` 的
schema 指向**单条事件**的载荷,由 description 说明分帧 —— SDK 生成器认这个形状。

## 许可

MIT
