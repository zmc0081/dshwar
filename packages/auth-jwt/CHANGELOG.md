# @dshwar/auth-jwt

## 0.5.0

### Minor Changes

- bf3d0bf: `@dshwar/auth-jwt`:JWKS 验签,且验签通过 ≠ 放行
  
  一个签名有效、尚未过期的 token,仍可能属于**已被停用**的用户 ——
  IdP 侧停用不会让已签发的 token 失效。所以 `verify()` 走三步:
  验签与标准声明 → 查 Subject Mirror 的停用态 → 由 tenant-map 裁决租户。
  
  第二步就是 V0.3.0 验收标准「身份源侧停用后下次请求被拒」的落点,
  测试用同一个 token 在停用前后各跑一次证明它。
  
  安全上的几处刻意选择:
  
  - **只接受非对称算法**,传入对称算法在**构造时**抛错。JWKS 分发的是公钥,
    允许 HMAC 等于让攻击者拿公钥伪造 token(alg 混淆)。有测试用真实 HMAC
    伪造 token 证明它被拒,以及 alg:none 被拒。
  - **租户由映射裁决,不信 token 自称**。多 IdP 并存时,B 家可以往自己签的 token 里
    写 `tenant: acme`。镜像与裁决冲突时拒绝而不是选一边 —— 选任何一边都是猜,
    猜错的后果是跨租户可见。
  - **错误不携带原因**。过期、错 aud、这个人没被供给过来 —— 调用方拿到的错误
    一模一样,有测试断言四种失败产生的错误集合大小为 1。区分原因等于给攻击者探针。
  - **JWKS 连不上时拒绝,不 fail open**。认证层 fail open 是灾难。
  - **kid 未命中刷新一次并带 30 秒冷却**,否则一串伪造 kid 的请求就是对着 IdP 的放大器。
  
  23 个单测,用真实密钥对与本地 JWKS 服务器跑,不 mock 验签也不 mock 网络 ——
  mock 掉验签之后「验签是对的」这句话就没被证明过。

### Patch Changes

- Updated dependencies [fcd7396]
- Updated dependencies [9fc2e21]
  - @dshwar/subject@0.5.0
  - @dshwar/tenant-map@0.5.0
  - @dshwar/auth@0.5.0
  - @dshwar/principal@0.5.0
