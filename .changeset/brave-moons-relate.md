---
'@dshwar/credentials-multiuser': minor
---

新增 `@dshwar/credentials-multiuser` —— per-principal 凭据解析,项目论点最直接的证明。

- 继承上游 `CredentialProvider`,实现 `resolve` / `describe` / `set` / `unset` 四方法
- 匿名 fail closed:解析返回 `undefined`,写入抛错,不回退默认值/共享 key/环境变量
- `describe` 只暴露 `configured` / `source` / `writable`,永不返回值
- shadow 遮蔽:网关按 principal 换发短时效 token,被遮蔽的 ref 只读,`set`/`unset` 抛错
- `PrincipalCredentialStore` 三方法接口,实现者可接 Postgres / Vault / KMS;
  本包只提供内存实现供测试
- `set`/`unset` 后 `notifyUpdated`,变更在下一次操作即生效
