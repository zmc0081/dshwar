# llm-local 复用上游适配器 —— 治理层,不造引擎

日期:2026-08-17 · 状态:已裁决(V0.6.5 Session 0)
关联:D6(预裁决:Ollama 适配,CI 未检测到即 skip,本地用量统计不计费)

## 一句话

`@dshwar/llm-local` **不实现任何模型调用代码** —— 它构造一个指向本地
OpenAI 兼容端点的上游 `DeepSeekAdapter` 实例,以 `local` 为 provider 名注册进
`ctx.llm`。流式、重试、消息格式、工具调用,全部是上游已经写好并持续维护的。

## 为什么这不越界(CLAUDE.md 一句话边界的裁决)

「模型编排(`llm/`)是上游地盘,只做治理层,不造引擎。」

一个从零实现的 Ollama 适配器是**引擎**:要跟上游的消息格式、流式分帧、
工具调用协议保持逐版本同步 —— 那正是「fork 上游」的另一种写法,只是名字体面。

复用上游适配器则是**治理**:llm-local 做的事只有三件 ——
provider 注册(归属)、keyless 凭据策略(裁决「本地端点不需要凭据」)、
模型清单声明(部署方配置)。没有一行代码碰模型调用本身。

## 证据链(全部实测,2026-08-17)

### 1. 上游契约面是公开导出

```
@deepseek-ai/dsh-llm 导出:LlmAdapter LlmRuntime LlmError …
LlmAdapter 原型:providerInfo providerRetryPolicy listModels resolveModel
@deepseek-ai/dsh-llm-deepseek 导出:DeepSeekAdapter Config resolveAdapterOptions …
DeepSeekAdapter 原型:… stream request(父类 LlmAdapter)
```

`DeepSeekAdapter` 是**公开导出**,不是深链 `/lib/` 内部实现 ——
硬规则 2(仅 `adapters/` 可深链)不适用,`packages/` 直接消费合法。

### 2. 三个注入点全部在构造函数上

上游插件自己的 `apply` 就是这么用的(反汇编自 `String(ds.apply)`):

```js
const adapter = new DeepSeekAdapter({ options, resolveApiKey, resolveUserId })
ctx.llm.registerAdapter([PROVIDER], adapter)
```

`resolveAdapterOptions({}, env)` 的输出确认 `baseURL` 与 `models` 可配:

```json
{ "apiKeyEnv": "DEEPSEEK_API_KEY", "baseURL": "https://api.deepseek.com",
  "models": [ … ], "retryPolicy": { … } }
```

把 `baseURL` 换成 `http://127.0.0.1:11434/v1`(Ollama)或
`http://127.0.0.1:8080/v1`(llama.cpp server),就是本地适配器。
两者都实现 OpenAI 兼容 `/v1`,**一个包覆盖两个引擎**。

### 3. 注册 API 是公开的

`ctx.llm.registerAdapter([provider], adapter)` —— `LlmRuntime` 的公开方法,
上游 `dsh-llm-deepseek` 插件走的同一条路。

### 4. 本机探测实测

```
$ ollama --version        → Warning: could not connect to a running Ollama instance
$ curl localhost:11434/api/tags → {"models":[{"name":"nomic-embed-text:latest",…}]}
```

⚠️ **CLI 与服务是两回事**:CLI 说没运行的同时,HTTP 端点活着并有模型。
探测一律打 HTTP(`/api/tags` 或 OpenAI 兼容 `/v1/models`),不调 CLI。

## keyless 为什么不违反硬规则 6

硬规则 6:「缺失 principal 时一律 fail closed。匿名 principal 解析不到任何
凭据,不得回退到默认值或共享 key。」

它保护的对象是**凭据** —— 一把能花别人钱、看别人数据的钥匙。
本地端点(127.0.0.1 上的 Ollama)不鉴权,**不存在这样的钥匙**:
`resolveApiKey` 返回的占位符不打开任何东西,泄漏它的损失是零。

fail closed 在这里没有对象,正如「不做离线额度机制」的推理链
(离线 → 只有本地模型 → 不消耗云端 token → 没有计量对象):
**规则不适用于不存在的东西。**

反过来要警惕的是:若部署方把 llm-local 的 `baseUrl` 指向一个**需要鉴权的
远程端点**,keyless 就成了共享匿名访问 —— 所以 llm-local 的配置校验
**只接受 loopback / 私有地址**,指向公网地址时拒绝启动并提示
「远程 OpenAI 兼容端点请走上游 dsh-llm-deepseek 的 baseURL 配置,
凭据经 credentials 服务按 principal 解析」。

## 风险与跟踪

| 风险                                          | 处置                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 上游把 `DeepSeekAdapter` 从公开导出撤下       | 契约测试立刻红(adapters 跟版流程),届时再评估:提 issue 要求稳定导出,或把适配器实例化挪进 `adapters/dsh-<version>/` |
| 上游构造签名变化                              | 同上 —— 锁版 + Renovate,48 小时窗口                                                                               |
| Ollama 的 OpenAI 兼容层与真 OpenAI 语义有出入 | 只影响本地推理质量,不影响治理层;上游适配器的重试与错误映射兜底                                                    |
