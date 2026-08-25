# @dshwar/billing-local

计费契约的本地实现 —— **只记账,不收款**。从 `@dshwar/metering` 的用量出账。

⚠️ **卖方未配置时拒绝出票**,不出一张署名为空的发票;查不到价的用量记为 `unpriced`,不是 0。

**依赖**:`@deepseek-ai/cordis` · `@dshwar/billing` · `@dshwar/metering`

**完整文档**:仓库 README 的「计量与治理」一节 —— <https://github.com/zmc0081/dshwar#readme>

> 这份 README 刻意只有几行。完整说明在仓库 README,重复一份只会分家 ——
> 而分家的那一刻是静默的。

MIT。
