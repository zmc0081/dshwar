# DSHWAR

> **DeepSeek Harness 之上的 ToB 产品基座。**
> 上游做能力,DSHWAR 做归属、隔离、配额、计费、审计。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## ⚠️ 开发者预览 · V0.4.7

运行时、API 平面、身份互操作、计量治理与**进程隔离**均已可用;控制平面在 V0.5.0。

**在评估采用之前,请先读完这三条:**

|                                   |                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 📦 **npm 包尚未发布**             | `@dshwar/*` 在 npm 上还不存在。现在只能从源码构建。本文中的 `pnpm add` 示例是**发布后**的用法                                                                                                                                                                            |
| 📊 **性能数字取自 Linux CI 基线** | 规模对照表按 **实测 63 MB/进程**,由 CI 常驻门禁盯着(见 [决策](docs/DECISIONS/process-cost-thresholds.md))。⚠️ **这张表只算子进程** —— 网关自身(Linux 实测 80 MB)与操作系统都不在里面,按表配机器请留出余量。`maxProcesses` 自 V0.4.7 起按你的机器内存推导,不再是固定的 64 |
| ⚖️ **项目名的商标复核进行中**     | "DSHWAR" 尚未完成商标检索与法务意见。**名称可能变更。** 不要把它写进合同、域名或对外品牌                                                                                                                                                                                 |

本项目**非 DeepSeek 官方产品,与 DeepSeek 无隶属关系**。对上游的引用限于指名性使用。

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

| 级别     | 形态                                | 适用                            | 状态          | 已知可越界的手法                     |
| -------- | ----------------------------------- | ------------------------------- | ------------- | ------------------------------------ |
| **逻辑** | 单进程,per-session principal 作用域 | 🚨 **仅限单 principal** —— 见下 | ✅ 默认       | 提示词注入、恶意 MCP、被污染的 skill |
| **进程** | 一 principal 一 dsh 进程            | 跨信任边界                      | ✅ **V0.4.5** | 进程逃逸、内核提权、资源耗尽         |
| **容器** | 进程 + OS 沙箱                      | 多租户 SaaS                     | 📋 仅配置位   | 内核提权                             |

**逻辑隔离不构成强边界。** `fs-tenant` 的路径钉死抬高了越界成本,但一个能跑 `bash`
的 agent 不受它约束。跨信任边界请开进程隔离(`@dshwar/supervisor`,V0.4.5 起可用)。

### 进程隔离**仍然不是**什么

自 V0.4.5 起进程隔离可用,但它换来的东西有明确边界,别把它当容器用:

- **不防内核提权。** 子进程和网关跑在同一个内核、同一个用户下。一个本地提权漏洞
  照样越过它。
- **不限制 CPU / 内存 / 磁盘。** 一个 principal 可以吃满整台机器。
  资源上限要靠部署方的 cgroup / Job Object / 容器。
- **不隔离网络。** 子进程能访问网关能访问的一切,包括内网服务与云厂商的
  元数据端点。
- **不阻止同一 principal 的会话互相看见。** 一 principal 一进程 —— 同一个人的
  多个会话**共用一个进程**(见 [`@dshwar/supervisor`](packages/supervisor) 的
  代价说明:63 MB/进程)。这是刻意的,但意味着「按会话隔离」不成立。
- **默认不开。** 升级到 V0.4.5 不会自动改变隔离级别,要在 profile 里显式选。

### 💰 多租户的资源成本 —— 选型时就该知道

**逻辑档只支持单 principal,所以多租户现在只剩进程隔离一档。**
它的代价不再是可选的调优项,而是承重结构:

| 团队规模  | 活跃进程 | 常驻内存(Linux) |
| --------- | -------- | --------------- |
| 5 人      | 5        | ≈ 315 MB        |
| 20 人     | 20       | ≈ 1.3 GB        |
| **50 人** | **50**   | **≈ 3.2 GB**    |
| 200 人    | 200      | ≈ 12.6 GB       |

口径:**冷启动 ~86 ms、常驻 ~63 MB/进程**(Linux,11 插件全集,五次采样中位数)。
「活跃」指未被空闲回收的 principal —— 不是注册用户数。

⚠️ **Linux 与 Windows 的差异方向不一致,别只记一句「Linux 更便宜」:**

| 量       | Windows | Linux     | 差异    |
| -------- | ------- | --------- | ------- |
| 冷启动   | 115 ms  | **86 ms** | −25%    |
| 常驻 RSS | 58 MB   | **63 MB** | **+9%** |

fork 确实更便宜,但**常驻内存反而更高** —— 两者由不同机制决定(进程创建与模块
加载 vs 堆与运行时开销),没有理由同向。**生产在 Linux,所以容量按 63 MB 算。**

两个参数因此从调优项变成**必配项**:

- `maxProcesses` —— 没有上限的进程池在流量尖峰下会把机器吃到 OOM,
  而 OOM killer 挑中谁是随机的,可能是网关自己
- `idleTimeoutMs` —— 决定「活跃」的窗口有多宽。调长了白占内存,
  调短了让回头客反复付 115 ms 冷启动

✅ **已在 Linux 复测,并做成 CI 常驻门禁** —— 冷启动或内存越界会让 CI 变红
(`scripts/measure-process-cost.mjs`,阈值定法见
[决策文档](docs/DECISIONS/process-cost-thresholds.md))。
数字不会再悄悄漂走,但**上生产前仍请在你自己的机型上量一遍**:
CI 用的是 GitHub 共享 runner,不是你的服务器。

**面向公众的多租户 SaaS 仍需要容器档** —— 由部署方的 Kubernetes / Nomad 提供,
接法见 `@dshwar/supervisor` 的 `ProcessLauncher`。

**工作区维度同理。** 自 V0.4.1 起路径模型是
`{root}/{tenantId}/{userId}/{workspaceId}` —— 同一用户的不同工作区之间**也做路径
钉死**,但**隔离级别与租户间相同**。工作区分区解决的是「按项目分开干活」这个
组织问题,不是信任问题:跨信任边界仍须进程或容器隔离。

> 宁可劝退采用者,不要让他们从事故中学会。

### principal 如何抵达 agent 执行层(V0.4.7 修复,附代价)

**这一段解释了「逻辑档为什么只支持单 principal」。**

principal 的传播用的是 **cordis 的上下文槽位**,绑定只存在于派生出来的 context
对象上。而 **agent 拿到的是它自己的 ctx** —— 由 `AgentRegistry` 插件的 fiber
派生,与调用方传进去的作用域无关。工具与适配器都跑在那个 ctx 上。

**进程隔离档已修**:一进程一 principal,装配时把它钉在根上,agent.ctx 继承得到,
文件落在正确的租户目录。实测通过。

**逻辑档修不了 —— 这是架构限制,不是待办。** 一个 runtime 多个 principal 时,
四条路全部走不通:

| 试过的路                            | 结果                                            |
| ----------------------------------- | ----------------------------------------------- |
| 根上 provide                        | ✅ 但对**所有** agent 生效 —— 把 bob 算成 alice |
| 每个 agent 的 ctx 上 provide        | ❌ 第一个成功,第二个 `already registered`       |
| 沿 fiber 链把 `this.ctx` 走回 agent | ❌ `cannot get property "ctx" without inject`   |
| 给每个 agent 装一份服务实例         | ❌ `service "fs" has been registered`           |

判别信息是在的(服务方法里的 `this.ctx` 按 agent 不同),但**没有公开 API
把它解回身份**。已向上游提 issue(见 [`docs/UPSTREAM-ISSUE-agent-ctx.md`](docs/UPSTREAM-ISSUE-agent-ctx.md));
在那之前,**逻辑档 + 多用户身份会被拒绝启动**,错误信息里带出路与代价。

单用户部署不受影响:一个人的文件落在 `anonymous` 目录下,路径难看但没有混放,
`profiles/single-user.yml` 照常可用。

全部实测与决策见
[`docs/DECISIONS/principal-scope-binding.md`](docs/DECISIONS/principal-scope-binding.md)。

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

| 包                                                                | 作用                          | 状态      |
| ----------------------------------------------------------------- | ----------------------------- | --------- |
| [`@dshwar/principal`](packages/principal)                         | principal 传播                | ✅ V0.1.0 |
| [`@dshwar/auth`](packages/auth)                                   | 认证契约                      | ✅ V0.1.0 |
| [`@dshwar/auth-static`](packages/auth-static)                     | 静态 token(开发用,禁止部署)   | ✅ V0.1.0 |
| [`@dshwar/credentials-multiuser`](packages/credentials-multiuser) | per-principal 凭据            | ✅ V0.1.0 |
| [`@dshwar/fs-tenant`](packages/fs-tenant)                         | 工作区按租户+工作区钉死       | ✅ V0.4.1 |
| [`@dshwar/storage-scoped`](packages/storage-scoped)               | 租户前缀键                    | ✅ V0.1.0 |
| [`@dshwar/api-contract`](packages/api-contract)                   | API v1 契约(Zod 单一事实源)   | ✅ V0.2.0 |
| [`@dshwar/gateway`](gateway)                                      | API 平面服务(Hono)            | ✅ V0.2.0 |
| [`@dshwar/sdk`](sdk/typescript)                                   | TS SDK(由 OpenAPI 生成)       | ✅ V0.2.0 |
| [`@dshwar/subject`](packages/subject)                             | 身份镜像(停用在此生效)        | ✅ V0.3.0 |
| [`@dshwar/tenant-map`](packages/tenant-map)                       | 租户映射,映射不出即拒         | ✅ V0.3.0 |
| [`@dshwar/auth-jwt`](packages/auth-jwt)                           | JWKS 验签,验签通过≠放行       | ✅ V0.3.0 |
| [`@dshwar/auth-oidc`](packages/auth-oidc)                         | 填一个 issuer URL 即接入      | ✅ V0.3.0 |
| [`@dshwar/scim-server`](packages/scim-server)                     | SCIM 2.0 子集,双路停用        | ✅ V0.3.0 |
| [`@dshwar/webhooks`](packages/webhooks)                           | 出站事件,签名可独立验证       | ✅ V0.3.0 |
| [`@dshwar/audit`](packages/audit)                                 | 仅追加审计                    | ✅ V0.4.0 |
| [`@dshwar/metering`](packages/metering)                           | 用量归属与成本核算            | ✅ V0.4.0 |
| [`@dshwar/policy`](packages/policy)                               | 配额判定(判定/执行分离)       | ✅ V0.4.0 |
| [`@dshwar/model-router`](packages/model-router)                   | 模型准入与预算降级            | ✅ V0.4.0 |
| [`@dshwar/supervisor`](packages/supervisor)                       | 进程隔离(一 principal 一进程) | ✅ V0.4.5 |

📋 = 已立项,契约签名见 [CONTRIBUTING.md](CONTRIBUTING.md) 的 good-first-issue 列表。

---

## API 平面

上游有两条对外通道,**两条都不能直接用**:SDK 协议是 stdio JSON-RPC(移动端连不上);
内置 webserver 没有 TLS 也没有认证,只有一道 Origin 栅栏,而且不带 `Origin` 头的请求
直接放行(实测见 [`docs/FEASIBILITY-REPORT.md`](docs/FEASIBILITY-REPORT.md) §4.4)。

DSHWAR 的 API 平面补的就是这一层。**它是客户接进来之后换不掉的那部分** ——
运行时插件可替换,控制面是标准 SaaS,只有这份契约是护城河。

| 端点                                        | 作用                         | 状态      |
| ------------------------------------------- | ---------------------------- | --------- |
| `POST /v1/sessions`                         | 建会话                       | ✅ V0.2.0 |
| `GET /v1/sessions`                          | 列出当前主体的会话           | ✅ V0.2.0 |
| `GET /v1/sessions/{id}`                     | 会话状态                     | ✅ V0.2.0 |
| `POST /v1/sessions/{id}/turns`              | 发起一轮(不等跑完)           | ✅ V0.2.0 |
| `GET /v1/sessions/{id}/stream`              | SSE 流式,支持断线续传        | ✅ V0.2.0 |
| `DELETE /v1/sessions/{id}`                  | 取消并释放                   | ✅ V0.2.0 |
| `GET /v1/admin/subjects/{id}/credentials`   | 凭据配置状态(**永不返回值**) | ✅ V0.2.0 |
| `GET /v1/admin/subjects` · `/{id}`          | 用户镜像(SCIM 推进来的)      | ✅ V0.3.0 |
| `/v1/admin/usage` · `subjects/{id}/usage`   | 用量明细与聚合               | ✅ V0.4.0 |
| `/v1/admin/subjects/{id}/quota` GET · PATCH | 配额读写                     | ✅ V0.4.0 |
| `/v1/admin/audit`                           | 审计查询                     | ✅ V0.4.0 |
| `/v1/admin/policies`                        | 模型准入与预算策略           | ✅ V0.4.0 |

**契约完整,实现分期 —— 这条策略在 V0.4.0 走完了。** v1 里定义的每个端点
现在都有实现,`planned` 清零(有测试钉住)。

这条策略当初的样子:未实现的端点返回 501 并在 OpenAPI 里标
`x-dshwar-status: planned`,而不是 404 —— 404 会让第三方以为路径写错了,
从而去猜别的路径。契约是换不掉的那一层,晚定一天成本高一天。
机制仍在,将来加新端点时照旧可用。

> 注:没配对应后端的部署仍会回落 501(比如没接 Subject Mirror 时的
> `/v1/admin/subjects`)—— 那是**部署级降级**,不是契约未实现。

契约以 Zod 为单一事实源,OpenAPI 3.1 由它生成,SDK 再由 OpenAPI 生成。
**任何一处手写都会引入第二个事实源**,而两个事实源迟早分叉 ——
分叉的表现是客户按文档写的客户端在生产上炸掉。

### SDK 快速上手

```bash
npm install @dshwar/sdk
```

```ts
import { DshwarClient } from '@dshwar/sdk'

const client = new DshwarClient({
  baseUrl: 'https://api.example.com',
  token: process.env.DSHWAR_TOKEN!, // 由**你的** IdP 签发，不是 DSHWAR 发的
})

const session = await client.createSession()
await client.createTurn(session.id, '用一句话介绍你自己')

for await (const event of client.stream(session.id)) {
  if (event.type === 'message.delta') process.stdout.write(event.text)
  if (event.type === 'turn.completed') break
}

await client.deleteSession(session.id)
```

完整例子见 [`examples/sdk-session`](examples/sdk-session)。那个包**只依赖
`@dshwar/sdk`** —— 没有 `@deepseek-ai/dsh-*`,没有 cordis。这不是巧合,
是被测试钉住的验收标准:第三方仅凭 SDK 就能完成一次完整会话,不接触 dsh。

SDK 的类型由 OpenAPI 生成,不手写。错误码是闭集,映射成可穷举的 TS 联合类型 ——
`switch (error.code)` 漏掉分支时编译不过。详见
[`sdk/typescript/README.md`](sdk/typescript/README.md)。

### 契约稳定性承诺

- `/v1/` 路径版本化。破坏性变更**升大版**,v1 与新版本**并行不少于 6 个月**。
- 破坏性变更必须显式声明:CI 的契约冻结检查(`pnpm check:contract`)拿上一次提交里的
  OpenAPI 做基线比对,检出破坏性差异且没有点名契约包的 `major` changeset 时直接变红。
- **给闭集枚举加值也算破坏性。** 错误码定成 `z.enum` 就是为了让你写出可穷举的
  `switch` —— 多一个值,你已经写全的 `switch` 立刻编译失败。这是设计后果,不是误判。

### 部署

见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。三件要点:

- **TLS 由反向代理终结**,网关不自己管证书
- **反向代理必须关缓冲、调长超时**,否则 SSE 会退化成「一次性收到一坨」
- 部署组合用 [`profiles/gateway.yml`](profiles/gateway.yml)

---

## 身份互操作

**DSHWAR 是身份消费者,不是身份提供者。** 不存密码、不签发身份令牌、不做注册
流程 —— 客户的用户目录在他们自己的 IdP 里,DSHWAR 只保留一份用于归属与授权的
**镜像**。这条边界让 DSHWAR 与 Keycloak / authentik / Entra 是集成关系而非竞争关系。

```
IdP(authentik / Entra / Okta)
  │ SCIM push(用户与组,含停用)          │ OIDC / JWT(每次请求的认证)
  ▼                                      ▼
/scim/v2 ──▶ Subject Mirror ◀── auth-jwt 查停用态与租户
```

**核心保证**:在 IdP 侧停用某用户,该用户的**下一次请求被拒绝** —— 即使他手里的
token 还没过期。JWT 是无状态的,单靠验签做不到这一点;`auth-jwt` 在验签之外
必查镜像的 `active`,而 SCIM 负责把停用推进镜像。端到端测试用同一个 token
在停用前后各跑一次证明它([identity-e2e.test.ts](gateway/test/identity-e2e.test.ts))。

| 集成点       | 说明                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **SCIM 2.0** | `/scim/v2`,User + Group。**PUT 与 PATCH 都能落停用** —— Entra/Okta 发 PATCH,authentik 发 PUT,只做一条就会「在 A 家能停用、在 B 家停不掉」 |
| **OIDC**     | 填一个 issuer URL 即接入;算法白名单只收非对称,alg 混淆与 alg:none 有测试钉死                                                              |
| **租户映射** | `claim` / `group` / `issuer` / `fixed` 四策略;**映射不出 = 拒绝登录**,歧义也拒绝                                                          |
| **Webhook**  | `subject.*` 出站事件,HMAC 签名可用任何语言独立验证;**不做投递保证**,下游按最终一致设计                                                    |
| **三类令牌** | 运行时 token / Admin Key / SCIM token 分离签发,互斥有负向测试;SCIM token 泄漏的爆炸半径止步于一个身份源的镜像                             |

接入步骤(authentik / Entra 各自的陷阱都写了)见
[`docs/IDENTITY-SETUP.md`](docs/IDENTITY-SETUP.md);部署组合见
[`profiles/enterprise.yml`](profiles/enterprise.yml)。

---

## 计量与治理

V0.3.0 解决了「谁能进来」,V0.4.0 解决「进来之后用了多少、该不该继续用」。
**全部是治理层,一行不碰模型引擎** —— `model-router` 不路由请求,
它只在 `createAgent` 入口裁决用哪个模型,真正的调用仍是上游 `dsh-llm` 的事。

| 能力     | 关键性质                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------- |
| **计量** | 计费口径按 DISJOINT 加(直接用 `inputTokens` 会少计费);**观测不阻断** —— 计量挂了会话照常                 |
| **配额** | 判定与执行分离,超限 429;**两段判定**(建会话读快照准入、发轮现算计费);计量不可用时 **fail open** 并落审计 |
| **准入** | opt-in,没配策略默认放行;清单外 **403 不静默换**                                                          |
| **降级** | 显式配置且**三处可见**:响应头、会话记录、审计 —— 用户有权知道自己被换了模型                              |
| **审计** | **仅追加**,类型层没有 update/delete;按租户强制过滤;凭据类操作绝不记录值                                  |

配置与陷阱(尤其是**价格表必须配全** —— 查不到价计 0 是"没配价"不是"免费")
见 [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md)。

---

## 兼容矩阵

| DSHWAR | API 契约     | DeepSeek Harness (`@deepseek-ai/dsh-*`) | cordis | Node               | 状态           |
| ------ | ------------ | --------------------------------------- | ------ | ------------------ | -------------- |
| 0.4.7  | `/v1` + SCIM | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | principal 抵达 |
| 0.4.6  | `/v1` + SCIM | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 测试有效性     |
| 0.4.5  | `/v1` + SCIM | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 进程隔离       |
| 0.4.1  | `/v1` + SCIM | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 多工作区       |
| 0.4.0  | `/v1` + SCIM | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 计量与治理首版 |
| 0.3.0  | `/v1` + SCIM | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 身份互操作首版 |
| 0.2.0  | `/v1`        | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | API 平面首版   |
| 0.1.0  | —            | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 无 API 平面    |

`@dshwar/gateway` 与 `@dshwar/sdk` 跟随 DSHWAR 主版本号统一提升(changesets fixed 模式),
但 **API 契约版本单独演进**:`/v1` 只在破坏性变更时才升,与包版本号解耦。
包升到 0.9.0 而契约仍是 `/v1`,是正常状态,不是漏改。

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

- **逻辑档只支持单 principal** —— 架构限制,非待办。多用户请用 `isolation: process`,
  逻辑档 + 多用户身份会被拒绝启动。见上方隔离模型章节
- **逻辑隔离不是强边界** —— 见上方警告;**进程隔离也不是容器**,同样见上方
- **进程隔离的代价是实打实的** —— 冷启动 ~115 ms、常驻 ~58 MB/进程
  (实测见 [`docs/FEASIBILITY-REPORT-V45.md`](docs/FEASIBILITY-REPORT-V45.md) §6)。
  单机 100 个活跃 principal ≈ 5.8 GB,`maxProcesses` 是必需配置而非调优项
- **进程隔离下,配额耗尽的租户仍能占用进程槽位** —— 配额判定挂在发起轮次上,
  而进程在建会话时就起来了。已知缺口,修复在计划中
- **`storage-scoped` 的 `loadAll()` 仍会把整个 unit 读进内存** —— 上游契约的形状,
  意味着一个租户的数据量会影响所有租户的内存占用
- **启用 `session-query-sqlite` 的部署必须视为单租户** —— 它是全局索引、不感知 principal
- **上游 `spawnTerminal` 在 Windows 不可用** —— 上游 `ProcessInspector` 只实现了
  linux / darwin;普通 `spawn` 不受影响
- **`auth-static` 的 token 是明文配置** —— 只用于开发与测试,禁止部署
- **治理的默认装配是内存实现** —— `server.ts` 里的审计/用量/配额重启即丢。
  四个包都提供了走上游 `storage` 契约的实现,生产请换上;Postgres 实现随
  V0.5.0 控制平面落地
- **价格表不配全会静默少算账** —— 查不到价的模型成本计 0

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
| `pnpm check:contract`           | **契约冻结** —— 与上一次提交比 OpenAPI,破坏性变更需显式声明   |
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
