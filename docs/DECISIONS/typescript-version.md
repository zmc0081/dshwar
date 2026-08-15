# 决策:TypeScript 锁在 6.x,不上 7.0

> 日期:2026-08-15 · Session 1 · 状态:**生效中**

## 决定

`typescript` 锁 **6.0.3**。**不要**升到 7.x,直到 typescript-eslint 支持它。

## 背景

`KICKOFF.md` 原本建议 `typescript@5.7.2`。Session 1 安装时 npm `latest` 已是 **7.0.2**
(TypeScript 的原生移植版),于是先按 latest 装了 7.0.2。`tsc -b --noEmit` 正常,
但 ESLint 直接拒绝启动:

```
Error: typescript-eslint does not support TS 7.0.
```

typescript-eslint 8.67.0 显式检测并拒绝 TS 7 API,跟踪 issue:
<https://github.com/typescript-eslint/typescript-eslint/issues/10940>

## 权衡

| 方案                         | 结论                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| 锁 TS 6.0.3                  | **采纳**。工具链全绿,少一个活动部件                                                    |
| TS 7 构建 + TS 6 侧装供 lint | 否决。为一个还没人需要的编译速度收益,换来两套 TS 常驻仓库                              |
| 放弃 typescript-eslint       | 否决。`no-restricted-imports` 的 adapters 边界规则(R2)是本 Session 的核心产出,不能没有 |

lint 纪律 > 编译器新特性。**adapters 边界规则一天不生效,仓库就一天在长直连上游内部实现的代码**
(CLAUDE.md 硬规则 2),这个代价远高于用不上 TS 7 的原生编译速度。

## 解除条件

typescript-eslint 发布支持 TS ≥7.1 的版本后:

1. 同时升 `typescript` 与 `typescript-eslint`
2. `pnpm lint` 与 `pnpm typecheck` 全绿
3. 删掉 `renovate.json` 里针对 typescript 的 `allowedVersions` 约束
4. 本文件标记为「已解除」

Renovate 已配置 `allowedVersions: "<7"` 锁住 typescript,不会自动开升级 PR。
