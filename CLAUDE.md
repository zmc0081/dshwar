# CLAUDE.md — DSHWAR 项目约束(权威源)

> **本文件由 Claude Code 每次启动自动加载,是约束的唯一权威源。** 任一违反 = PR 阻塞。
> 当前版本(正在开发): **V0.2.0**
> 仓库: `dshwar`(开源主仓,MIT) · `dshwar-console`(控制平面,M4 启用)

---

## 零、文档地图(按需读取,不自动加载)

以下文件**不会**随本文件自动进入上下文,需要时按下表主动读取。
⚠️ **禁止在本文件中用 `@` 语法引入它们**——`@` 导入在启动时就会把整个文件塞进上下文,
`SESSION_TASKS.md` 会随版本增长到十几万字符,导入即等于每次会话烧掉全部预算。

| 文件                       | 什么时候读                                                         |
| -------------------------- | ------------------------------------------------------------------ |
| `SESSION_TASKS.md`         | **每个 Session 开工必读**——找到当前版本块与本次 Session 的任务详情 |
| `ARCHITECTURE.md`          | 涉及跨平面设计、路线调整、新增包立项时                             |
| `IDENTITY-INTEROP.md`      | 涉及认证、SCIM、租户映射、CMS / 后台对接时                         |
| `KICKOFF.md`               | 仅首次搭建环境与仓库时                                             |
| `SESSION_TASKS_HISTORY.md` | **仅**追溯已发布版本的具体实现时;日常开发不要读                    |
| `README.md`                | 修改对外表述、兼容矩阵、开源边界声明时                             |

---

## 一、项目是什么

DSHWAR 是 **DeepSeek Harness 之上的 ToB 产品基座**。上游是本地单用户的 Agent 运行时;DSHWAR 补齐商业应用需要的用户体系、隔离、计量、计费、运营与多端接入。

### 一句话边界(所有决策的裁决标准)

> **上游做能力,DSHWAR 做归属、隔离、配额、计费、审计。**

新增任何包之前先回答:属于"能力"还是"治理"?

- 属于**治理** → 放心做。单用户场景不需要治理,上游永远不会碰。
- 属于**能力** → 先确认上游三个月内不会做。记忆(`context/` `compaction/` `spill/`)、模型编排(`llm/` `subagent/` `workflow/`)、对话 UI(`client/ui-*`)都是上游地盘,**只做治理层,不造引擎**。

### 三平面

```
控制平面  租户/订阅/支付/配额/审计/后台     独立仓库、独立数据库、与 dsh 零耦合
API 平面  运行时 API + 管理 API + SCIM     ★ 护城河，契约由 DSHWAR 定义与版本化
运行时平面 principal/credentials/fs/storage  cordis 插件，跟随 dsh 版本
──────────────────────────────────────
DeepSeek Harness（npm 依赖，精确锁版）
```

---

## 二、硬规则(8 条,PR 阻塞级)

1. **禁止 fork / patch 上游**。从 npm 消费 `@deepseek-ai/dsh-*`。需要改上游才能实现 → 提 issue,不建 patch 目录。
2. **只有 `adapters/dsh-<version>/` 允许 import 上游内部实现**。`packages/**` 与 `gateway/**` 仅可依赖上游契约包的公开导出,禁止深链 `/lib/` `/src/` 路径。
3. **上游依赖精确锁版**,禁止 `^` 与 `~`。运行时校验实际版本,不匹配拒绝启动并给出可读提示。
4. **禁止存储密码、禁止签发身份令牌、禁止实现注册流程**。DSHWAR 是身份消费者,不是提供者。凡出现 `bcrypt` / `argon2` / `password` 字段即违规。
5. **凭据端点只暴露 `describe` 语义**(configured / source / writable),**永不返回值**。这是上游 `dsh-credentials` 的既有约束,必须原样传递到 Admin API。
6. **缺失 principal 时一律 fail closed**。匿名 principal 解析不到任何凭据,不得回退到默认值或共享 key。
7. **租户映射 fallback 默认 `reject`**。映射不出租户的用户宁可拒绝登录——落进默认租户意味着 A 公司的人能看到 B 公司的工作区。改为 `fixed` 需在 PR 描述中显式说明理由。
8. **不改上游语义**。`profiles/single-user.yml` 与多用户 profile 在单用户场景下行为必须一致,契约测试强制。

### PR 自查(grep 必须全为 0 / 全绿)

```bash
# 2. 深链上游内部实现
grep -rE "@deepseek-ai/dsh-[a-z-]+/(lib|src|dist)/" packages/ gateway/ adapters/../  → 0

# 3. 上游依赖锁版
grep -rE '"@deepseek-ai/[a-z-]+": *"[\^~]' packages/*/package.json gateway/package.json → 0

# 4. 密码体系
grep -rniE "bcrypt|argon2|scrypt|passwordHash|password_hash" packages/ gateway/ --include=*.ts → 0

# 5/6. 凭据泄漏与默认回退
grep -rnE "resolve\(.*\)\.value" gateway/ --include=*.ts                      → 0（Admin API 不得取值）
grep -rn "ANONYMOUS" packages/*/src --include=*.ts                            → 仅 principal 包

# 配置只经 profile 注入，不散落 env 读取
grep -rn "process\.env" packages/ --include=*.ts                              → 0

# 门禁
pnpm typecheck                                                                → clean
pnpm test && pnpm test:contract                                               → green
pnpm eslint . --max-warnings 0                                                → clean
```

---

## 三、文档瘦身与归档(强制)

**目的**:`SESSION_TASKS.md` 必须始终保持在 **Claude Code 单文件读取上限(150,000 字符)** 以内。超限时 Claude Code 读不全任务书,会基于残缺上下文开发,**且不会主动告知哪部分被截断**。

**触发时机**:每次版本发布后(该版本从"规划中"转为【已发布】时)**立即执行**。

**压缩规则**

| 类别                               | 处理       |
| ---------------------------------- | ---------- |
| 版本标题                           | 保留       |
| 简介引用段                         | 保留       |
| 交付内容表(改了什么)               | 保留       |
| 包含的 Session 标题列表            | 保留       |
| 核心改进要点                       | 保留       |
| **Session prompt 代码块**          | 删除并归档 |
| **实现步骤 / 接口规格 / 契约细节** | 删除并归档 |
| **验证动作 / 测试清单**            | 删除并归档 |
| **git 命令**                       | 删除并归档 |

**一句话标准:记录「改了什么」,不记录「怎么改的」。**

压缩后的版本块末尾追加:`> 实现细节见 SESSION_TASKS_HISTORY.md`

**归档规则**

- 被删内容**完整原样**追加到 `SESSION_TASKS_HISTORY.md` **开头**(保持从新到旧)
- 归档不做任何删减,不受体积限制
- **未发布版本永不压缩**,保留完整任务详情供开发使用

**校验**:压缩后主文件字符数须 < 150,000。**超过 100,000(上限 2/3)即应准备压缩**,不要卡到 150,000。

**Session 状态图例(统一)**:✅ 已完成 · 🔄 进行中 · ⬜ 未开始 · 🟠 代码就绪待外部资源
已发布版本的 Session 一律标 ✅;开发中版本每完成一个即更新,并维护块头部的「Session 状态」小结表。

---

## 四、版本号统一更新(强制)

所有 `@dshwar/*` 包**统一版本号**(changesets fixed 模式)。每次发版以下位置必须一致,任一不一致 = 发布阻塞:

1. root `package.json` 的 `version`
2. 各 workspace 包的 `version`(由 changesets 统一提升)
3. `CLAUDE.md` 顶部「当前版本」
4. `SESSION_TASKS.md` 头部「当前版本(正在开发)」
5. `README.md` 兼容矩阵中的 DSHWAR 版本行
6. `gateway` 的 OpenAPI `info.version`

**开发版本号即时同步(强制)**:新版本规划确立后、第一个 Session 开工前,必须先把上述位置更新为**正在开发的版本号**。效果:开发环境构建产物版本号 = 正在开发版本号 = 最终发布版本号,发布时无需再改。

---

## 五、上游跟版(强制)

- Renovate 盯 `@deepseek-ai/dsh-*`,新版本自动开 PR
- 升级流程:Renovate PR → `pnpm test:contract` 跑红 → **只改 `adapters/`** → 绿了合并
- 目标:上游小版本 **48 小时内**跟上
- `README.md` 维护 DSHWAR × dsh 兼容矩阵,每次跟版更新
- 双轨:`stable` 跟已验证版本,`edge` 跟上游最新
- ⚠️ 上游 npm registry 版本号与 monorepo 根版本号**不一致**,**一律以 registry 为准**
- ⚠️ **上游子包的 `dist-tags.latest` 是坏的**:除 `@deepseek-ai/dsh` 本体外,全部子包的 `latest` 停留在 `0.0.1-rc.1`,而实际已发布到 `0.1.0-rc.6`。**Renovate 必须按版本号跟版,不得依赖 `latest` 标签**,否则永远不开 PR。实测见 `docs/FEASIBILITY-REPORT.md` §4.3
- 当前锁定版本:**`0.1.0-rc.6`**(Session 0 验证基线),适配目录 `adapters/dsh-0.1.0/`

---

## 六、代码规范

**TypeScript**:strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`;ESLint + Prettier;禁止 `any`(必要时 `unknown` + 收窄);公开导出必须有 TSDoc,写**为什么**而非重述签名。

**契约包**:抽象类继承 cordis `Service`,通过 `declare module` 做模块增强挂到 `Context`;实现包命名 `<contract>-<impl>`,与上游 `fs-local` / `storage-sqlite` 的惯例一致。

**测试**:Vitest。每个上游接触点必须有契约测试(录制/回放),上游改接口即刻跑红。

**提交**:Conventional Commits(`feat:` / `fix:` / `docs:` / `chore:`);分支 `main` / `feature/v<版本号>`;PR 需含描述 / 影响范围 / 测试方式。

---

## 七、安全与隔离

**隔离级别不是配置偏好,是安全等级。** Harness agent 能执行 shell、读写文件系统。

| 级别                      | 适用                   | 说明                                    |
| ------------------------- | ---------------------- | --------------------------------------- |
| 逻辑(单进程多 principal)  | **仅限互相信任的用户** | 提示词注入、恶意 MCP、污染 skill 可越界 |
| 进程(一 principal 一进程) | 跨信任边界             | 顺带解决上游 SDK 协议无 cancel 的问题   |
| 容器(进程 + OS 沙箱)      | 多租户 SaaS            |                                         |

- README 与文档必须**显著声明**逻辑隔离的适用边界。宁可劝退采用者,不要让他们从事故中学会。
- SCIM 令牌与 Admin 令牌**分离签发**:供给系统只能写身份镜像,不能读用量与凭据配置。
- Admin API Key **按租户签发**,一把钥匙不得横跨租户。
- 所有 Admin 与 SCIM 调用进入 `@dshwar/audit`,记录调用者 / 目标 / 变更前后。
- 沙箱策略喂给上游 `sandbox-policy` / `fs-sandbox`,**不另起炉灶**。

---

## 八、开源与商业边界

**MIT 开源**:全部运行时插件、API 平面、控制平面核心、`billing-local`(只记账不收款)。

**闭源**:仅两块 —— `billing-hosted`(Stripe / 微信 / 支付宝接入)与 DSHWAR Cloud 托管服务。

开源用户拿到的是**可用的完整基座**;商业客户买的是省掉自建的时间。这条线公开写明,藏着会失去信任。

---

## 九、商标与声明

- 项目名不含 "DeepSeek"。README 必须声明:非 DeepSeek 官方产品、无隶属关系。
- 对上游的引用限于**指名性使用**(识别所扩展的项目),不得用于品牌暗示。
- 发布前过一次法务。
