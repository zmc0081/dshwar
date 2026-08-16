---
'@dshwar/model-router': minor
'@dshwar/gateway': minor
'@dshwar/api-contract': patch
---

`@dshwar/model-router`:模型准入与预算降级;policies 端点转正,planned 清零

- 裁决不路由:只在 createAgent 入口回答「许不许用、用哪个」,交回上游。
- 准入 opt-in:没配策略默认放行 —— 默认封锁会让治理变成「上来先配全通」的仪式。
  清单外 403 不静默换;空清单 = 全部允许(契约语义)。
- 降级显式且三处可见(红线 3),端到端逐一断言:响应头
  x-dshwar-model-downgraded、会话记录用裁决后的模型(计量要对上真正在跑的)、
  审计 model.downgraded 带 before/after。
- 边界:没配 fallback 超阈值不降级(超限走 429);预算水位未知不降级
  (依据必须是真数);降级目标配成清单外 → 拒绝(先准入后降级)。
- /v1/admin/policies 转正(只读;写入口留给控制平面的审批流)。
  **契约里 planned 至此清零** —— v1 定义的每个端点都有实现,有测试钉住;
  「planned 端点」测试块换代为「部署级降级回落 501」,机制保留数据清空。

17 个新单测。
