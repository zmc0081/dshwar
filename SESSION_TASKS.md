# DSHWAR 开发 Session 任务清单

> 项目对外名称:DSHWAR;npm 作用域 `@dshwar/*`;开源主仓 `dshwar`,控制平面仓 `dshwar-console`。
> 当前版本(正在开发): **V0.1.0** —— 本行强制为"正在开发的版本号",随新版本规划立即更新(见第三部分强制约束)

---

## 文档结构说明

本文档分三大部分:

1. **第一部分 · 项目基本介绍**:项目定位、架构边界、准备阶段、使用方式、Session 完成后的验证步骤。
2. **第二部分 · Session 任务记录(倒序)**:按版本从新到旧排列(最新在最上)。
   - <span style="color:#d00000">**红色标记 = 该版本尚未上线**</span>(规划中,保留完整任务详情)
   - Session 状态:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源
   - 未标红 = **已发布**,已压缩为"改了什么"的摘要;
     **实现细节见 `SESSION_TASKS_HISTORY.md`**
3. **第三部分 · 强制约束**:所有开发必须遵守的强制约束,**CLAUDE.md 为权威源**。

> **文件瘦身规则(强制)**:版本发布后,其任务块压缩为
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

| 版本       | 内容                                                      | 周期 | 状态                                      |
| ---------- | --------------------------------------------------------- | ---- | ----------------------------------------- |
| **V0.1.0** | 运行时平面 MVP + 开源首发                                 | 3 周 | <span style="color:#d00000">规划中</span> |
| V0.2.0     | API 平面:OpenAPI v1 + Gateway + SDK + Admin 端点          | 4 周 | 待启动                                    |
| V0.3.0     | 身份互操作:Subject Mirror + SCIM 2.0 + 租户映射 + Webhook | 2 周 | 待启动                                    |
| V0.4.0     | 计量与治理:metering + policy + model-router               | 3 周 | 待启动                                    |
| V0.5.0     | 控制平面:租户/成员/订阅/运营后台                          | 5 周 | 待启动                                    |
| V0.6.0     | 支付:billing 契约 + local + 首个 hosted 实现              | 3 周 | 待启动                                    |
| V0.7.0+    | 端:移动端 SDK + 对话前端                                  | 持续 | 待启动                                    |

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
> 规划中(开发中,未上线):V0.1.0(Session 0-8)

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

### 在开始 Session 0 之前

```bash
git clone git@github.com:<org>/dshwar.git && cd dshwar
git checkout -b feature/v0.1.0
# 版本号即时同步：CLAUDE.md 顶部、本文件头部、root package.json 均写 0.1.0
```

---

### ⬜ Session 0: 可行性证伪(3 天,止损点)

> ⚠️ **本 Session 的目的是证伪,不是交付。** 整套架构压在两条上游行为上,不先验证,
> 后面五个月都是赌。**结论为否时,立即停止并按下方止损路径调整架构,不要绕过。**

```
读取 CLAUDE.md 与 ARCHITECTURE.md §2.2。

本次任务:验证两条上游行为，不写任何产品代码，产出一份验证报告。

1. 环境准备
   - 按上游 examples/jsonrpc-demo 的 cordis.yml 在本机跑通 dsh
   - 记录：监听端口、协议形态（stdio / HTTP / SSE / WS）、认证方式

2. 验证 A —— ctx.isolate 作用域传播
   - 用 ctx.isolate('principal') 派生两个兄弟子上下文，各绑一个 principal
   - 断言：子上下文 a 读不到子上下文 b 的 principal
   - 断言：父上下文不受子上下文影响

3. 验证 B —— 凭据不跨操作缓存
   - 在同一运行时内先后用两个 principal 解析同一个 credential ref
   - 断言：第二次解析返回第二个 principal 的值，无需重启任何插件
   - 断言：换绑后的新值在「下一次」操作即生效，不是下一个会话

4. 验证 C —— 并发无串号
   - 并发发起两个 principal 的解析各 100 次
   - 断言：无一次串号

5. 验证 D —— node-pty 在外部拉起的子进程中行为正常
   - 确认 dsh-subprocess-local 的 PTY 能力在非交互式父进程下可用

== 产出 ==
docs/FEASIBILITY-REPORT.md，包含：
- 四项验证的通过/失败结论与复现步骤
- dsh 实际暴露的通道形态（端口、协议、认证）
- 若失败：失败点的具体表现与最小复现

不要写产品代码。不要建 packages/。本 Session 只产出验证脚本与报告。
```

验证:

- 四项全过 → 进入 Session 1,架构不变
- **验证 A 或 C 失败** → cordis 作用域机制与文档不符 → 架构改为**进程级隔离优先**,`supervisor` 从 V0.4.0 提前到本版本,`ARCHITECTURE.md §2.4` 与路线图同步修订
- **验证 B 失败** → 凭据换绑需要重启插件 → 会话级 principal 绑定不可行,需改为每 principal 一个运行时
- `/publish chore: {v} session 0 feasibility report`

---

### ⬜ Session 1: 工程骨架与 adapters 边界纪律

```
读取 CLAUDE.md（8 条硬规则与 PR 自查清单）。

本次任务:建立仓库骨架与工程纪律。纪律必须在写第一个包之前就位——
adapters 边界规则写进 CI 只要半小时，不写的话三个月后满仓库都是直连上游内部实现。

1. pnpm workspace
   - packages/* 与 examples/*
   - tsconfig.base.json：strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess
   - tsc project references，不引入 bundler

2. 版本策略
   - changesets init，改为 fixed 模式：全部 @dshwar/* 统一版本号
   - 校验脚本 scripts/check-version：比对 root package.json / CLAUDE.md 顶部 /
     SESSION_TASKS.md 头部 / README 兼容矩阵，不一致则退出码非 0

3. adapters 边界 lint（R2，本 Session 最重要的产出）
   - ESLint no-restricted-imports 规则：
     packages/** 与 gateway/** 禁止匹配 @deepseek-ai/dsh-*/(lib|src|dist)/**
     仅 adapters/** 豁免
   - 同时提供 grep 版本写入 CI，双保险

4. 上游依赖锁版守卫
   - 脚本扫描全部 package.json，@deepseek-ai/* 出现 ^ 或 ~ 即失败

5. CI（GitHub Actions）
   - 矩阵：Node 22 / Node 24
   - 步骤：install → typecheck → lint → 边界检查 → 锁版检查 → test
   - Renovate 配置：盯 @deepseek-ai/dsh-*，自动开 PR

6. profiles/single-user.yml 骨架
   - 组合上游原生插件 + 匿名 principal，作为后续所有对照测试的基线

== 测试 ==
- 故意写一行深链 import，CI 必须失败
- 故意把某个上游依赖改成 ^，CI 必须失败
- 故意改乱一处版本号，check-version 必须失败
```

验证:

- 三条负向测试全部正确拦截
- `/publish chore: {v} session 1 workspace scaffold and adapter boundary`

---

### ⬜ Session 2: `@dshwar/principal`

```
读取 CLAUDE.md。本次任务:实现 principal 传播——DSHWAR 引入的唯一新概念。
其余所有包都是上游已有契约的替代实现，只有这个是新的。

1. 类型
   - Principal：id / tenantId / roles[] / claims，全部 readonly
   - ANONYMOUS 常量，Object.freeze
   - id 必须是稳定不可轮换的标识，禁止用邮箱

2. PrincipalService extends Service
   - 通过 declare module 增强 Context，挂 ctx.principal
   - current(): Principal，永不返回 undefined
   - isAnonymous(): boolean

3. withPrincipal(ctx, principal): Context
   - 内部用 ctx.isolate('principal') 派生子作用域
   - 返回的 context 是服务端交给「一个会话」的东西
   - 拥有该 fiber 的作用域释放时自动解绑

4. TSDoc
   - 每个公开导出必须有文档，写「为什么」而非重述签名
   - 特别说明：为什么 principal 必须每次操作解析、不跨操作缓存

== 测试 ==
- 兄弟作用域互不可见（复现 Session 0 验证 A）
- 父作用域不受子作用域影响
- 默认构造返回 ANONYMOUS
- 并发 100 组 principal 无串号
```

验证:

- 单测覆盖作用域隔离与并发
- `/publish feat: {v} session 2 principal propagation`

---

### ✅ Session 3: `@dshwar/auth` 契约 + `auth-static` 实现

```
读取 CLAUDE.md（硬规则 4：不做 IdP）。
本次任务:定义认证契约并提供零配置的开发实现。

1. @dshwar/auth
   - AuthError：不携带失败原因细节，调用方不得分支处理
   - abstract class Auth extends Service，挂 ctx.auth
   - abstract verify(token: string): Promise<Principal>
   - 文档必须写明契约边界：只验证与映射，永不存密码、永不签发令牌、
     永不实现注册流程。这条边界决定 DSHWAR 与 Keycloak/Casdoor 是集成关系
     而非竞争关系。

2. @dshwar/auth-static
   - 配置声明的 token → principal 映射
   - 构造时输出显式警告：token 是明文配置，禁止部署
   - quiet 选项仅供测试使用
   - 存在意义：让 git clone && pnpm dev 零外部依赖即可跑通，
     这是新贡献者的第一印象，也是所有契约测试的 fixture

3. 明确不在本 Session 做
   - auth-jwt 与 auth-oidc 放到 V0.3.0，本版本不碰

== 测试 ==
- 未知 token 抛 AuthError
- AuthError 不泄漏失败原因
- grep 校验：包内不存在 bcrypt / argon2 / password 字样
```

验证:

- 契约测试可用 auth-static 作为 fixture
- `/publish feat: {v} session 3 auth contract and static provider`

---

### ✅ Session 4: `@dshwar/credentials-multiuser`

```
读取 CLAUDE.md（硬规则 5、6）与上游 dsh-credentials 的 README 与类型定义。

本次任务:实现 per-principal 凭据解析。这是整个论点最直接的证明——
换掉一个实现，所有 LLM 适配器、工具、插件自动变成多用户，消费方零改动。

1. 继承上游 CredentialProvider 抽象类（类名如此，服务名才是 ctx.credentials），
   实现四个抽象方法
   - resolve(ref) / describe(ref) / set(ref, value) / unset(ref)
   - 严格遵守上游语义：空值等同缺失；set 时若被只读来源遮蔽必须拒绝

2. PrincipalCredentialStore 接口
   - get / put / remove，三个方法，实现者可用 Postgres / Vault / KMS
   - 本 Session 只提供内存实现供测试，不做持久化

3. shadow 遮蔽机制（网关短时效 token 的落点）
   - 运营方持一把上游 key，按 principal 换发 scoped token
   - 被遮蔽的 ref 只读，set/unset 必须抛错
   - 这是「用户永不持有 provider key」的架构实现

4. fail closed（硬规则 6）
   - 匿名 principal 解析不到任何凭据，返回 undefined
   - 不得回退到默认值、共享 key 或环境变量
   - 文档写明理由：组合配错时宁可跑不起来

5. notifyUpdated
   - set/unset 后通知上游，确保变更即刻生效

== 测试 ==
- 两个 principal 解析同一 ref 得到各自的值
- 匿名 principal 解析返回 undefined
- 被遮蔽的 ref：resolve 返回网关值、describe 报 writable=false、set 抛错
- 换绑 principal 后下一次 resolve 立即生效（复现 Session 0 验证 B）
```

验证:

- examples/minimal-server 跑通:两用户两 key,零消费方改动
- `/publish feat: {v} session 4 per-principal credentials`

---

### ✅ Session 5: `@dshwar/fs-tenant` ★ 隔离的真实边界

```
读取 CLAUDE.md（第七节 安全与隔离）与上游 dsh-fs、fs-sandbox 的契约。

本次任务:把工作区根按租户钉死。

⚠️ credentials 解决的是「用谁的钱」，fs 解决的才是「能看谁的数据」。
本 Session 是整个版本安全性的重心，测试要求高于其它 Session。

1. 路径钉死
   - 工作区根 = {root}/{tenantId}/{userId}
   - tenantId 与 userId 必须经过白名单字符校验后才参与路径拼接
   - 所有路径操作先 resolve 再校验是否仍在根内

2. 逃逸拦截（逐项写测试）
   - ../ 与多级 ../../
   - 绝对路径
   - 符号链接指向根外
   - Windows 8.3 短名与 UNC 路径
   - URL 编码与 Unicode 规范化绕过
   - 空 tenantId / userId

3. 与上游沙箱的关系
   - 本包只做路径钉死，不重做沙箱
   - 策略计算结果喂给上游 sandbox-policy / fs-sandbox，不另起炉灶

4. 文档必须写明隔离模型的边界
   - 逻辑隔离仅适用于互相信任的用户
   - agent 能执行 shell，路径钉死抬高成本但不构成强边界
   - 跨信任边界必须用进程隔离 + 容器

== 测试 ==
- 上述每一条逃逸手法都有对应的拒绝测试
- 两租户互相不可见（正向与反向各测）
- 单租户单用户场景下行为与上游 fs-local 一致（对照 single-user.yml）
```

验证:

- 逃逸测试全绿,单用户对照基线行为一致
- `/publish feat: {v} session 5 tenant-pinned filesystem`

---

### ⬜ Session 6: `@dshwar/storage-scoped`

```
读取 CLAUDE.md 与上游 dsh-storage 家族（storage / storage-domain / storage-sqlite / storage-json）。

本次任务:租户维度的存储作用域。

1. 先评估，再决定是否新建包（R7 待确认项）
   - 详读上游 storage-domain 的语义：它的 domain 概念能否直接承载 tenantId
   - 若可以：本包退化为一层薄配置 + 文档，不重复造轮子
   - 若不行：说明差异，再实现 storage-scoped
   - 评估结论写入 docs/DECISIONS/storage-scoping.md

2. 若需实现
   - 所有 key 加租户前缀，前缀由 principal 派生而非调用方传入
   - 跨租户读写在本层拒绝，不依赖上层自觉
   - 前缀分隔符须是 key 白名单之外的字符，避免伪造前缀

3. 一并处理 session 归属
   - 上游 session-persistence 按目录存储，接入 fs-tenant 后自动隔离
   - 确认 session-query 的查询是否会跨租户，若会则加过滤

== 测试 ==
- 租户 A 无法通过构造 key 读到租户 B 的数据
- 伪造前缀的 key 被拒绝
- 单租户场景行为与上游一致
```

验证:

- 决策文档已写,跨租户读写被拒
- `/publish feat: {v} session 6 tenant-scoped storage`

---

### ⬜ Session 7: `adapters/dsh-0.1.0` 与上游契约测试

```
读取 CLAUDE.md（硬规则 2、3 与第五节 上游跟版）。

本次任务:把所有上游接触面收敛到一个目录，并建立跟版机制。
这决定了未来每次上游破坏性变更的修复成本是「改一个目录」还是「翻遍全仓」。

1. adapters/dsh-0.1.0/
   - 把 packages/** 中所有对上游内部实现的依赖搬进来，对外只暴露稳定的内部接口
   - 目录顶部文档说明：这里是唯一允许感知上游内部的地方
   - 运行时校验上游实际版本，不匹配拒绝启动并给出可读提示
     （注意：以 npm registry 版本为准，上游 monorepo 根版本号与之不一致）

2. 契约测试（录制/回放）
   - 为每一个上游接触点写测试：credentials 四方法、fs 路径语义、storage 键语义
   - 参考上游自身的快照测试基建模式
   - 目标：上游改接口，pnpm test:contract 立刻跑红，且红点直指 adapters

3. profiles/single-user.yml 对照基线（R9）
   - 全部契约测试同时跑 single-user.yml 与 team.yml
   - 单用户场景下两者行为必须完全一致
   - 这是「只加隔离、不改语义」的证明，也是别人敢用的理由

4. 兼容矩阵
   - README 建立 DSHWAR × dsh 版本对照表
   - 双轨说明：stable 跟已验证版本，edge 跟上游最新

== 测试 ==
- 人为改一个 adapters 内的假设，契约测试必须红
- 双 profile 对照测试全绿
- 边界 lint 在全仓通过（Session 1 的规则此时才真正被验证）
```

验证:

- 对照基线全绿,契约测试可拦截上游变更
- `/publish feat: {v} session 7 upstream adapter and contract tests`

---

### 🟠 Session 8: 开源首发

```
读取 CLAUDE.md（第八节 开源与商业边界、第九节 商标与声明）。

本次任务:完成开源发布。不要等完美——先发优势建立在「第一个能用的」上，
不是「最好的」上。

1. README.md
   - 首屏必须回答：和已有的 Electron 封装有什么不同
     （那个做的是打包，DSHWAR 做的是平台）
   - 契约表：上游已有哪些契约、只有单用户实现、DSHWAR 补齐哪一列
   - 三十行 minimal-server 示例直接放首屏
   - 隔离模型警告：显著位置，不可折叠
   - 兼容矩阵
   - 开源/闭源边界公开写明：闭源仅 billing-hosted 与托管服务

2. 法务与声明
   - LICENSE：MIT
   - 商标声明：非官方、无隶属关系、指名性使用
   - 项目名法务复核结论记录在 docs/DECISIONS/naming.md

3. 贡献者路径
   - CONTRIBUTING.md：从契约测试开始，先做插件不碰核心
   - 每个 [planned] 包对应一个 good-first-issue，附带契约签名

4. 发布
   - changesets 打 0.1.0，npm publish 全部 @dshwar/* 包
   - GitHub Release，附 FEASIBILITY-REPORT 摘要
   - 上游仓库开一个 issue 介绍本项目（生态位声明，也是第一批用户来源）

== 测试 ==
- npm 包可从空目录安装并跑通 minimal-server
- README 中的每一段代码都可直接执行
- 版本号一致性检查通过（check-version）
```

验证:

- 从空目录 `pnpm add @dshwar/principal` 可跑通示例
- `/publish chore: {v} session 8 open source release`

---

### 版本发布后必做

```
V0.1.0 已发布。执行文档瘦身(见第三部分「二、文档瘦身与归档」):

1. 将本文件中 M0.1.0 的块:
   - 标题红色标记去掉,改为【已发布】
   - 按压缩规则压缩:保留 标题/简介/交付内容表/Session 标题列表/核心改进,
     删除所有 prompt 代码块与实现细节
   - 末尾加 `> 实现细节见 SESSION_TASKS_HISTORY.md`
2. 被删内容**完整**追加到 SESSION_TASKS_HISTORY.md 开头(保持从新到旧)
3. 更新文件头「当前版本(正在开发)」为 V0.2.0
4. 更新第一部分版本路线表中 V0.1.0 状态为「已发布」
5. 报告:主文件字符数是否仍 < 150,000

完成后提交:/publish docs: {v} compress released version tasks
```

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

### PR 自查(grep 必须全为 0 / 全绿)

```bash
grep -rE "@deepseek-ai/dsh-[a-z-]+/(lib|src|dist)/" packages/ gateway/          → 0
grep -rE '"@deepseek-ai/[a-z-]+": *"[\^~]' packages/*/package.json              → 0
grep -rniE "bcrypt|argon2|scrypt|passwordHash|password_hash" packages/ gateway/  → 0
grep -rnE "resolve\(.*\)\.value" gateway/ --include=*.ts                        → 0
grep -rn "process\.env" packages/ --include=*.ts                                → 0
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

## 七、开源与商业边界(强制)

- **MIT 开源**:全部运行时插件、API 平面、控制平面核心、`billing-local`
- **闭源**:仅 `billing-hosted`(Stripe / 微信 / 支付宝)与 DSHWAR Cloud 托管服务
- 这条线**公开写在 README**,藏着会失去信任

## 八、商标与声明(强制)

- 项目名不含 "DeepSeek";README 必须声明非官方、无隶属关系
- 对上游的引用限于**指名性使用**,不得用于品牌暗示
- 发布前过法务

---
