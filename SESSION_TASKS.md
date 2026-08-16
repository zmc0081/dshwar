# DSHWAR 开发 Session 任务清单

> 项目对外名称:DSHWAR;npm 作用域 `@dshwar/*`;开源主仓 `dshwar`,控制平面仓 `dshwar-console`。
> 当前版本(正在开发): **V0.4.6** —— 本行强制为"正在开发的版本号",随新版本规划立即更新(见第三部分强制约束)

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
| V0.4.1     | `fs-tenant` 多工作区改造                                  | 3 天 | <span style="color:#d00000">开发完成</span>        |
| V0.4.5     | supervisor 进程隔离                                       | 2 周 | <span style="color:#d00000">开发完成</span>        |
| **V0.4.6** | **测试有效性与真实路径**                                  | 1 周 | <span style="color:#d00000">开发中</span>          |
| **V0.4.7** | **principal 抵达 agent 执行层**(🚨 发布阻塞)              | 1 周 | <span style="color:#d00000">待启动</span>          |
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
| **性能复测** | 进程隔离的 115 ms / 58 MB 需在 **Linux** 重测                  | 发布 V0.4.5 之前                                            |

> ⚠️ **性能复测不是走过场。** V0.4.5 的数字来自 Windows 开发机,而 Linux 上
> fork 更便宜、内存布局也不同。**若常驻内存明显更高,`maxProcesses` 的默认值
> (当前 64)必须跟着下调** —— 那个默认值是照 58 MB 算出来的,数字变了它就错了,
> 而它错的后果是部署方按文档配置却把机器吃到 OOM。
> 同时要更新 `docs/FEASIBILITY-REPORT-V45.md` §6、`docs/DEPLOYMENT.md` §2.5、
> `README.md` 已知限制、`CLAUDE.md` 第七节四处引用了这两个数字的地方。

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
> 开发中:**V0.4.6(测试有效性与真实路径)**
> 开发完成待发布:V0.4.5(Session 0-4) · V0.4.1(Session 0-2) · V0.4.0(Session 0-5) · V0.3.0(Session 0-7) · V0.2.0(Session 0-6) · V0.1.0(Session 0-8)
> 后续规划:V0.5.0 · V0.5.5 · V0.6.0 · V0.6.5 · V0.7.0 · V0.8.0(见「后续版本规划」)

---

## 后续版本规划(V0.4.5 → V0.8.0)

---

### 🚨 V0.4.7 · principal 抵达 agent 执行层(发布阻塞)

> **这是当前唯一的发布阻塞项。** 在它落地之前,本项目只适合单租户或评估用途 ——
> agent 执行的文件操作会跨租户共用同一个目录。
>
> 完整背景、清点结果与决策见
> [`docs/DECISIONS/principal-scope-binding.md`](docs/DECISIONS/principal-scope-binding.md)。

**根因**(V0.4.6 Session 0 实测):principal 绑定活在 cordis 的**上下文槽位**上,
而 **agent 拿到的是它自己的 ctx**(由 `AgentRegistry` 插件的 fiber 派生,根上下文)。
工具与适配器都跑在那个 ctx 上,于是全部读到 `ANONYMOUS`。

⚠️ **与「作用域活多久」无关。** 全程 await 到底、全程待在作用域内,结果一样。
这个机理曾被写错两次(都写成「AsyncLocalStorage 作用域过期」)——
错误的机理会导出错误的修法,所以记在这里。

**范围**:三个消费方。

| 包                      | 失败形态                             | 修法                                                             |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `credentials-multiuser` | fail closed —— 拒绝服务,吵闹          | 消费点显式重入(已验证可行)                                       |
| **`fs-tenant`**         | 🚨 **不 fail closed,跨租户共用目录** | 加 `principalOf?: () => Principal` 配置回调,与已有的 `workspaceOf` 同款 |
| `storage-scoped`        | 同上;当前未装配,V0.5.5 会装配        | 同上 —— **必须赶在 V0.5.5 之前**                                  |

**已定的事**:

- 走 **B(逐点显式重入 / 配置注入)+ 守卫**。守卫已在 V0.4.6 落地
  (`principal.current()` 调用点白名单,含两个方向的负向验证)
- **A(在 `createAgent` 处一次绑定)已证伪** —— 三组对照全部读到 `anonymous`。
  要走那条路必须上游给钩子,按硬规则 1 提 issue,不排期
- 快照语义要写进文档:**IdP 侧停用不是即时的**,已开始的那一轮不会中断
  (生命周期校验在建会话时做,窗口是分钟级)

**验收**:一条在**真实时序下**(agent 执行时,不是测试里直接调)断言工作区落点
正确的测试。V0.4.6 Session 3 的「作用域类探针」就是为它准备的。



> 本节是**路线图**,不是任务书。每个版本在成为「正在开发版本」时,提升为完整版本块
> 并补齐 Session prompt。此处只记录已定的决策与交付范围,避免为尚未定型的设计写死细节。

---

### ~~V0.4.5 · supervisor 进程隔离~~ —— 已提升为完整版本块

> 2026-08-16 提升为「正在开发版本」,完整任务书见上方 M0.4.5 块。
> 提升时更正了本节引言里一处**已被推翻的动机**(「解决无 cancel」)——
> 见 M0.4.5 块的「开工前的一处更正」。以下为提升前的原始记录:

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

## <span style="color:#d00000">●</span> M0.4.6 · 测试有效性与真实路径(Session 0-4) <span style="color:#d00000">[开发中]</span>

> **这一版修的不是某个 bug,是「我们凭什么相信绿色」。**
>
> V0.4.5 收尾时冒出四个顺带发现,typecheck 上线后又暴露六处「测试通过但没测到
> 东西」。它们看着互不相干,指向的却是同一个系统性缺口:
>
> **708 个测试全绿,但没有任何机制验证「实现坏掉时测试真的会红」;
> 而整个测试体系跑在 fake 上 —— 真实网关从 V0.2.0 交付至今,
> 从未跑通过一轮真实对话。**
>
> 📌 **核心论点**:测试的价值不在于它通过,而在于**它在该失败的时候失败**。
> 一个永远绿的测试与没有测试等价,但更糟 —— 它让人以为有覆盖。
>
> 开工前必读 `CLAUDE.md`。
>
> **不做的事**:不做全量变异测试(投入产出比不划算,且会把 CI 拖到分钟级);
> 不重构现有测试;不动 `/v1` 之外的契约面。

### 这一版的由来:两组证据

**一组来自 V0.4.5 的顺带发现**(均非 V0.4.5 引入,是被它照出来的):

| # | 发现                                                     | 症状                             |
| - | -------------------------------------------------------- | -------------------------------- |
| 1 | 契约映射表写着 `agent/error` → `error`,但那是 cordis Context 上的事件,`translateEvent` 永远看不到 | agent 报错时 SSE 流静默停住      |
| 2 | `assembleRuntime()` 装了 `dsh-llm` 却从未注册任何 provider | 真实网关起得来,但发不出一轮对话 |
| 3 | 配额判定挂在 `/turns`,而进程在建会话时就起来              | 配额耗尽的租户仍能占满进程槽位   |
| 4 | 测试文件从未经过 `tsc`                                    | 一次会话踩了三个编译期可见的错误 |

**另一组来自 typecheck 上线**(`b635a2d`,已于 2026-08-16 合并):
它给全仓 19 个包各配了一份 `tsconfig.test.json`,并在纳入检查后修掉了
**7 个测试文件**里的错误。这些就是「测试通过但没测到东西」的实物证据。

#### 失效断言清单 —— Session 3 探针的经验依据

把它们按「运行时是否真的没测到」分开,因为两类的教训不同:

**A 类:真失效 —— 测试当时确实没在测该测的东西**

| 文件                                        | 问题                                                                 | 后果                                                       |
| ------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `adapters/…/usage-observability.test.ts` + `gateway/test/harness.ts` | 假适配器吐 `reason: 'stop'`,而上游的 `FinishReason` 是对象 `{ kind: 'stop' }` | 下游读 `reason.kind` 拿到 `undefined` —— 假模型不忠实于上游,而契约测试的全部价值就在忠实 |
| `packages/supervisor/test/pool.test.ts`   | `Partial<Parameters<typeof Supervisor.prototype.constructor>[0]>` —— `Supervisor.prototype.constructor` 的类型是 `Function`,`Parameters<Function>` 不给任何约束 | `make({ … })` 的选项**完全没有类型检查**,选项名写错会被静默忽略,测试照样绿 |
| `packages/webhooks/test/webhooks.test.ts` | `statuses[i]` 在 `noUncheckedIndexedAccess` 下是 `number | undefined` | `new Response(null, { status: undefined })` **默认成 200** —— 重试测试可能一直在测 200,而不是它想测的状态码 |
| `packages/auth-static/test/auth-static.test.ts` | `promise.catch(e => e as AuthError)` | `verify` 万一**没有**拒绝,成功的 `Principal` 会被原样递下去,后续断言在错误的对象上找 `.message` |

**B 类:类型层修正 —— 运行时本来就对,但掩盖了可读性或未来的坑**

| 文件                                      | 问题                                                        |
| ----------------------------------------- | ----------------------------------------------------------- |
| `gateway/test/sdk-example.test.ts`      | `resolve: () => undefined` 应为 `async` —— `await undefined` 恰好也是 `undefined`,所以没炸 |
| `packages/api-contract/test/freeze.test.ts` | `buildOpenApiDocument()` 漏了必填的 `version` —— 比对两侧都是 `undefined`,判定仍成立 |
| `gateway/test/harness.ts`               | 重复读 `request.signal?.aborted` 被 TS 判成恒假 —— 运行时每次都重读,取消是有效的 |

⚠️ **A 类的第 2 条是我在 V0.4.5 Session 1 写的。** 它意味着 supervisor 的 37 条
测试里,凡是通过 `make({...})` 传选项的那些,**选项名从未被校验过**。
这正是本版本存在的理由:绿色本身不构成证据。

⚠️ **`.mjs` 夹具是这套机制结构上够不到的盲区。** 全仓两个
(`echo-child.mjs` / `child-agent.mjs`),后者带着与 A 类第 1 条**完全相同**的
`reason: 'stop'` 错误,合并时由人工看出来并修掉 —— 不是被检查抓出来的。
处理方式见 Session 1 第 5 条。

⚠️ **第 2 条与第 4 条的组合是这一版存在的理由。** 测试用的是自带假模型的
harness,而不是产品装配路径 `assembleRuntime()` —— 于是「网关没有 provider」
这个致命缺口被 708 个绿色测试**完整地掩盖了三个版本**。
测试没有说谎,它只是从来没被问到那个问题。

### Session 状态

| Session                    | 状态      | 说明                                      |
| -------------------------- | --------- | ----------------------------------------- |
| 0 端到端冒烟:真实路径      | ⬜ 未开始 | **最高优先级** —— 网关到底能不能发出对话  |
| 1 `scripts/` 纳入类型检查  | ⬜ 未开始 | **范围已缩窄** —— test 部分已由 b635a2d 完成 |
| 2 配额两段判定             | ⬜ 未开始 | 准入 + 计费,两处都做                      |
| 3 断言有效性探针           | ⬜ 未开始 | 故意弄坏实现,确认测试变红                 |
| 4 `agent/error` 送达 + `unavailable` | ⬜ 未开始 | 补上契约里写了却没实现的那条              |

图例:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源

### 本次需求清单

| 编号 | 需求                                                         | 所属 Session |
| ---- | ------------------------------------------------------------ | ------------ |
| R0   | **真实路径冒烟**:真 `assembleRuntime()` + 真 provider + 真网关跑通一轮 | Session 0    |
| R1   | `scripts/*.ts` 纳入类型检查,修既有错误                       | Session 1    |
| R2   | `examples/minimal-server` 补 `tsconfig`                       | Session 1    |
| R3   | **配额两段判定**:建会话用快照准入,`/turns` 用精确值计费      | Session 2    |
| R4   | **断言有效性探针**:四处核心断言的负向测试,纳入 `check:all`   | Session 3    |
| R5   | `agent/error` 送达 SSE 客户端                                | Session 4    |
| R6   | `ErrorCode` 补 `unavailable`,池满改返 503                    | Session 4    |
| R7   | 契约明确「客户端必须优雅处理未知枚举值」,冻结检查放行枚举新增 | Session 4    |

### 三条已拍板的决策

#### 决策 1:`ErrorCode` 现在就补 `unavailable`,不等 V0.5.0

V0.4.5 把进程池满映射成 `429`,理由是契约的 `ErrorCode` 是闭集、加值会被
冻结检查判为破坏性变更。**那个折中现在撤销。**

> **理由:整个项目尚未发布任何版本,现在改契约成本为零。**
> `npm view @dshwar/fs-tenant` 返回 404 —— 没有任何下游在消费这个契约,
> 「破坏性」一词此刻没有承载对象。等到 V0.5.0 再改,代价就真的存在了。

配套三件事,**缺一不可**:

1. `ErrorCode` 加 `unavailable`,`STATUS_BY_CODE` 映射到 **503**。
   语义:「你没做错什么,是这台机器满了」——与 `rate_limited`(429,
   「你请求太多」)是两件事,混在一起会让客户端错误地限制自己。
2. **契约里明确规定「客户端必须优雅处理未知枚举值」。** 这是前提,不是附注 ——
   没有这条规定,加值确实会打穿下游写全的 `switch`。
3. 冻结检查把 `enum.value.added` 从破坏性变更中**排除**。

> ⚠️ **这一条与 `freeze.ts` 现有的判据直接冲突,改的时候要连理由一起改。**
> 那里写着「闭集枚举加值会让下游已写全的 `switch` 编译失败」——
> 这个判断在没有第 2 条规定时是**对的**。所以顺序是:先在契约里立下规定,
> 再放宽检查。只做后者是把安全网剪了一个洞。
>
> 相应地,`enum.value.removed` **仍是破坏性变更**,不受本决策影响 ——
> 删值会让下游正在处理的分支变成死代码,那是真的坏。

#### 决策 2:`scripts/*.ts` 统一纳入根级 `tsconfig.scripts.json`

与 test 的接入机制相同。**不是每个包各配一份** —— 脚本散在
`packages/api-contract/scripts/`、`sdk/typescript/scripts/` 等处,
逐包配置会重复同一段样板,而漏配的那个包就是下一个静默错误的藏身处。

#### 决策 3:配额准入与计费是两件事,两处都做

不是二选一。

| 时机       | 数据源           | 目的                             | 失败模式                       |
| ---------- | ---------------- | -------------------------------- | ------------------------------ |
| 建会话     | **缓存快照**(几秒过期) | 准入,防 DoS 向量           | 略微滞后,允许极少量超额         |
| `/turns`   | **精确值**       | 计费与限流                       | 无                             |

> ⚠️ **准入路径不能同步等计量。** `MeteringStore.query()` 是异步的,
> 而建会话是热路径 —— 每次建会话都去查一遍计量,等于把计量组件放进了
> 会话创建的故障域,这与 `@dshwar/policy` 「计量是账目组件,不是安全组件」
> 的既有立场直接矛盾。所以准入读的是**快照**,过期即刷新,查不到就放行
> (fail open,与 policy 现有语义一致)。
>
> 快照的存在只为堵住「配额耗尽的租户不断建会话占满进程槽位」这个 DoS 向量,
> 不为精确计费 —— 精确计费在 `/turns`,那里本来就要等。

### 本版本红线

1. **不放宽任何已有的安全断言。** 本版本是给测试加牙齿,不是给实现松绑。
   任何「为了让测试通过而改断言」的改动都要在 PR 描述里单独说明。
2. **Session 0 的冒烟必须走产品装配路径。** 用 `assembleRuntime()`,
   不用 `createTestHarness()`。用 harness 就是重演已经掩盖了三个版本的那个错误。
3. **`enum.value.removed` 仍是破坏性变更。** 决策 1 只放宽新增。
4. **探针不进 CI 常规路径的耗时预算。** Session 3 的负向测试若把 `check:all`
   拖过一分钟,就拆成单独的 script,而不是让所有人每次都等。

---

### ⬜ Session 0: 端到端冒烟:真实路径(最高优先级)

> ⚠️ **这是本版本唯一的「必须做」。** 其余四个 Session 都是加固,
> 只有这一个回答一个至今无人回答的问题:**网关能不能发出一轮真实对话?**
>
> V0.2.0 的验收标准写着「第三方仅凭 HTTP 就能完成一次完整会话,不接触 dsh」。
> 那条标准一直由 `createTestHarness()` 验证 —— 而 harness 自带假模型,
> `assembleRuntime()` 不带。**两者的差异恰好落在没被测的那一格里。**

```
读取 CLAUDE.md。本次任务:让真实网关跑通一轮真实对话。不改测试架构。

1. 先查清 provider 从哪来
   - 上游 @deepseek-ai/dsh-llm 提供什么内置 adapter？有没有官方 DeepSeek provider 包？
   - ★ 先查再设计，不要凭空造一个 adapter
   - 硬规则 2：只有 adapters/dsh-<version>/ 允许 import 上游内部实现
   - 硬规则 3：上游依赖精确锁版

2. 把 provider 接进 assembleRuntime()
   - RuntimeOptions 加 provider 配置（provider 名 / 模型 / base URL / 凭据来源）
   - ★ 凭据必须走 @dshwar/credentials-multiuser 的 per-principal 解析
     不得从 process.env 直接读（硬规则 6 + 「配置只经 profile 注入」）
   - 若结论是「adapter 由部署方注册，网关不内置」：
     那也要让 assembleRuntime() 在没有任何 provider 时**拒绝启动或打醒目警告**，
     并在 docs/DEPLOYMENT.md 写清部署方必须做什么

3. 端到端冒烟
   - 起真实 server（startServer），用真实凭据发一轮，收到真实回复
   - 这一条**需要真实 API key**，属于外部资源。拿不到 key 时：
     用一个照上游契约写的最小 provider（本地 echo/stub），
     但它必须经 assembleRuntime() 的 provider 配置路径注册，
     ★ 不得走 createTestHarness()

4. 加守卫，不让缺口重现
   - 一条测试：assembleRuntime() 装出来的运行时，ctx.llm 里确实有已注册的 provider
   - 这条测试的作用是不让「测试布局掩盖产品缺口」再次发生

== 产出 ==
- 真实网关能发出一轮对话的证据（日志或测试输出，贴进 PR）
- 若走 stub：明确记录「真实 provider 仍未验证」，并进发布清单
```

验证:

- ★ 红线 2:冒烟走 `assembleRuntime()`,不走 `createTestHarness()`
- `/publish feat: {v} session 0 real-path smoke test`

---

### ⬜ Session 1: `scripts/` 纳入类型检查(范围已缩窄)

> ⚠️ **`test/` 部分已经做完了,不在本 Session 范围内。** 立项时以为要一起做,
> 但那份工作在 `b635a2d` 里独立完成并已合并(见本版本块开头的「合并进来的成果」)。
> 本 Session 只剩 `scripts/`,**照 `tsconfig.test.json` 那套现成机制照搬即可**。

**开工前已复核的实际状态**(2026-08-16 实测,不是推测):

| 目标                                   | 状态                                              |
| -------------------------------------- | ------------------------------------------------- |
| `sdk/typescript/scripts/`(generate + render) | ✅ **已经干净** —— `render.ts` 被 `b635a2d` 顺手修了,只需登记进机制 |
| `packages/api-contract/scripts/generate-openapi.ts` | ❌ TS2339 **仍在**(第 40 行),是唯一已知的待修错误 |
| `examples/minimal-server`            | ❌ 仍无 `tsconfig.json`(`examples/sdk-session` 有,照它配) |

```
读取 CLAUDE.md。本次任务:把 scripts/*.ts 纳入 tsc，机制与 test 相同。

1. 根级 tsconfig.scripts.json（决策 2）
   - ★ 照 tsconfig.test.json 抄，不要另发明一套。那份已经过一轮实战，
     连守卫、CI 接线、negative test 都齐了
   - noEmit: true，覆盖两处：
     packages/api-contract/scripts/、sdk/typescript/scripts/
   - 加 npm script（typecheck:scripts），接进 check:all

2. 修唯一已知的错误
   - packages/api-contract/scripts/generate-openapi.ts:40
     TS2339: Property 'version' does not exist on type 'OpenApiDocument'
     ★ 合并之后复测仍在
   - 注意 freeze.test.ts 已经因为同一个类型改成了
     buildOpenApiDocument('0.0.0-freeze-test')——修的时候看一眼那边的取舍

3. examples/minimal-server 补 tsconfig
   - 照 examples/sdk-session 配，登记进根 tsconfig references

4. check-guards.mjs 加守卫
   - 仿照已有的两条（根 tsconfig references / 根 tsconfig.test.json references）
   - 新增：「每个含 scripts/*.ts 的位置都已登记进 tsconfig.scripts.json」

5. ★ .mjs 夹具的盲区 —— 本 Session 只需记录，不必解决
   - tsconfig 那套机制结构上够不到 .mjs。全仓两个：
     packages/supervisor/test/fixtures/echo-child.mjs
     adapters/dsh-0.1.0/test/fixtures/child-agent.mjs
   - 后者曾有与 7 个 .ts 测试文件完全相同的 finish reason 形状错误
     （reason: 'stop' 应为 { kind: 'stop' }），已在合并时人工修掉 ——
     但它是**被人看出来的**，不是被检查抓出来的
   - 可选做法（评估后再定，别硬上）：改写成 .ts 走 strip-types 跑，
     或加 // @ts-check + JSDoc。两者都有代价，写清楚再选

== 测试 ==
- 负向:故意在某个 script 里写一个类型错误，确认 typecheck:scripts 变红
- 负向:新增一个未登记的 scripts 目录，确认守卫变红
```

验证:

- `/publish chore: {v} session 1 typecheck scripts`

---

### ⬜ Session 2: 配额两段判定

```
读取 CLAUDE.md 与 packages/policy/src/index.ts 的 fail open 说明。
本次任务:堵住「配额耗尽的租户占满进程槽位」这个 DoS 向量。

1. 建会话侧:快照准入（决策 3）
   - 在 policy 包加一层配额快照，几秒过期（可配，默认建议 5s）
   - ★ 准入路径不得同步等 metering.query()（它是异步的，且是热路径）
   - 查不到快照就放行 —— fail open，与 policy 现有语义一致
   - 快照只为堵 DoS 向量，不为精确计费

2. /turns 侧:精确判定
   - 保持现状不动。那里本来就要等，精确值是对的

3. 与进程隔离联动
   - gateway/test/isolation.test.ts 里有一条
     「【已知缺口】配额耗尽的租户仍能建会话并占用进程槽位」
     ★ 它的失败信息写着「若这里变成 429，说明缺口已修，请更新本测试」——
     修完必须更新它，否则它会变成一条阻碍正确行为的测试

4. 两档隔离行为一致
   - ★ 红线 2（V0.4.5）：客户端不该知道自己跑在哪种隔离下
   - 准入行为在 logical 与 process 两档必须相同

== 测试 ==
- 配额耗尽的租户建会话被拒（两档都测）
- 准入不阻塞:metering 挂掉时建会话仍然成功（fail open）
- 快照过期后能刷新到新值
- 精确计费仍在 /turns，未被准入替代
```

验证:

- `/publish feat: {v} session 2 two-stage quota admission`

---

### ⬜ Session 3: 断言有效性探针

```
读取 CLAUDE.md。本次任务:证明关键测试会在实现坏掉时变红。

★ 这是本版本的核心产出。做法是**故意弄坏实现，确认对应测试变红**，
  而不是做全量变异测试（投入产出比不划算，且会把 CI 拖到分钟级）。

1. 四处核心断言各写一个探针
   - 取消:把 agent.cancel() 改成空实现 → 取消测试必须红
   - 隔离:把 fs-tenant 的路径钉死去掉一段 → 隔离测试必须红
   - 配额:把配额判定改成永远 allow → 配额测试必须红
   - 契约:在 openapi 里删一个端点 → check:contract 必须红

   ★ 选这四处不是拍脑袋。版本块开头的「失效断言清单」是实测得来的,
     A 类四条里有三条落在假适配器与测试夹具上（假模型不忠实于上游、
     选项没有类型约束、索引取空后静默默认）——**探针要针对的正是这一类：
     被测对象没坏，是喂给它的东西坏了，于是断言测了个寂寞。**
     写探针时优先弄坏「实现」，但也要有一条弄坏「夹具」的
     （例如把 harness 的 FinishReason 改回字符串），确认对应测试变红。

2. 探针怎么实现
   - 不要真的改源码再改回来（会污染工作树，且中途失败会留下坏代码）
   - 建议:在临时目录里 patch 一份副本再跑，或用 vitest 的模块 mock 覆盖实现
   - ★ 探针失败的信息必须说清「哪条断言失去了效力」，
     而不只是「探针没通过」—— 后者要人再花十分钟才知道发生了什么

3. 纳入 check:all
   - ★ 红线 4:若把 check:all 拖过一分钟，拆成单独 script

== 测试 ==
- 四个探针各自跑通（即:弄坏后确实变红）
- 反向:不弄坏时探针不误报
```

验证:

- ★ 红线 1:不放宽任何已有的安全断言
- `/publish test: {v} session 3 assertion effectiveness probes`

---

### ⬜ Session 4: `agent/error` 送达 + `unavailable`

```
读取 CLAUDE.md。本次任务:补上契约里写了却没实现的那条，并落实决策 1。

1. agent/error 送达 SSE 客户端
   - 实测（V0.4.5 Session 2）：agent/error 是挂在 cordis Context 上的事件
     （dsh-agent/lib/types/runtime-types.d.ts:316，签名带 this: Scoped<Agent>），
     不是 SessionEventMap 成员，所以 translateEvent 永远看不到它
   - 要在 GatewaySessionStore.register() 里另开一条 ctx.on('agent/error', …) 订阅
   - ★ 主要难点是 seq 分配：agent/error 没有 seq，而 EventBuffer 与
     Last-Event-ID 都按 seq 过滤。直接借 lastSeq + 1 会与随后到来的真实
     上游事件（如 turn/end）撞号
   - V0.4.5 的 fail() 能安全借号，前提是「终结之后不再有上游事件」——
     agent/error 不一定终结，不能照抄
   - 两个方案，先评估再动手：
     a. 网关自持 seq 计数器（彻底，但要改现有断言 seq 的测试）
     b. 为合成事件预留号段（局部，但要论证不破坏续传）

2. ErrorCode 补 unavailable（决策 1）
   - ErrorCode 加 'unavailable'，STATUS_BY_CODE 映射 503
   - gateway/src/isolation.ts 的 AtCapacityError 映射改为 unavailable
     （现在是 rate_limited，那里的注释写明了这是被红线逼出来的折中）
   - ★ 三件配套缺一不可，见决策 1

3. 契约规定「客户端必须优雅处理未知枚举值」
   - 写进 packages/api-contract 的对外说明与 OpenAPI 描述
   - SDK 侧确认:遇到未知枚举值不抛，走 default 分支

4. 冻结检查放行枚举新增
   - freeze.ts 的 enum.value.added 从 breaking 改为 additive
   - ★ 连同它现有的理由一起改 —— 那句「闭集枚举加值会让下游已写全的
     switch 编译失败」在没有第 3 条规定时是对的
   - enum.value.removed 保持 breaking（红线 3）

== 测试 ==
- agent 报错时 SSE 收到 error 事件（不是流静默停住）
- 续传（Last-Event-ID）在错误事件前后都不丢不重
- 进程池满返回 503 且 code 为 unavailable
- check:contract 对枚举新增放行、对枚举删除仍然拦
```

验证:

- ★ 红线 3:`enum.value.removed` 仍是破坏性变更
- `/publish feat: {v} session 4 agent error delivery and unavailable code`

---

## <span style="color:#d00000">●</span> M0.4.5 · supervisor 进程隔离(Session 0-4) <span style="color:#d00000">[开发完成]</span>

> **这一版换来的是「敢卖给互不信任的用户」。** 到 V0.4.1 为止,隔离级别只有
> **逻辑隔离**,而 README、CLAUDE.md 第七节、`fs-tenant` 的文档全都写死了
> 「逻辑隔离仅适用于互相信任的用户」。那句话是对的,也因此把产品挡在
> 「一家公司内部」这个天花板下 —— 面向公众的多租户 SaaS、免费试用与付费用户
> 混跑,现在一律劝退。
>
> 📌 **核心论点**:一 principal 一进程,越界成本从「提示词注入即可」升到
> 「需要一个进程逃逸漏洞」。
>
> 开工前必读 `CLAUDE.md` 与 `ARCHITECTURE.md` §2.4。
>
> **不做的事**:不做容器隔离的实现(profile 里留档位,实现随部署方的编排系统);
> 不做跨机调度(那是 V0.5.0 控制平面的事);不改 `/v1` 契约。

### 交付内容(改了什么)

| 交付                              | 说明                                                                  |
| --------------------------------- | --------------------------------------------------------------------- |
| `@dshwar/supervisor`(新包)       | 一 principal 一进程的进程池。租约模型、进程上限、空闲回收、两种健康检查、僵尸进程防护 |
| `gateway/src/worker.ts`(新)      | 子进程入口。装配复用 `assembleRuntime()`,不重写一份                     |
| `gateway/src/sessions/remote.ts`(新) | 跨进程 agent 句柄,戴与进程内句柄相同的 `AgentHandleLike` 面孔          |
| `gateway/src/isolation.ts`(新)   | 三档隔离的**唯一**分派点                                               |
| `GatewaySessionStore.fail()`     | 崩溃终结会话 → SSE 推 `error` 后收流,不静默丢失                        |
| `AgentHandleLike.agent.ctx`      | 由 `CordisContext` 收窄为 `SessionEventSource`(只含 `on('session/event')`) |
| `AgentFactoryFn`                 | 入参加 `principal` —— 进程按主体分配                                   |
| `gateway.config.json`            | 新增 `isolation` 段,并真的接进 `server.ts`                            |
| README / CLAUDE.md §7 / ARCHITECTURE.md §2.4 / DEPLOYMENT.md §2.5 | 隔离矩阵改写,新增「进程隔离仍然不是什么」 |

### 核心改进要点

1. **红线 2 靠契约而非分支达成**。跨进程句柄满足与进程内句柄完全相同的
   `AgentHandleLike`,于是会话簿、SSE、计量、`DELETE` 全部一行不改,
   `/v1` 契约零变更。`process` 档复用既有验收路径**一字不改**跑通。
2. **取消是代价不是收益**。进程内的 `Agent.cancel()` 从 V0.2.0 起就可用;
   进程隔离把它变成待解问题。实现为三级降级:IPC 取消(正路,只停本路会话)
   → SIGTERM → SIGKILL。已更正 `CLAUDE.md` 与 `ARCHITECTURE.md` 里反向的表述。
3. **seq 原样透传,不重编号**。实测上游 seq 是每 agent 各自从 0 起算,
   会话怎么分组都不影响它 —— 重编号只会制造两档不一致的风险面。
4. **默认不变**(红线 1),且配错级别**拒绝启动**而非静默回退。
5. **满了就拒绝,不排队**。排队会把「进程不够」升级成「网关被挂起的请求拖垮」。

### 实测代价(五次采样,Windows 开发机)

冷启动 **~115 ms**(其中插件装配仅 ~13 ms)、常驻 **~58 MB/进程**。
冷启动九成花在进程创建与模块加载上 —— 优化装配代码没用,只能压进程复用率,
这正是选「一 principal 一进程」而非「一会话一进程」的原因。

### 已知缺口(已开独立任务)

- 配额判定挂在发起轮次上,而进程在建会话时就起来 —— 配额耗尽的租户仍能占用进程槽位
- `container` 档只是配置位,实现交给部署方的编排系统
- 待发布前补:Linux 上重测性能数字;node-pty 两层嵌套

### Session 状态

| Session                             | 状态      | 说明                               |
| ----------------------------------- | --------- | ---------------------------------- |
| 0 可行性证伪:跨进程驱动             | ✅ 已完成 | **止损未触发**;A/B/C/D 全绿,E 延至 Session 1;报告见 `docs/FEASIBILITY-REPORT-V45.md` |
| 1 `@dshwar/supervisor` 契约与进程池 | ✅ 已完成 | 进程池 + 租约模型;37 条测试        |
| 2 跨进程会话驱动                    | ✅ 已完成 | 逐条对照通过;红线 3 保住           |
| 3 隔离级别与网关接线                | ✅ 已完成 | 三档就位,默认仍 logical            |
| 4 文档与发布准备                    | ✅ 已完成 | 隔离矩阵改写,配置键真的生效        |

图例:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源

### 本次需求清单

| 编号 | 需求                                                          | 所属 Session |
| ---- | ------------------------------------------------------------- | ------------ |
| R0   | **可行性证伪**:子进程里能否驱动 agent、拿回流式事件、可靠取消 | Session 0    |
| R1   | `@dshwar/supervisor`:进程池编排,一 principal 一进程           | Session 1    |
| R2   | 进程生命周期:spawn / 健康检查 / 空闲回收 / 上限               | Session 1    |
| R3   | 跨进程的会话驱动与事件回传,SSE 语义不变                       | Session 2    |
| R4   | **可靠取消**:终止进程即取消 —— 补回进程隔离带来的代价         | Session 2    |
| R5   | 崩溃恢复:进程死亡后的会话状态处理,不静默丢失                  | Session 2    |
| R6   | 隔离级别三档由 profile 选择,**默认仍是逻辑**                  | Session 3    |
| R7   | 与 `policy` / `metering` 联动,**不另起一套**                  | Session 3    |
| R8   | 文档:隔离矩阵、README 警告改写、部署指南                      | Session 4    |

**本版本红线**:

1. **默认不变。** 隔离级别默认仍是逻辑隔离 —— 进程隔离要显式开。
   默认改行为会让现有部署在升级后突然多出一堆进程。
2. **`/v1` 契约零变更。** 隔离级别是部署决策,不是 API 概念。
   客户端不该知道自己跑在哪种隔离下。
3. **取消语义不退化。** 进程隔离之后 `DELETE /v1/sessions/{id}` 必须**仍然**
   立刻截断输出。做不到就是这一版没做完。
4. **不重做沙箱。** 进程隔离之上的 OS 沙箱仍喂给上游 `sandbox-policy`,
   容器档只留配置位,实现交给部署方的编排系统。

> 实现细节见 SESSION_TASKS_HISTORY.md

---

## <span style="color:#d00000">●</span> M0.4.1 · `fs-tenant` 多工作区改造(Session 0-2) <span style="color:#d00000">[开发完成]</span>

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

### ✅ Session 2: 文档、profile 与 V0.1.0 发布准备

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

## 一、架构与上游硬规则(9 条,PR 阻塞级)

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
