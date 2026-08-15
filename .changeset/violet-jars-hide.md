---
'@dshwar/fs-tenant': minor
---

新增 `@dshwar/fs-tenant` —— 工作区根按租户钉死,隔离的真实边界。

- 工作区根 `{root}/{tenantId}/{userId}`,每次操作现场计算
- 两道防线:字面层拦 `../`/绝对路径/UNC/盘符/空字节;realpath 层兜住符号链接
- 标识符编码:白名单内原样保留(运维可读),白名单外走 SHA-256 而非拒绝或转义
- 包装内层 `FileSystem` 而非重做 —— 上游 `fs-local` 明示 containment 应由
  「a stricter backend」实现
- 跨作用域传递的 `FsTarget` 会被拒绝(读与写都拦)
- 111 条测试:44 条纯路径逃逸 + 23 条对着真实 `fs-local` 的隔离与符号链接测试
