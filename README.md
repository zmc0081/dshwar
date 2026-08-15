# DSHWAR

> **DeepSeek Harness 之上的 ToB 产品基座。**
> 上游做能力,DSHWAR 做归属、隔离、配额、计费、审计。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> ⚠️ **开发者预览 · V0.1.0 开发中。** 当前处于 Session 1(工程骨架)阶段,
> 运行时插件尚未落地。本 README 的完整版由 Session 8(开源首发)产出。

---

## ⚠️ 隔离模型警告 —— 先读这一段

Harness agent **能执行 shell、能读写文件系统**。这决定了隔离级别不是配置偏好,
**是安全等级**。

| 级别     | 形态                                | 适用                           | 已知可越界的手法                     |
| -------- | ----------------------------------- | ------------------------------ | ------------------------------------ |
| **逻辑** | 单进程,per-session principal 作用域 | **仅限互相信任的用户**(团队内) | 提示词注入、恶意 MCP、被污染的 skill |
| **进程** | 一 principal 一 dsh 进程            | 跨信任边界                     | —                                    |
| **容器** | 进程 + OS 沙箱                      | 多租户 SaaS                    | —                                    |

**逻辑隔离不构成强边界。** `fs-tenant` 的路径钉死抬高了成本,但 agent 能执行 shell
这一事实意味着它不是不可逾越的墙。跨信任边界请用进程隔离 + 容器。

> 宁可劝退采用者,不要让他们从事故中学会。

---

## 这和已有的 Electron 封装有什么不同

那个做的是**打包**,DSHWAR 做的是**平台**。

上游 DeepSeek Harness 是本地单用户的 Agent 运行时,它的每个服务契约
(`credentials` / `fs` / `storage` / `subprocess`)都只有单用户实现。
DSHWAR 不 fork、不 patch,而是**把这些契约换成多用户实现**——
换完之后,所有 LLM 适配器、工具、插件自动变成多用户,消费方零改动。

这一条已在 Session 0 用可运行的验证证明,见
[`docs/FEASIBILITY-REPORT.md`](docs/FEASIBILITY-REPORT.md)。

---

## 兼容矩阵

| DSHWAR | DeepSeek Harness (`@deepseek-ai/dsh-*`) | cordis | Node               | 状态   |
| ------ | --------------------------------------- | ------ | ------------------ | ------ |
| 0.1.0  | 0.1.0-rc.6                              | 4.0.1  | ^22.19.0 \|\| >=24 | 开发中 |

上游依赖**精确锁版**,禁止 `^` 与 `~`(CLAUDE.md 硬规则 3)。

> ⚠️ 上游子包的 npm `dist-tags.latest` 目前是坏的(停在 `0.0.1-rc.1`,实际已发布到
> `0.1.0-rc.6`)。跟版请按版本号,不要依赖 `latest` 标签。
> 详见 [`docs/FEASIBILITY-REPORT.md`](docs/FEASIBILITY-REPORT.md) §4.3。

双轨:`stable` 跟已验证版本,`edge` 跟上游最新。

---

## 开源与商业边界

这条线公开写明,藏着会失去信任。

|              | 范围                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| **MIT 开源** | 全部运行时插件、API 平面、控制平面核心、`billing-local`(只记账不收款)          |
| **闭源**     | 仅两块 —— `billing-hosted`(Stripe / 微信 / 支付宝接入)与 DSHWAR Cloud 托管服务 |

开源用户拿到的是**可用的完整基座**;商业客户买的是省掉自建的时间。

---

## 开发

```bash
pnpm install
pnpm check:all      # check:version + check:guards + typecheck + lint + test
```

| 命令                 | 作用                                   |
| -------------------- | -------------------------------------- |
| `pnpm build`         | `tsc -b`                               |
| `pnpm typecheck`     | `tsc -b --noEmit`                      |
| `pnpm test`          | Vitest                                 |
| `pnpm test:contract` | 上游契约测试(升级 dsh 后必跑)          |
| `pnpm lint`          | ESLint,含 **adapters 边界规则**        |
| `pnpm check:guards`  | CLAUDE.md PR 自查清单(grep 双保险)     |
| `pnpm check:version` | 版本号全仓一致性                       |
| `pnpm verify:guards` | **守卫的负向测试** —— 确认守卫真的会拦 |

> `typescript` 锁在 6.x:typescript-eslint 尚不支持 TS 7。
> 见 [`docs/DECISIONS/typescript-version.md`](docs/DECISIONS/typescript-version.md)。

---

## 商标与声明

**DSHWAR 不是 DeepSeek 官方产品,与 DeepSeek 无隶属、无背书、无赞助关系。**

"DeepSeek"、"DeepSeek Harness" 与 "dsh" 为其各自权利人所有。本项目对上述名称的引用
限于**指名性使用**(nominative use)——即识别本项目所扩展的上游项目——
不用于任何品牌暗示。

项目名不含 "DeepSeek"。

## 许可

MIT。见 [LICENSE](LICENSE)。
