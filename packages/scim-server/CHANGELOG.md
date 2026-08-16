# @dshwar/scim-server

## 0.5.0

### Minor Changes

- be58b35: `@dshwar/scim-server`:SCIM 2.0 服务端子集,PUT 与 PATCH 都能落停用
  
  供给方往这里推用户与组,落点是 Subject Mirror。停用是最重要的链路,
  且各家动作不同(REPORT-V3 §4):Entra/Okta 发 PATCH,authentik 发 PUT ——
  两条路径都实现,三种真实形状各有一条测试,含 Entra 把 active 发成字符串
  "False" 的怪癖与它移除组成员的过滤 path 写法。
  
  - `/ServiceProviderConfig` 如实声明:patch/filter true,bulk/sort/etag false,
    changePassword 永远 false(硬规则 4)。authentik 读它并缓存一小时,
    虚报一次供给方接下来一小时都用错方法。
  - 创建载荷带 password → 400 并指明去供给方关掉密码同步,不静默丢弃。
  - 未知 filter → 501,不返回全量 —— 静默全量是数据泄漏。
  - 未知 PATCH path → 400 invalidPath,不忽略 —— 供给方以为改成功了是最难排查的失配。
  - DELETE 是删除不是停用信号(Entra 硬删除延迟 30 天)。
  - 组成员变更同步进 Subject.groups;strategy:group 下命中第二个租户组时
    整个组操作 400,不静默选一个。更新与 PATCH 不因映射问题阻断 ——
    停用必须是最健壮的路径,重裁失败沿用既有租户并落审计。
  - 错误一律 SCIM 自己的格式,供给方只认它。
  
  22 个单测,请求体逐字按供给方的文档化行为写。

### Patch Changes

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
- Updated dependencies [fcd7396]
- Updated dependencies [9fc2e21]
  - @dshwar/subject@0.5.0
  - @dshwar/tenant-map@0.5.0
