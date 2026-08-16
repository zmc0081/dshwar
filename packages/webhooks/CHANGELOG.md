# @dshwar/webhooks

## 0.5.0

### Minor Changes

- fd01987: `@dshwar/webhooks`:出站投递 + V0.3.0 端到端验收
  
  - HMAC-SHA256 签名,时间戳参与签名(签名防篡改,时间窗防重发)。
    测试用 node:crypto 从头实现验证、不 import 本包代码 ——
    只有我们自己算得对的签名等于没有签名。恒定时间比较。
  - 重试指数退避,每次重试**重签**(复用首签会让重试在下游看来像重放)。
    重试耗尽落审计,不静默丢弃。端点互不拖累。
  - **明确不做投递保证**:那需要持久队列,属于控制平面(V0.5.0)。
    在库层伪装可靠性比明说「尽力而为」更糟 —— 进程一重启保证就静默蒸发。
    文档写明下游按最终一致设计,定期拉 /v1/admin/subjects 兜底。
  - 载荷只有 id 与元数据,没有用户资料:webhook 会经过下游的日志与代理。
  - scim-server 新增 onSubjectChange 事件(created/updated/deactivated),
    词表由 DSHWAR 定义,与供给方用 PUT 还是 PATCH 解耦。
  
  端到端验收(gateway/test/identity-e2e.test.ts):供给方推两个用户 → JWT 认证
  通过 → authentik 的 PUT 形状停用其一 → 同一个 token 下一次被拒 → 另一人不受
  影响 → webhook 出站且签名可独立验证 → Entra 的 PATCH 形状走完同一条链。
  authentik 容器版验收手册在 scripts/e2e-authentik.md(代码就绪待外部资源,
  它验证的增量只有 REPORT-V3 标 ⚠️ 的三条实测)。
