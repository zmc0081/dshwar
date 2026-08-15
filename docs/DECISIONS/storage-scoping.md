# 决策:上游 `storage-domain` 不能直接承载 tenantId,需要 `@dshwar/storage-scoped`

> 日期:2026-08-15 · Session 6 · 状态:**生效中**
> 对应 `SESSION_TASKS.md` 的 R7 待确认项(默认假设为「可以直接复用」)

## 结论

**默认假设不成立。** 上游 `storage-domain` 的 `domain` 概念**不能**承载 `tenantId`,
本包不能退化为薄配置,需要真实实现 `@dshwar/storage-scoped`。

## 上游实际语义(读 0.1.0-rc.6 的类型定义)

三层结构:

| 层       | 包                                | 职责                                                 |
| -------- | --------------------------------- | ---------------------------------------------------- |
| Hub      | `dsh-storage`                     | 具名后端注册表 + 数据形态挂载点。**本身不做任何 IO** |
| 数据形态 | `dsh-storage-domain`              | schema 校验、变更事件的 KV domain                    |
| 后端     | `storage-sqlite` / `storage-json` | 拥有介质(一个文件树根、一个数据库文件)               |

## 为什么 `domain` 不是租期维度

### 1. domain 是**数据形状**的命名空间,不是归属维度

`defineDomain` / `domainTable` 声明的是 zod schema 与表结构。`context`、`sessions`、
`settings` 各是一个 domain。把 `tenantId` 当 domain 名,等于让每个租户都拥有一套
**独立的 schema 声明** —— 而 schema 是全局一致的,租户之间不该有差别。

### 2. 单名单开,与 per-request 解析冲突

`DomainFacility.open()` 的契约明写:

> reject a name that is already open (`already-open`)

domain 句柄由调用方持有并 `close()`,生命周期挂在 fiber 上。而 principal 是
**每次操作现场解析**的(Session 0 验证 B)。两者的生命周期模型正面冲突:
N 个租户就要长期持有 N 个 domain 句柄,且第二次 open 同名直接拒绝。

### 3. 路由是静态配置,不随请求变化

```ts
interface Config {
  backend: string //  默认后端
  routes?: Record<string, string> //  domain 名 → 后端名
}
```

`routes` 在插件配置里写死。租户是运行时才知道的,配置里写不出来 ——
除非每加一个租户就改配置重启,那不叫多租户。

### 4. 隔离粒度错位

即便硬把 tenantId 塞进 domain 名,隔离也只发生在 domain 这一层;
而 `KvUnit.loadAll()` 返回的是**整个 unit 的全量快照**,跨租户数据仍在同一个
unit 里。真正需要作用域的是**记录键**,不是 domain 名。

## 因此:在记录键这一层做

`KvUnit` 的契约给了一个关键事实:

> `key` — Record key; **any string is safe (keys never reach file paths)**

记录键不参与路径拼接,所以加前缀是安全的 —— 这是 `fs-tenant` 那边**不成立**的
前提(那里的段落会真的变成目录名,所以必须白名单 + 编码)。

但「any string is safe」同时意味着一个威胁:**记录键的内容完全由调用方控制**,
因此**任何分隔符都可能被伪造**。

### 前缀编码:长度前缀,不是分隔符

天真的做法 `${tenant}:${key}` 会被伪造:租户 `acme` 用键 `x` 得到 `acme:x`;
而租户 `a` 用键 `cme:x` 也得到 `a:cme:x` —— 不同,但只要分隔符可以出现在
租户名或键里,构造碰撞只是时间问题。

本包用**长度前缀**:

```
<scope 的字符长度>:<scope><key>
```

例:scope=`acme`,key=`x` → `4:acmex`

解析时先读长度,就精确知道 scope 在哪里结束 —— **与 scope 和 key 的内容完全无关**。
没有任何字符串可以伪造出别人的前缀。这比「选一个不会出现的分隔符」更强:
后者依赖一个跨包的字符集不变式,而不变式会随重构悄悄失效。

### 跨租户读写在本层拒绝

`loadAll()` 返回全量快照,包装层按前缀过滤后**剥掉前缀**再交给上层 ——
上层看到的是一个只有自己数据的普通 KV。跨租户读不是「上层自觉不去读」,
而是**根本拿不到**。

## session 归属

任务书要求一并确认。

- **`session-persistence-jsonl`** 按目录存储(`root: dshHomePath('sessions')`),
  接入 `fs-tenant` 后随工作区自动隔离,**无需额外处理**。
- **`session-query-sqlite`** 在 web profile 的默认配置是
  `{ path: ':memory:', openAt: 'never' }` —— 默认根本不开库。
  一旦启用持久化,它的查询**会跨租户**(它是一个全局索引,不感知 principal)。

  **本版本不接它**:V0.1.0 的 `不做的事` 明确排除了查询层。
  `session-tenant` 包在 `ARCHITECTURE.md §3.1` 里已立项,归属 V0.2.0 之后。
  在那之前,**启用 `session-query-sqlite` 的部署必须视为单租户**,
  这一条已写进 `@dshwar/storage-scoped` 的 README 与本文件。

## 影响

- 新建 `@dshwar/storage-scoped`,包装 `StorageBackend` / `KvFacet` / `KvUnit`
- `SESSION_TASKS.md` 的 R7 待确认项从「默认假设:可以」改为**已否决**
- `session-query-sqlite` 的跨租户风险记入 README 的已知限制

## 补充:作用域在 `open` 时定格,不是每次操作现场解析

实现时撞上一个与直觉相反的结论,记在这里。

`credentials` 那边是**每次操作**重新解析当前 principal —— 因为上游
`dsh-credentials` 的契约明确要求「consumers re-resolve at each operation」。
照搬到存储上会出两个问题:

1. **上游存储句柄按契约就是长命的。** `DomainFacility.open()` 返回的 handle 由
   调用方持有并 `close()`,生命周期挂在 fiber 上,同名 domain 同时只能开一次。
   `KvUnit` 的方法**不接受任何上下文参数** —— 没有任何位置能让「当前是谁」
   在调用时传进来。

2. **闭包不会被重绑。** 硬要每次操作去读,只能让闭包捕获一个 `ctx` 对象。
   而普通闭包**不像** cordis Service 的 `this.ctx` 那样按访问方重绑
   (Session 0 验证 A6 说的是 Service,不是任意闭包)——
   于是在根上下文注册一次的后端会**永远读到匿名**,且不报任何错。

第 2 条是被测试抓出来的:第一版实现在根上下文注册,所有租户的数据都落到
`anonymous` 前缀下,而 lint、typecheck、以及除跨租户断言之外的全部测试都是绿的。

**结论**:`open()` 是作用域边界。在会话作用域内 open,unit 从此绑定该租户。
在根上下文 open 会得到 `anonymous` 作用域 —— 那不是 bug,是 fail closed。
