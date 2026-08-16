---
'@dshwar/api-contract': minor
---

契约冻结:把「契约不能随便改」变成机制

- `diffContract()` / `breakingChanges()` 落在契约包里而非某个构建脚本里 ——
  「哪种改动算破坏性」是契约的语义,不是工具的实现细节。18 个单测覆盖两个方向:
  破坏性必须红、相容必须绿。一条只会说「红」的规则和一条只会说「绿」的规则一样没用。
- `pnpm check:contract` 拿**上一次提交里的 OpenAPI** 做基线,而不是仓库里另存的
  快照文件。另存快照行不通:改契约的人必然顺手更新快照,检查恒绿。
- 破坏性变更的放行条件是一份点名 `@dshwar/api-contract` 的 `major` changeset ——
  它同时满足「显式声明」(躺在 PR diff 里)与「升大版」两个要求。
- **给闭集枚举加值判为破坏性。** 错误码定成 `z.enum` 就是为了让下游写出可穷举的
  `switch`;多一个值,已写全的 `switch` 立刻编译失败。这是设计后果,不是判定过严。
- CI 里契约冻结单独成 job,用 `fetch-depth: 0` —— 浅克隆取不到基线,
  检查会变成「跳过」而不是「通过」。

其余交付:

- `profiles/gateway.yml`:= `team.yml` + 驱动 agent 的三个上游插件。
  身份与隔离部分与 `team.yml` 逐行相同,由 profile-parity 测试断言差异集。
- `docs/DEPLOYMENT.md`:拓扑、两种令牌、反向代理必须改的默认值(关缓冲、调长超时、
  透传 `Last-Event-ID`)、断线续传、隔离边界。
- README 新增 API 平面一节与 SDK 快速上手;兼容矩阵加 API 契约版本列。
