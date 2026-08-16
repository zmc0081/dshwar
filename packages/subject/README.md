# @dshwar/subject

Subject Mirror —— 外部身份源里某个用户在 DSHWAR 这一侧的**镜像**。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 它是什么

一份用于**归属与授权**的副本:这个 token 背后是谁、属于哪个租户、现在还有没有效。

```ts
import { InMemorySubjectStore } from '@dshwar/subject'

const store = new InMemorySubjectStore()

// 由 SCIM 供给方推进来，不是我们凭空造的
const alice = await store.upsert({
  source: 'authentik',
  externalId: 'ak-0001',
  userName: 'alice',
  tenantId: 'acme',
  emails: [{ value: 'alice@acme.example', primary: true }],
  groups: ['tenant:acme'],
})

// 供给方那边停用了 → auth 层下一次就会拒绝
await store.deactivate(alice.id)
```

## 它不是什么

**不是用户表。** DSHWAR 是身份消费者,不是身份提供者(CLAUDE.md 硬规则 4)。
由此推出三条不可协商的约束:

| 约束             | 为什么                                                                              |
| ---------------- | ----------------------------------------------------------------------------------- |
| **没有密码字段** | 契约层就不留位置。留一个 optional 的,迟早有人往里写东西                             |
| **没有新建入口** | 只有 `upsert` 且必须带 `source`。凭空造的用户在上游 IdP 里不存在,下次全量同步变孤儿 |
| **停用不删除**   | `active: false` 是状态不是删除。审计要能回答「这个人什么时候被停的」                |

`assertNoCredentialFields()` 会在供给方载荷里带 `password` 时**报错而不是静默丢弃** ——
SCIM 的 `User` schema 里真的有这个字段(RFC 7643 §4.1.1),而静默丢弃会让部署方
以为密码同步成功了。

## 两个实现

| 实现                   | 用途                                   |
| ---------------------- | -------------------------------------- |
| `InMemorySubjectStore` | 测试与单进程部署                       |
| `KvSubjectStore`       | 走上游 `storage` 契约,跟随部署方的后端 |

两者跑**同一套测试断言** —— 它们迟早会分叉,而分叉的表现是「开发时好好的,
上了持久化就丢停用状态」。

### 已知限制

上游 `KvUnit` 只有 `loadAll()`,**没有按键读取**,所以每次 `get` 都会把整个 unit
读进内存。这是上游契约的形状,`@dshwar/storage-scoped` 有同样的问题。

身份数据通常是几千到几万条,这个量级可接受。真到了需要按键读取的规模,
应该换 Postgres 实现(V0.5.0 控制平面),**而不是在这里加缓存** ——
缓存会让「供给方刚停用的用户」在缓存过期前仍然能通过认证。

## 内部 id 怎么来的

`subjectKey(source, externalId)`,复用 `@dshwar/storage-scoped` 的长度前缀编码。

`source` 与 `externalId` 都是**外部完全可控**的字符串,`${source}:${externalId}`
这样的拼接能被构造碰撞 —— 而碰撞意味着 B 家的用户覆盖掉 A 家的。长度前缀与两者的
内容完全无关,没有任何字符串能伪造出别人的键。

## 许可

MIT
