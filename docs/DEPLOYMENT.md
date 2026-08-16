# 部署 DSHWAR 网关

面向自己搭一套 DSHWAR API 平面的人。读完你会知道:进程怎么起、TLS 谁来管、
反向代理必须改哪几个默认值、以及这套部署的**隔离边界在哪**。

---

## 0. 先读这一段:隔离边界

网关**默认**是逻辑隔离 —— 单进程内多 principal。自 V0.4.5 起可以显式切到
进程隔离(一 principal 一进程),**但默认不变** —— 升级不会自动改变隔离级别。

Harness agent 能执行 shell、读写文件系统。逻辑隔离下,提示词注入、恶意 MCP、
被污染的 skill **都可能越界**。路径钉死与租户前缀抬高了越界成本,但它们不是强边界。

| 你的场景                | 逻辑(默认) | 进程(V0.4.5) |
| ----------------------- | ---------- | ------------ |
| 一家公司内部,同事之间   | 可以       | 可以         |
| 一个团队,成员互相认识   | 可以       | 可以         |
| 免费试用 + 付费用户混跑 | **不行**   | 可以         |
| 面向公众的多租户 SaaS   | **不行**   | ⚠️ 见 §2.5   |

这条不是免责声明,是采用边界。宁可劝退,不要让人从事故里学会。

---

## 1. 拓扑

```
客户端 ──TLS──▶ 反向代理 ──明文 HTTP──▶ DSHWAR 网关(单进程)
                (nginx / Caddy /            │
                 ALB / Cloudflare)          ├─ @dshwar/principal
                                            ├─ @dshwar/auth-*      ← 验证令牌
                                            ├─ @dshwar/credentials-multiuser
                                            ├─ @dshwar/fs-tenant
                                            ├─ @dshwar/storage-scoped
                                            └─ @deepseek-ai/dsh-*  ← 上游运行时
```

**网关不管 TLS。** 证书由反向代理终结。这不是偷懒:自己管证书意味着每个部署都要
处理续期、SNI、OCSP stapling、协议降级 —— 那是反向代理已经做得很好的事,
重做一遍只会做得更差,而且做差了是安全问题。

**网关不签发身份。** 令牌由**你的** IdP 签发,DSHWAR 只验证与消费。
DSHWAR 不存密码、不做注册流程(CLAUDE.md 硬规则 4)。

---

## 2. 起进程

```bash
pnpm --filter @dshwar/gateway build
node gateway/dist/server.js --config gateway.config.json
```

配置模板见 [`gateway/gateway.config.example.json`](../gateway/gateway.config.example.json)。
只有 `--port` 与 `--host` 能用命令行覆盖;**身份与凭据一律只从配置文件读** ——
令牌散在环境变量里,轮换时没人知道该改哪几台机器。

`--host` 默认 `127.0.0.1`,只听本地。这是刻意的:网关前面必须有反向代理终结 TLS。
要直接对外请显式传 `0.0.0.0`。

### 装了哪些插件

`profiles/gateway.yml` 是这套组合的声明式表达(给用 dsh 自带 loader 的人看),
可执行版本是 `gateway/src/runtime.ts` 里的 `GATEWAY_PLUGINS`。两者漂移由
`gateway/test/server.test.ts` 断言拦住 —— profile 里出现而装配里没有、又没写明
为什么不装的插件,测试直接红。

它 = `team.yml` + 驱动 agent 所需的三个插件(`dsh-tools` / `dsh-system-prompt` /
`dsh-agent-loop`)。少任何一个,`ctx.agents.create()` 能建出对象但 `followup()`
不产生输出 —— 症状是「事件序列完全正确却收到 0 个增量」,极难排查。

profile 里有三条**默认不装**,每条都有理由:

| 插件                     | 为什么不装                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsh-subprocess-local`   | 依赖 node-pty 原生构建,且上游 `ProcessInspector` 只实现 linux / darwin,win32 直接抛错。让默认部署在 Windows 上起不来,代价大于收益。**需要 shell 工具的部署自行加装。**       |
| `cordis-plugin-timer`    | 上游某些插件的可选依赖,本装配用不到                                                                                                                                          |
| `@dshwar/storage-scoped` | 它导出的是 `scopedBackend(ctx, inner)` 包装函数,不是根上下文插件 —— 作用域在 `open()` 那一刻定格,必须在会话作用域内套用。会话流本身不读 `ctx.storage`,不装它不影响任何端点。 |

⚠️ 默认的 `@dshwar/auth-static` 用明文令牌,**禁止用于生产**。它在那里只是为了让
部署方能先把管道跑通。生产请换 `@dshwar/auth-jwt` 或 `@dshwar/auth-oidc`(V0.3.0)。
进程启动时会就此打一行警告。

### 两种令牌

| 令牌          | 头                              | 签发方        | 作用域       |
| ------------- | ------------------------------- | ------------- | ------------ |
| 运行时 token  | `Authorization: Bearer <token>` | **你的 IdP**  | 一个终端用户 |
| Admin API Key | `x-dshwar-admin-key: <key>`     | 你,按租户签发 | 一个租户     |

**一把 Admin Key 不得横跨租户。** SCIM 令牌(V0.3.0)与 Admin 令牌分离签发:
供给系统只能写身份镜像,不能读用量与凭据配置。

### 2.5 隔离级别:怎么选,代价是什么(V0.4.5)

**先回答一个问题:你的用户互相信任吗?**

- **信任**(一家公司内部、一个团队)→ 用默认的 `logical`。省下每进程 58 MB,
  不必调进程池,运维简单。
- **不信任**(免费试用与付费用户混跑、面向外部客户)→ 开 `process`。

```jsonc
{
  "isolation": {
    // logical(默认) | process | container
    "level": "process",
    // ★ 必需项,不是调优项。见下方内存开销。
    "maxProcesses": 64,
    // 引用归零后多久回收该 principal 的进程
    "idleTimeoutMs": 300000,
  },
}
```

#### 代价(实测,不是估算)

五次采样,Windows 11 开发机、Node 22、11 个插件全集
(明细见 [`FEASIBILITY-REPORT-V45.md`](FEASIBILITY-REPORT-V45.md) §6):

| 指标                | 实测        | 怎么读                                       |
| ------------------- | ----------- | -------------------------------------------- |
| 冷启动(fork → 就绪) | **~115 ms** | 每个 principal 的**第一次**请求要多等这么久  |
| 其中插件装配        | ~13 ms      | 只占九分之一 —— 优化装配代码没用             |
| 常驻内存            | **~58 MB**  | 每个**活跃 principal** 一份,不是每个会话一份 |

> ⚠️ 这组数字来自 Windows 开发机。Linux 上 fork 更便宜,预期冷启动更低。
> 上生产前请在你自己的机型上重测。

**容量规划的算法很简单:**

```
所需内存 ≈ 网关自身 + 活跃 principal 数 × 58 MB
maxProcesses ≈ (可用内存 - 网关自身 - 留白) / 58 MB
```

100 个活跃 principal ≈ 5.8 GB。**`maxProcesses` 必须设**:没有上限的进程池
在流量尖峰下会把机器吃到 OOM,而 OOM killer 挑中谁是随机的 —— 可能是网关自己。

进程池满时网关返回 **429**(契约的错误码是闭集,没有 503 位置;语义上它表示
「退避后重试」,负载均衡器与客户端的处置是对的)。看到 429 且用量没超配额,
就是该扩容或调高 `maxProcesses` 了。

#### 进程隔离**不解决**什么

别把它当容器用:

- **不防内核提权。** 子进程与网关同内核、同用户。
- **不限制 CPU / 内存 / 磁盘。** 一个 principal 能吃满整台机器。
  要限,套 cgroup / systemd slice / Windows Job Object,或直接上容器。
- **不隔离网络。** 子进程能访问网关能访问的一切,**包括内网服务与云厂商的
  元数据端点**(`169.254.169.254`)。这一条常被忽略,后果是凭据泄漏。
  用网络策略或容器网络命名空间来限。
- **不隔离同一 principal 的多个会话。** 一 principal 一进程 —— 同一个人的
  并发会话共用一个进程。这是刻意的(否则内存按会话数增长),但意味着
  「按会话隔离」不成立。
- **不阻止配额耗尽的租户占用进程槽位。** 配额判定挂在发起轮次上,而进程在
  建会话时就起来了。已知缺口。

**面向公众的多租户 SaaS 请上容器档。** 本版本的 `container` 只是配置位:
容器编排交给你的 Kubernetes / Nomad,接法是给 `Supervisor` 换一个
`ProcessLauncher`(见 [`@dshwar/supervisor`](../packages/supervisor/README.md))。

#### shell 工具在进程隔离下

子进程能正常再拉起孙进程(已测),所以 agent 的 shell 工具不受进程隔离影响。
但 `dsh-subprocess-local` **默认仍不装**(理由见上一节的表),需要 pty 的部署
自行加装 —— 加装后请在你的目标平台上验一次,V0.4.5 未覆盖 pty 的两层嵌套。

---

## 3. 反向代理:必须改的几个默认值

SSE 是长连接、流式、不带 `Content-Length`。代理的默认配置几乎全是为短请求调的,
不改就会出现「本地跑得好好的,上了生产只能收到最后一坨」。

### nginx

```nginx
location /v1/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;

    # 关掉缓冲 —— 否则 nginx 会攒够一整块才吐给客户端，流式变成一次性
    proxy_buffering off;
    proxy_cache off;

    # SSE 是长连接。默认 60s 会在一轮还没跑完时把连接掐掉
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    # 客户端 IP 与协议，网关的审计日志要用
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Last-Event-ID 必须原样透传，否则断线续传失效
    proxy_set_header Last-Event-ID     $http_last_event_id;
}
```

### Caddy

```caddyfile
api.example.com {
    reverse_proxy 127.0.0.1:8787 {
        flush_interval -1          # 立即冲刷，等价于 nginx 的 proxy_buffering off
        transport http {
            read_timeout 3600s
        }
    }
}
```

Caddy 默认自动申请并续期证书,这就是「让反向代理管 TLS」的意思。

### 云上的负载均衡

- **AWS ALB**:`idle_timeout.timeout_seconds` 默认 60 秒,调到 3600。ALB 不缓冲响应,SSE 可用。
- **Cloudflare**:免费版对流式响应有缓冲行为,SSE 表现不稳定。要么走 Enterprise,
  要么让 SSE 流量绕过 Cloudflare 代理(DNS only)。
- **GCP HTTPS LB**:默认 30 秒,调 `backendService.timeoutSec`。

### 心跳

网关每 15 秒发一个 `event: ping`。它的作用是让中间的每一跳都看到流量,
不至于按「空闲」把连接回收。如果你的代理链路上有更短的空闲超时,
把 `heartbeatMs` 调到它的一半以下。

---

## 4. 断线续传

SSE 每条事件带单调递增的 `id:`。客户端重连时带上 `Last-Event-ID`,
网关从缓冲里补发之后的事件:

```ts
for await (const event of client.stream(id, { lastEventId: '42' })) {
  // 从第 43 条开始
}
```

缓冲是**有界**的。断线太久,早期事件会被挤掉 —— 补发从缓冲里还剩的最早一条开始,
不会静默假装没丢。会话状态本身查 `GET /v1/sessions/{id}`,那个不受缓冲限制。

---

## 5. 反向代理之外的事

**限流**在代理层做,网关不实现。契约里有 `rate_limited` 与 429,但判定逻辑属于
`@dshwar/policy`(V0.4.0)。在那之前,用 nginx 的 `limit_req` 或代理自带的能力。

**审计**。所有 Admin 与 SCIM 调用进 `@dshwar/audit`,记录调用者 / 目标 / 变更前后。
默认输出到 stdout,接你自己的日志管道。审计日志的保留期通常比凭据轮换周期长得多 ——
所以它**只记 describe 层面的事实,绝不记凭据值**。

**凭据**。`GET /v1/admin/subjects/{id}/credentials` 只返回
`configured` / `source` / `writable` 三个字段,**永不返回值**。
这是上游 `dsh-credentials` 的既有约束,原样传递到 Admin API(硬规则 5)。
返回类型里没有值字段 —— 契约层就没给它留位置。

---

## 6. 升级

`@dshwar/*` 全部统一版本号。升级时整套一起升,不要单独升某一个包。

上游 `@deepseek-ai/dsh-*` **精确锁版**。DSHWAR 与 dsh 的对应关系见
[README 的兼容矩阵](../README.md#兼容矩阵)。跨过矩阵里的组合去搭,
运行时会在启动时校验版本并拒绝启动 —— 那是刻意的,不是 bug。

API 契约的破坏性变更会升大版,且 v1 与新版本**并行不少于 6 个月**。
CI 里的契约冻结检查(`pnpm check:contract`)保证破坏性变更不会悄悄溜进来。
