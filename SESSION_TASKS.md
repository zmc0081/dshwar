# DSHWAR 开发 Session 任务清单

> 项目对外名称:DSHWAR;npm 作用域 `@dshwar/*`;开源主仓 `dshwar`,控制平面仓 `dshwar-console`。
> 当前版本(正在开发): **V0.3.0** —— 本行强制为"正在开发的版本号",随新版本规划立即更新(见第三部分强制约束)

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

| 版本       | 内容                                                      | 周期 | 状态                                               |
| ---------- | --------------------------------------------------------- | ---- | -------------------------------------------------- |
| V0.1.0     | 运行时平面 MVP + 开源首发                                 | 3 周 | <span style="color:#d00000">开发完成,待发布</span> |
| V0.2.0     | API 平面:OpenAPI v1 + Gateway + SDK + Admin 端点          | 4 周 | <span style="color:#d00000">开发完成</span>        |
| **V0.3.0** | 身份互操作:Subject Mirror + SCIM 2.0 + 租户映射 + Webhook | 2 周 | <span style="color:#d00000">开发中</span>          |
| V0.4.0     | 计量与治理:metering + policy + model-router               | 3 周 | 待启动                                             |
| V0.5.0     | 控制平面:租户/成员/订阅/运营后台                          | 5 周 | 待启动                                             |
| V0.6.0     | 支付:billing 契约 + local + 首个 hosted 实现              | 3 周 | 待启动                                             |
| V0.7.0+    | 端:移动端 SDK + 对话前端                                  | 持续 | 待启动                                             |

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
> 规划中(开发中,未上线):**V0.3.0(Session 0-7,当前)** · V0.2.0(Session 0-6,开发完成)
> · V0.1.0(Session 0-8,开发完成)

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
| 5 `@dshwar/scim-server`     | ⬜ 未开始 | User + Group + PATCH                              |
| 6 网关接入与令牌分离        | ⬜ 未开始 | SCIM 挂载、Admin subjects 转实现、三类令牌        |
| 7 `@dshwar/webhooks` 与发布 | ⬜ 未开始 | 出站投递 + 端到端验收 + 文档                      |

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

---

### ✅ Session 0: 可行性证伪:SCIM 供给链(2 天,止损点)

> ⚠️ **与 V0.1.0 / V0.2.0 的 Session 0 同级。** 本版本的验收标准写着
> 「用 Keycloak 作为身份源,通过 SCIM 把两个用户推进 DSHWAR……全程不写一行定制代码」
> (`IDENTITY-INTEROP.md` §8)。这句话压在一条**未验证的假设**上:
> 供给方真的能主动把用户 push 过来。
>
> 已知风险:**Keycloak 本体不自带 SCIM 客户端**(SCIM 供给是社区扩展)。
> 若属实,这条验收标准按原文无法达成,必须先换供给方或换验收方式 ——
> 而不是写到 Session 7 才发现。

```
读取 CLAUDE.md 与 IDENTITY-INTEROP.md 全文。

本次任务:验证 SCIM 供给链路真的能走通。不写产品代码，产出验证报告。

1. 供给方调研
   - Keycloak 是否自带 SCIM 客户端？若无，可选扩展是什么、成熟度如何
   - Okta / Azure AD(Entra) / Authentik 各自的 SCIM 客户端行为
   - 结论：本版本的验收标准用哪一个供给方，为什么

2. 验证 A —— PATCH 的停用语义
   - 抓取真实供给方发出的 "停用用户" 请求体
   - 确认它是 PATCH 还是 PUT、active 字段的实际形状
   - 若各家不一致，记录差异矩阵

3. 验证 B —— Group 到租户的实际形状
   - SCIM Group 的 members 是引用还是内联
   - 一个用户属于多个 Group 时，租户映射如何裁决(必须确定，否则 R2 无从实现)

4. 验证 C —— JWKS 轮换
   - 起一个真实 IdP，取 discovery 与 jwks_uri
   - 确认 kid 轮换时的行为，以及缓存该怎么失效

5. 验证 D —— 令牌分离的可行性
   - 供给方能否为 SCIM 单独配一个 bearer token(而非复用 admin)

== 产出 ==
- docs/FEASIBILITY-REPORT-V3.md，逐条断言 + 实际输出
- 若验收标准无法按原文达成，在报告里给出替代方案并更新任务书
```

验证:

- 止损判据:**若没有任何供给方能零定制代码推送用户**,本版本改为「只做 Subject 契约 + Admin 端点」,SCIM 推迟
- `/publish chore: {v} session 0 scim provisioning feasibility`

---

### ✅ Session 1: `@dshwar/subject` —— Subject Mirror

```
本次任务:身份镜像的契约与实现。

1. 契约
   - Subject：externalId / userName / active / tenantId / emails / groups / meta
   - **不含密码字段**(硬规则 4)，契约层就不留位置
   - 来源标记 source：哪个身份源推来的，用于多 IdP 并存时的归属

2. SubjectStore 契约
   - upsert(subject) / get(id) / getByExternalId(source, externalId)
   - list(filter) / deactivate(id)
   - **不提供 create 之外的"新建用户"入口** —— DSHWAR 不是身份提供者

3. storage 实现
   - 走上游 dsh-storage 契约 + @dshwar/storage-scoped 的租户前缀
   - 记录键设计要能支撑 getByExternalId 的查询

4. 停用态
   - active:false 的用户必须能被 auth 层看到并拒绝
   - 停用不删除记录(审计需要)

== 测试 ==
- 停用后 get 仍返回记录，但 active 为 false
- 跨租户的 externalId 相同不冲突
- 契约里不存在任何可放密码的字段(结构断言，与 CredentialDescriptor 同款)
```

验证:

- `/publish feat: {v} session 1 subject mirror`

---

### ✅ Session 2: `@dshwar/tenant-map` —— 租户映射

```
本次任务:把 IDENTITY-INTEROP.md §5 的映射规则变成代码。

1. 四种策略
   - claim：从 OIDC claim 取，如 org_id
   - group：从 SCIM Group 名按前缀解析，如 tenant:acme
   - issuer：一个身份源一个租户
   - fixed：全部归入一个租户(单租户部署)

2. fallback
   - 默认 reject —— 映射不出租户宁可拒登(硬规则 7)
   - fixed:<tenant> 需显式配置

3. 多值裁决
   - 一个用户命中多个 Group 时怎么办(Session 0 验证 B 的结论)
   - 歧义必须**拒绝**而不是取第一个 —— 取第一个意味着顺序变了归属就变了

== 测试 ==
- 每种策略各一组正向用例
- 映射不出租户时默认 reject，且错误信息说明是哪一步失败
- 多 Group 歧义被拒绝
- 配置 fixed fallback 需要显式写出租户名，空字符串被拒
```

验证:

- `/publish feat: {v} session 2 tenant mapping`

---

### ✅ Session 3: `@dshwar/auth-jwt` —— JWKS 验签

```
本次任务:替掉 auth-static 的明文令牌表。

1. 验签
   - 实现 @dshwar/auth 契约的 verify(token) → Principal
   - 支持 RS256 / ES256；拒绝 alg:none 与对称算法(HS*)混用
   - iss / aud / exp / nbf 全部校验，不给"宽松模式"开关

2. JWKS
   - 从 jwks_uri 拉取并缓存
   - kid 未命中时刷新一次；刷新仍未命中即拒绝(不无限刷新，那是放大器)
   - 缓存 TTL 与并发去重

3. 与 subject / tenant-map 接合
   - 验签通过后查 Subject Mirror：不存在或 active:false → 拒绝
   - 租户由 tenant-map 决定，不直接信 token 里的 tenant 字段

== 测试 ==
- 过期 / 未生效 / 错误 aud / 错误 iss 各一条负向用例
- alg:none 与 HS256 伪造被拒
- kid 轮换后能自动恢复
- 用户在 Subject Mirror 里被停用后，同一个仍然有效的 token 也被拒 ★ 本版本的核心验收
```

验证:

- `/publish feat: {v} session 3 jwt authentication`

---

### ✅ Session 4: `@dshwar/auth-oidc` —— OIDC 接入

```
本次任务:让部署方只填一个 issuer URL 就能接上。

1. discovery
   - 拉 /.well-known/openid-configuration
   - 取 jwks_uri / issuer，交给 auth-jwt 复用

2. claim 映射
   - sub → subject 的 externalId
   - preferred_username / email → userName(可配)
   - 租户 claim 交给 tenant-map

3. 与 auth-jwt 的关系
   - auth-oidc 是 auth-jwt 的配置来源，不重复实现验签

== 测试 ==
- discovery 文档缺字段时给出可读错误，而不是运行时才炸
- issuer 与 token 里的 iss 不一致时拒绝
- 契约测试对着 Session 0 录下来的真实 discovery 文档回放
```

验证:

- `/publish feat: {v} session 4 oidc integration`

---

### ⬜ Session 5: `@dshwar/scim-server` —— SCIM 2.0 子集

```
本次任务:SCIM 2.0 服务端，User + Group + PATCH。

1. User 资源
   - POST / GET / PUT / PATCH / DELETE /Users
   - ★ PUT 与 PATCH **两条路径都必须能把 active:false 落到停用**
     (Session 0 §4:Entra/Okta 发 PATCH，authentik 发 PUT)
   - ★ DELETE **不得**被当作停用信号(Entra 硬删除延迟 30 天才发)
   - filter 至少支持 userName eq 与 externalId eq(供给方最常用的两条)
   - 分页 startIndex / count

2. Group 资源
   - 同上；members 的增删走 PATCH

3. PATCH
   - RFC 7644 §3.5.2 的 add / remove / replace
   - **active:false 必须落到 Subject Mirror 的停用**(本版本验收的关键路径)

4. 错误与 schema
   - SCIM 的错误响应格式与 DSHWAR 的 ErrorResponse 不同 —— 走 SCIM 自己的格式
   - /ServiceProviderConfig 与 /Schemas 端点 ★ **第一优先级，且必须如实声明能力**
     authentik 读它来决定用 PATCH 还是 PUT，并**缓存一小时** ——
     虚报一次，供给方接下来一小时都会用错方法(Session 0 §5)

== 测试 ==
- 用 Session 0 录下来的真实供给方请求体回放
- PATCH active:false 后，该用户经 auth 的请求被拒
- 未知 filter 返回 501 而不是静默返回全量 ★ 静默返回全量是数据泄漏
```

验证:

- `/publish feat: {v} session 5 scim server`

---

### ⬜ Session 6: 网关接入与令牌分离

```
本次任务:把 SCIM 挂上网关，并把三类令牌彻底分开。

1. 三类令牌
   - 运行时 token：Authorization: Bearer，终端用户
   - Admin Key：x-dshwar-admin-key，按租户
   - SCIM token：Authorization: Bearer，**按身份源**，只能写身份镜像
   - 中间件层分道，与 V0.2.0 的分道鉴权同款

2. SCIM 挂载
   - /scim/v2/* 前缀，不占用 /v1/
   - SCIM token 不得访问 /v1/ 的任何端点，反之亦然 ★ 必须有负向测试

3. Admin subjects 端点转实现
   - /v1/admin/subjects 与 /v1/admin/subjects/{id} 由 501 转为实现
   - **契约一个字段都不许改** —— 契约冻结检查会拦

4. 审计
   - 所有 SCIM 写操作进 audit，记录来源身份源与变更前后

== 测试 ==
- SCIM token 打 /v1/sessions → 401
- 运行时 token 打 /scim/v2/Users → 401
- Admin Key 打 /scim/v2/Users → 401
- pnpm check:contract 必须绿(planned 转实现不是契约变更)
```

验证:

- `/publish feat: {v} session 6 scim mount and token separation`

---

### ⬜ Session 7: `@dshwar/webhooks` 与发布

```
本次任务:出站事件投递，端到端验收，收尾。

1. webhooks
   - 事件：subject.created / subject.updated / subject.deactivated
   - 投递：HMAC 签名头、重试退避、失败落审计
   - **不做投递保证**(那需要持久队列，属于控制平面)，明确写在文档里

2. 端到端验收 ★ 本版本的存在理由
   - **authentik 以容器起在 CI 里**，不依赖任何 SaaS 账号
     (Session 0 裁决:Keycloak 没有出站 SCIM 客户端，原验收标准点名它是错的)
   - 推两个用户进来，其中一个在 authentik 侧停用，该用户下次请求被拒，全程零定制代码
   - ⚠️ 顺带实测 Session 0 标 ⚠️ 的三条:authentik 解绑用户的确切请求形状、
     多 Group 命中时的样本、JWKS kid 轮换行为

3. 文档
   - README 加身份互操作一节与集成矩阵
   - docs/IDENTITY-SETUP.md：接 IdP 的实操步骤
   - 兼容矩阵更新
   - profiles/enterprise.yml：OIDC + SCIM 的部署组合

== 测试 ==
- webhook 签名可被第三方按文档独立验证(不能只有我们自己算得对)
- 投递失败重试后仍失败 → 落审计，不静默丢弃
- 端到端验收脚本进 CI(供给方不可用时跳过并说明，不静默变绿)
```

验证:

- M2.5 验收:**authentik**(容器)停用用户后,该用户下次请求被拒,全程零定制代码
- `/publish chore: {v} session 7 webhooks and identity release`

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

---

### ✅ Session 0: 可行性证伪(3 天,止损点)

> ⚠️ **与 V0.1.0 的 Session 0 同级。** 本版本压在一条未验证的上游行为上:
> 网关要在**进程内**驱动 dsh 的 agent,而上游只提供 stdio JSON-RPC 的 SDK 协议,
> 且该协议**没有 cancel 与 session-close 方法**(`ARCHITECTURE.md` §2.4)。
> 不先验证,后面四周都是赌。

```
读取 CLAUDE.md 与 ARCHITECTURE.md §1.1、§2.4。

本次任务:验证网关能否在进程内驱动 dsh agent。不写产品代码，产出验证报告。

1. 环境准备
   - 用 V0.1.0 的 team.yml 组合起一个进程内 cordis 运行时
   - 确认 ctx.agent / ctx.session 的公开 API 形状

2. 验证 A —— 进程内发起一次完整会话
   - 不经 stdio JSON-RPC，直接用 cordis 服务发起一轮对话
   - 断言：能拿到完整回复
   - 若必须经 SDK 协议才能驱动 → 记录，架构需引入 supervisor 提前

3. 验证 B —— 流式输出
   - 确认 agent 的增量输出以何种形式暴露（事件 / AsyncIterable / 回调）
   - 断言：可转成 SSE 而不需要缓冲整个回复

4. 验证 C —— 取消
   - 上游 SDK 协议无 cancel。确认进程内是否有别的途径
     （AbortSignal / fiber dispose / ctx 作用域释放）
   - 断言：取消后不再产生输出，且不泄漏 fiber
   - 若无法取消 → supervisor 从 V0.4.0 提前，因为「终止进程即是取消」

5. 验证 D —— 并发会话隔离
   - 同一进程内并发两个 principal 的会话
   - 断言：输出不串号，凭据不串号（复现 V0.1.0 验证 C 到 agent 层）

== 产出 ==
docs/FEASIBILITY-REPORT-V2.md，包含：
- 四项验证的通过/失败结论与复现步骤
- agent / session 的实际 API 形状
- 若失败：失败点的最小复现与架构影响

不要写产品代码。不要建 gateway/。
```

验证:

- 四项全过 → 进入 Session 1,架构不变
- **验证 A 失败** → 进程内驱动不可行 → `supervisor` 从 V0.4.0 提前到本版本
- **验证 C 失败** → 无法取消 → 同上,且 SSE 断连会泄漏 fiber,必须先解决
- `/publish chore: {v} session 0 gateway feasibility`

---

### ✅ Session 1: OpenAPI v1 契约 ★ 护城河本体

```
读取 CLAUDE.md 与 IDENTITY-INTEROP.md §3.3。

本次任务:定义 v1 全部契约。这是本版本最重要的产出——
运行时插件可替换、控制面是标准 SaaS，只有这份契约是客户接进来之后换不掉的。

1. packages/api-contract
   - Zod schema 为单一事实源，OpenAPI 3.1 由其生成
   - 禁止手写 OpenAPI yaml；禁止 schema 与文档两处维护

2. 运行时 API
   - POST /v1/sessions              创建会话
   - GET  /v1/sessions/{id}         会话状态
   - POST /v1/sessions/{id}/turns   发起一轮
   - GET  /v1/sessions/{id}/stream  SSE 流式
   - DELETE /v1/sessions/{id}       取消并释放

3. Admin API（契约完整定下，实现分期）
   - /v1/admin/subjects                    [planned]
   - /v1/admin/subjects/{id}/quota         [planned]
   - /v1/admin/subjects/{id}/usage         [planned]
   - /v1/admin/subjects/{id}/credentials   ← V0.2.0 实现，describe 语义
   - /v1/admin/usage                       [planned]
   - /v1/admin/policies                    [planned]
   - /v1/admin/audit                       [planned]
   - planned 端点在 OpenAPI 标注 x-dshwar-status: planned

4. 横切约定（R2 —— 决定第三方后台能不能自动生成）
   - 统一错误形状：{ error: { code, message, requestId } }
     错误 code 是**闭集**，SDK 可穷举
   - 列表端点统一 ?limit&cursor&sort，游标分页不用 offset
   - 所有响应带 requestId，与审计对得上

5. 凭据端点的形状（硬规则 5）
   - 只返回 configured / source / writable
   - 契约层就不给「值」留位置——schema 里没有那个字段，
     实现方即便想返回也没地方放

6. info.version 纳入 check-version

== 测试 ==
- Zod → OpenAPI 生成结果快照测试
- 凭据端点的 schema 里不存在任何可放值的字段
- 错误 code 闭集与 SDK 的穷举一致
```

验证:

- OpenAPI 3.1 可被 `@redocly/cli lint` 通过
- `check-version` 覆盖 `info.version`
- `/publish feat: {v} session 1 openapi v1 contract`

---

### ✅ Session 2: Gateway 骨架与会话路由

```
读取 CLAUDE.md（第七节 安全与隔离)。

本次任务:Hono 服务、认证、会话路由。

1. gateway/
   - Hono，Web 标准，可跑 Node 与边缘
   - 契约来自 packages/api-contract，路由由 schema 校验

2. 会话路由 —— 本 Session 的核心
   - Bearer token → ctx.auth.verify() → Principal
   - runWithPrincipal 派生会话作用域（**不是 withPrincipal**——
     长命进程按请求派生会累积隔离槽位，V0.1.0 已实测）
   - 此下所有插件按 principal 解析，消费方零改动

3. 令牌分离（R4，第七节强制）
   - 运行时 token 与 Admin API Key 分离签发
   - Admin API Key 按租户签发，一把钥匙不得横跨租户
   - 中间件层就分开，不在 handler 里判断

4. 错误处理
   - 统一错误形状，requestId 贯穿
   - AuthError 原样传递「不携带原因」的语义——网关不得把它翻译成
     「token 不存在」之类的具体消息

5. 明确不做
   - TLS 终结交给反向代理，网关不自己管证书
   - 限流只留接口，实现在 V0.4.0 的 policy

== 测试 ==
- 无 token / 错 token / 过期 token 的响应形状完全一致
- Admin Key 访问运行时端点被拒，反之亦然
- 跨租户 Admin Key 被拒
- 并发请求不串号（复现 V0.1.0 验证 C 到 HTTP 层）
```

验证:

- `/publish feat: {v} session 2 gateway skeleton and session routing`

---

### ✅ Session 3: 运行时 API 与 SSE

```
本次任务:让第三方仅凭 HTTP 就能完成一次完整会话。

1. 会话生命周期
   - 创建 / 查询 / 发起一轮 / 取消
   - 会话归属 principal，跨 principal 访问一律 404（不是 403——
     403 会泄漏「这个 id 存在」）

2. SSE 流式
   - 增量输出转 SSE，不缓冲整个回复
   - 断连处理：客户端掉线必须释放 fiber（Session 0 验证 C 的落点）
   - 心跳，穿透代理

3. 取消
   - DELETE 立即停止产出并释放
   - 按 Session 0 验证 C 的结论实现

== 测试 ==
- 一次完整会话：创建 → 发起 → 流式收完 → 释放
- 断连后 fiber 被释放（度量，不靠肉眼）
- 跨 principal 访问会话返回 404
- 并发两个 principal 的会话输出不串号
```

验证:

- `/publish feat: {v} session 3 runtime api and sse`

---

### ✅ Session 4: Admin API

```
读取 CLAUDE.md（硬规则 5)与 IDENTITY-INTEROP.md §3.3。

本次任务:实现有后端可依托的 Admin 端点，其余按契约返回 501。

1. /v1/admin/subjects/{id}/credentials
   - 调 credentials.describe()，只返回 configured / source / writable
   - **永不返回值**。PR 自查的 grep 会盯这一条

2. planned 端点
   - 返回 501，body 用统一错误形状，code 为 not_implemented
   - 响应头带 x-dshwar-planned-version 指出哪个版本会实现
   - 不返回 404——404 会让第三方以为路径写错了

3. 列表端点的分页与排序
   - 游标分页，让 Refine / Appsmith 直接吃

4. 审计埋点
   - 所有 Admin 调用记录调用者 / 目标 / 变更前后
   - @dshwar/audit 在 V0.3.0，本版本先留接口并落日志

== 测试 ==
- credentials 端点的响应体不含任何 key 值（正则扫描，不靠人看）
- planned 端点返回 501 而非 404
- 跨租户 Admin Key 读不到别的租户的 subject
```

验证:

- `/publish feat: {v} session 4 admin api`

---

### ✅ Session 5: TS SDK

```
本次任务:由 OpenAPI 生成 TS SDK，不手写。

1. sdk/typescript
   - 由 packages/api-contract 的 OpenAPI 生成
   - 生成脚本进 CI：契约改了 SDK 没重生成即失败

2. SSE 客户端
   - 生成器通常不管流式，这部分手写但**只写传输**，类型仍来自契约

3. 错误
   - 错误 code 闭集映射为可穷举的 TS 联合类型

== 测试 ==
- examples/sdk-session：仅凭 SDK 完成一次完整会话，不接触 dsh
- 契约改一个字段，SDK 未重生成时 CI 必须红
```

验证:

- M2 验收:第三方仅凭 SDK 完成一次完整会话
- `/publish feat: {v} session 5 typescript sdk`

---

### ✅ Session 6: 契约冻结与发布

```
本次任务:把「契约不能随便改」变成机制。

1. 契约冻结检查
   - OpenAPI 快照进仓库
   - 变更时 CI 比对：破坏性变更必须在 PR 描述显式声明并升大版
   - 非破坏性变更（加字段、加端点）放行

2. profiles/gateway.yml
   - 网关部署用的组合

3. 文档
   - README 加 API 平面一节与 SDK 快速上手
   - 兼容矩阵更新
   - 部署文档：TLS 由反向代理终结，网关不自己管证书

== 测试 ==
- 人为做一次破坏性契约变更，CI 必须红
- 加一个可选字段，CI 必须绿
```

验证:

- `/publish chore: {v} session 6 contract freeze and release`

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

### ✅ Session 0: 可行性证伪(3 天,止损点)

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
