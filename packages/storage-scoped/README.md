# @dshwar/storage-scoped

> 租户维度的存储作用域:记录键加长度前缀,跨租户读写在本层拒绝。

上游 `storage-domain` 的 `domain` **不能**承载 `tenantId` —— 它是 schema 的命名空间,
单名单开、静态路由。完整评估见
[`docs/DECISIONS/storage-scoping.md`](../../docs/DECISIONS/storage-scoping.md)。

## 用法

⚠️ **必须在会话作用域内 `open()`**:

```ts
await runWithPrincipal(ctx, principal, async (sessionCtx) => {
  const backend = scopedBackend(sessionCtx, innerBackend)
  const unit = await backend.kv.open(descriptor) // ← 作用域在这一刻定格
  await unit.putRecord('records', 'k', v) // 此后该 unit 永远属于这个租户
})
```

在根上下文 open 会得到 `anonymous` 作用域 —— 那不是 bug,是 fail closed。

## 为什么是长度前缀,不是分隔符

上游 `KvUnit` 的契约明写:记录键 **"any string is safe (keys never reach file paths)"**。
键的内容**完全由调用方控制**,所以任何分隔符都可能出现在键里。

天真的 `${scope}:${key}` 会被伪造。本包用:

```
<scope 的字符长度>:<scope><key>      例:acme + "x" → "4:acmex"
```

先读长度就精确知道 scope 在哪结束 —— **与 scope 和 key 的内容完全无关**。
`encodeKey('acme', 'x')` 与 `encodeKey('a', 'cmex')` 不碰撞,
键里塞 `4:evil` 也伪造不出别人的前缀。

这比「选一个不会出现的分隔符」更强:后者依赖跨包的字符集不变式,
而不变式会随重构悄悄失效,失效时没有任何报错。

## 为什么作用域在 `open` 时定格

`credentials` 是每次操作重新解析,因为上游契约明确要求。**存储不是这个模型** ——
上游句柄按契约就是长命的,`KvUnit` 的方法不接受任何上下文参数。

硬要每次操作去读,只能让闭包捕获 `ctx`;而普通闭包**不像** cordis Service 的
`this.ctx` 那样按访问方重绑,于是在根上下文注册一次的后端会永远读到匿名,
且不报任何错。这是被测试抓出来的 —— 第一版实现所有租户的数据都落到
`anonymous` 前缀下,而除跨租户断言外的全部检查都是绿的。

## 已知限制

**`loadAll()` 仍会把整个 unit 读进内存。** 这是上游契约的形状(它就是全量快照),
本包改不了。意味着**一个租户的数据量会影响所有租户的内存占用**。
跨信任边界的部署应当一租户一后端(`storage` hub 支持多后端并存),而不是靠本包。

**全局单例槽位无法作用域化。** `KvUnit` 的 global 是 unit 级的单个槽位,
没有键可以加前缀。`setGlobal()` 直接抛错 —— 需要 per-tenant 单例值,
请用一张只含固定键的表。

**⚠️ 启用 `session-query-sqlite` 的部署必须视为单租户。** 它是一个全局索引,
不感知 principal,查询会跨租户。`session-tenant` 包归属 V0.2.0 之后。
`session-persistence-jsonl` 不受影响 —— 它按目录存储,接入 `fs-tenant` 后自动隔离。

## 许可

MIT

## 为什么没有工作区维度(V0.4.1 决策)

V0.4.1 把 `fs-tenant` 的路径改成了四段(加了 `workspaceId`)。**本包没有跟着加。**

三条理由:

1. **我们不知道哪些数据属于工作区。** unit 名与记录键全部来自上游插件,对我们
   不透明。用户偏好是用户级的,项目索引是工作区级的 —— 一刀切会把前者也切开,
   表现为「新建工作区后设置全没了」。
2. **真正要防的风险已经防住了。** 本包存在的理由是跨租户泄漏。同一用户的两个
   工作区之间**不是信任边界**,`fs-tenant` 给它们做隔离是为了组织(按项目分区),
   不是为了安全。
3. **作用域在 `open()` 时定格**,而 `open()` 往往发生在插件启动阶段,那时还没有
   请求作用域 —— 时机根本对不上。

将来出现明确属于工作区且必须隔离的存储需求时,正确做法是**per-unit 的 opt-in**,
而不是一刀切前缀:出错时影响一个 unit,而不是全部数据。

完整推理见 [`docs/DECISIONS/storage-workspace-scoping.md`](../../docs/DECISIONS/storage-workspace-scoping.md)。
