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

## ⚠️ 价格表必须配全 —— 而「没配」不再是一个 0

`aggregateDaily()` 对查不到价的模型给 **`{ kind: 'unpriced' }`**,**不是 0**。

> V0.9.0 Session 5.5 之前它给 0,而「部署方不计费」也给 0 ——
> 一份把「**算不出来**」印成「**零元**」的账单。而拿它对账的人对两者的处理
> 完全相反:前者要补配价再重算,后者无事可做。

三种情况现在在类型层分得开,**没有一种能退化成 0**:

| `kind`     | 含义         | 谁产生它                              |
| ---------- | ------------ | ------------------------------------- |
| `priced`   | 算出来了     | 模型在 `prices` 里                    |
| `unpriced` | **算不出来** | 模型不在 `prices` 里,也没被声明不计费 |
| `unbilled` | **不收费**   | 模型或其 provider 在 `unbilled` 里    |

`billing-local` 遇到 `unpriced` 会**拒绝出票**并点名是哪些模型 ——
与「未配置卖方拒绝出票」同一条纪律。

### 指数由部署方声明,不由任何一张表推断

`currencyExponent` 是 minor → major 的指数:CNY / USD 是 2,**JPY 是 0**,**KWD 是 3**。
它必须与 `prices` 里那些数字的单位一致 —— 两者出自同一段配置,
正是这个值可信的全部理由。

🚨 **不要在消费方自带一张「币种 → 指数」表**:那是第二个事实源,
与这里的口径迟早分家,而分家的表现是账目差 10 的整数次幂。
`check-guards.mjs` 有一条守卫盯着这件事。

```ts
const prices: PriceTable = {
  currency: 'CNY',
  currencyExponent: 2,
  // 本地算力不计费 —— 这是一句**声明**,与「忘了配价」在类型上就分得开
  unbilled: ['local'],
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
