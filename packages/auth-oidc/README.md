# @dshwar/auth-oidc

让部署方**只填一个 issuer URL** 就能接上 OIDC IdP。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 用

```ts
import { createOidcAuth } from '@dshwar/auth-oidc'

const auth = await createOidcAuth(ctx, {
  issuer: 'https://idp.acme.example/realms/acme', // 只需要这一个 URL
  audience: 'dshwar',
  source: 'acme-idp',
  subjects: subjectStore,
  tenantMap: { strategy: 'claim', claim: 'org_id' },
})
```

Keycloak、Authentik、Logto、Auth0 —— 任何标准 OIDC 提供方都是这一个写法。

## 它不重复实现验签

本包只把 discovery 文档解析成 [`@dshwar/auth-jwt`](../auth-jwt) 的配置,验签整个
交给它。反过来做很诱人:在这里再写一遍验签,"顺便"支持一些 discovery 里没有的
东西。那样会有**两处**验签逻辑,其中一处迟早落后于另一处 —— 落后的那一处就是漏洞。

**验签只允许有一个实现。**

## 三条安全性质

| 性质                           | 说明                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **算法协商只会变小**           | 取 discovery 声明的 ∩ 我们允许的。IdP 声明支持 HS256 是它的事,我们不会因此接受;IdP 只声明对称算法时直接拒绝启动                               |
| **issuer 一致性校验**          | discovery 声明的 issuer 必须与配置的完全一致(OIDC Discovery 1.0 §4.3)。不一致意味着配错了 URL,或者中间有人换掉了文档                          |
| **discovery 只在启动时拉一次** | 它是配置,不是每请求数据。IdP 换 jwks_uri 要重启进程 —— 这是刻意的:静默跟随一个变化的 jwks_uri,意味着攻击者只要能改 discovery 就能换掉验签密钥 |

## 缺字段立刻报错

discovery 缺 `jwks_uri` 意味着这套配置**永远无法验签**。在启动时说清楚,
比在第一个用户登录时抛一个绕了三层的错误有用得多。

`OidcDiscoveryError` 与 `AuthError` 是两类错误:前者是**配置问题**(带详细原因,
该修配置),后者是认证失败(刻意不带原因,见 auth-jwt 的说明)。

## 许可

MIT
