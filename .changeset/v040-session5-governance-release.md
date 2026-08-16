---
'@dshwar/gateway': minor
---

治理链路串联与发布收尾

- `server.ts` 一次接全四个治理包:审计、计量、配额、准入降级。
  `governance` 配置段整段可选 —— 不配就是「不计量、不限额、不管准入」。
- 端到端(R9)`gateway/test/governance-e2e.test.ts` 六步单一叙事:
  设配额入审计 → 两轮烧到 200/250 → 水位 0.8 新会话被降级(三处可见)→
  烧穿后 429 → 用量可查且会计恒等 → 审计可查且 before/after 都在。
  验的是**环环相扣**:降级水位来自计量,429 判定来自计量,审计串起全部变更。
- 文档:`docs/GOVERNANCE.md`(四条红线、DISJOINT 计费口径、fail open 的理由、
  价格表必须配全的警告);README 加计量与治理一节;
  `profiles/enterprise.yml` 加四个治理包;示例配置补 governance 段。

**编译产物冒烟抓到两个测试没覆盖的接线 bug,均已修复并补回归测试:**

1. **id 空间不一致**:Subject Mirror 的内部 id 由 `(source, externalId)` 派生,
   而 auth-static 的 principal id 是条目 id —— 运维查配额永远 404。
   两侧单测各自都绿,因为没有一个同时配了 subjectStore 与 quotaAdmin。
2. **审计写 console 而端点读 store**:PATCH 配额成功,审计端点却永远是空的。
   改为同时写两处;SCIM 的审计同样接进 store,且 tenantId 从镜像查回来 ——
   写死 `'-'` 会让 SCIM 记录对每个租户都不可见,等于没记。
