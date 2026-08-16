# @dshwar/metering

## 0.5.0

### Minor Changes

- c70833f: `@dshwar/metering`:用量归属;usage 两端点由 501 转实现
  
  - 采集挂在会话簿的 session/event 监听上(REPORT-V4 实测的信道:上游把用量
    随 assistant/message 一起发,没有独立用量流),挂在翻译之前 ——
    该事件不在对外词表里,但正是携带用量的那个。
  - **红线 1 观测不阻断**,两层兜底都有测试:safeRecord 吞掉 store 异常交给
    失败回调;连回调炸了也不向上抛。端到端测试用必炸的 store 证明一轮照常跑完。
  - **计费口径只有一处**:billedInputTokens 实现 DISJOINT 加法
    (input + cacheRead + cacheWrite),直接用 inputTokens 会少计费,
    聚合与配额取数都从它走。
  - 缺席容忍:适配器没报用量计 0 标 unreported,不估算 —— 估算值混进账目
    比缺口更难审。测试 harness 的假适配器恰好不发 usage,正好覆盖这条路径。
  - 会计恒等式有测试:聚合行 token 总和 = 明细逐条相加。
  - 成本整数分、桶级一次舍入;查不到价计 0(是「没配价」不是「免费」,
    README 加粗警告)。
  - /v1/admin/usage 与 /v1/admin/subjects/{id}/usage 转正,check:contract
    零变更;行形状为契约 UsageRecord 九字段,不多不少。
  
  23 个新单测,全仓 543 绿。
