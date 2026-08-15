# @dshwar/principal

> principal 传播 —— **DSHWAR 引入的唯一新概念**。

其余所有 DSHWAR 包(`auth` / `credentials-multiuser` / `fs-tenant` / `storage-scoped`)
都是上游 DeepSeek Harness 已有契约的替代实现。只有「这次操作是谁发起的」这个问题
在单用户的上游运行时里**不存在**,因而必须由 DSHWAR 定义。

## 安装

```bash
pnpm add @dshwar/principal
```

`@deepseek-ai/cordis` 是 peer dependency,精确锁版。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import { PrincipalService, createPrincipal, runWithPrincipal } from '@dshwar/principal'

const ctx = new Context()
await ctx.plugin(PrincipalService) // 根上下文加载一次

ctx.principal.current() // → ANONYMOUS
ctx.principal.isAnonymous() // → true

const alice = createPrincipal({
  id: 'e6f1a2b3-…', // IdP 的不可变主键，不是邮箱
  tenantId: 'acme',
  roles: ['member'],
})

await runWithPrincipal(ctx, alice, async (sessionCtx) => {
  sessionCtx.principal.current() // → alice
  // 此下所有插件按 alice 解析，消费方零改动
})
```

## 两个派生函数,选哪个

|                                | 形状           | 生命周期         | 用在                      |
| ------------------------------ | -------------- | ---------------- | ------------------------- |
| `withPrincipal(ctx, p)`        | 返回 `Context` | 跟随调用方 fiber | 会话式:一次派生、长期持有 |
| `runWithPrincipal(ctx, p, fn)` | 回调           | 回调结束即释放   | **按请求处理的服务端**    |

**长命进程按请求调用请务必用 `runWithPrincipal`。** 实测(cordis 4.0.1):
`withPrincipal` 每次调用在 `ctx.reflect.store` 留下一个隔离槽位,200 次调用积累
200 个,进程活多久就积累多久;`runWithPrincipal` 跑 200 次槽位数不变。
`test/service.test.ts` 里有一条断言精确盯着这个数字。

## 设计要点

### 服务与绑定分两个槽位

`ctx.principal` 是服务,在根注册**一次**;绑定值放在另一个被隔离的槽位
(`PRINCIPAL_BINDING`)。派生会话作用域只 isolate 绑定槽位,**不重建任何插件**。

之所以成立,靠的是 cordis 的 context 是 Proxy:服务方法里的 `this.ctx` 会重绑到
**访问方**的 context,于是同一个服务实例能按调用者所在的作用域读出不同的绑定。
这一条在 Session 0 已实测确认(`docs/FEASIBILITY-REPORT.md` 验证 A6)。

### `current()` 永不返回 `undefined`

未绑定处返回 `ANONYMOUS`。这不是便利性设计,是安全设计:如果它可能返回
`undefined`,每个下游都要自己判空,而漏判一处等于「把没有主体的操作当成有主体」。
让它永远有值、且那个值是「拒绝」,漏判就变成了 fail closed。

### `id` 不得使用邮箱 —— 运行时硬拦截

`createPrincipal` 会拒绝邮箱形状的 id。理由不是洁癖:id 是租户数据的归属键,
而邮箱会变更、会被回收。改名让数据变成孤儿;地址被回收则让半年后入职的新同事
**继承前任的全部数据**。

请改用 IdP 的不可变主键:OIDC `sub`、SCIM `id`、目录 object id。

### 标识符校验是黑名单,不是白名单

真实 IdP 的主体标识形状五花八门(Auth0 的 `auth0|…`、SAML URN、带连字符的 GUID),
白名单会把合法用户挡在门外。这里只拦路径分隔符、控制字符、`.`/`..` —— 零误伤。

⚠️ **本层不是路径安全的防线。** `fs-tenant`(Session 5)会对参与路径拼接的值做
独立的白名单校验。路径安全从不依赖单层检查。

## 边界

本包**只做传播,不做认证**。「token 换 principal」属于 `@dshwar/auth`。

DSHWAR 是身份消费者,不是提供者:不存密码、不签发身份令牌、不实现注册流程
(CLAUDE.md 硬规则 4)。

## 许可

MIT
