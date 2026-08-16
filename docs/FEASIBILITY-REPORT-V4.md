# V0.4.0 Session 0 · 用量可观测性报告

> 日期:2026-08-16 · 对应 `SESSION_TASKS.md` M0.4.0 Session 0(止损点)
> 结论:**止损未触发。** 上游报 token 用量,且随消息事件同行,归属闭环。

---

## 0. 一句话结论

metering 的输入信道**存在且已实测**:适配器发 `usage` chunk → 上游把它装配进
`assistant/message` 事件(与消息本体同行)→ 走网关已经在用的 `session/event`
信道 → 事件带 `turn` / `step`,配合网关的会话簿即可归属到 principal。
**不需要任何新信道,不需要碰上游内部。**

与前三份报告不同,本次验证**全部是可执行断言**,且直接落成了常驻契约测试
(`adapters/dsh-0.1.0/test/usage-observability.test.ts`,5 条)——
上游改掉任何一环,跟版时它先红。

---

## 1. 验证 A —— 上游报不报用量?

### 结论:报,而且设计得很干净。

类型面(`@deepseek-ai/dsh-llm` 0.1.0-rc.6):

```ts
// StreamChunk 联合里有专门的用量块
{ type: 'usage', usage: TokenUsage }

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

两条上游自己写死的语义,metering 直接继承:

1. **「Adapters emit usage before the terminal finish and nothing afterward」**
   —— 用量在 finish 之前到,一个 step 至多一条。
2. **「Counts are DISJOINT」** —— `inputTokens` 只算未命中缓存的输入;
   计费输入 = `inputTokens + cacheReadTokens + cacheWriteTokens`。
   DeepSeek 的 `prompt_tokens` 是总量,上游已经替我们把口径拆干净了。
   ⚠️ metering 的计费口径必须按这个加法算,直接用 `inputTokens` 会**少计费**。

落库侧(`@deepseek-ai/dsh-session`):`assistant/message` 事件的形状是
`{ turn, step, message, usage?: TokenUsage }`,上游注释原话:

> "the model output and its accounting travel together
> (there is no separate usage record)"

**没有独立的用量记录** —— 这是上游的设计决定,意味着 metering 只有这一个
采集点,不存在「漏了另一条用量流」的问题。

`usage` 是可选的:适配器没报就没有。metering 必须容忍缺席
(计为 0 并打标记,而不是崩)。

---

## 2. 验证 B —— 信道实测

### 结论:5 条断言全过,一次通过。

用报固定用量(120 in / 7 out / 30 cacheRead)的假适配器驱动完整的
七插件装配,在 `handle.agent.ctx` 上监听 `session/event`:

| 断言                                                          | 结果 |
| ------------------------------------------------------------- | ---- |
| `assistant/message` 带 usage,数值与适配器报的逐字段一致       | ✅   |
| input 与 cacheRead 独立存在(DISJOINT 口径成立)                | ✅   |
| 信封 `{ type, seq, ... }`,seq 单调(与 REPORT-V2 §4.3 一致)    | ✅   |
| `assistant/chunk` 里能看到原始 usage 块(备用信道,粒度到 step) | ✅   |
| `assistant/message` 带 `turn` 与 `step`                       | ✅   |

**这是网关 SSE 已经在用的同一条信道。** metering 不需要新订阅点 ——
`GatewaySessionStore.register()` 现有的监听器旁边加一个采集回调即可。

---

## 3. 验证 C —— 归属

### 结论:闭环,零新增信道。

归属链:事件带 `turn`/`step` → 监听器挂在 **agent 自己的 ctx** 上
(上游按 agent 作用域过滤事件,V0.2.0 验证 D 实测)→ 网关的会话簿本来就存着
`session → principal` → 三者拼起来就是 `UsageRecord` 的归属键。

跨会话不会串:作用域过滤保证一个监听器只看到自己 agent 的事件 ——
这一条 V0.2.0 已验证并有契约测试,本版本直接复用结论。

---

## 4. 对设计的三条直接约束

1. **计费口径**:billedInput = `inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)`。
   契约冻结的 `UsageRecord` 怎么摆这几个字段,Session 2 按冻结契约实现,
   但**聚合与计费必须按 DISJOINT 口径加**。
2. **粒度**:采集点是 step 级(一轮可能多个 step,工具调用会拆步)。
   `UsageRecord` 至少要能按 `(session, turn)` 聚合。
3. **缺席容忍**:`usage` 可选。没报的 step 计 0 并标 `unreported`,
   不崩、不估算 —— 估算值混进账目比缺口更难审。

---

## 5. 断言汇总

| #   | 断言                                     | 结果                      | 依据                       |
| --- | ---------------------------------------- | ------------------------- | -------------------------- |
| A1  | 上游 StreamChunk 有 usage 块             | 是                        | 类型面 + 实测              |
| A2  | TokenUsage 口径 DISJOINT                 | 是                        | 类型注释 + 实测两字段独立  |
| A3  | assistant/message 随带 usage             | 是                        | 实测                       |
| A4  | 存在独立的用量事件流                     | **否**(设计如此,单采集点) | 类型注释                   |
| B1  | usage 穿过 agent-loop 到达 session/event | 是                        | 实测                       |
| B2  | 信封形状与 REPORT-V2 §4.3 一致,seq 单调  | 是                        | 实测                       |
| C1  | 事件带 turn/step,归属零新增信道          | 是                        | 实测                       |
| C2  | agent 作用域过滤防跨会话串号             | 是                        | V0.2.0 验证 D,契约测试在案 |

全部断言常驻于 `adapters/dsh-0.1.0/test/usage-observability.test.ts`。

---

## 6. 止损判据的裁决

任务书:「若用量完全不可观测且无法从消息内容估算,V0.4.0 改为只做
audit + policy(按轮次限额),metering 推迟。」

**未触发。** 按原计划进行,Session 2 的 metering 直接挂在已验证的信道上。
