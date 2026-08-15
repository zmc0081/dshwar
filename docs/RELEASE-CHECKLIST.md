# V0.1.0 发布清单

> 代码与文档已就绪(Session 8 完成)。**发布本身尚未执行** —— 下列步骤需要
> 仓库所有者的账号与授权,且都是不可逆的对外动作。

## 状态

| 步骤                                                   | 状态                         | 阻塞原因                      |
| ------------------------------------------------------ | ---------------------------- | ----------------------------- |
| README(契约表 / 示例 / 隔离警告 / 兼容矩阵 / 开源边界) | ✅ 完成                      | —                             |
| LICENSE(MIT)+ 商标声明                                 | ✅ 完成                      | —                             |
| `docs/DECISIONS/naming.md`                             | ✅ 已记录                    | ⚠️ **法务复核未完成**         |
| CONTRIBUTING.md + good-first-issue 契约签名            | ✅ 完成                      | —                             |
| CHANGELOG.md                                           | ✅ 完成                      | —                             |
| 包可从空目录安装并跑通                                 | ✅ **已验证**                | 见下                          |
| 版本号一致性                                           | ✅ `pnpm check:version` 通过 | —                             |
| npm publish                                            | 🟠 **待执行**                | npm 组织 `@dshwar` 未注册占名 |
| GitHub Release                                         | 🟠 **待执行**                | 仓库未创建,本地无 remote      |
| 上游仓库开 issue                                       | 🟠 **待执行**                | 对外动作,需所有者决定         |

## 已验证:从空目录安装可跑通

不能 publish,但用 `pnpm pack` 打出真实 tarball、从一个空目录安装,
能验出 `files` / `exports` / 依赖声明的所有遗漏 —— 这是 publish 之前
能做的最接近的验证。

```bash
# 打包
for p in principal auth auth-static credentials-multiuser fs-tenant storage-scoped; do
  (cd packages/$p && pnpm pack --pack-destination /tmp/dshwar-pack)
done

# 空目录安装 + 跑 README 首屏那段代码
mkdir /tmp/smoke && cd /tmp/smoke && npm init -y
npm install @deepseek-ai/cordis@4.0.1 @deepseek-ai/dsh-credentials@0.1.0-rc.6 \
  /tmp/dshwar-pack/dshwar-*.tgz
node smoke.mjs
```

实测输出:

```
dev-alice → sk-alice-XXXX
dev-bob   → sk-bob-YYYY
(匿名)     → undefined
```

**README 首屏的代码逐字可执行。**

## ⚠️ 发布前必读:changesets 会把版本推到 0.2.0

`CLAUDE.md` 第四节要求「开发版本号即时同步」——全仓已经预先标成 `0.1.0`。
而 `.changeset/` 里有 5 条 `minor` 变更集,直接跑 `pnpm exec changeset version`
会把 `0.1.0` 推成 **`0.2.0`**,与预标的版本冲突,`pnpm check:version` 会红。

首发时二选一:

**A. 保留预标版本(推荐)** —— 删掉 `.changeset/*.md`(内容已汇总进 `CHANGELOG.md`),
直接以 `0.1.0` 发布。此后每个版本正常走 changesets 流程。

**B. 接受 bump** —— 跑 `changeset version` 让它变成 `0.2.0`,同步改
`CLAUDE.md` / `SESSION_TASKS.md` / `README` 兼容矩阵,以 `0.2.0` 首发。

这是「预标版本号」与 changesets bump 模型之间的固有张力,**只在首发时出现一次**。
后续版本按 CLAUDE.md 第四节的流程(规划确立即预标)不会再撞。

## 待执行的发布步骤

### 1. 占名与建仓(前置)

- [ ] 注册 npm 组织 `@dshwar`
- [ ] 创建 GitHub 仓库 `dshwar`,`dshwar-console` 建空仓占位
- [ ] `git remote add origin …` 并推送 `main` 与 `feature/v0.1.0`

### 2. 法务

- [ ] 完成 `docs/DECISIONS/naming.md` 里的商标检索与律师复核
- [ ] 若结论为需改名,**在有用户之前改**

### 3. 发布

- [ ] 按上方 A 或 B 处理版本
- [ ] `pnpm publish -r --access public`
- [ ] GitHub Release,附 `docs/FEASIBILITY-REPORT.md` 摘要
- [ ] 上游仓库开 issue 做生态位声明

### 4. 发布后(CLAUDE.md 第三节强制)

- [ ] 把 `SESSION_TASKS.md` 的 M0.1.0 块压缩,细节归档到 `SESSION_TASKS_HISTORY.md`
- [ ] 头部「当前版本」改为 V0.2.0
- [ ] 版本路线表中 V0.1.0 标为「已发布」

## CI 的最后一公里

`.github/workflows/ci.yml` 目前只跑检查,**没有发布 job**。
接上 remote 之后建议加一个 `release.yml`,用 changesets 的 GitHub Action
把「合并 PR → 发布」自动化,避免手工 `npm publish` 的版本漂移。
