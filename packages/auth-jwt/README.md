# @dshwar/auth-jwt

用 JWKS 验签的 `Auth` 实现。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 验签通过 ≠ 放行

**这是本包最重要的一句话。** 一个签名有效、尚未过期的 token,仍然可能属于一个
**已经被停用**的用户 —— IdP 侧停用不会让已签发的 token 失效,它只是不再签发新的。

每次 `verify()` 走完三步,缺一不可:

```
① 验签与标准声明（iss / aud / exp / nbf）
② 查 Subject Mirror：不存在或 active:false → 拒绝   ★ V0.3.0 的验收标准
③ 由 tenant-map 裁决租户，不直接信 token 里的租户字段
```

第 ③ 步的理由:token 里的 `tenant` 字段是**签发方**说了算的。多 IdP 并存时,
B 家的 IdP 可以往自己签的 token 里写 `tenant: acme`。租户归属必须由 DSHWAR 的
映射配置裁决,而不是由 token 自称。

镜像里的租户与本次裁决**不一致**时直接拒绝,而不是选一边 —— 两条路径对同一个人
给出不同归属,选任何一边都是猜,而猜错的后果是跨租户可见。

## 用

```ts
import { JwtAuth } from '@dshwar/auth-jwt'

await ctx.plugin(JwtAuth, {
  issuer: 'https://idp.acme.example',
  audience: 'dshwar',
  jwksUri: 'https://idp.acme.example/jwks',
  source: 'acme-idp', // 这个 IdP 在 Subject Mirror 里的标识
  subjects: subjectStore,
  tenantMap: { strategy: 'claim', claim: 'org_id' },
  onFailure: (detail) => logger.warn(detail),
})
```

## 算法:不给 alg 混淆留缝

**只接受非对称算法**(RS256/384/512、ES256/384/512)。

JWKS 分发的是**公钥**。一旦允许 HS256 之流,攻击者就能拿那把公开的公钥当 HMAC
密钥伪造 token —— 这是经典的 alg 混淆,出过多次真实 CVE。传入对称算法会在
**构造时直接抛错**,不是运行时才发现。

用了 `jose` 不等于安全:必须显式把允许的算法钉死,否则 alg 混淆照样成立。
这里钉死了,并有测试用真实 HMAC 伪造 token 证明它被拒。

## 错误不携带原因

`AuthError` 没有 `code`、没有 `reason`,消息固定一句 —— 无论是过期、错 aud、
还是这个人根本没被供给过来,调用方拿到的错误**一模一样**。

区分失败原因等于给攻击者一支探针:先枚举出哪些 sub 真实存在,再针对性攻击。

诊断信息走 `onFailure` 回调:朝内、可详尽;错误对象朝外、必须沉默。

## 时钟容差

默认 30 秒。**不是越大越宽容越好** —— 容差是攻击者可用的过期窗口。
30 秒足够覆盖正常的 NTP 漂移,再大就该去修时钟同步,而不是调这个值。

## JWKS 缓存与轮换

`kid` 未命中时刷新一次 JWKS,刷新后仍未命中即拒绝,并有 30 秒冷却 ——
没有冷却的话,一串伪造 `kid` 的请求就是一台对着 IdP 的放大器。

JWKS 端点连不上时**拒绝**,不 fail open。认证层 fail open 是灾难:
IdP 抖一下,全世界都能进来。

## 许可

MIT
