---
'@dshwar/gateway': minor
---

Admin API —— 契约完整,实现分期。

- `/v1/admin/subjects/{id}/credentials` 调 `credentials.describe()`,
  只返回 configured / source / writable;显式列字段,上游哪天多返回一个也不会被透传
- 在**目标主体的作用域内**查询 —— 不派生作用域会读到匿名,永远 unconfigured
- 8 个 planned 端点返回 501(非 404)+ `x-dshwar-planned-version` 响应头,
  清单**从契约里读**而非手写(手写会漂移)
- 跨租户 Admin Key 403,且被拒时不泄漏目标主体的任何凭据信息
- 审计埋点:调用者 / 目标 / 变更前后;凭据类只记 describe 层面的事实,
  绝不记值(审计保留期比凭据轮换周期长得多)
- 审计记录不含 Admin Key 本身,只有标签
