# CLAUDE.md — DSHWAR 项目约束(权威源)

> **本文件由 Claude Code 每次启动自动加载,是约束的唯一权威源。** 任一违反 = PR 阻塞。
> 当前版本(正在开发): **V0.6.5**
> 仓库: `dshwar`(开源主仓,MIT) · `dshwar-console`(控制平面,M4 启用)

---

## 零、文档地图(按需读取,不自动加载)

以下文件**不会**随本文件自动进入上下文,需要时按下表主动读取。
⚠️ **禁止在本文件中用 `@` 语法引入它们**——`@` 导入在启动时就会把整个文件塞进上下文,
`SESSION_TASKS.md` 会随版本增长到十几万字符,导入即等于每次会话烧掉全部预算。

| 文件                                               | 什么时候读                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `SESSION_TASKS.md`                                 | **每个 Session 开工必读**——找到当前版本块与本次 Session 的任务详情                                 |
| `ARCHITECTURE.md`                                  | 涉及跨平面设计、路线调整、新增包立项时                                                             |
| `IDENTITY-INTEROP.md`                              | 涉及认证、SCIM、租户映射、CMS / 后台对接时                                                         |
| `KICKOFF.md`                                       | 仅首次搭建环境与仓库时                                                                             |
| `SESSION_TASKS_HISTORY.md`                         | **仅**追溯已发布版本的具体实现时;日常开发不要读                                                    |
| `README.md`                                        | 修改对外表述、兼容矩阵、开源边界声明时                                                             |
| `docs/DECISIONS/unverified-plausible-causation.md` | **当一个因果解释听起来特别顺的时候**——收录三个已写进文档、指导过决策、后来被实测推翻的「顺理成章」 |

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

## 二、硬规则(9 条,PR 阻塞级)

1. **禁止 fork / patch 上游**。从 npm 消费 `@deepseek-ai/dsh-*`。需要改上游才能实现 → 提 issue,不建 patch 目录。
2. **只有 `adapters/dsh-<version>/` 允许 import 上游内部实现**。`packages/**` 与 `gateway/**` 仅可依赖上游契约包的公开导出,禁止深链 `/lib/` `/src/` 路径。
3. **上游依赖精确锁版**,禁止 `^` 与 `~`。运行时校验实际版本,不匹配拒绝启动并给出可读提示。
4. **禁止存储密码、禁止签发身份令牌、禁止实现注册流程**。DSHWAR 是身份消费者,不是提供者。凡出现 `bcrypt` / `argon2` / `password` 字段即违规。
5. **凭据端点只暴露 `describe` 语义**(configured / source / writable),**永不返回值**。这是上游 `dsh-credentials` 的既有约束,必须原样传递到 Admin API。
6. **缺失 principal 时一律 fail closed**。匿名 principal 解析不到任何凭据,不得回退到默认值或共享 key。
7. **租户映射 fallback 默认 `reject`**。映射不出租户的用户宁可拒绝登录——落进默认租户意味着 A 公司的人能看到 B 公司的工作区。改为 `fixed` 需在 PR 描述中显式说明理由。
8. **不改上游语义**。`profiles/single-user.yml` 与多用户 profile 在单用户场景下行为必须一致,契约测试强制。
9. **开源分发的构建产物不得包含任何闭源组件**——`billing-hosted` 等闭源部分必须是独立构建产物。这既是 open-core 的边界,也是 SignPath Foundation 免费签名的资格条件(不得含维护者或关联组织发布的专有代码)

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

# 9. 开源构建产物不含闭源组件
node scripts/check-oss-purity.mjs   # 开源构建产物不含闭源组件（硬规则 9）        → 0

# 门禁
pnpm typecheck                                                                → clean
pnpm typecheck:test   # 测试文件走 tsconfig.test.json,不跑这条它们不被检查      → clean
pnpm test && pnpm test:contract                                               → green
pnpm eslint . --max-warnings 0                                                → clean
```

---

## 三、文档瘦身与归档(强制)

**目的**:`SESSION_TASKS.md` 必须始终保持在 **Claude Code 单文件读取上限(150,000 字符)** 以内。超限时 Claude Code 读不全任务书,会基于残缺上下文开发,**且不会主动告知哪部分被截断**。

**触发时机**:每次版本**开发完成后**(全部 Session 标 ✅ 时)**立即执行**。

> ⚠️ **2026-08-16 判据修正。** 原文写的是「版本发布后」。改为「开发完成后」的理由:
> 本节的目的是保住主文件在读取上限内,而**发布是对外动作,与主文件涨不涨无关**。
> 按原判据执行的实际后果是四个版本全部开发完成却一个都不能压缩,主文件一路逼近上限。

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
- **开发中的版本永不压缩**,保留完整任务详情供开发使用;
  已完成但未发布的版本**可以**压缩 —— 其 prompt 不再被任何人执行

**校验**(三条,缺一不可):

1. 压缩后主文件字符数 < 150,000。**超过 100,000(上限 2/3)即应准备压缩**。
2. **压缩前的每个 `###` 小节标题,必须能在主文件或归档里找到。** 少一个就是丢了内容。
3. **主文件里不得残留 Session prompt。** 判据:`grep -c '^读取 CLAUDE.md' SESSION_TASKS.md` → 0。

> ⚠️ **第 2、3 条是 V0.4.6 补的,起因是压缩脚本自己出过 bug。** 那次切分器
> 把后来插入的、以 `---` 结尾的引用段当成小节结束,于是漏下两段孤儿 prompt ——
> 而字符数看起来完全正常。**这类工具 bug 会重复发生,校验比修复值钱**:
> 修复只解决这一次,校验解决下一次。

> ⚠️ **单位是字符,不是字节。** 中文在 UTF-8 下一个字符占 3 字节,两者差约 1.6 倍 ——
> 按字节判断会提前一大截触发压缩。量的时候用:
>
> ```bash
> node -e "console.log(require('fs').readFileSync('SESSION_TASKS.md','utf8').length)"
> ```
>
> (`wc -c` 给的是字节,`ls -l` 也是。V0.4.5 Session 4 实测:78,882 字节 = 48,455 字符。)

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

**changeset 收敛(强制,与上一条配套)**:提升开发版本号时,把 `.changeset/*.md` 的内容**并入 `CHANGELOG.md` 并删除**。

> 为什么:预标版本号与 changesets 的 bump 模型天然冲突 —— 任何待发布的 `minor` 变更集都会把预标的版本再推一级,与「发布时无需再改」直接矛盾。
>
> 这不是绕过工具。**changesets 记录的是「发布之间」的增量,而首发之前不存在「之间」**;变更集描述的是一个从未发布过的东西的演进过程,那属于 CHANGELOG 的「初版包含什么」。
>
> **首次发布之后恢复正常流程**:那时有了真实的「上一版」作参照,预标与 bump 不再冲突。
>
> ⚠️ 真走 `changeset version` 时注意:它**不提升 root `package.json`**(root 是 `private`),而 `check-version` 拿 root 当基准 —— 必须手工同步。见 `docs/RELEASE-CHECKLIST.md`。

---

## 五、上游跟版(强制)

- Renovate 盯 `@deepseek-ai/dsh-*`,新版本自动开 PR
- 升级流程:Renovate PR → `pnpm test:contract` 跑红 → **只改 `adapters/`** → 绿了合并
- 目标:上游小版本 **48 小时内**跟上
- `README.md` 维护 DSHWAR × dsh 兼容矩阵,每次跟版更新
- 双轨:`stable` 跟已验证版本,`edge` 跟上游最新
- ⚠️ 上游 npm registry 版本号与 monorepo 根版本号**不一致**,**一律以 registry 为准**
- ⚠️ **上游子包的 `dist-tags.latest` 是坏的**:除 `@deepseek-ai/dsh` 本体外,全部子包的 `latest` 停留在 `0.0.1-rc.1`,而实际已发布到 `0.1.0-rc.6`。**Renovate 不得依赖 `latest` 标签**,否则永远不开 PR。实测见 `docs/FEASIBILITY-REPORT.md` §4.3
  - ✅ **但有 `next` 标签,且指向正确版本**(V0.4.6 实测):`dsh-llm` 与 `dsh-llm-deepseek` 的 `dist-tags` 都是 `{ latest: 0.0.1-rc.1, next: 0.1.0-rc.6 }`。**Renovate 可以直接跟 `next`**,比按版本号排序省事
  - ⚠️ 各子包**在同一条版本线上**,不是「版本线不统一」—— 是同一条线加同一个坏标签。不要因为看到 `0.0.1-rc.1` 就以为某个包落后了
- 当前锁定版本:**`0.1.0-rc.6`**(Session 0 验证基线),适配目录 `adapters/dsh-0.1.0/`

---

## 六、代码规范

**TypeScript**:strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`;ESLint + Prettier;禁止 `any`(必要时 `unknown` + 收窄);公开导出必须有 TSDoc,写**为什么**而非重述签名。

**契约包**:抽象类继承 cordis `Service`,通过 `declare module` 做模块增强挂到 `Context`;实现包命名 `<contract>-<impl>`,与上游 `fs-local` / `storage-sqlite` 的惯例一致。

**测试**:Vitest。每个上游接触点必须有契约测试(录制/回放),上游改接口即刻跑红。

### ★ 元规则:每新增一个验证机制,必须回答「谁验证它?」

> **答不上来不算做完。** 这一条与硬规则同级 —— 它管的是所有硬规则赖以生效的那一层。

**为什么需要一条元规则,而不是靠细心。** 同一个形状已经出现三次,一次比一次靠里:

| #   | 什么没被验证                                    | 怎么发现的                         | 之前"绿"了多久                 |
| --- | ----------------------------------------------- | ---------------------------------- | ------------------------------ |
| 1   | **测试文件**不被 tsc 检查                       | 一次会话里连踩三个编译期可见的错误 | 全仓 40+ 测试文件,从 V0.1.0 起 |
| 2   | **CI 不跑 `verify:assertions`** —— 盯守卫的那条 | 首次真实 runner 复盘               | 从 V0.4.6 加进 `check:all` 起  |
| 3   | **根 `scripts/` 不被类型检查** —— 守卫脚本自己  | 修 #2 时顺手查出                   | 两个版本                       |

**三次都是「检查机制自己的那一层没人管」**,而且**每一次都是等它咬人才修**。
第三次是唯一一次在咬人之前就动手的 —— 只因为前两次刚发生,人还记着。
**记着是会过期的,规则不会。**

**这一条要在立项时回答,不是在收工时补。** 具体到三类:

| 新增了什么                                      | 必须同时给出                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| 一条**守卫**                                    | `verify-guards.mjs` 里的负向验证 —— 植入违规,确认它真的红                      |
| 一条**断言 / 测试**                             | 若它守的是核心不变式,给 `verify-assertions.mjs` 一条探针:弄坏实现,确认它真的红 |
| 一个**检查项目**(tsconfig / lint 配置 / CI job) | 回答「它要是根本没跑,我怎么会知道?」—— 通常是再加一条守卫盯着它                |

⚠️ **「跑绿了」不是答案。** 一条永远绿的检查与没有检查等价,但更危险:它让人以为有覆盖。
`tsc -b` 对 `include: []` 的空项目**安静地成功** —— 那种绿与「检查过且通过」在输出上一模一样。

### ★ 推论:凡遍历集合做断言处,必须断言「**真的断言过至少一次**」

> **一个遍历零个元素的循环,与一个没有断言的测试等价** —— 而它在输出里
> 显示为「通过」。这是上面那条元规则最常见的一种具体形态。

**判据在出口,不在入口。**

⚠️ 这条最初写成「必须有**集合非空**的前置断言」。**那个判据不够** ——
它检查的是「入口有没有东西」,而真正要保证的是「**出口有没有发生**」。
嵌套 `continue` 过滤时两者会分家:外层集合非空,内层却可能一次都没执行到
`expect`,而前置断言照样通过。

**同一形状已经出现四次**,每次的伪装都不同:

| #   | 形态                                       | 空跑的表现                                     |
| --- | ------------------------------------------ | ---------------------------------------------- |
| 1   | `median([])` 返回 `NaN`                    | NaN 参与阈值比较恒为 false → **永远不超标**    |
| 2   | `unchanged` 只出现在一个分支上             | 别处读到 `undefined` → 诊断信息挑错的那条      |
| 3   | 进度标记脚本 `s.replace()` 未命中却打印 ✅ | 状态**静默退回**,文档与实际不符                |
| 4   | `planned` 恒为空,循环从 V0.4.0 起是死代码  | 「planned 端点返回 501」**两个版本没被验证过** |

四次的共同点:**「零次」与「全部通过」在输出上没有区别**。

**具体要求:数真正断言过几次**

```ts
// ❌ 循环零次而测试「通过」
for (const route of ROUTES.filter((r) => r.status === 'planned')) { … }

// ⚠️ 不够 —— 只保证入口有东西,不保证出口发生过
const planned = ROUTES.filter((r) => r.status === 'planned')
expect(planned.length).toBeGreaterThan(0)
for (const route of planned) {
  if (someCondition) continue   // ← 全部 continue 掉,断言仍是零次
  expect(…)
}

// ✅ 数出口
let asserted = 0
for (const route of ROUTES) {
  for (const [status, response] of Object.entries(route.responses)) {
    if (Number(status) >= 300) continue
    asserted += 1
    expect(…)
  }
}
expect(asserted, '一条都没断言到 —— 本条空跑了').toBeGreaterThan(0)
```

**什么时候可以只写前置断言**

循环体里**没有任何 `continue` / 提前 `return` / 条件分支**时,
「入口非空」等价于「出口发生」,写哪个都行 —— 这时前置断言更省事,也更早报错。

**一律不需要的**:遍历**字面量数组**(`for (const x of ['a','b'])`)——
它构造上非空且无过滤。

**一律需要的**:遍历**派生集合**(filter / 导入的常量 / 响应体 / 枚举 options),
或循环体内有任何过滤。

⚠️ **不要让链条无限延伸。** 「谁验证验证者」不必递归到底:
到**「这一层失效时会有人看见」**为止即可。判据是**可见性**,不是层数 ——
`verify-guards` 自己没有验证者,但它一失效,`check:all` 的输出里会少掉三十行,那是看得见的。

**提交**:Conventional Commits(`feat:` / `fix:` / `docs:` / `chore:`);PR 需含描述 / 影响范围 / 测试方式。

**分支**:`main` / `feature/v<版本号>`。**`main` 始终是主干,feature 分支合并后即删除。**

> ⚠️ 这条是 2026-08-16 补的,因为它被违反过一次而没人发现:开发从 V0.1.0 一路
> 做到 V0.4.6 都留在 `feature/v0.1.0` 上,`main` 停在 V0.2.0 中段落后 36 个提交,
> 而分支名说的是 v0.1.0、内容却是 v0.4.6。
>
> 后果不只是难看:`scripts/check-contract.mjs` 拿 **`main` 上的 openapi.json**
> 当契约冻结基线。`main` 停在半年前,基线就停在半年前 —— 冻结检查比对的是一个
> 早已不代表主干的快照,**它报的「破坏性 0 处」是对着错误的参照物说的**。
>
> 合并回 `main` 用 `--ff-only`,保持历史线性;快进不了说明分支有分叉,
> 停下查清楚,不要改用普通 merge 或 rebase 掩盖过去。

---

## 七、安全与隔离

**隔离级别不是配置偏好,是安全等级。** Harness agent 能执行 shell、读写文件系统。

| 级别                      | 适用                    | 状态          | 说明                                 |
| ------------------------- | ----------------------- | ------------- | ------------------------------------ |
| 逻辑(单进程)              | 🚨 **仅限单 principal** | ✅ 默认       | 多 principal 时**根本没有隔离**,见下 |
| 进程(一 principal 一进程) | **多用户的唯一可选项**  | ✅ **V0.4.5** | 不防内核提权、不限资源、不隔离网络   |
| 容器(进程 + OS 沙箱)      | 多租户 SaaS             | 📋 仅配置位   | 实现交给部署方的编排系统             |

> 🚨 **V0.4.7 起,逻辑档只支持单个 principal。** 本表前一版写的是
> 「逻辑 = 仅限互相信任的用户」——**那个判据是错的,而且错得不明显**。
>
> 「互相信任」说的是**恶意方能不能越界**;而逻辑档下多 principal 的问题是
> **根本没有分隔** —— principal 到不了 agent 执行层,所有人的文件都落进
> `anonymous/anonymous/`,互相静默覆盖。再互相信任的同事也不接受这个。
>
> 原因是架构限制而非待办(四条路全部走不通,见
> `docs/DECISIONS/principal-scope-binding.md`)。配置层已闸掉:
> 逻辑档 + 多用户身份**拒绝启动**。

> ⚠️ **进程隔离与 cancel 无关,方向甚至是反的。** 本表曾写着进程隔离「顺带解决
> 上游 stdio SDK 协议无 cancel 的问题」——**那句话是错的**。V0.2.0 Session 0 实测:
> **进程内**的 `Agent` 接口有 `cancel(cause)`,`AgentHandle.dispose()` 亦然,
> 两者都真的截断输出,网关的取消从 V0.2.0 起就能用
> (`docs/FEASIBILITY-REPORT-V2.md` §4.1)。「无 cancel」只适用于走 stdio SDK 协议的消费方。
>
> 反过来说,**进程隔离把一个已经好用的取消变成了需要重新解决的问题** ——
> 子进程里的 agent 不再有进程内句柄可调。V0.4.5 Session 0 验证了它可解
> (IPC 送取消 + 子进程内调进程内 cancel,真的截断),Session 2 实现了三级降级。
> 这是这一版的**代价**,不是收益。见 `docs/FEASIBILITY-REPORT-V45.md` §3。

> ⚠️ **进程隔离不是容器。** 它不防内核提权、不限制 CPU/内存、不隔离网络,
> 也不隔离同一 principal 的多个会话(它们共用一个进程)。代价是实测
> 冷启动 ~115 ms、常驻 ~58 MB/进程 —— `maxProcesses` 是必需配置而非调优项。
> **默认仍是逻辑隔离,进程隔离要显式开。**

- README 与文档必须**显著声明**逻辑隔离的适用边界。宁可劝退采用者,不要让他们从事故中学会。
- SCIM 令牌与 Admin 令牌**分离签发**:供给系统只能写身份镜像,不能读用量与凭据配置。
- Admin API Key **按租户签发**,一把钥匙不得横跨租户。
- 所有 Admin 与 SCIM 调用进入 `@dshwar/audit`,记录调用者 / 目标 / 变更前后。
- 沙箱策略喂给上游 `sandbox-policy` / `fs-sandbox`,**不另起炉灶**。
- **同一用户的不同工作区之间也是隔离的**,但隔离级别与租户间相同——工作区分区解决的是「按项目分开干活」这个组织问题,不是信任问题
- **不做运行时审批弹窗**。上游 SDK 协议的 server→client 请求是死能力;审批走**策略预授权 + 事后审计**,拒绝进 `@dshwar/audit`

---

## 八、开源与商业边界

**MIT 开源**:全部运行时插件、API 平面、控制平面核心、`billing-local`(只记账不收款)、`billing-stripe`(Stripe 适配器,**D4 改开源**,V0.6.0)。

**闭源**:仅托管服务本体 —— `billing-hosted`(托管收款,含微信 / 支付宝等国内通道)与 DSHWAR Cloud。

> D4(2026-08):支付适配器没有护城河价值,闭源它等于让自建者收不了钱,
> 直接违背「开源用户拿到可用的完整基座」。开源许可不可撤回 ——
> 回滚窗口只到 `@dshwar/billing-stripe` 首次发布前,见 AUTOPILOT-LOG 的 D4 专节。

开源用户拿到的是**可用的完整基座**;商业客户买的是省掉自建的时间。这条线公开写明,藏着会失去信任。

- **客户端分发**:开源版由项目签名(Windows 走 SignPath Foundation 免费通道,macOS 走 Apple Developer $99/年);**客户白牌版本由客户自己签名**——界面挂客户品牌,签名主体就该是客户。DSHWAR 只提供打包与签名的 CI 模板,不代签

---

## 九、商标与声明

- 项目名不含 "DeepSeek"。README 必须声明:非 DeepSeek 官方产品、无隶属关系。
- 对上游的引用限于**指名性使用**(识别所扩展的项目),不得用于品牌暗示。
- 发布前过一次法务。
