---
'@dshwar/policy': minor
'@dshwar/gateway': minor
'@dshwar/api-contract': patch
---

`@dshwar/policy`:配额判定;quota 两端点转正;网关发轮前置 429

- 判定与执行分离(红线 2):包内没有任何 HTTP 概念,deny 由网关翻成
  429 rate_limited,判定逻辑可被控制平面原样复用。
- **fail open,理由写死在文档里**:计量是账目组件不是安全组件,读不到账就
  拒绝等于把计量故障升级成全员服务中断;放行的代价只是几轮没被限额,
  账目可从审计补。与身份层 fail closed(硬规则 6)方向相反、互不冲突 ——
  保护的东西不同。不限流的主体连 metering 都不读,有测试证明 metering
  全挂时它们不受影响。
- deny 只有 quota_exhausted 一种,类型层可穷举(红线 3):降级是
  model-router 的显式配置,本包永远不回答「换个便宜模型继续」。
- 余额不缓存:tokenUsed 每次判定现算。端到端测试:烧完配额下一轮 429,
  PATCH 提额后立即恢复 —— 缓存的余额会让「提额」变成「提额并等缓存过期」。
- 周期为 UTC 自然月,上周期用量不计入,可注入 BillingPeriod 换合同周期。
- PATCH 的变更进审计,before/after 都在 ——「谁在什么时候把限额从多少改到
  多少」是账务纠纷时的第一个问题。
- quota GET/PATCH 转正,check:contract 零变更;planned 只剩 policies。

20 个新单测。
