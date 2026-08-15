---
'@dshwar/auth': minor
'@dshwar/auth-static': minor
---

新增认证契约与静态实现。

- `@dshwar/auth`:`Auth` 抽象类挂 `ctx.auth`,`verify(token) => Promise<Principal>`。
  `AuthError` 构造函数不接受任何参数,不携带 code / reason / cause —— 认证接口是
  预言机,区分失败原因等于给攻击者探针。
- `@dshwar/auth-static`:配置声明的 token 映射,构造时警告禁止部署(`quiet` 仅供测试)。
  重复 token、空 token、邮箱形状的 id、映射到匿名主体,一律在构造时拒绝。
