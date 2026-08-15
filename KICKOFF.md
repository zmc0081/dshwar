# DSHWAR 启动文档

> 为商业 AI 应用提供产品基座。在 DeepSeek Harness 之上补齐 ToB 产品运营能力。
> MIT 协议 · 开发者预览 · 当前版本 **V0.1.0(开发中)**

配套文档:

- `ARCHITECTURE.md` — 技术架构与产品架构、路线图、风险登记
- `IDENTITY-INTEROP.md` — 身份互操作(SCIM / CMS / 后台系统对接)
- `CLAUDE.md` — 强制约束的**权威源**,每个 Session 开工前必读
- `SESSION_TASKS.md` — Session 任务书
- `SESSION_TASKS_HISTORY.md` — 已发布版本的实现细节归档

---

## 一、开工前的五个决定

以下决定影响仓库结构与工作量,**必须在 Session 1 之前确认**,越晚改越贵。

| #   | 决定                            | 建议默认值               | 影响                                                              |
| --- | ------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| 1   | 是否做 IdP(存密码 / 发身份令牌) | **否**                   | 决定是否要建注册与密码体系,工作量差一个数量级                     |
| 2   | 控制平面是否独立仓库            | **是**                   | 现在分开零成本,以后拆是重构                                       |
| 3   | 记忆能力做引擎还是只做治理      | **只做治理**             | 直接影响约三个月工作量                                            |
| 4   | 租户映射默认策略                | **`issuer`**(一源一租户) | 最不容易配错的默认值                                              |
| 5   | 项目名是否过法务                | **发布前必须过**         | "DSH" 是上游 CLI 名而非品牌名,风险较低但非零;有用户后改名成本陡增 |

---

## 二、前置条件

```bash
node --version    # 必须 ^22.19.0 || >=24.0.0（与上游 engines 一致）
pnpm --version    # >= 11
git --version
docker --version  # M2.5 起需要（跑 Keycloak 做集成验证）
```

- [ ] GitHub 组织 / 仓库已创建:`dshwar`(开源主仓)
- [ ] `dshwar-console`(控制平面)先建空仓占位,M4 才启用
- [ ] npm 组织 `@dshwar` 已注册(**发布前先占名**)
- [ ] 本机能访问 npm registry 与 GitHub

---

## 三、仓库初始化

```bash
git clone git@github.com:<org>/dshwar.git && cd dshwar
pnpm init
pnpm add -Dw typescript@5.7.2 vitest@2.1.8 @changesets/cli
pnpm changeset init      # 改为 fixed 模式：全部 @dshwar/* 同版本号
git checkout -b feature/v0.1.0
```

**版本策略**:所有 `@dshwar/*` 包**统一版本号**(changesets fixed 模式)。这样版本号一致性检查只需要比对 root `package.json`、`CLAUDE.md` 顶部、README 兼容矩阵三处,而不是二十个包。

---

## 四、第一周:证伪优先

**整个项目压在两条上游行为上。不先验证,后面五个月都是赌。**

1. `ctx.isolate(name)` 返回的子上下文拥有独立服务槽位,兄弟作用域互不可见
2. 凭据每次操作解析一次、**绝不跨操作缓存**

### Day 1–3 · Session 0(可行性验证)

| #   | 动作                                                    | 通过标准                    |
| --- | ------------------------------------------------------- | --------------------------- |
| 1   | 按上游 `examples/jsonrpc-demo` 的 `cordis.yml` 跑通 dsh | 本机可运行                  |
| 2   | 跑通 `examples/minimal-server`                          | 两用户各自解析到自己的 key  |
| 3   | 换绑 principal 后立即发起请求                           | 新凭据即刻生效,无需重启插件 |
| 4   | 并发两 principal 各跑一轮                               | 无串号、无互相可见          |

> **止损点**:第 2 或第 4 项不通过 → cordis 作用域机制与文档不符 → `ARCHITECTURE.md §2.2` 的技术前提不成立 → 架构改为**进程级隔离优先**,`supervisor` 从 M3 提前到 M1。
>
> 这三天不能省。它决定后面五个月。

### Day 4–5 · Session 1(骨架与纪律)

- CI 矩阵:Node 22 / Node 24
- Renovate 盯 `@deepseek-ai/dsh-*`
- **adapters 边界 lint 规则**(见 `CLAUDE.md` 硬规则 2)——半小时的事,不做的话三个月后满仓库都是直连上游内部实现
- `profiles/single-user.yml` 对照基线跑通

---

## 五、V0.1.0 交付范围

| 包                              | 作用                                  |
| ------------------------------- | ------------------------------------- |
| `@dshwar/principal`             | 唯一的新概念,principal 传播           |
| `@dshwar/auth` + `auth-static`  | 认证契约 + 开发实现                   |
| `@dshwar/credentials-multiuser` | per-principal 凭据                    |
| `@dshwar/fs-tenant`             | 工作区按租户钉死 **★ 隔离的真实边界** |
| `@dshwar/storage-scoped`        | 租户前缀键                            |
| `adapters/dsh-0.1.0/`           | 唯一允许触碰上游内部的目录            |

**发布验收**:`single-user.yml` 与 `team.yml` 在单用户场景下行为完全一致——这是"只加隔离、不改语义"的证明,也是别人敢用的理由。

---

## 六、不要等完美再开源

开源项目的先发优势建立在"第一个能用的"上,不是"最好的"上。上游才开源不久,这个生态位现在是空的。

V0.1.0 发布时 README 首屏必须回答一个问题:**和已有的 Electron 封装有什么不同?**

答案是:那个做的是打包,DSHWAR 做的是平台。

---

## 七、常用命令

```bash
pnpm build                    # tsc -b
pnpm typecheck                # tsc -b --noEmit
pnpm test                     # vitest run
pnpm test:contract            # 上游契约测试（升级 dsh 后必跑）
pnpm -r exec npm pkg get dependencies   # 检查是否有 ^ / ~ 锁版违规
```
