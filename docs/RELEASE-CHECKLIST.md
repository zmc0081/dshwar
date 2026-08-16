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

> ⚠️ **必须是 `pnpm pack`,不能是 `npm pack`。**(V0.4.1 Session 2 实测)
>
> `npm pack` **不重写 `workspace:*` 协议**,打出来的 tarball 里
> `"@dshwar/principal": "workspace:*"` 原样留着,安装时报
> `EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"` —— 包是坏的。
> `pnpm pack` 会把它重写成 `"0.4.1"`。
>
> 这条不只影响验证:**真发布时也必须走 `pnpm publish` 或 changesets**
> (两者都做协议重写)。谁哪天图省事用 `npm publish`,发出去的就是装不上的包,
> 而 npm 上的版本号不能重用 —— 只能发一个补丁版把它盖掉。

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

## changesets 与预标版本号的张力(已按方案 A 处理)

`CLAUDE.md` 第四节要求「开发版本号即时同步」——全仓已预先标成 **`0.4.1`**,
且承诺「发布时无需再改」。而 changesets 的模型是「攒变更集 → 提版本 → 发布」,
两者天然冲突:任何待发布的 `minor` 变更集都会把 `0.4.1` 推成 `0.5.0`。

**已采用方案 A(V0.4.1 收敛,2026-08-16)**:各版本的变更集在版本号提升时
并入 `CHANGELOG.md` 并删除。理由不是图省事 ——

> **changesets 记录的是「发布之间」的增量,而首发之前不存在「之间」。**
> 22 份变更集描述的是一个从未发布过的东西的演进过程,那属于 CHANGELOG 的
> 「初版包含什么」,不属于「相对上一版改了什么」。

**发布之后恢复正常流程**:每个改动写 changeset,`changeset version` 生成条目。
那时预标与 bump 不再冲突,因为有了真实的「上一版」作参照。

### 两个实测到的坑

**1. `npm pack` 不重写 `workspace:*`,`pnpm pack` 会。** 见上一节。

**2. `changeset version` 不提升 root `package.json`,而 `check-version` 拿它当基准。**

root 是 `private: true`,changesets 正确地忽略它。但 `scripts/check-version.mjs`
以 root 的 `version` 为基准比对其余 24 处 —— 于是跑完 `changeset version` 之后:

```
packages/*  → 0.5.0   (changesets 提升了)
package.json → 0.4.1  (没被提升)
→ pnpm check:version 红
```

**将来真走 `changeset version` 时,必须手工把 root 的 `version` 同步过去。**
这不是 bug,是两个工具对「root 算不算一个包」的看法不同;写在这里免得下次
花半小时排查。

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
