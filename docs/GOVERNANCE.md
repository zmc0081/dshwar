# 计量与治理

面向要给 DSHWAR 部署配上「能对账、能设限」的人。四个包各管一件事:

| 包                     | 管什么               | 挂在哪                  |
| ---------------------- | -------------------- | ----------------------- |
| `@dshwar/audit`        | 谁在什么时候改了什么 | 所有 Admin 与 SCIM 调用 |
| `@dshwar/metering`     | 用了多少、值多少钱   | 会话事件流              |
| `@dshwar/policy`       | 还能不能用           | 发起一轮之前            |
| `@dshwar/model-router` | 许不许用、用哪个     | 建会话之前              |

---

## 0. 四条红线

这四条决定了治理**故障时**的行为,比功能本身更值得先读:

1. **计量只观测,不阻断。** 丢一条用量记录是账目问题,断一次会话是事故。
   采集走 `safeRecord()`,吞掉一切异常。
2. **判定与执行分离。** `policy` 只回答「能不能」,429 由网关发 ——
   判定逻辑要能被控制平面复用,不能长在 HTTP 层里。
3. **超限拒绝,不静默降级。** 配额烧完就是 429。降级是 `model-router` 的
   **显式配置**,且必须让用户看得见。
4. **审计仅追加。** 没有 update、没有 delete —— 类型层就写不出修改。

---

## 1. 计费口径:必须按 DISJOINT 加

上游 `TokenUsage` 的计数**互不重叠**:`inputTokens` 只算未命中缓存的输入。

```
计费输入 = inputTokens + cacheReadTokens + cacheWriteTokens
```

直接用 `inputTokens` 会**少计费**。`billedInputTokens()` 是唯一的口径实现,
聚合与配额取数都从它走。上游哪天改口径,
`adapters/dsh-0.1.0/test/usage-observability.test.ts` 先红。

### ⚠️ 价格表必须配全

查不到价的模型成本计 **0**。这不是"免费",是"没配价":

```json
{
  "governance": {
    "pricing": {
      "currency": "CNY",
      "prices": {
        "deepseek/deepseek-chat": { "inputPerMTokenMinor": 200, "outputPerMTokenMinor": 800 }
      }
    }
  }
}
```

价格是**每百万 token 的最小货币单位(整数分)**。成本在日×主体×模型的桶级
一次舍入,不逐条累加 —— 逐条舍入会让账目随记录条数漂移。

**唯一的例外:本地 provider(V0.6.5)。** `llm-local` 注册的本地模型
(`local` / `ollama` 等)**不要配价** —— 本地算力花的是部署方自己的电与显卡,
DSHWAR 没有立场替它标价。账单上本地行金额恒 0 且 token 完整可见,
那个 0 是「本地算力不计费」,不是「没配价」。给本地 provider 配上价,
反而会把一笔不存在的钱写进客户的账单。本地用量的看板走
`summarizeLocalUsage`(统计,与云端口径一致),不走账单。

用量没被适配器报出来时计 0 并标 `unreported`,**不估算** ——
估算值混进账目比缺口更难审。

---

## 2. 配额

```json
{ "governance": { "quotas": [{ "subjectId": "alice-e6f1", "tokenLimit": 500000 }] } }
```

`tokenLimit: null` 或不配 = 不限。周期是 **UTC 自然月**,上个周期的用量不计入。

- 判定发生在 **发起一轮之前**(不是建会话):烧钱的是轮,不是会话对象。
- 超限 → `429` + `rate_limited`,契约里的标准错误形状。
- **余额不缓存**:每次判定从计量现算。缓存会让「提额」变成「提额并等缓存过期」。

### fail open —— 与身份层的 fail closed 方向相反

| 层             | 失败时   | 为什么                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------- |
| 身份(硬规则 6) | **拒绝** | 认不出人就放行 → 别人的数据被看到,不可逆                                        |
| 配额           | **放行** | 读不到账就拒绝 → 计量故障升级成全员服务中断;放行只是几轮没被限额,账目可从审计补 |

计量是账目组件,不是安全组件。把它放进关键路径的故障域,等于造一个
「记账挂了所以谁都不能用」的事故模式。fail open 时会落审计
(`policy.metering-unavailable`),不是静默放过。

---

## 3. 模型准入与降级

```json
{
  "governance": {
    "modelPolicies": [
      {
        "id": "p-acme",
        "tenantId": "acme",
        "allowedModels": ["deepseek/deepseek-chat", "deepseek/deepseek-lite"],
        "fallbackModel": "deepseek/deepseek-lite"
      }
    ]
  }
}
```

- **准入是 opt-in**:没配策略的租户默认放行。默认封锁会让每个新租户先撞 403,
  然后运维学会「上来先配个全通策略」,治理从此变成仪式。
- `allowedModels: []` = 全部允许(契约语义)。
- 清单外 → **403,不静默换**。

### 降级必须让用户看得见

预算用到阈值(默认 80%)且配了 `fallbackModel` 时自动降级,三处留痕:

1. 响应头 `x-dshwar-model-downgraded: provider/model`
2. 会话记录里存的是**裁决后**的模型 —— 计量与审计因此对得上真正在跑的那个
3. 审计 `model.downgraded`,`before` / `after` 都在

静默换模型省下的每一分钱,都会在第一次「为什么答案变笨了」的工单里加倍还回去。

三条边界:没配 `fallbackModel` → 超阈值也不降级(走 429);预算水位未知 →
不降级(依据必须是真数);`fallbackModel` 配成清单外 → **拒绝**,
不放行一个清单外的模型。

---

## 4. 审计

所有 Admin 与 SCIM 调用进审计(CLAUDE.md 第七节)。查询走
`GET /v1/admin/audit`,**按 Admin Key 的租户强制过滤** —— 租户不是查询参数,
可指定的过滤键等于把跨租户查询做成了一个功能。

- **凭据类操作只记 `describe` 层面的事实,绝不记录值。** 审计的保留期比凭据的
  轮换周期长得多,把值写进去等于造一个长期留存的密钥副本。
- 配额变更记 `before` / `after`:「谁在什么时候把限额从多少改到多少」是账务
  纠纷时的第一个问题。
- 需要「修正一条审计」时**追加一条修正记录**,不改历史。

生产部署请把 `InMemoryAuditStore` 换成走上游 `storage` 契约的 `KvAuditStore`,
或等 V0.5.0 控制平面的 Postgres 实现 —— 内存实现重启即丢。

---

## 5. 完整配置示例

见 [`gateway/gateway.config.example.json`](../gateway/gateway.config.example.json)。
治理整段可选,不配就是「不计量、不限额、不管准入」。

---

## 6. 已知限制

- **内存实现重启即丢。** 四个包都提供了走上游 `storage` 契约的实现,
  但 `server.ts` 的默认装配用的是内存版 —— 它面向的是「先把管道跑通」。
- **`loadAll()` 整表进内存。** 上游 `KvUnit` 没有按键读取,审计与用量数据量大时
  应换 Postgres 实现(V0.5.0),而不是在这里加缓存 ——
  缓存会让「刚被停用/刚烧完配额」的判定滞后。
- **不出账单。** 本版本只记账。`billing` 契约与 `billing-local` 在 V0.6.0。
