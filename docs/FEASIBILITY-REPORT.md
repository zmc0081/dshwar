# DSHWAR Session 0 · 可行性验证报告

> 产出于 V0.1.0 Session 0(止损点)。本 Session 不写产品代码、不建 `packages/`,
> 只产出验证脚本与本报告。
>
> 验证日期:2026-08-15
> 上游版本:`@deepseek-ai/dsh-*` **0.1.0-rc.6** · `@deepseek-ai/cordis` **4.0.1**
> 验证脚本:[`feasibility/verify/`](../feasibility/verify/)

---

## 一、结论摘要

**四项止损验证全部通过。ARCHITECTURE.md §2.2 的两条技术前提成立,架构不变,进入 Session 1。**

| #   | 验证项                   | Windows | Linux | 结论                              |
| --- | ------------------------ | ------- | ----- | --------------------------------- |
| A   | `ctx.isolate` 作用域传播 | 13/13   | 13/13 | **通过**                          |
| B   | 凭据不跨操作缓存         | 21/21   | 21/21 | **通过**                          |
| C   | 并发无串号               | 5/5     | 5/5   | **通过**                          |
| D   | PTY 在非交互父进程下可用 | 5/8     | 8/8   | **Linux 通过;Windows 受上游限制** |
| —   | B10 实现约束探查(非止损) | 1/3     | 1/3   | 发现一条硬约束,见 §4.1            |

止损路径**未触发**:

- 验证 A / C 通过 → 无需改为「进程级隔离优先」,`supervisor` 保持在 V0.4.0
- 验证 B 通过 → 会话级 principal 绑定可行,无需每 principal 一个运行时

> 📌 **核心论点已被证明**:Harness 的服务契约可以被换成多用户实现,消费方零改动。
> 单个 credentials 实例在根作用域注册一次,不同会话作用域访问它时各自解析到自己的 key。

---

## 二、验证环境

| 项       | Windows(开发机)      | Linux(容器,部署目标)       |
| -------- | -------------------- | -------------------------- |
| OS       | Windows 11 Pro 26200 | Linux 6.6.87.2 WSL2 x86_64 |
| Node     | v24.14.0             | v24.19.0                   |
| pnpm     | 11.12.0              | 11.12.0                    |
| 容器镜像 | —                    | `node:24`                  |

两个平台跑的是**同一套脚本**(`feasibility/verify-linux.sh` 把脚本复制进容器后重装依赖再跑)。

### 复现步骤

```bash
cd feasibility
pnpm install
node verify/run-all.ts                    # Windows / 本机

# Linux 复跑(部署目标平台)
docker run --rm -v "$PWD:/src:ro" -w / node:24 bash /src/verify-linux.sh
```

退出码:全绿为 0;任一断言失败为 1(当前因 B10 恒为 1,见 §4.1)。

---

## 三、逐项结论

### 验证 A —— `ctx.isolate` 作用域传播 ✅ 13/13

cordis 4.0.1 的 `isolate(name: string, label?: symbol): this` 行为与文档完全一致。

| 断言                                               | 结果 |
| -------------------------------------------------- | ---- |
| A1 兄弟作用域互不可见                              | 通过 |
| A2 父作用域不被子作用域污染                        | 通过 |
| A3 相同 label 的两次 `isolate` 合并作用域          | 通过 |
| A4 嵌套 isolate:孙作用域覆盖,父不受影响            | 通过 |
| A5 **作用域随 fiber 释放自动解绑**(会话结束不泄漏) | 通过 |
| A6 **父作用域注册的服务,`this.ctx` 重绑到访问方**  | 通过 |

**A6 是本次验证最关键的一条结果。** 它决定了 `withPrincipal` 的实现形态:

```ts
// 服务只在根作用域注册一次
await root.plugin(PerPrincipalCredentials)

// 不同会话作用域访问同一个服务,各自解析到自己的 principal
const aliceCtx = withPrincipal(root, alice) // ctx.isolate('principal') + provide
const bobCtx = withPrincipal(root, bob)

await aliceCtx.credentials.resolve(REF) // → sk-alice-...
await bobCtx.credentials.resolve(REF) // → sk-bob-...
```

机制:cordis 的 context 是 Proxy,读 `ctx.someService` 返回的是**按访问方 context 追踪过的
wrapper**(`aliceCtx.credentials !== bobCtx.credentials`),wrapper 内部方法里的 `this.ctx`
是访问方而非注册方。这正是「换掉一个实现,所有消费方自动变多用户」得以成立的底层原因。

### 验证 B —— 凭据不跨操作缓存 ✅ 21/21

上游 `dsh-credentials` 的 TSDoc 已明文承诺此语义;本项验的是**行为**而非复述文档:

> "Resolution is per call: consumers re-resolve at each operation and must not cache
> across operations — that per-operation read is what makes a changed credential reach
> the next operation without a restart."

| 断言                                                                   | 结果 |
| ---------------------------------------------------------------------- | ---- |
| B1 两 principal 同一 ref 解析到各自的值                                | 通过 |
| B2 顺序解析 alice→bob→alice,每次立即换值(证明无缓存)                   | 通过 |
| B3 **换绑后「下一次操作」即生效,未重启任何插件**                       | 通过 |
| B4 匿名 principal fail closed,不回退共享 key(硬规则 6)                 | 通过 |
| B5 `describe` 只暴露 `configured`/`source`/`writable`,不含值(硬规则 5) | 通过 |
| B6 遮蔽机制:网关值只读,`set`/`unset` 抛错                              | 通过 |
| B7 `set` 后 `credentials/updated` 事件发出                             | 通过 |
| B8 空值等同缺失(上游 seam 规则)                                        | 通过 |
| B9 `credentialRef` 拒绝非 POSIX 标识符                                 | 通过 |

**CLAUDE.md 硬规则 5 与 6 可以原样落在上游契约上**,不需要任何变通:
`CredentialInfo` 的类型定义本身就只有三个字段,不存在「不小心返回值」的可能。

### 验证 C —— 并发无串号 ✅ 5/5

本项最容易「假绿」——顺序执行永远不串号。脚本在 `resolve()` 内部**三处**插入随机
`await`(读 principal 前、读到后取值前、返回前),最大化交错窗口。

| 断言                                       | 规模   | 结果     |
| ------------------------------------------ | ------ | -------- |
| C1 两 principal 并发,复用长命 context      | 200 次 | 0 次串号 |
| C2 每请求新建作用域(贴近真实网关模型)      | 100 次 | 0 次串号 |
| C3 三 principal 交叉(排除「刚好两个错开」) | 100 次 | 0 次串号 |
| C4 匿名与具名混跑,匿名不得借到别人的 key   | 100 次 | 0 次泄漏 |

### 验证 D —— PTY 在非交互父进程下可用 ⚠️ 平台相关

脚本以 `stdio: ['pipe','pipe','pipe']`(父进程无 TTY,模拟 supervisor 拉起方式)
拉起子进程,子进程内经 cordis 装载 `LocalSubprocessRuntime`,调**上游真实路径**
`ctx.subprocess.spawnTerminal()` —— 刻意不直接 `import node-pty`,因为要验的是
「`dsh-subprocess-local` 的 PTY 能力可用」,不是「node-pty 这个包能装上」。

| 断言                                              | Windows  | Linux |
| ------------------------------------------------- | -------- | ----- |
| D1 子进程正常退出、确认自身无 TTY                 | 通过     | 通过  |
| D2 `dsh-subprocess-local` 注册为 `ctx.subprocess` | 通过     | 通过  |
| D2b **普通 `spawn()`(非 PTY 路径)可用**           | **通过** | 通过  |
| D3 `spawnTerminal()` 分配 PTY                     | **失败** | 通过  |
| D4 PTY 回显可读(shell 真在跑)                     | **失败** | 通过  |
| D5 终端会话可终止并达到静默                       | **失败** | 通过  |

**Windows 失败原因不是 node-pty**(它安装正常,conpty.dll 已就位),
而是上游 `dsh-subprocess-local` 根本没实现 win32 的进程表检查:

```js
// @deepseek-ai/dsh-subprocess-local/lib/index.js
function createProcessInspector(platform, arch, internals) {
  if (platform === 'linux') return new LinuxProcessInspector(arch, internals)
  if (platform === 'darwin') return new MacProcessInspector(internals)
  throw new Error(`subprocess-local: terminal inspection is unsupported on platform ${platform}`)
}
```

`ProcessInspector` 负责前台进程组检查与会话树清理,`spawnTerminal` 在分配时才惰性解析它,
于是 win32 上一调即抛。**普通 `spawn()` 走另一条代码路径,win32 完全可用**
(其 `childEnv` 里有专门的 win32 大小写处理),因此影响面被限制在终端类工具。

---

## 四、附带发现(非止损,但影响后续 Session)

### 4.1 ⚠️ cordis Service 中**不能使用** ECMAScript `#private` 字段

```
Cannot read private member #secret from an object whose class did not declare it
```

根作用域访问与 isolate 子作用域访问**都会抛**,两个平台一致。原因即 A6 所述:
服务经 Proxy 包装,方法内的 `this` 是 wrapper 而非真实实例,而 `#private`
按规范只能在真实实例上访问。

**对照组已验证绕行方案**:TypeScript 的 `private` 只是编译期修饰,运行时是普通属性,
可正常穿透 Proxy(B10c 通过)。

> **对 Session 2–6 的约束**:所有继承 cordis `Service` 的类
> (`principal` / `auth` / `credentials-multiuser` / `fs-tenant` / `storage-scoped`)
> **一律用 TypeScript `private`,禁止 `#private`**。建议在 Session 1 的 ESLint 配置里
> 加一条规则拦截,否则会在 Session 4 花掉半天排查一个看起来毫无道理的 TypeError。

### 4.2 上游类名与任务书不一致

| 位置                         | 任务书写法                        | 上游实际                        |
| ---------------------------- | --------------------------------- | ------------------------------- |
| `SESSION_TASKS.md` Session 4 | 「继承上游 `Credentials` 抽象类」 | 类名是 **`CredentialProvider`** |

服务名确实是 `ctx.credentials`(基类内部 `super(ctx, "credentials")`),但类名不是。
Session 4 开工前需修正任务书措辞。

### 4.3 上游 npm `dist-tags.latest` 是坏的

除 `@deepseek-ai/dsh` 本体外,**全部子包的 `latest` 标签停留在 `0.0.1-rc.1`**,
而实际已发布到 `0.1.0-rc.6`:

```
@deepseek-ai/dsh                latest = 0.1.0-rc.6   ← 正确
@deepseek-ai/dsh-credentials    latest = 0.0.1-rc.1   ← 实际已有 0.1.0-rc.6
@deepseek-ai/dsh-fs             latest = 0.0.1-rc.1   ← 同上
@deepseek-ai/dsh-storage-domain latest = 0.0.1-rc.1   ← 同上
（sandbox-policy / subprocess-local / fs-local / storage-sqlite / llm / session 同）
```

CLAUDE.md 硬规则 3(精确锁版、禁止 `^` `~`)正好绕开这个坑。但两点要注意:

1. **Renovate 配置必须按版本号而非 `latest` 标签跟版**,否则永远不会开 PR
2. 文档中 `adapters/dsh-0.0.1/` 的命名与 `0.0.1-rc.1` 版本假设**已过期**,需统一改为 `0.1.0`

### 4.4 dsh 实际暴露的通道形态(Session 0 环境准备产出)

`dsh --profile web --host 127.0.0.1 --port 3080` 实测:

| 项       | 实测结果                                                                          |
| -------- | --------------------------------------------------------------------------------- |
| 监听     | `127.0.0.1:3080`(默认值来自 profile,`--port 0` 可让 OS 选)                        |
| 协议     | **HTTP/1.1 明文**,单端口;SPA + 插件 bundle 从 `/plugins/<pkg>/client.js` 动态加载 |
| RPC      | `POST /api` 与 `/api/respond`;WebSocket 升级探测无响应                            |
| TLS      | **无**                                                                            |
| 认证     | **无**                                                                            |
| 唯一栅栏 | Origin 白名单(`--trusted-host` 可扩充)                                            |

栅栏行为实测:

```
GET /                                  → 200   （无任何凭据）
GET /api                               → 404   （无 Origin 头，直接通过栅栏）
GET /api  -H "Origin: http://evil…"    → 403   （伪造 Origin 被拒）
```

**关键:不带 `Origin` 头的请求直接放行。** 这是 CSRF 栅栏,不是认证 ——
任何非浏览器客户端(curl、脚本、移动端 SDK)都不会带 Origin,因此凡能连到该端口者
即拥有完全访问权。

> 这条实测**印证并细化了 ARCHITECTURE.md §1.1 关于「API 平面是护城河」的判断**:
> 上游内置 webserver 无法直接用于 ToB。不过 §1.1 现在的表述是「自述没有 TLS、认证和
> origin 策略」——**origin 策略其实是有的**,缺的是 TLS 与认证。建议改为
> 「没有 TLS 与认证,仅有一道面向浏览器的 Origin 栅栏」,避免被采用者挑出事实错误。

`credentials` 在 web profile 中由 `@deepseek-ai/dsh-credentials-local` 提供,
配置为 `apiKeyEnv: DEEPSEEK_API_KEY` —— 即单用户从环境变量取一把 key,
与 DSHWAR 要替换的正是这一层,契合预期。

---

## 五、对后续 Session 的行动项

| #   | 行动                                                                         | 落点          |
| --- | ---------------------------------------------------------------------------- | ------------- |
| 1   | 上游锁版统一为 `0.1.0-rc.6`,`adapters/dsh-0.0.1/` 改名 `adapters/dsh-0.1.0/` | Session 1 / 7 |
| 2   | ESLint 加规则:继承 cordis `Service` 的类禁止 `#private`                      | Session 1     |
| 3   | Renovate 按版本号跟版,不依赖 `dist-tags.latest`                              | Session 1     |
| 4   | 修正任务书:上游类名 `CredentialProvider`(非 `Credentials`)                   | Session 4     |
| 5   | CI 的 PTY 相关契约测试只在 Linux runner 跑;Windows 开发机需 Docker 复跑      | Session 7     |
| 6   | 修订 ARCHITECTURE.md §1.1 对上游 webserver 的表述(见 §4.4)                   | 随时          |
| 7   | `README` 隔离模型警告可引用本报告 A6 机制说明                                | Session 8     |

---

## 六、遗留未验证项

以下不属于 Session 0 范围,记录以免遗忘:

- **`storage-domain` 能否直接承载 tenantId**(R7 待确认项)—— Session 6 评估
- **进程级隔离的实际开销** —— 逻辑隔离已验证可行,但跨信任边界仍需进程隔离;
  内存开销与冷启动延迟未测,`supervisor` 立项(V0.4.0)前需补
- **macOS 上的 PTY 行为** —— 上游有 `MacProcessInspector`,但本次未在 darwin 实测
