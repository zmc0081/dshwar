---
'@dshwar/auth-oidc': minor
---

`@dshwar/auth-oidc`:填一个 issuer URL 即可接入 OIDC IdP

本包只把 discovery 文档解析成 `@dshwar/auth-jwt` 的配置,验签整个交给它 ——
两处验签逻辑里落后的那一处就是漏洞,验签只允许有一个实现。

- **算法协商只会变小**:取 discovery 声明的 ∩ 我们允许的。IdP 声明 HS256
  是它的事,我们不会因此接受;只声明对称算法的 IdP 直接拒绝启动。
- **issuer 一致性校验**(OIDC Discovery 1.0 §4.3):discovery 声明的与配置的
  不一致即拒绝 —— 那意味着配错了 URL,或者中间有人换掉了文档。
- **discovery 只在启动时拉一次**:它是配置,不是每请求数据。静默跟随变化的
  jwks_uri 意味着攻击者只要能改 discovery 就能换掉验签密钥。
- **缺字段立刻报错**:缺 jwks_uri 的配置永远无法验签,启动时说清楚比第一个
  用户登录时炸有用。`OidcDiscoveryError`(配置问题,带原因)与 `AuthError`
  (认证失败,不带原因)是两类错误。

18 个单测,含两条端到端:对着真实 discovery + JWKS 服务器完成认证、
停用后同一个 token 被拒 —— 只测拼装不测接合是最容易假绿的写法。
