# @dshwar/credentials-multiuser

> per-principal 凭据解析。**这是整个项目论点最直接的证明。**

换掉一个实现,所有 LLM 适配器、工具、插件自动变成多用户 —— 它们仍然调
`ctx.credentials.resolve(ref)`,一行都不用改。

跑一遍 [`examples/minimal-server`](../../examples/minimal-server) 就能看到:

```
dev-alice  → called model with sk-alice-XXXX (source: principal:alice-e6f1)
dev-bob    → called model with sk-bob-YYYY (source: principal:bob-a2b3)
(匿名)      → (no credential available)
```

消费方 `callModel()` 完全不知道 principal 存在。

## 用法

```ts
await ctx.plugin(PrincipalService)
await ctx.plugin(MultiuserCredentials, { store })

await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF)) // → alice 的 key
await runWithPrincipal(ctx, bob, (c) => c.credentials.resolve(REF)) // → bob 的 key
```

## 三条不可动摇的语义

**1. 每次操作现场解析,绝不跨操作缓存。** 上游 `dsh-credentials` 的契约明文要求。
本实现每次都重新读 `ctx.principal.current()` 与 store —— 缓存任何一层,
下一个用户就会拿到上一个用户的 key。

**2. 空值等同缺失。** `resolve` 跳过,`describe` 报 unconfigured。
一个空白绝不能冒充已配置的密钥。

**3. 匿名 fail closed(硬规则 6)。** 不回退默认值、不回退共享 key、不读环境变量。

> 若匿名能拿到运营方的 key,一个配错的 profile 会让所有匿名请求都用运营方的钱跑 ——
> 而这个事故的表现形式是「一切正常」,直到月底看到账单。让它当场解析不到,
> 报错会指向配置,而不是指向财务。

## `describe` 永不返回值(硬规则 5)

返回体只有 `configured` / `source` / `writable`。这是上游 `CredentialInfo` 的既有形状,
DSHWAR 原样传递,不做扩展。配置界面据此渲染「已配置 / 来自何处 / 能否修改」,
而看不到密钥本身。

## shadow 遮蔽 —— 用户永不持有 provider key

运营方持一把上游 key,按 principal 换发 scoped token:

```ts
await ctx.plugin(MultiuserCredentials, {
  store,
  shadow: async (principal, ref) =>
    ref === API_KEY ? { value: await mintScopedToken(principal) } : undefined,
})
```

被遮蔽的 ref:

| 操作            | 行为                                            |
| --------------- | ----------------------------------------------- |
| `resolve`       | 返回网关值,`source` 标为 `gateway-scoped-token` |
| `describe`      | `configured: true`,**`writable: false`**        |
| `set` / `unset` | **抛错**                                        |

写入必须拒绝而不是静默忽略:否则写会看起来成功,而 `resolve` 仍返回遮蔽值 ——
用户会反复保存、反复"失败",却看不到任何错误。

遮蔽值为空时视为不遮蔽,回落到用户自己的凭据 —— 一个配错的空 token 若能生效,
症状会是「我明明配了 key 却解析不到」。

## 存储

`PrincipalCredentialStore` 只有三个方法(`get` / `put` / `remove`),实现者可用
Postgres / Vault / KMS / 云厂商 Secret Manager。本包**不做持久化实现** ——
「凭据存哪儿」是采用者的合规决定,企业往往已有一套密钥托管,再塞一套是负担。

`InMemoryPrincipalCredentialStore` 仅供测试与本地开发,进程重启即丢。

## 许可

MIT
