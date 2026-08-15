---
'@dshwar/principal': minor
---

新增 `@dshwar/principal` —— principal 传播,DSHWAR 引入的唯一新概念。

- `Principal` 类型(id / tenantId / roles / claims 全部 readonly,实例冻结)
- `createPrincipal` 构造并校验:拒绝邮箱形状的 id、路径分隔符、控制字符、首尾空白
- `ANONYMOUS` 常量,`tenantId` 取 `'anonymous'` 而非空串,避免在路径与键前缀里塌陷成无前缀
- `PrincipalService` 注册为 `ctx.principal`,`current()` 永不返回 undefined
- `withPrincipal` 派生会话作用域;`runWithPrincipal` 回调式,结束即释放隔离槽位
