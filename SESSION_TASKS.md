# DSHWAR 开发 Session 任务清单

> 项目对外名称:DSHWAR;npm 作用域 `@dshwar/*`;开源主仓 `dshwar`,控制平面仓 `dshwar-console`。
> 当前版本(正在开发): **V0.4.1** —— 本行强制为"正在开发的版本号",随新版本规划立即更新(见第三部分强制约束)

---

## 文档结构说明

本文档分三大部分:

1. **第一部分 · 项目基本介绍**:项目定位、架构边界、准备阶段、使用方式、Session 完成后的验证步骤。
2. **第二部分 · Session 任务记录(倒序)**:按版本从新到旧排列(最新在最上)。
   - <span style="color:#d00000">**红色标记 = 该版本尚未上线**</span>(规划中,保留完整任务详情)
   - Session 状态:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源
   - 开发完成的版本已压缩为"改了什么"的摘要;
     **实现细节见 `SESSION_TASKS_HISTORY.md`**
3. **第三部分 · 强制约束**:所有开发必须遵守的强制约束,**CLAUDE.md 为权威源**。

> **文件瘦身规则(强制)**:版本**开发完成后**,其任务块压缩为
> 「标题 + 简介 + 交付内容表 + 包含 Session 标题 + 核心改进」,删除的 Session prompt 与
> 实现细节归档到 `SESSION_TASKS_HISTORY.md`。目的:保持本文件在
> Claude Code 可完整读取的范围内(< 150,000 字符)。

---

# 第一部分 · 项目基本介绍

## 项目定位

DSHWAR 是 **DeepSeek Harness 之上的 ToB 产品基座**。上游是本地单用户的 Agent 运行时;DSHWAR 补齐商业应用需要的用户体系、租户隔离、计量、计费、运营后台与多端接入。

**一句话边界(所有决策的裁决标准)**:

> 上游做能力,DSHWAR 做归属、隔离、配额、计费、审计。

## 架构总览

```
控制平面  租户/订阅/支付/配额/审计/后台      独立仓库、独立数据库、与 dsh 零耦合
API 平面  运行时 API + 管理 API + SCIM 2.0   ★ 护城河，契约由 DSHWAR 定义与版本化
运行时平面 principal/credentials/fs/storage   cordis 插件，跟随 dsh 版本
────────────────────────────────────────
DeepSeek Harness（npm 依赖 @deepseek-ai/dsh-*，精确锁版）
```

详见 `ARCHITECTURE.md` 与 `IDENTITY-INTEROP.md`。

## 版本路线

| 版本       | 内容                                                      | 周期 | 状态                                               |
| ---------- | --------------------------------------------------------- | ---- | -------------------------------------------------- |
| V0.1.0     | 运行时平面 MVP + 开源首发                                 | 3 周 | <span style="color:#d00000">开发完成,待发布</span> |
| V0.2.0     | API 平面:OpenAPI v1 + Gateway + SDK + Admin 端点          | 4 周 | <span style="color:#d00000">开发完成</span>        |
| V0.3.0     | 身份互操作:Subject Mirror + SCIM 2.0 + 租户映射 + Webhook | 2 周 | <span style="color:#d00000">开发完成</span>        |
| V0.4.0     | 计量与治理:metering + policy + model-router + audit       | 3 周 | <span style="color:#d00000">开发完成</span>        |
| **V0.4.1** | **`fs-tenant` 多工作区改造 ★ V0.1.0 发布前必做**          | 3 天 | <span style="color:#d00000">开发中</span>          |
| V0.4.5     | supervisor 进程隔离                                       | 2 周 | 待启动                                             |
| V0.5.0     | 控制平面 / **企业自服务配置台**                           | 5 周 | 待启动                                             |
| **V0.5.5** | **工作台后端**:工作区 / 产物 / 预授权 / 作业 / 附件       | 3 周 | 待启动                                             |
| V0.6.0     | 支付:billing 契约 + local + 首个 hosted 实现              | 3 周 | 待启动                                             |
| **V0.6.5** | **本地模型 + 离线能力**(Ollama / llama.cpp)               | 2 周 | 待启动                                             |
| V0.7.0     | 端:Web 工作台 + Tauri 桌面壳(胖客户端)                    | 4 周 | 待启动                                             |
| V0.8.0     | 移动端 SDK(Kotlin / Swift)                                | 2 周 | 待启动                                             |

### 两条并行轨(不占 Session 编号,不阻塞开发)

| 轨道         | 内容                                                           | 触发时机                                                    |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------------------- |
| **视觉设计** | 设计语言 → 运营后台四屏 → 工作台主界面 → 桌面壳专属            | 设计语言与后台四屏**现在即可启动**;工作台界面待 V0.5.5 定型 |
| **代码签名** | SignPath Foundation(Windows,开源免费)+ Apple Developer($99/年) | V0.7.0 首个 release 之后                                    |

> 签名不是采购事项。开源项目分发预编译包可申请 SignPath Foundation 免费签名;
> 客户白牌版本由**客户自己签名**(挂客户品牌),DSHWAR 只提供打包与签名的 CI 模板。

## 双运行模式(开源自建 / 托管商业)

一份代码,靠 `profiles/` 切换,**不分叉出两套实现**:

| 维度 | 开源自建模式                      | 托管商业模式                |
| ---- | --------------------------------- | --------------------------- |
| 身份 | `auth-static` / `auth-jwt` 或匿名 | `auth-oidc` 接托管服务      |
| 凭据 | **用户自己的 API key,本地直连**   | 网关下发短时效 scoped token |
| 计量 | 本地记账,不上报                   | 上报托管服务,参与计费       |
| 品牌 | 中性(DSHWAR)                      | 运行期主题,配置由服务端下发 |
| 模型 | 云端 API 或**本地 Ollama**        | 走 `model-router` 网关路由  |

## 工作台能力边界

> 沿用一句话边界:**上游做能力,DSHWAR 做归属、隔离、配额、计费、审计。**

| 能力     | 上游 dsh 已有                                 | DSHWAR 补什么                            |
| -------- | --------------------------------------------- | ---------------------------------------- |
| 会话     | `session-*` 全家、`session-query`             | 归属过滤、跨租户隔离                     |
| 工作区   | `workspace`                                   | 多工作区 CRUD、路径钉死、配额            |
| 产物     | `spill`(溢出机制,非资产库)                    | **不引入独立产物模型**,做文件浏览与下载  |
| 作业     | `jobs` / `jobs-local`                         | **状态外置到 DSHWAR 库**,进程只作执行器  |
| 附件     | `attachment-local`(依赖 `sharp`)              | 契约 + 租户隔离 + 对象存储实现           |
| 技能     | `skill`                                       | 租户级三态、**仅 admin 可安装**          |
| 工具审批 | 权限流水线(SDK 通道的 server→client 是死能力) | **策略预授权 + 事后审计,不做运行时弹窗** |
| 模型     | `llm` 家族                                    | 准入裁决、预算降级、**本地模型适配**     |
| 记忆     | `context/` `compaction/` `spill/`             | 只做归属与保留策略,**不自建引擎**        |

## 准备阶段(在开始 Session 之前)

### 前置条件

- [ ] Node.js `^22.19.0 || >=24.0.0`(与上游 `engines` 一致):`node --version`
- [ ] pnpm ≥ 11:`pnpm --version`
- [ ] Git:`git --version`
- [ ] Docker(V0.3.0 起需要,用于跑 Keycloak 做集成验证)
- [ ] GitHub 仓库 `dshwar` 已创建;`dshwar-console` 建空仓占位
- [ ] npm 组织 `@dshwar` 已注册占名
- [ ] 全部文档（`CLAUDE.md` / `ARCHITECTURE.md` / `SESSION_TASKS.md` 等）已放入仓库根目录
- [ ] 五个开工前决定已确认(见 `KICKOFF.md` 第一节)

### 使用方式

每个 Session 对应一次 Claude Code 会话。在项目目录下启动,把 Session 的 Prompt 粘贴执行。
Claude 会先读 `CLAUDE.md` 了解约束,再生成代码。每个 Session 完成后验证并提交,再进入下一个。

## 每个 Session 完成后的验证步骤

```bash
pnpm typecheck                        # tsc -b --noEmit
pnpm test                             # vitest run
pnpm test:contract                    # 上游契约测试
pnpm eslint . --max-warnings 0

# PR 自查（见第三部分，grep 必须全为 0）
git add . && git commit -m "feat: session N - 功能描述" && git push
```

---

# 第二部分 · Session 任务记录(倒序排列)

> 最新版本在最上方。<span style="color:#d00000">**红色版本标题 = 尚未上线(规划中)**</span>。
>
> **Session 完成状态标记**:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源
> 已发布版本的 Session 一律标 ✅;开发中版本按实际进度标记,每完成一个即更新。
>
> 已发布:(暂无)
> 开发中:**V0.4.1(fs-tenant 多工作区改造)**
> 开发完成待发布:V0.4.0(Session 0-5) · V0.3.0(Session 0-7) · V0.2.0(Session 0-6) · V0.1.0(Session 0-8)
> 后续规划:V0.4.5 · V0.5.0 · V0.5.5 · V0.6.0 · V0.6.5 · V0.7.0 · V0.8.0(见「后续版本规划」)

---

## 后续版本规划(V0.4.5 → V0.8.0)

> 本节是**路线图**,不是任务书。每个版本在成为「正在开发版本」时,提升为完整版本块
> 并补齐 Session prompt。此处只记录已定的决策与交付范围,避免为尚未定型的设计写死细节。

---

### V0.4.5 · supervisor 进程隔离(2 周)

> 从 V0.4.0 顺延而来。企业多租户的前提:没有进程隔离,隔离级别只有逻辑隔离,
> 而文档已写死「逻辑隔离仅适用于互相信任的用户」。
> 顺带解决上游 SDK 协议**没有 cancel 与 session-close 方法**的问题——终止进程即是取消,
> 而工作台里「停止」是基本操作,这条不解决 UI 做出来也是残的。

| 交付           | 说明                                               |
| -------------- | -------------------------------------------------- |
| 进程池编排     | 一 principal 一 dsh 进程,spawn / 守护 / 回收       |
| 隔离级别配置   | 逻辑 / 进程 / 容器三档,由 profile 选择             |
| 可靠取消       | 终止进程即取消,替代上游缺失的 cancel               |
| 限流与配额联动 | 与 V0.4.0 的 `policy` / `metering` 对齐,不另起一套 |
| 崩溃恢复       | 进程死亡后的会话状态处理                           |

---

### V0.5.0 · 控制平面 / 企业自服务配置台(5 周)

> **定位改写**:原文写「运营后台」,实际要卖的是**企业客户能自服务配置他们的解决方案**——
> 配租户、成员、配额、模型准入,看用量与账单。措辞要对,这是产品本体。
> 独立仓库 `dshwar-console`,独立数据库,与 dsh 零耦合。

| 交付                   | 说明                                                |
| ---------------------- | --------------------------------------------------- |
| 租户 / 成员 / 角色管理 | 建立在 V0.3.0 的 Subject Mirror 之上                |
| 配额与模型准入配置     | 消费 V0.4.0 的 `policy`                             |
| 用量看板与审计查询     | 消费 V0.4.0 的 `metering` / `audit`                 |
| 只读数据库视图         | `dshwar_v1_*`,给若依 / JeecgBoot 类后台直接建表接入 |
| React 前端             | 见下方三条约束                                      |

**★ 前端必须遵守的三条约束(为 V0.7.0 套壳预留,现在写零成本,事后补是重构)**:

1. 路由用 **hash 或 memory router**,不用 history router
2. **不依赖浏览器专有 API**(`window.location` 直接操作、`localStorage` 作为唯一存储、Service Worker 等)
3. 所有请求走**统一 SDK 层**,不散落 `fetch`;`baseURL` 必须可注入,以便从远端切到 `127.0.0.1`

---

### V0.5.5 · 工作台后端(3 周)

> 工作台不是「画个界面」——目前任务书里产物、作业、审批、附件、技能全是空白。
> 本版本补齐后端地基,让 V0.7.0 真的只剩画界面与套壳。
> 范围按 **P0 + P1**,技能治理顺延。

| 编号 | 交付            | 已定决策                                                                           |
| ---- | --------------- | ---------------------------------------------------------------------------------- |
| P0   | 工作区 CRUD API | 基于 V0.4.1 的路径模型                                                             |
| P0   | 产物浏览与下载  | **不引入独立产物模型**,产物即工作区文件                                            |
| P0   | 策略预授权      | **不做运行时审批弹窗**;工作区设置页配置允许的工具 / 路径 / 网络 / shell,拒绝进审计 |
| P1   | 作业队列        | **状态外置到 DSHWAR 库**,dsh 进程只作执行器;支持跨重启恢复                         |
| P1   | 附件上传        | 契约 + `attachment-tenant`(fs 根)/ `attachment-object`(S3 兼容:MinIO / OSS / COS)  |
| P2   | 技能租户治理    | **顺延**。三态:未安装 / 已安装未启用 / 已启用;**仅 admin 可安装**(装技能等于提权)  |

> ⚠️ **开工第一件事**:查证 V0.2.0 的 501 占位端点是否已包含 workspaces / jobs /
> deliverables。已包含 → 本版本是「把 501 换成实现」,`/v1` 契约一行不动;
> 未包含 → 是契约新增,须走契约冻结检查并显式声明兼容性。

---

### V0.6.0 · 支付(3 周)

| 交付                   | 说明                                 |
| ---------------------- | ------------------------------------ |
| `@dshwar/billing` 契约 | 计量 → 计费 → 出账                   |
| `billing-local`        | **开源实现**,只记账不收款,自建者够用 |
| `billing-hosted`       | **闭源**,Stripe / 微信 / 支付宝接入  |

> 开源与闭源的分界线就在这里。开源用户拿到的是**可用的完整基座**,
> 商业客户买的是省掉自建的时间。这条线公开写在 README。

---

### V0.6.5 · 本地模型 + 离线能力(2 周)

> **这是开源版最有说服力的差异化**,不是一个降级方案。
> 「完全本地运行、数据不出内网、可自建用户体系的 AI 工作台」——
> 涉密、内网、金融、医疗客户只有这一个选择。

| 交付                 | 说明                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `@dshwar/llm-local`  | 适配 Ollama / llama.cpp;上游 `llm` 是可替换插件,支持自定义 OpenAI 兼容端点 |
| 离线态判定与自动降级 | 断网时自动切到本地模型                                                     |
| 离线可用范围落地     | 见下方边界表                                                               |
| 本地用量统计         | **统计而非计费**,一张本地表,联网后可选上报做看板                           |

**真离线的硬边界(已定)**:

| 能力                           | 离线可用?                 |
| ------------------------------ | ------------------------- |
| 浏览历史会话、产物、工作区文件 | ✅                        |
| 本地工具执行(文件操作、脚本)   | ✅                        |
| Agent 推理                     | ❌ **除非配置了本地模型** |
| 云端 token                     | ❌ 不可用                 |

> **不做离线额度机制。** 推理链:离线 → 只能用本地模型 → 不消耗云端 token →
> 没有需要计量的对象 → 不需要预授权额度、本地签名账本、时钟回拨检测、联网补报。
> 云端 token 是计费对象,本地算力不是。这条边界一划,离线态与在线态在计量上是两个世界。

---

### V0.7.0 · 端:Web 工作台 + Tauri 桌面壳(4 周)

> **胖客户端**:dsh 跑在本地。一份 React 代码,三个宿主。

```
┌──────────────────────────────────────────┐
│ Tauri 壳（Rust）                          │
│  ├── 凭据：系统钥匙串，refresh token      │
│  ├── 进程编排：拉起/守护 sidecar          │
│  └── 本地库：会话索引、作业队列           │
├──────────────────────────────────────────┤
│ Node sidecar（一个进程）                  │
│  ├── DSHWAR gateway（Hono，127.0.0.1）    │
│  └── dsh runtime（cordis + 原生模块）     │
├──────────────────────────────────────────┤
│ React（与 V0.5.0 同一份代码）             │
│  只认 OpenAPI，baseURL 从远端换成本地     │
└──────────────────────────────────────────┘
```

> **关键收益**:gateway 也搬到本地,React 代码一行不用改,认证 / principal 注入 /
> 限流 / 审计在本地与远端是同一套实现,不会出现「本地版本有个绕过口子」。

| 已定决策 | 内容                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ |
| 壳       | **Tauri v2**                                                                                           |
| 认证     | **系统浏览器 + PKCE,loopback 回调**;refresh token 存系统钥匙串,前端永不持有长效凭据                    |
| 白牌     | **运行期主题**,品牌配置由服务端下发;安装包永远中性,一个二进制服务所有租户                              |
| 组件     | 只借上游 `ui-slots` 槽位约定,**组件自研**(运行期换肤的前提)                                            |
| 更新     | Tauri 内置 updater + 自托管更新源;**频道分离**:前端资源热更(MB 级)/ sidecar 随大版本(季度)/ 壳几乎不动 |
| 审批 UI  | **无运行时弹窗**;取而代之是工作区设置页(允许的工具 / 路径 / 网络 / shell)                              |

**⚠️ 打包单独排两周,不要混在功能 Session 里。** 胖客户端要打包 Node 22 运行时与三个
原生模块(`node-pty` / `sharp` / `@vscode/ripgrep`),Tauri 没有 `@electron/rebuild`
那样的现成工具链,target-triple 命名、分平台 prebuild、macOS 每个 `.node` 单独签名
都要自己搭。

---

### V0.8.0 · 移动端 SDK(2 周)

> 从 V0.7.0 拆出。**只出 SDK(Kotlin / Swift)+ 一个可运行示例,不做 App、不进商店。**
> 你是基座,移动端 App 是客户的产品。SDK 由 OpenAPI 生成,与 TS / Python SDK 同源。

---

## <span style="color:#d00000">●</span> M0.4.1 · `fs-tenant` 多工作区改造(Session 0-2) <span style="color:#d00000">[开发中]</span>

> **这是一个有时限的改动。** `fs-tenant` 属于 V0.1.0,状态是「开发完成,**待发布**」——
> 还没 publish 到 npm。此刻把路径从 `{root}/{tenant}/{user}` 改成
> `{root}/{tenant}/{user}/{workspace}` 是普通改动;**一旦 V0.1.0 发布出去就是破坏性变更**,
> 要升大版本、写迁移、维护双版本。
>
> 📌 **为什么需要多工作区**:工作台的核心体验是按项目分区干活。单工作区意味着用户把
> 所有项目的文件混在一起。这个决定现在做成本为零,以后加是路径迁移。
>
> 开工前必读 `CLAUDE.md`。
>
> **不做的事**:不做工作区的 CRUD API(V0.5.5)、不做 UI(V0.7.0)。
> 本版本**只改路径模型与隔离校验**,让后续版本有地基。

### Session 状态

| Session              | 状态      | 说明                           |
| -------------------- | --------- | ------------------------------ |
| 0 路径模型与逃逸测试 | ✅ 已完成 | 四段路径;95 条(+28);Linux 复验 |
| 1 连带影响面         | ⬜ 未开始 | 附件 / 会话 / 存储 / 网关      |
| 2 文档与发布准备     | ⬜ 未开始 | 含 V0.1.0 发布前检查           |

图例:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源

### 本次需求清单

| 编号 | 需求                                                                | 所属 Session |
| ---- | ------------------------------------------------------------------- | ------------ |
| R0   | `fs-tenant` 路径模型改为 `{root}/{tenantId}/{userId}/{workspaceId}` | Session 0    |
| R1   | `workspaceId` 白名单字符校验;逃逸测试按新增路径段全量重写           | Session 0    |
| R2   | 缺省工作区语义:未指定 `workspaceId` 时落到 `default`,行为向后兼容   | Session 0    |
| R3   | 附件存储路径挂到工作区下,随之调整                                   | Session 1    |
| R4   | 会话持久化与 `session-query` 的工作区维度过滤                       | Session 1    |
| R5   | `storage-scoped` 键前缀是否需要工作区维度——**先评估再决定**         | Session 1    |
| R6   | Gateway 侧:`/v1` 现有端点如何携带 `workspaceId`(查询参数 vs 路径段) | Session 1    |
| R7   | 配额模型扩展:每用户工作区数上限 + 单工作区容量上限                  | Session 1    |
| R8   | 文档、`profiles/` 更新;V0.1.0 发布前一致性检查                      | Session 2    |

**红线**:本版本不得引入任何 CRUD API 或 UI。只改路径模型与校验。

---

### ✅ Session 0: 路径模型变更与逃逸测试重写

```
读取 CLAUDE.md 与 SESSION_TASKS.md 中本 Session 的任务详情。

本次任务:把 fs-tenant 的路径模型从三段改为四段。

⚠️ 这是整个项目安全性的重心。逃逸测试的要求高于其它任何 Session——
多一层路径段意味着每一种绕过手法都要重新验证一遍，不能假设原有测试仍然覆盖。

1. 路径模型
   - {root}/{tenantId}/{userId}/{workspaceId}
   - workspaceId 与 tenantId、userId 同级对待：白名单字符校验通过后才参与拼接
   - 校验顺序：先校验每一段，再拼接，再 resolve，最后断言仍在根内
   - 不要用「拼接后再检查」替代「拼接前先校验」，两者都要

2. 缺省工作区（R2）
   - 未指定 workspaceId 时落到 default
   - 目的是让现有调用方零改动仍能工作
   - default 不是特殊值，走完全相同的校验路径

3. 逃逸测试全量重写（R1）
   逐条写测试，每一条都要有对应的拒绝断言：
   - ../ 与多级 ../../，在四段路径的每一个位置分别尝试
   - 绝对路径
   - 符号链接指向根外
   - Windows 8.3 短名与 UNC 路径
   - URL 编码与 Unicode 规范化绕过
   - 空 tenantId / userId / workspaceId
   - workspaceId 伪造成路径分隔符或点号序列
   - 跨工作区读写（同一用户的两个工作区之间也要隔离）

4. 与上游沙箱的关系
   - 本包只做路径钉死，不重做沙箱
   - 策略计算结果仍喂给上游 sandbox-policy / fs-sandbox

== 测试 ==
- 上述每一条逃逸手法都有对应的拒绝测试
- 两租户互相不可见（正向与反向各测）
- 同用户两工作区互相不可见
- 未指定 workspaceId 时行为与改造前一致（对照 single-user.yml）
```

验证:

- 逃逸测试全绿,`single-user.yml` 对照基线行为不变
- `/publish feat: {v} session 0 multi-workspace path model`

---

### ✅ Session 1: 连带影响面

```
读取 CLAUDE.md。本次任务:处理路径模型变更的连带影响。

Session 0 改了路径根，以下几处会跟着受影响，逐一处理。凡是「先评估再决定」的，
把结论写进 docs/DECISIONS/ 下的对应文件，不要默默做了。

1. 附件存储路径（R3）
   - 附件挂到工作区下：{workspace}/.attachments/
   - 确认上游 attachment-local 的路径假设是否被打破

2. 会话与查询（R4）
   - 会话持久化目录随工作区分层
   - session-query 增加工作区维度过滤
   - 确认跨工作区查询被拒绝，而不是靠调用方自觉

3. storage-scoped 是否需要工作区维度（R5，先评估）
   - 存储键的语义是「租户数据」还是「工作区数据」？两者都有可能
   - 评估结论写入 docs/DECISIONS/storage-workspace-scoping.md
   - 若结论是不需要，说明理由，不要为了对称而加

4. Gateway 端点如何携带 workspaceId（R6，先评估）
   - 选项 A：查询参数 ?workspaceId=
   - 选项 B：路径段 /v1/workspaces/{id}/sessions
   - 关键约束：V0.2.0 的 /v1 契约已冻结，任何变更需按契约冻结检查显式声明兼容性
   - 评估结论写入 docs/DECISIONS/workspace-in-api.md，并给出兼容性声明

5. 配额模型扩展（R7）
   - 每用户工作区数上限
   - 单工作区容量上限
   - 与 V0.4.0 已完成的 policy / metering 对齐，不要另起一套

== 测试 ==
- 附件在正确的工作区目录下
- 跨工作区的会话查询被拒绝
- 超出工作区数上限时创建被拒绝
- 契约冻结检查通过（若改了 OpenAPI）
```

验证:

- 两份决策文档已写,契约兼容性已声明
- `/publish feat: {v} session 1 multi-workspace ripple effects`

---

### ⬜ Session 2: 文档、profile 与 V0.1.0 发布准备

```
读取 CLAUDE.md（第三节 文档瘦身、第四节 版本号统一更新）。

本次任务:收尾并为 V0.1.0 发布做准备。

1. 文档
   - fs-tenant 的 README 更新路径模型说明
   - 隔离模型章节补一句：同一用户的不同工作区之间也是隔离的，
     但隔离级别与租户间相同——逻辑隔离仅适用于互相信任的场景
   - ARCHITECTURE.md 的隔离模型章节同步

2. profiles/
   - single-user.yml / team.yml / enterprise.yml 补工作区相关配置
   - single-user.yml 必须保持对照基线语义：单用户单工作区行为与原生 dsh 一致

3. V0.1.0 发布前检查（本 Session 的真正目的）
   - 版本号一致性检查通过（scripts/check-version）
   - 全部契约测试双 profile 跑绿
   - PR 自查 grep 全为 0
   - 从空目录安装 npm 包并跑通 examples/minimal-server
   - 确认安装包/构建产物中不含任何闭源组件
     （这是 SignPath Foundation 的资格条件，也是 open-core 边界）

4. 报告
   - 明确回答：V0.1.0 现在是否可以发布？若否，列出阻塞项

== 测试 ==
- check-version 通过
- 双 profile 契约测试全绿
- 空目录安装可跑通
```

验证:

- V0.1.0 具备发布条件
- `/publish docs: {v} session 2 multi-workspace docs and release readiness`

---

## <span style="color:#d00000">●</span> M0.4.0 · 计量与治理(Session 0-5) <span style="color:#d00000">[未上线]</span>

> **这一版换来的是「能对账、能设限」。** V0.3.0 之后,谁能进来已经解决;
> 但进来之后用了多少、该不该继续用、用哪个模型 —— 全都没有答案。
> 没有计量,billing(V0.6.0)无米下锅;没有 policy,一个失控脚本能把
> 整个租户的预算一夜烧光;没有准入,试用用户能直接调最贵的模型。
>
> 📌 **核心论点**:计量与治理全部是**治理层**,一行不碰模型引擎
> (一句话边界:上游做能力,DSHWAR 做归属、隔离、配额、计费、审计)。
> `model-router` 不路由请求 —— 它只在 `createAgent` 的入口裁决
> 「这个 principal 此刻允许用哪个模型」,真正的模型调用仍是上游 `dsh-llm` 的事。
>
> 开工前必读 `CLAUDE.md`。
>
> **开工前已确认的决定**(2026-08-16):**supervisor 进程隔离顺延 V0.4.5。**
> 版本路线表与 README 的承诺此前冲突(前者未列,后者标 V0.4.0),裁决为
> 聚焦计量与治理 —— 两块合并会让版本失焦,且 supervisor 的限流/配额设计
> 依赖计量先落地。README 两处已改 V0.4.5 并注明调整日期,原文不删。
>
> **不做的事**:不做 supervisor(V0.4.5)、不做控制平面与后台 UI(V0.5.0)、
> 不做收款(V0.6.0,本版本只记账不出账单)、不做请求级模型路由(那是上游地盘)。

### Session 状态

| Session                  | 状态      | 说明                                     |
| ------------------------ | --------- | ---------------------------------------- |
| 0 可行性证伪:用量可观测  | ⬜ 未开始 | **止损点** —— 上游到底报不报 token 用量  |
| 1 `@dshwar/audit`        | ⬜ 未开始 | 仅追加审计,`/v1/admin/audit` 转正        |
| 2 `@dshwar/metering`     | ⬜ 未开始 | 用量归属与查询,usage 两端点转正          |
| 3 `@dshwar/policy`       | ⬜ 未开始 | 配额与限流,quota 两端点转正,网关执行 429 |
| 4 `@dshwar/model-router` | ⬜ 未开始 | 模型准入与预算降级,policies 端点转正     |
| 5 治理链路串联与发布     | ⬜ 未开始 | 端到端:超配额被拒、降级生效、全程入审计  |

图例:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源

### 本次需求清单

| 编号 | 需求                                                                   | 所属 Session |
| ---- | ---------------------------------------------------------------------- | ------------ |
| R0   | **可行性证伪**:上游事件里能不能拿到 per-turn 的 token 用量             | Session 0    |
| R1   | `@dshwar/audit`:仅追加、可查询、按租户过滤的审计存储                   | Session 1    |
| R2   | `/v1/admin/audit` 由 501 转实现,契约不变                               | Session 1    |
| R3   | `@dshwar/metering`:用量记录按 principal/session/turn 归属              | Session 2    |
| R4   | `/v1/admin/usage` 与 `/v1/admin/subjects/{id}/usage` 转正              | Session 2    |
| R5   | `@dshwar/policy`:配额存储 + 判定;**超限拒绝是 fail closed 的延伸**     | Session 3    |
| R6   | `/v1/admin/subjects/{id}/quota` GET/PATCH 转正;网关 429 `rate_limited` | Session 3    |
| R7   | `@dshwar/model-router`:模型准入 + 预算降级,只在 createAgent 入口裁决   | Session 4    |
| R8   | `/v1/admin/policies` 转正                                              | Session 4    |
| R9   | **端到端**:烧完配额 → 下一轮被拒;预算过半 → 自动降级;全程入审计        | Session 5    |
| R10  | 文档与 profile 更新;supervisor 顺延的对外说明                          | Session 5    |

**本版本红线**:

1. **计量只观测,不阻断**。metering 挂在事件流上,它挂了不能影响会话 ——
   丢一条用量记录是账目问题,断一次会话是事故。
2. **判定与执行分离**。policy 包只回答「能不能」,429 由网关发 ——
   判定逻辑要能被控制平面复用,不能长在 HTTP 层里。
3. **超限拒绝,不静默降级**。配额烧完就是 429,不偷偷换便宜模型继续跑 ——
   降级是 model-router 的**显式配置**,不是 policy 的隐式行为。
4. **审计仅追加**。没有 update、没有 delete;保留期内的记录改不了也删不了。

### 核心改进

- **计费口径按 DISJOINT 加**:上游 `inputTokens` 只算未命中缓存的输入,
  直接用它会**少计费**。`billedInputTokens()` 是唯一实现,聚合与配额取数都从它走。
- **观测不阻断**:计量挂了会话照常跑完 —— 丢一条用量记录是账目问题,断一次会话是事故。
- **判定与执行分离**:`policy` 只回答「能不能」,429 由网关发,判定逻辑可被控制平面复用。
- **配额 fail open**:计量读不到时放行并落审计。与身份层 fail closed(硬规则 6)方向相反 ——
  计量是账目组件不是安全组件,把它放进关键路径的故障域等于造「记账挂了谁都不能用」的事故模式。
- **降级三处可见**:响应头、会话记录、审计。静默换模型省下的钱会在第一次工单里加倍还回去。
- **审计仅追加**:类型层没有 update / delete,KV 实现连 `deleteRecord` 都不声明。
- ★ **契约 `planned` 清零** —— 「契约完整,实现分期」策略至此走完,v1 定义的每个端点都有实现。

> 实现细节见 [`SESSION_TASKS_HISTORY.md`](SESSION_TASKS_HISTORY.md)。

---

## <span style="color:#d00000">●</span> M0.3.0 · 身份互操作(Session 0-7) <span style="color:#d00000">[未上线]</span>

> **这一版换来的是「能接 CMS / IdP」。** V0.2.0 把契约定死了,但用户还得靠
> `auth-static` 的明文令牌表手工维护 —— 那不是能交付给客户的东西。
> 本版本补齐:身份从哪来(OIDC / JWT)、用户怎么同步进来(SCIM)、
> 属于哪个租户(租户映射)、变更怎么通知出去(Webhook)。
>
> 📌 **核心论点**:DSHWAR 是**身份消费者**,不是身份提供者。
> 不存密码、不签发身份令牌、不做注册流程(CLAUDE.md 硬规则 4)。
> 客户的用户目录在他们自己的 IdP 里,DSHWAR 只保留一份**镜像**用于归属与授权。
>
> 开工前必读 `CLAUDE.md` 与 `IDENTITY-INTEROP.md`。
>
> **不做的事**(避免范围失控):不做控制平面服务与后台 UI(V0.5.0)、
> 不做 metering / policy 实现(V0.4.0)、不做进程隔离 supervisor(V0.4.0)、
> 不做只读数据库视图(V0.5.0 随控制平面)、不做 Python SDK。

### 开工前已确认的四个决定(2026-08-16)

这四条原本是 `IDENTITY-INTEROP.md` §9 的待定项,开工前逐条定死:

1. **`subject` / `scim-server` / `webhooks` 放主仓 `packages/`,不新建 `dshwar-console` 仓。**
   `IDENTITY-INTEROP.md` §7 把它们划给控制平面,但那说的是**部署形态**,不是仓库归属。
   这三个本质是**库**,不是服务;控制平面的服务(租户 / 订阅 / 后台 UI)仍留给 V0.5.0
   的 `dshwar-console`。放主仓意味着立刻复用现成的门禁、changesets 与版本机制,
   省掉搭第二套工程骨架的 3-5 天。
2. **SCIM 一期含 `User` + `Group`,且 `PUT` 与 `PATCH` 两条更新路径都要做。**
   `Group` 是租户映射 `strategy: group` 的前提。
   ⚠️ **Session 0 修正**:原写「PATCH 是停用的主要动作,缺它验收走不通」——
   这只对 Entra / Okta 成立。实际选定的验收基线 authentik **用 PUT 更新用户**,
   PATCH 只用于组成员增删。两条路径都必须能把 `active:false` 落到停用,
   否则会出现「在 A 家能停用、在 B 家停不掉」,而停不掉意味着离职员工仍能调模型。
   依据见 `docs/FEASIBILITY-REPORT-V3.md` §4。
3. **不发布 V0.1.0 / V0.2.0,直接升 0.3.0 继续开发。**
   三个版本的内容并入未来一次性首发。CLAUDE.md 第四节的「开发版本号即时同步」照常执行。
4. **Subject Mirror 复用上游 `storage` 契约 + `@dshwar/storage-scoped`,不引 Postgres。**
   `IDENTITY-INTEROP.md` §7 按控制平面选型写的是 Postgres + Drizzle,但那是 V0.5.0
   控制平面落地时的事。主仓引入数据库依赖与迁移体系,会让 CI 必须起容器,
   与「运行时插件轻量」的定位冲突。存储是**能力**,上游已有契约 —— 不另起炉灶
   (CLAUDE.md 一句话边界)。换 Postgres 时换实现包即可。

### Session 状态

| Session                     | 状态      | 说明                                              |
| --------------------------- | --------- | ------------------------------------------------- |
| 0 可行性证伪:SCIM 供给链    | ✅ 已完成 | **止损未触发**;验收基线由 Keycloak 换为 authentik |
| 1 `@dshwar/subject`         | ✅ 已完成 | 内存与 storage 两个实现跑同一套断言;29 个单测     |
| 2 `@dshwar/tenant-map`      | ✅ 已完成 | 四种策略 + 歧义即拒;29 个单测,负向多于正向        |
| 3 `@dshwar/auth-jwt`        | ✅ 已完成 | 验签通过≠放行:停用即拒;23 个单测,真实密钥对       |
| 4 `@dshwar/auth-oidc`       | ✅ 已完成 | 只解析 discovery,验签复用 auth-jwt;18 个单测      |
| 5 `@dshwar/scim-server`     | ✅ 已完成 | PUT 与 PATCH 双路停用;三家供给方形状实测;22 单测  |
| 6 网关接入与令牌分离        | ✅ 已完成 | 五条令牌互斥负向测试;subjects 转正契约零变更      |
| 7 `@dshwar/webhooks` 与发布 | ✅ 已完成 | 进程内全链路验收 7/7;容器脚本 🟠 待外部资源       |

图例:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源

### 本次需求清单

| 编号 | 需求                                                                | 所属 Session |
| ---- | ------------------------------------------------------------------- | ------------ |
| R0   | **可行性证伪**:SCIM 供给方能否零定制代码把用户推进来                | Session 0    |
| R1   | `@dshwar/subject`:Subject Mirror 契约 + storage 实现,含停用态       | Session 1    |
| R2   | `@dshwar/tenant-map`:`claim` / `group` / `issuer` / `fixed` 四策略  | Session 2    |
| R3   | **fallback 默认 `reject`**,映射不出租户宁可拒登(硬规则 7)           | Session 2    |
| R4   | `@dshwar/auth-jwt`:JWKS 验签 + 缓存 + 轮换                          | Session 3    |
| R5   | `@dshwar/auth-oidc`:discovery 端点解析,与租户映射接合               | Session 4    |
| R6   | `@dshwar/scim-server`:User + Group + PATCH,SCIM 2.0 子集            | Session 5    |
| R7   | SCIM 令牌与 Admin 令牌**分离签发**,供给系统不得读用量与凭据配置     | Session 6    |
| R8   | `/v1/admin/subjects*` 由 501 转为实现,契约不变                      | Session 6    |
| R9   | `@dshwar/webhooks`:出站事件投递,含重试与签名                        | Session 7    |
| R10  | **端到端验收**:供给方停用某用户后,该用户下次请求被拒,全程零定制代码 | Session 7    |

**本版本红线**:

1. **不存密码、不签发身份令牌、不做注册流程**(硬规则 4)。凡出现 `bcrypt` / `argon2` / `password` 字段即违规。
2. **租户映射 fallback 默认 `reject`**(硬规则 7)。改 `fixed` 须在 PR 描述显式说明理由。
3. **三类令牌分离签发**:运行时 token(终端用户)· Admin Key(按租户)· SCIM token(按身份源)。任一把钥匙不得跨类使用。
4. **Subject Mirror 是镜像,不是事实源**。DSHWAR 不新建用户,只接受供给方推来的记录。

### 核心改进

- ★ **验签通过 ≠ 放行**:IdP 侧停用不会让已签发的 token 失效,`auth-jwt` 每次必查
  Subject Mirror 的 `active`。这是本版本验收标准的落点。
- **停用的两条路径都做**:Entra / Okta 发 `PATCH`,authentik 发 `PUT` ——
  只做一条就会「在 A 家能停用、在 B 家停不掉」,而停不掉意味着离职员工仍能调模型。
- **三类令牌分离签发**:运行时 token / Admin Key / SCIM token,互斥有五条负向测试。
  SCIM token 配在外部系统里,泄漏的爆炸半径被圈定为「一个身份源的镜像被改」。
- **租户由映射裁决,不信 token 自称**:映射不出与歧义**都拒绝**,
  镜像与裁决冲突时拒绝而非选一边 —— 选任何一边都是猜,猜错的后果是跨租户可见。
- **只接受非对称算法**,传入对称算法在构造时抛错(JWKS 分发的是公钥,允许 HMAC 等于让人拿公钥伪造)。
- Session 0 裁决:**Keycloak 没有 SCIM 出站客户端**,验收基线由它换为 authentik。

> 实现细节见 [`SESSION_TASKS_HISTORY.md`](SESSION_TASKS_HISTORY.md)。

---

## <span style="color:#d00000">●</span> M0.2.0 · API 平面(Session 0-6) <span style="color:#d00000">[未上线]</span>

> **M2 是总闸。** API 契约没定,移动端、控制面、第三方接入全部堵住
> (`ARCHITECTURE.md` §4.2)。V0.1.0 完成后应优先本版本,而非继续加运行时包。
>
> 📌 **核心论点**:那份稳定契约是客户接进来之后**换不掉**的东西。
> 运行时插件可替换,控制面是标准 SaaS —— 只有 API 契约是护城河。
>
> 上游两条通道都不能直接用:SDK 协议是 stdio JSON-RPC(移动端连不上);
> 内置 webserver 没有 TLS 与认证,仅有一道 Origin 栅栏,且**不带 `Origin` 头的请求
> 直接放行**(实测见 `docs/FEASIBILITY-REPORT.md` §4.4)。
>
> **不做的事**(避免范围失控):不做 SCIM(V0.3.0)、不做 metering / policy 的
> **实现**(V0.4.0)、不做控制平面(V0.5.0)、不做 supervisor 进程隔离(V0.4.0)、
> 不做 Python SDK(V0.3.0)。

### Session 状态

| Session                  | 状态      | 说明                                                                             |
| ------------------------ | --------- | -------------------------------------------------------------------------------- |
| 0 可行性证伪             | ✅ 已完成 | **止损未触发**,32 条断言全过(Win + Linux);报告见 `docs/FEASIBILITY-REPORT-V2.md` |
| 1 OpenAPI v1 契约        | ✅ 已完成 | Zod 单一事实源 → OpenAPI 3.1;redocly lint 零警告;29 个单测                       |
| 2 Gateway 骨架与会话路由 | ✅ 已完成 | 分道鉴权在中间件层;22 个单测,含隔离槽位零增长                                    |
| 3 运行时 API 与 SSE      | ✅ 已完成 | 端到端对真实 harness;19 个单测,含断连释放度量与 Last-Event-ID                    |
| 4 Admin API              | ✅ 已完成 | credentials describe;8 个 planned 返 501;22 个单测                               |
| 5 TS SDK                 | ✅ 已完成 | 由 OpenAPI 生成;M2 验收对真实端口跑通;12 个单测                                  |
| 6 契约冻结与发布         | ✅ 已完成 | 基线取自 git 而非快照文件;18 个单测 + 2 条端到端负向测试                         |

图例:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源

### 本次需求清单

| 编号 | 需求                                                                       | 所属 Session |
| ---- | -------------------------------------------------------------------------- | ------------ |
| R0   | **可行性证伪**:进程内驱动 dsh agent、流式输出、取消语义                    | Session 0    |
| R1   | OpenAPI 3.1 契约,Zod 为单一事实源,`info.version` 纳入版本一致性检查        | Session 1    |
| R2   | 统一错误形状与分页/排序参数(让 Refine / Appsmith 能自动生成后台)           | Session 1    |
| R3   | `gateway/`:Hono 服务、Bearer → `auth.verify` → `runWithPrincipal` 会话路由 | Session 2    |
| R4   | 按租户签发的 Admin API Key,与运行时 token **分离**                         | Session 2    |
| R5   | `/v1/sessions` 运行时 API + SSE 流式 + 取消                                | Session 3    |
| R6   | `/v1/admin/subjects/{id}/credentials`:`describe` 语义,**永不返回值**       | Session 4    |
| R7   | planned 端点返回 501 并在 OpenAPI 标注,契约完整、实现分期                  | Session 4    |
| R8   | `sdk/typescript`:由 OpenAPI 生成                                           | Session 5    |
| R9   | 契约冻结检查:OpenAPI 变更需显式声明兼容性                                  | Session 6    |
| R10  | `profiles/gateway.yml`、部署文档、兼容矩阵更新                             | Session 6    |

**本版本红线**:

1. **契约是单一事实源** —— Zod → OpenAPI → SDK,**不手写客户端**
2. **Admin 与运行时令牌分离签发**,Admin API Key 按租户签发,一把钥匙不得横跨租户
3. **凭据端点只暴露 `describe`**,永不返回值(硬规则 5,原样传递上游约束)
4. **`/v1/` 路径版本化**,破坏性变更升大版,双版本并行不少于 6 个月

**开工前已确认的两个决定**(2026-08-15):

- **Admin API 的 `subjects` / `usage` 端点:契约先行,实现分期。**
  版本路线表原写 V0.2.0 交付这两个端点,但 Subject Mirror 在 V0.3.0、
  metering 在 V0.4.0 —— V0.2.0 没有后端可依托。决定:OpenAPI 里把契约**完整定下**,
  只实现有后端的 `credentials describe`,其余返回 501 并标 `x-dshwar-status: planned`。
  理由:契约是换不掉的那一层,晚定一天成本高一天。
- **SDK 首发只做 TS,Python 留到 V0.3.0。**
  `ARCHITECTURE.md` §2.1 原写「TS / Python 首发」。M2 的验收标准
  (第三方仅凭 SDK 完成一次完整会话)用 TS 即可证明;Python 意味着仓库引入第二套
  工具链与发布渠道,约多 1 周且需长期维护。契约定下后,Python SDK 任何时候生成都一样快。

### 核心改进

- ★ **契约是单一事实源**:Zod → OpenAPI 3.1 → SDK,任何一处手写都是第二个事实源,
  而两个事实源迟早分叉 —— 分叉的表现是客户按文档写的客户端在生产上炸掉。
- **契约完整,实现分期**:未实现端点返回 501 并标 `x-dshwar-status: planned`,
  而不是 404 —— 404 会让第三方以为路径写错了,从而去猜别的路径。
- **契约冻结的基线取自 git,不是快照文件**:另存快照行不通,改契约的人必然顺手更新它,检查恒绿。
- **闭集枚举加值判为破坏性**:错误码定成 `z.enum` 就是为了让下游写出可穷举的 `switch`,
  多一个值就让已写全的 `switch` 编译失败。这是设计后果,不是判定过严。
- **网关只消费装好的 `ctx`**,不组装 harness;装配在 `runtime.ts` 里单列一层。
- **凭据永不返回值**:契约层就没给值字段留位置,SDK 生成的类型里同样没有。

> 实现细节见 [`SESSION_TASKS_HISTORY.md`](SESSION_TASKS_HISTORY.md)。

---

## <span style="color:#d00000">●</span> M0.1.0 · 运行时平面 MVP + 开源首发(Session 0-8) <span style="color:#d00000">[未上线]</span>

> V0.1.0 是**奠基版本**:验证 principal 能沿 cordis 作用域正确传播,补齐 Harness 缺失的
> 多用户服务实现,并完成开源首发。
> 包含:① Session 0 可行性证伪(**不通过则整套架构改为进程隔离优先**);
> ② 工程骨架与 adapters 边界纪律;③ `principal` / `auth` / `auth-static` /
> `credentials-multiuser` / `fs-tenant` / `storage-scoped` 六个包;
> ④ 上游契约测试与跟版机制;⑤ 文档、许可、商标声明与 npm 首发。
>
> 开工前必读 `CLAUDE.md`(一句话边界 / 8 条硬规则 / PR 自查清单)。
>
> 📌 **核心论点**:Harness 的服务契约可以被换成多用户实现,消费方零改动。
> 本版本的全部工作都在证明这一句话。
>
> **不做的事**(避免范围失控):不做 HTTP API、不做后台界面、不做计量计费、
> 不做记忆引擎、不做进程 supervisor。这些在 V0.2.0 之后。

### Session 状态

| Session                   | 状态                  | 说明                                                                                                                                      |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0 可行性验证              | ✅ 已完成             | **止损未触发**,四项全过;上游锁定 `0.1.0-rc.6`;报告见 `docs/FEASIBILITY-REPORT.md`                                                         |
| 1 工程骨架与边界纪律      | ✅ 已完成             | workspace / TS / ESLint 边界规则 / 守卫脚本 / changesets / CI / single-user 骨架;负向测试 8/8                                             |
| 2 `@dshwar/principal`     | ✅ 已完成             | principal 传播;31 个单测覆盖作用域隔离与并发无串号                                                                                        |
| 3 `auth` + `auth-static`  | ✅ 已完成             | 认证契约与静态实现;`AuthError` 不携带失败原因,19 个单测                                                                                   |
| 4 `credentials-multiuser` | ✅ 已完成             | per-principal 凭据 + 网关遮蔽;33 个单测;`examples/minimal-server` 跑通                                                                    |
| 5 `fs-tenant` ★           | ✅ 已完成             | 路径钉死;67 条测试(含符号链接逃逸,须在 Linux 验证)                                                                                        |
| 6 `storage-scoped`        | ✅ 已完成             | R7 已否决,新建包;长度前缀防伪造;27 个单测                                                                                                 |
| 7 契约测试与跟版          | ✅ 已完成             | `adapters/dsh-0.1.0` 落地;33 条契约测试;R9 双 profile 对照;负向测试增至 9 条                                                              |
| 8 开源首发                | 🟠 代码就绪待外部资源 | 文档 / 许可 / 商标 / CONTRIBUTING 完成,tarball 空目录安装已验证;npm 组织与 GitHub 仓库未创建,发布未执行 —— 见 `docs/RELEASE-CHECKLIST.md` |

图例:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源

### 本次需求清单

| 编号 | 需求                                                                          | 所属 Session |
| ---- | ----------------------------------------------------------------------------- | ------------ |
| R0   | **可行性证伪**:验证 `ctx.isolate` 作用域传播与凭据不跨操作缓存                | Session 0    |
| R1   | 工程骨架:pnpm workspace / CI 双 Node 矩阵 / Renovate / changesets fixed       | Session 1    |
| R2   | **adapters 边界 lint 规则**:禁止 `packages/**` 深链上游内部实现               | Session 1    |
| R3   | `@dshwar/principal`:Principal 类型、`withPrincipal`、ANONYMOUS 语义           | Session 2    |
| R4   | `@dshwar/auth` 契约 + `auth-static` 实现(零配置开箱即用)                      | Session 3    |
| R5   | `@dshwar/credentials-multiuser`:per-principal 解析 + 网关短时效 token 遮蔽    | Session 4    |
| R6   | `@dshwar/fs-tenant`:工作区根按租户钉死,路径逃逸拦截 **★ 隔离真实边界**        | Session 5    |
| R7   | `@dshwar/storage-scoped`:租户前缀键(先评估上游 `storage-domain` 可否直接复用) | Session 6    |
| R8   | `adapters/dsh-0.1.0/` + 上游契约测试(录制/回放)                               | Session 7    |
| R9   | `profiles/single-user.yml` 对照基线:单用户行为与原生 dsh 一致                 | Session 7    |
| R10  | 文档、MIT 许可、商标声明、兼容矩阵、npm 首发与 GitHub 发布                    | Session 8    |

**三条红线(本版本强制)**:

1. **不 fork、不 patch 上游**——需要改上游才能实现的,提 issue 不建 patch 目录
2. **不做 IdP**——不存密码、不签发身份令牌、不实现注册流程
3. **缺失 principal 一律 fail closed**——匿名解析不到任何凭据,不得回退到共享 key

**待确认项(不阻塞开发,按默认假设先行)**:

- 项目名法务审查(默认假设:"DSH" 为上游 CLI 名,风险可接受,发布前复核)
- `storage-domain` 是否可直接满足租户前缀需求(默认假设:可以,Session 6 先评估再决定是否新建包)

### 核心改进

- ★ **核心论点已证**:Harness 的服务契约可以被换成多用户实现,**消费方零改动**。
  `profiles/single-user.yml` 与 `team.yml` 的对照测试是这句话唯一的硬凭据。
- **六个运行时包落地**:principal / auth / auth-static / credentials-multiuser /
  fs-tenant / storage-scoped。
- **adapters 边界纪律**:唯一允许触碰上游内部的目录,ESLint 与 grep 双保险,
  且**豁免本身被验证有效** —— 不验豁免就不知道拦住的是违规还是所有人。
- **守卫本身有负向测试**:一条永远返回「通过」的守卫比没有守卫更危险,它给人虚假的安全感。
- **fail closed 是默认值**:匿名 principal 解析不到任何凭据,不回退到共享 key。
- 已知限制显著声明:**逻辑隔离不构成强边界**,跨信任边界需进程隔离。

> 实现细节见 [`SESSION_TASKS_HISTORY.md`](SESSION_TASKS_HISTORY.md)。

---

## (已发布版本区)

> 暂无。V0.1.0 发布后,其压缩摘要将出现在此处,完整实现细节移入 `SESSION_TASKS_HISTORY.md`。

---

# 第三部分 · 强制约束(所有开发必须遵守)

> 以下为强制约束的汇总速查。**`CLAUDE.md` 是权威源**,每个 Session 开工前必须先读 `CLAUDE.md`。
> 任一违反 = PR 阻塞。

## 一、架构与上游硬规则(8 条,PR 阻塞级)

1. **禁止 fork / patch 上游**——从 npm 消费 `@deepseek-ai/dsh-*`,需要改上游则提 issue
2. **只有 `adapters/dsh-<version>/` 允许 import 上游内部实现**,禁止深链 `/lib/` `/src/` `/dist/`
3. **上游依赖精确锁版**,禁止 `^` 与 `~`;运行时校验版本,不匹配拒绝启动
4. **禁止存储密码、签发身份令牌、实现注册流程**——DSHWAR 是身份消费者不是提供者
5. **凭据只暴露 `describe` 语义**(configured / source / writable),**永不返回值**
6. **缺失 principal 一律 fail closed**——不得回退到默认值或共享 key
7. **租户映射 fallback 默认 `reject`**——改为 `fixed` 需在 PR 描述显式说明理由
8. **不改上游语义**——单用户场景下 `single-user.yml` 与多用户 profile 行为必须一致
9. **开源分发的构建产物不得包含任何闭源组件**——`billing-hosted` 等闭源部分必须是独立构建产物。这既是 open-core 的边界,也是 SignPath Foundation 免费签名的资格条件(不得含维护者或关联组织发布的专有代码)

### PR 自查(grep 必须全为 0 / 全绿)

```bash
grep -rE "@deepseek-ai/dsh-[a-z-]+/(lib|src|dist)/" packages/ gateway/          → 0
grep -rE '"@deepseek-ai/[a-z-]+": *"[\^~]' packages/*/package.json              → 0
grep -rniE "bcrypt|argon2|scrypt|passwordHash|password_hash" packages/ gateway/  → 0
grep -rnE "resolve\(.*\)\.value" gateway/ --include=*.ts                        → 0
grep -rn "process\.env" packages/ --include=*.ts                                → 0
node scripts/check-oss-purity.mjs   # 开源构建产物不含闭源组件（硬规则 9）        → 0
pnpm typecheck && pnpm test && pnpm test:contract                               → green
pnpm eslint . --max-warnings 0                                                  → clean
```

## 二、文档瘦身与归档(强制)

**目的**:`SESSION_TASKS.md` 必须始终保持在 **Claude Code 单文件读取上限(150,000 字符)** 以内。超限时 Claude Code 读不全任务书,会基于残缺上下文开发,**且不会主动告知哪部分被截断**。

**触发时机**:每次版本发布后(该版本从"规划中"转为【已发布】时)**立即执行**。

**压缩规则**:

- **保留**(写进主文件):版本标题 / 简介 / 交付内容表(改了什么)/ 包含的 Session 标题 / 核心改进
- **删除并归档**(移入 `SESSION_TASKS_HISTORY.md`):Session 完整 prompt、实现步骤、接口规格、契约细节、验证动作、测试清单、git 命令 —— 即**"怎么实现的"一律不留在主文件**
- 压缩后块末尾注明:`> 实现细节见 SESSION_TASKS_HISTORY.md`

**一句话标准:记录「改了什么」,不记录「怎么改的」。**

**归档规则**:

- 被删内容**完整原样**追加到 `SESSION_TASKS_HISTORY.md` **开头**(保持从新到旧)
- 归档不做任何删减,不受体积限制,仅在追溯具体实现时查阅
- **未发布版本永不压缩**,保留完整任务详情供开发使用

**Session 状态标记(统一图例)**:

- ✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源
- 已发布版本的 Session 一律标 ✅;开发中版本**每完成一个即更新**
- 开发中版本块头部维护「Session 状态」小结表

**校验**:压缩后主文件字符数须 < 150,000;超出则继续压缩更早的版本块。
**何时准备**:文件超过 100,000 字符(上限 2/3)时即应准备压缩,不要卡到 150,000。

## 三、版本号统一更新(强制)

所有 `@dshwar/*` 包**统一版本号**(changesets fixed 模式)。每次发版以下位置必须一致,任一不一致 = 发布阻塞:

1. root `package.json` 的 `version`
2. 各 workspace 包的 `version`(由 changesets 统一提升)
3. `CLAUDE.md` 顶部「当前版本」
4. 本文件头部「当前版本(正在开发)」
5. `README.md` 兼容矩阵中的 DSHWAR 版本行
6. `gateway` 的 OpenAPI `info.version`(V0.2.0 起)

用 `scripts/check-version` 扫描全部位置并校验一致,接入 CI 作为发布阻塞项。

**开发版本号即时同步(强制)**:新版本规划确立后、第一个 Session 开工前,必须先把上述位置更新为**正在开发的版本号**。效果:开发环境版本号 = 正在开发版本号 = 最终发布版本号,发布时无需再改,杜绝"文档 / 开发环境 / 发布版本"三者不一致。

## 四、上游跟版(强制)

- Renovate 盯 `@deepseek-ai/dsh-*`,新版本自动开 PR
- 升级流程:Renovate PR → `pnpm test:contract` 跑红 → **只改 `adapters/`** → 绿了合并
- 目标:上游小版本 **48 小时内**跟上
- `README.md` 维护 DSHWAR × dsh 兼容矩阵,每次跟版更新
- 双轨:`stable` 跟已验证版本,`edge` 跟上游最新
- ⚠️ 上游 npm registry 版本号与 monorepo 根版本号**不一致**,**一律以 registry 为准**

## 五、代码规范(强制)

**TypeScript**:strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`;ESLint + Prettier;禁止 `any`;公开导出必须有 TSDoc,写**为什么**而非重述签名。

**契约包**:抽象类继承 cordis `Service`,`declare module` 增强 `Context`;实现包命名 `<contract>-<impl>`,与上游 `fs-local` / `storage-sqlite` 惯例一致。

**测试**:Vitest。每个上游接触点必须有契约测试;全部契约测试同时跑 `single-user.yml` 与多用户 profile。

**提交**:Conventional Commits;分支 `main` / `feature/v<版本号>`;PR 需含描述 / 影响范围 / 测试方式。

## 六、安全与隔离(强制)

- **隔离级别不是配置偏好,是安全等级**。逻辑隔离仅适用于互相信任的用户;跨信任边界必须进程隔离 + 容器
- README 与文档必须**显著声明**逻辑隔离的适用边界
- SCIM 令牌与 Admin 令牌**分离签发**(V0.3.0 起)
- Admin API Key **按租户签发**,不得横跨租户
- 所有 Admin 与 SCIM 调用进入审计,记录调用者 / 目标 / 变更前后
- 沙箱策略喂给上游 `sandbox-policy` / `fs-sandbox`,**不另起炉灶**
- **同一用户的不同工作区之间也是隔离的**,但隔离级别与租户间相同——逻辑隔离仅适用于互相信任的场景
- **不做运行时审批弹窗**。上游 SDK 协议的 server→client 请求是死能力;审批走**策略预授权 + 事后审计**,拒绝进 `@dshwar/audit`

## 七、开源与商业边界(强制)

- **MIT 开源**:全部运行时插件、API 平面、控制平面核心、`billing-local`
- **闭源**:仅 `billing-hosted`(Stripe / 微信 / 支付宝)与 DSHWAR Cloud 托管服务
- 这条线**公开写在 README**,藏着会失去信任
- **客户端分发**:开源版由项目签名(Windows 走 SignPath Foundation 免费通道,macOS 走 Apple Developer $99/年);**客户白牌版本由客户自己签名**——界面挂客户品牌,签名主体就该是客户。DSHWAR 只提供打包与签名的 CI 模板,不代签

## 八、商标与声明(强制)

- 项目名不含 "DeepSeek";README 必须声明非官方、无隶属关系
- 对上游的引用限于**指名性使用**,不得用于品牌暗示
- 发布前过法务

---
