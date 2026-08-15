# @dshwar/auth-static

> 配置声明的 token → principal 映射。

## 🚫 禁止部署

**token 是明文配置。** 构造时会打一行警告说这件事,`quiet: true` 只该出现在测试里。

它存在的意义只有两个:

1. 让 `git clone && pnpm dev` **零外部依赖**就能跑通 —— 这是新贡献者的第一印象。
   要求别人先架一套 Keycloak 才能看到项目跑起来,大多数人会直接关掉标签页。
2. 当**全部契约测试的 fixture** —— 测试需要一个行为完全确定、不依赖网络、
   不需要时钟的认证实现。

生产请用 `@dshwar/auth-jwt` 或 `@dshwar/auth-oidc`(V0.3.0)。

## 用法

```ts
await ctx.plugin(StaticAuth, {
  entries: [
    { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] },
    { token: 'dev-bob', id: 'bob-a2b3', tenantId: 'globex' },
  ],
})

await ctx.auth.verify('dev-alice') // → alice
await ctx.auth.verify('nope') // → 抛 AuthError
```

## 配置错误在**启动时**炸

构造阶段就拒绝,而不是等到运行时:

| 配置                      | 结果                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| 重复 token                | 抛错。静默覆盖会让「我明明配了 alice,怎么登进去是 bob」变成一个查半天的谜 |
| 空 token                  | 抛错                                                                      |
| 邮箱形状的 `id`           | 抛错(经 `createPrincipal`)                                                |
| 带路径分隔符的 `tenantId` | 抛错(同上)                                                                |
| 映射到匿名主体            | 抛错。症状会是「登录成功但什么都读不到」,现场离根因十万八千里             |

## 许可

MIT
