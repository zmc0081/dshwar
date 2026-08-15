# Changesets

本目录存放尚未发布的变更集。执行 `pnpm exec changeset` 新增一条。

## DSHWAR 的两条特殊约定

**1. fixed 模式** —— 全部 `@dshwar/*` 包统一版本号(CLAUDE.md 第四节)。
给任意一个包写 changeset,发布时所有包一起提升到同一版本号。
不要试图让某个包单独走版本 —— 版本一致性检查(`pnpm check:version`)会拦下。

**2. 开发版本号即时同步** —— 新版本规划确立后、第一个 Session 开工前,
就要把 root `package.json`、`CLAUDE.md` 顶部、`SESSION_TASKS.md` 头部、
`README.md` 兼容矩阵一次性改成**正在开发的版本号**。

效果:开发环境构建产物版本号 = 正在开发版本号 = 最终发布版本号,发布时无需再改。

改完跑一次:

```bash
pnpm check:version
```

更多细节见 <https://github.com/changesets/changesets>。
