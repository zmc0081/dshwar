---
'@dshwar/scim-server': minor
---

`@dshwar/scim-server`:SCIM 2.0 服务端子集,PUT 与 PATCH 都能落停用

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
