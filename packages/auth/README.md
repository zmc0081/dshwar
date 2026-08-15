# @dshwar/auth

> 认证契约:**拿一个已经存在的凭证,换出一个 `Principal`**。

```ts
const principal = await ctx.auth.verify(bearerToken)
const sessionCtx = withPrincipal(ctx, principal)
```

## 契约边界 —— 本包只做验证与映射

**永不**做这三件事(CLAUDE.md 硬规则 4):

| 不做               | 谁做                                                 |
| ------------------ | ---------------------------------------------------- |
| 存储密码           | 身份提供方(Keycloak / Casdoor / Authentik / Entra …) |
| 签发身份令牌       | 同上                                                 |
| 实现注册与找回流程 | 同上                                                 |

**这条边界决定了 DSHWAR 与 Keycloak 之流是集成关系而非竞争关系。**

不是为了少写代码。IdP 是一个需要长期安全投入的品类:密码哈希参数要跟着算力演进、
MFA 要跟标准、账号恢复是社会工程学的主战场、合规认证要按年过。做租户治理的产品
顺手做 IdP,等于给自己领一份永久的安全责任 —— 而客户的安全团队会立刻问
「你们的密码策略过审了吗」,那时唯一正确的答案是「我们不存密码」。

## `AuthError` 不携带失败原因

没有 `code`、没有 `reason`、没有 `cause`,消息固定。构造函数**不接受任何参数** ——
留一个 `message` 形参,下一个人就会往里塞 `"token expired"`。

认证接口天然是预言机。区分「token 不存在」/「已过期」/「租户不匹配」,
等于给攻击者一支探针:先枚举出哪些 token 真实存在,再针对性攻击。

诊断信息去日志与审计,不进错误对象 —— 一条朝内可详尽,一条朝外必须沉默。

## 实现方

| 包                    | 场景                                 | 版本   |
| --------------------- | ------------------------------------ | ------ |
| `@dshwar/auth-static` | 开发与测试,零外部依赖                | V0.1.0 |
| `@dshwar/auth-jwt`    | 自签 JWT / JWKS                      | V0.3.0 |
| `@dshwar/auth-oidc`   | Keycloak / Authentik / Logto / Auth0 | V0.3.0 |

## 许可

MIT
