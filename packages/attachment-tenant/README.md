# @dshwar/attachment-tenant

附件的租户隔离存储 —— 路径按 `tenant/subject/workspace` 钉死,复用 `fs-tenant` 的编码规则。

**它不是一个通用对象存储**:路径由 principal 推导,调用方给不出越界的路径。

**依赖**:`@dshwar/fs-tenant` · `@dshwar/principal`

**完整文档**:仓库 README 的「计量与治理」一节 —— <https://github.com/zmc0081/dshwar#readme>

> 这份 README 刻意只有几行。完整说明在仓库 README,重复一份只会分家 ——
> 而分家的那一刻是静默的。

MIT。
