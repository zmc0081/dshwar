---
'@dshwar/gateway': minor
'@dshwar/api-contract': patch
---

网关接入 SCIM,三类令牌彻底分开;/v1/admin/subjects 由 501 转实现

三类令牌:运行时 token(终端用户)· Admin Key(按租户)· SCIM token(按身份源)。
互斥由各自的中间件保证,并有五条负向测试钉住:SCIM token 打 /v1/* 401、
运行时 token 与 Admin Key 打 /scim/* 401、别的身份源的 SCIM token 打本挂载点
401 且与无效 token 不可区分 —— 区分它们等于告诉拿到 token 的人这把钥匙在别处有效。

- SCIM 挂 /scim/v2,不占用 /v1/:SCIM 有自己的错误格式与版本节奏。
  鉴权失败返回 SCIM 自己的错误格式 —— 读它的是供给方的同步引擎。
- ScimTokenResolver 与 AdminKeyResolver 同构但刻意不复用同一个接口:
  复用意味着一把钥匙可以同时出现在两张表里,而分离签发正是要杜绝这件事。
- /v1/admin/subjects 与 /v1/admin/subjects/{id} 转实现,check:contract 确认
  planned → implemented 不构成契约变更;契约里这两个端点不再声明 501
  (与 credentials 端点的写法一致)。列表端点在查询层就按租户圈死 ——
  它不接收 subjectId,没有 assertTenant 可挂,是最容易漏的一处。
- 网关对 @dshwar/subject 只依赖一个结构性只读子集(SubjectMirrorReader),
  未配置镜像的部署回落 501,不强迫拉进整个包。
- server.ts:静态令牌表的用户也进镜像,SCIM 推进来的用户与静态用户走同一张表。

修一处只有真跑才暴露的错:把中文塞进 x-dshwar-planned-version 响应头会直接抛
(头部值不允许非 ASCII)—— 版本号进头,解释进正文。
