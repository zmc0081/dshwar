# 首发清单

> 代码与文档已就绪。**发布本身尚未执行** —— 下列步骤需要仓库所有者的账号与授权,
> 且都是不可逆的对外动作。
>
> ⚠️ **首发版本号待定,由仓库所有者决定。** 本文件曾写死「V0.1.0」,后来改成
> 「目标版本 0.4.5」,两次都很快过时 —— 首发一直被 npm 组织占名与建仓阻塞,
> 而开发没停,版本号一路推到 0.4.6。**清单内容与版本号无关,不要再往标题里写死一个。**
> 下文一律说「首次发布」,具体版本号发布时以全仓统一的版本号为准
> (CLAUDE.md 第四节,共 26 处)。

## 状态

| 步骤                                                   | 状态                         | 阻塞原因                  |
| ------------------------------------------------------ | ---------------------------- | ------------------------- |
| README(契约表 / 示例 / 隔离警告 / 兼容矩阵 / 开源边界) | ✅ 完成                      | —                         |
| LICENSE(MIT)+ 商标声明                                 | ✅ 完成                      | —                         |
| `docs/DECISIONS/naming.md`                             | ✅ 已记录                    | ⚠️ **法务复核未完成**     |
| CONTRIBUTING.md + good-first-issue 契约签名            | ✅ 完成                      | —                         |
| CHANGELOG.md                                           | ✅ 完成                      | —                         |
| 包可从空目录安装并跑通                                 | ✅ **已验证**                | 见下                      |
| 版本号一致性                                           | ✅ `pnpm check:version` 通过 | —                         |
| npm publish                                            | 🟠 **待执行**                | 组织已注册占名,包尚未发布 |
| GitHub Release                                         | 🟠 **待执行**                | 仓库与 remote 已就绪      |
| 上游仓库开 issue                                       | 🟠 **待执行**                | 对外动作,需所有者决定     |

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

## V0.4.5 新增的发布前确认项

进程隔离是**对外的安全承诺**,写错的代价是采用者据此做错部署决策。
发布前逐条确认:

- [x] README 的隔离矩阵已含「状态」列,进程档标为可用
- [x] README 显式写出**进程隔离仍然不是什么**(不防内核提权 / 不限资源 /
      不隔离网络 / 不隔离同一 principal 的会话 / 默认不开)
- [x] `CLAUDE.md` 第七节与 `ARCHITECTURE.md` §2.4 已同步,
      并更正了「进程隔离顺带解决 cancel」这句反向的表述
- [x] `docs/DEPLOYMENT.md` §2.5 有选型指引与**实测**的冷启动 / 内存数字
- [x] `gateway.config.example.json` 有 `isolation` 段,且该配置键**真的生效**
      (`gateway/test/server.test.ts` 断言配错级别时拒绝启动)
- [x] `profiles/enterprise.yml` 指向 process 档,`team.yml` 保持 logical
- [ ] 🚨 **在 Linux 上重测冷启动与内存** —— **已从待办升级到关键路径**
      (V0.4.7)。之前它可有可无,因为逻辑档是默认、进程档是可选;
      现在**进程档是唯一的多租户路径**,58 MB / 115 ms 撑着三样东西:
      README 的成本模型、`maxProcesses: 64` 的默认值、以及 5/20/50/200 人
      那张规模对照表。Linux 上若明显不同,**那三样全是错的** ——
      而错的后果是部署方照文档配置把机器吃到 OOM。
      需更新:`FEASIBILITY-REPORT-V45.md` §6、`DEPLOYMENT.md` §2.5、
      `README.md` 的规模对照表、`gateway.config.example.json` 的默认值
- [ ] 🟠 **人工跑一次 live smoke** —— `gateway/test/live-smoke.test.ts`
      从未在 CI 中运行过(需真实 API key)。跑法见该文件头部;
      key 走 `.env`,**绝不写进受版本控制的文件**。
      记录结果(模型回复的前 80 字)到本清单
- [ ] ⚠️ **补测 node-pty 在两层嵌套下是否可用**(需先装
      `dsh-subprocess-local`)。当前只验证了「子进程能再拉起孙进程」,
      pty 的原生绑定在深度 2 未验

## 待执行的发布步骤

### 1. 占名与建仓(前置)

- [x] 注册 npm 组织 `@dshwar` —— ✅ 2026-08-16 完成,CLI 已登录(`star-zm`)
- [x] 创建 GitHub 仓库 —— ✅ <https://github.com/zmc0081/dshwar>(Public)。
      `dshwar-console` 空仓占位仍待建
- [x] `git remote add origin …` 并**只推 `main`**

  > **首次 CI 复盘(2026-08-16)。** 第一次在真实 runner 上跑就红了,
  > 而它抓到的东西本地一条都看不见 —— 因为**本地的 `check:all` 与 CI 跑的
  > 不是同一组检查**,两边各有对方没有的项。这类漂移只会越拉越大,
  > 所以修法不是补那一条,而是把两边**对齐成同一组**并写进本清单:
  > **改门禁时必须同时改 `package.json` 的 `check:all` 与 `.github/workflows/ci.yml`。**

  > ⚠️ 曾写「推送 `main` 与 `feature/v0.1.0`」。那条已失效:`feature/v0.1.0`
  > 早已合并进 `main` 并删除。**`main` 是唯一的主干**,feature 分支合并后即删,
  > 不推到远端(CLAUDE.md 第六节)。

### 2. 法务

- [ ] 完成 `docs/DECISIONS/naming.md` 里的商标检索与律师复核
- [ ] 若结论为需改名,**在有用户之前改**

### 3. 发布

- [ ] 按上方 A 或 B 处理版本
- [ ] `pnpm publish -r --access public`
- [ ] GitHub Release,附 `docs/FEASIBILITY-REPORT.md` 摘要
- [ ] 上游仓库开 issue 做生态位声明

### 4. 发布后(CLAUDE.md 第三节强制)

- [ ] 版本路线表中把已发布的版本标为「已发布」
- [ ] 头部「当前版本(正在开发)」改为下一个版本号,并同步全仓 26 处
- [ ] 已开发完成的版本块若尚未压缩,按第三节压缩并归档

  > 首次发布时会一次性把 V0.1.0 起的多个版本一并发出去 —— 它们的版本块
  > 早已在开发完成时压缩过了(第三节的判据是「开发完成后」而非「发布后」),
  > 所以这一步通常无事可做,列在这里只是兜底。

## CI 的最后一公里

`.github/workflows/ci.yml` 目前只跑检查,**没有发布 job**。
接上 remote 之后建议加一个 `release.yml`,用 changesets 的 GitHub Action
把「合并 PR → 发布」自动化,避免手工 `npm publish` 的版本漂移。
