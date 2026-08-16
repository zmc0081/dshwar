# DSHWAR

> **DeepSeek Harness 之上的 ToB 产品基座。**
> 上游做能力,DSHWAR 做归属、隔离、配额、计费、审计。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **开发者预览 · V0.1.0。** 运行时平面已可用;API 平面(Gateway / SDK)在 V0.2.0。

---

## 和已有的 Electron 封装有什么不同

**那个做的是打包,DSHWAR 做的是平台。**

上游 DeepSeek Harness 是本地单用户的 Agent 运行时。它的每个服务契约
(`credentials` / `fs` / `storage`)都设计得很好,但**只有单用户实现** ——
因为单用户场景根本不需要问「这次操作是谁发起的」。

DSHWAR 不 fork、不 patch,而是**把这些契约换成多用户实现**。换完之后,
所有 LLM 适配器、工具、插件自动变成多用户,**消费方一行都不用改**。

### 三十行看懂

```ts
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { StaticAuth } from '@dshwar/auth-static'
import {
  InMemoryPrincipalCredentialStore,
  MultiuserCredentials,
} from '@dshwar/credentials-multiuser'
import { PrincipalService, runWithPrincipal } from '@dshwar/principal'

const API_KEY = credentialRef('DEEPSEEK_API_KEY')
const ctx = new Context()

await ctx.plugin(PrincipalService)
await ctx.plugin(StaticAuth, {
  entries: [
    { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme' },
    { token: 'dev-bob', id: 'bob-a2b3', tenantId: 'globex' },
  ],
})

const store = new InMemoryPrincipalCredentialStore()
await ctx.plugin(MultiuserCredentials, { store })

await store.put(await ctx.auth.verify('dev-alice'), API_KEY, 'sk-alice-XXXX')
await store.put(await ctx.auth.verify('dev-bob'), API_KEY, 'sk-bob-YYYY')

// ↓ 这个函数就是「消费方」。它不知道 principal 存在。
const callModel = async (c: Context) => (await c.credentials.resolve(API_KEY))?.value

for (const token of ['dev-alice', 'dev-bob']) {
  const principal = await ctx.auth.verify(token)
  console.log(token, '→', await runWithPrincipal(ctx, principal, callModel))
}
// dev-alice → sk-alice-XXXX
// dev-bob   → sk-bob-YYYY
console.log('(匿名)', '→', await callModel(ctx)) // → undefined，fail closed
```

可运行版本:[`examples/minimal-server`](examples/minimal-server)。

这一条在开工前就用可运行的验证证明过 ——
见 [`docs/FEASIBILITY-REPORT.md`](docs/FEASIBILITY-REPORT.md)。

---

## ⚠️ 隔离模型警告 —— 先读这一段

Harness agent **能执行 shell、能读写文件系统**。这决定了隔离级别不是配置偏好,
**是安全等级**。

| 级别     | 形态                                | 适用                           | 已知可越界的手法                     |
| -------- | ----------------------------------- | ------------------------------ | ------------------------------------ |
| **逻辑** | 单进程,per-session principal 作用域 | **仅限互相信任的用户**(团队内) | 提示词注入、恶意 MCP、被污染的 skill |
| **进程** | 一 principal 一 dsh 进程            | 跨信任边界                     | —                                    |
| **容器** | 进程 + OS 沙箱                      | 多租户 SaaS                    | —                                    |

**逻辑隔离不构成强边界。** `fs-tenant` 的路径钉死抬高了越界成本,但一个能跑 `bash`
的 agent 不受它约束。跨信任边界请用进程隔离 + 容器(`supervisor`,V0.4.0)。

> 宁可劝退采用者,不要让他们从事故中学会。

---

## 契约表 —— DSHWAR 补齐了哪一列

| 契约           | 上游已有             | 上游实现                                  | DSHWAR 补齐                                                                  |
| -------------- | -------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `credentials`  | ✅ `dsh-credentials` | 单用户(env 取一把 key)                    | **`@dshwar/credentials-multiuser`** —— per-principal + 网关短时效 token 遮蔽 |
| `fs`           | ✅ `dsh-fs`          | 单用户(`fs-local`,`cwd` 不做 containment) | **`@dshwar/fs-tenant`** —— 工作区根按租户钉死                                |
| `storage`      | ✅ `dsh-storage`     | 单用户(无租期维度)                        | **`@dshwar/storage-scoped`** —— 记录键租户前缀                               |
| `subprocess`   | ✅ `dsh-subprocess`  | 单用户                                    | 沿用上游,策略喂给 `sandbox-policy`                                           |
| 认证           | ❌ 无                | —                                         | **`@dshwar/auth`** + `auth-static`(契约 + 开发实现)                          |
| principal 传播 | ❌ 无                | —                                         | **`@dshwar/principal`** —— 唯一的新概念                                      |

上游的契约包设计得足够干净:**DSHWAR 没有一处需要深链上游内部实现**
(见 [`adapters/dsh-0.1.0`](adapters/dsh-0.1.0))。

### 包

| 包                                                                | 作用                        | 状态      |
| ----------------------------------------------------------------- | --------------------------- | --------- |
| [`@dshwar/principal`](packages/principal)                         | principal 传播              | ✅ V0.1.0 |
| [`@dshwar/auth`](packages/auth)                                   | 认证契约                    | ✅ V0.1.0 |
| [`@dshwar/auth-static`](packages/auth-static)                     | 静态 token(开发用,禁止部署) | ✅ V0.1.0 |
| [`@dshwar/credentials-multiuser`](packages/credentials-multiuser) | per-principal 凭据          | ✅ V0.1.0 |
| [`@dshwar/fs-tenant`](packages/fs-tenant)                         | 工作区按租户钉死            | ✅ V0.1.0 |
| [`@dshwar/storage-scoped`](packages/storage-scoped)               | 租户前缀键                  | ✅ V0.1.0 |
| `@dshwar/auth-jwt` · `auth-oidc`                                  | JWKS / Keycloak / Authentik | 📋 V0.3.0 |
| `@dshwar/metering` · `policy` · `model-router`                    | 计量与治理                  | 📋 V0.4.0 |
| `@dshwar/supervisor`                                              | 进程隔离                    | 📋 V0.4.0 |

📋 = 已立项,契约签名见 [CONTRIBUTING.md](CONTRIBUTING.md) 的 good-first-issue 列表。

---

## 兼容矩阵

| DSHWAR | DeepSeek Harness (`@deepseek-ai/dsh-*`) | cordis | Node               | 状态 |
| ------ | --------------------------------------- | ------ | ------------------ | ---- |
| 0.2.0  | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 当前 |

上游依赖**精确锁版**,禁止 `^` 与 `~`。版本不匹配时 `adapters/dsh-0.1.0` 的守卫会
**拒绝启动**,而不是打一行警告 —— 带着不匹配的版本跑起来,故障会出现在离根因很远的地方。

> ⚠️ 上游子包的 npm `dist-tags.latest` 目前是坏的(停在 `0.0.1-rc.1`,实际已发布到
> `0.1.0-rc.6`)。跟版请按版本号,不要依赖 `latest` 标签。
> 详见 [`docs/FEASIBILITY-REPORT.md`](docs/FEASIBILITY-REPORT.md) §4.3。

### 双轨

| 轨       | 跟什么                                      | 适合谁                     |
| -------- | ------------------------------------------- | -------------------------- |
| `stable` | 已跑通契约测试的上游版本(当前 `0.1.0-rc.6`) | 生产                       |
| `edge`   | 上游最新,由社区先踩雷                       | 想早点知道上游改了什么的人 |

**跟版流程**(目标:上游小版本 48 小时内跟上):

1. Renovate 开 PR(按版本号跟,不依赖 `latest` 标签)
2. `pnpm test:contract` 跑红 —— 红点直指 `adapters/`,告诉你上游改了哪条语义
3. **只改 `adapters/`**,`packages/**` 不应因跟版而变动
4. 绿了合并,把 `EXPECTED_UPSTREAM_VERSION` 与目录名一起升版

第 3 步是整个机制的意义所在:破坏性变更的修复成本被压在一个目录里,而不是散在全仓。

---

## 开源与商业边界

这条线公开写明,藏着会失去信任。

|              | 范围                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| **MIT 开源** | 全部运行时插件、API 平面、控制平面核心、`billing-local`(只记账不收款)              |
| **闭源**     | **仅两块** —— `billing-hosted`(Stripe / 微信 / 支付宝接入)与 DSHWAR Cloud 托管服务 |

开源用户拿到的是**可用的完整基座**(`billing-local` 能记账、能出用量报表,自建者够用);
商业客户买的是省掉自建的时间。

---

## 已知限制

老实说在前面,免得你从事故里发现:

- **逻辑隔离不是强边界** —— 见上方警告
- **`storage-scoped` 的 `loadAll()` 仍会把整个 unit 读进内存** —— 上游契约的形状,
  意味着一个租户的数据量会影响所有租户的内存占用
- **启用 `session-query-sqlite` 的部署必须视为单租户** —— 它是全局索引、不感知 principal
- **上游 `spawnTerminal` 在 Windows 不可用** —— 上游 `ProcessInspector` 只实现了
  linux / darwin;普通 `spawn` 不受影响
- **`auth-static` 的 token 是明文配置** —— 只用于开发与测试,禁止部署

---

## 开发

```bash
pnpm install
pnpm check:all
```

| 命令                            | 作用                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `pnpm build` / `pnpm typecheck` | `tsc -b`                                                      |
| `pnpm test`                     | Vitest                                                        |
| `pnpm test:contract`            | 上游契约测试(升级 dsh 后必跑)                                 |
| `pnpm test:linux`               | 在 Linux 容器里复跑(符号链接与 PTY 测试在 Windows 会静默跳过) |
| `pnpm lint`                     | ESLint,含 **adapters 边界规则**                               |
| `pnpm check:guards`             | PR 自查清单(grep 双保险)                                      |
| `pnpm check:version`            | 版本号全仓一致性                                              |
| `pnpm verify:guards`            | **守卫的负向测试** —— 确认守卫真的会拦                        |

> `typescript` 锁在 6.x:typescript-eslint 尚不支持 TS 7。
> 见 [`docs/DECISIONS/typescript-version.md`](docs/DECISIONS/typescript-version.md)。

想参与?看 [CONTRIBUTING.md](CONTRIBUTING.md) —— **从契约测试开始,先做插件不碰核心**。

---

## 商标与声明

**DSHWAR 不是 DeepSeek 官方产品,与 DeepSeek 无隶属、无背书、无赞助关系。**

"DeepSeek"、"DeepSeek Harness" 与 "dsh" 为其各自权利人所有。本项目对上述名称的引用
限于**指名性使用**(nominative use)——即识别本项目所扩展的上游项目 ——
不用于任何品牌暗示。项目名不含 "DeepSeek"。

命名的法务考量记录在 [`docs/DECISIONS/naming.md`](docs/DECISIONS/naming.md)。

## 许可

MIT。见 [LICENSE](LICENSE)。
