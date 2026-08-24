---
'@dshwar/api-contract': major
'@dshwar/metering': major
'@dshwar/console-contract': major
---

`UsageRecord` 的成本字段换形状:`costMinorUnits` + `currency` → `cost`

## 破坏了什么

| 旧                              | 新                      |
| ------------------------------- | ----------------------- |
| `costMinorUnits: integer`(必填) | **删除**                |
| `currency: string`(必填)        | **删除**                |
| —                               | `cost: Cost`(必填,见下) |

`Cost` 是一个判别对象:`kind` ∈ `priced` / `unpriced` / `unbilled`,
外加三个**仅 `priced` 非空**的载荷字段 `amountMinor` / `currency` / `currencyExponent`。

## 为什么值得

同一个字段上挂着两个洞,而它们互相牵制 —— 分两次动等于破坏性变更做两遍,
且第二次会发现第一次挑的形状不够用:

1. **语义折叠**:「这个模型没配价(**算不出来**)」与「部署方不计费(**不收钱**)」
   产出同一个 `0`,直达发票金额栏。而拿账单对账的人对两者的处理**完全相反** ——
   前者要去补配价再重算,后者是正确的终值。
2. **单位假设**:契约注释写死「分」,于是消费方一律 `÷ 100`。而 ISO 4217 的
   minor unit 指数不都是 2:**JPY = 0**(账目差 100 倍)、**KWD = 3**(差 10 倍,
   方向相反)。前端自带一张币种表是**第二个事实源**,与服务端计价口径迟早分家。

一个 `number | null` 装不下「多少钱 + 什么币种 + 几位小数 + 算不算得出来」这四件事。

## 老客户端怎么迁移

```diff
- const yuan = record.costMinorUnits / 100
- const code = record.currency
+ if (record.cost.kind !== 'priced') {
+   // 'unpriced' = 算不出来(去补配价);'unbilled' = 不收费(终值)
+   // ⚠️ 这两种都**不要**渲染成 0 —— 那正是这次改动要拆掉的谎
+   return '—'
+ }
+ const divisor = 10 ** record.cost.currencyExponent   // 不要写死 100
+ const major = record.cost.amountMinor / divisor
+ const code = record.cost.currency
```

服务端侧:`PriceTable` 新增必填的 `currencyExponent`,以及可选的 `unbilled`
(声明哪些 provider / 模型不计费)。**没有默认值** —— 不声明的话本地模型会落进
`unpriced`,那是刻意的:「这个部署不对本地算力收费」是一句只有部署方能说的话。

> ⚠️ 本文件在下一次提升开发版本号时并入 `CHANGELOG.md` 并删除(CLAUDE.md 第四节)。
> 它现在必须存在:`check-contract.mjs` 认的是**点名契约包的 major changeset**,
> 而不是 PR 描述里的一句声明。
