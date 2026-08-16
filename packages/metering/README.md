# @dshwar/metering

用量归属与成本核算。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 红线:观测不阻断

计量挂在会话事件流上,它挂了**不能**影响会话 —— 丢一条用量记录是账目问题,
断一次会话是事故。采集必须走 `safeRecord()`:任何异常都吞掉并交给失败回调
(通常落审计),连失败回调本身炸了也不向上抛。有测试钉住这两层。

## 计费口径只有一处

上游 `TokenUsage` 的计数是 **DISJOINT** 的:`inputTokens` 只算未命中缓存的输入。

```
计费输入 = inputTokens + cacheReadTokens + cacheWriteTokens
```

直接用 `inputTokens` 会**少计费**。`billedInputTokens()` 是唯一的口径实现,
聚合(`aggregateDaily`)与配额取数(`totalBilledTokens`)都从它走 ——
上游哪天改口径,`adapters/dsh-0.1.0` 的契约测试先红,然后改一处。

## 缺席容忍:不估算

上游的 `usage` 是可选的,适配器没报就没有。没报的 step 计 0 并标
`unreported: true` —— **不估算**。估算值混进账目比缺口更难审。

## ⚠️ 价格表必须配全

`aggregateDaily()` 对查不到价的模型成本计 **0**。这不是"免费",是"没配价" ——
**部署方必须把用到的每个模型都配进 `PriceTable`**,否则账单会静默少算。
价格以每百万 token 的最小货币单位(整数分)配置,成本在桶级一次舍入,不逐条累加。

```ts
const prices: PriceTable = {
  currency: 'CNY',
  prices: {
    'deepseek/deepseek-chat': { inputPerMTokenMinor: 200, outputPerMTokenMinor: 800 },
  },
}
```

## 接线(网关)

```ts
const store = new GatewaySessionStore({
  onUsage: (obs) => void safeRecord(metering, toRawUsage(obs), (d) => audit(d)),
})
```

采集点是 `assistant/message` 事件 —— 上游把用量随消息一起发,没有独立的用量流
(实测见 `docs/FEASIBILITY-REPORT-V4.md`)。粒度为 step,聚合到日 × 主体 × 模型,
与契约 `UsageRecord` 对齐。

## 许可

MIT
