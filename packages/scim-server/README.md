# @dshwar/scim-server

SCIM 2.0 服务端子集。供给方(authentik / Entra / Okta)往这里推用户与组,
落点是 [`@dshwar/subject`](../subject) 的身份镜像。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 停用是这里最重要的链路

**`PUT` 与 `PATCH` 两条路径都能把 `active:false` 落到停用。** 这不是过度设计:

| 供给方          | 停用动作                                                               |
| --------------- | ---------------------------------------------------------------------- |
| Microsoft Entra | `PATCH`,无 path、对象 value、`op` 大写,**active 发成字符串 `"False"`** |
| Okta            | `PATCH` + `path: "active"`                                             |
| authentik       | **`PUT` 整体替换** —— 它的 PATCH 只用于组成员                          |

只做一条,就会「在 A 家能停用、在 B 家停不掉」——而停不掉意味着离职员工仍能调模型。
三种形状各有一条测试,逐字按供给方的实际行为写。

`DELETE` 是删除,**不是**停用信号:Entra 的硬删除延迟 30 天才发。

## `/ServiceProviderConfig` 必须如实

authentik 读它决定用 PATCH 还是 PUT,**并缓存一小时** —— 虚报一次,供给方接下来
一小时都用错方法。所以:

- `patch.supported: true` —— 真的实现了
- `bulk` / `sort` / `etag`:**false** —— 没实现就不声明
- `changePassword: false` —— 永远是 false,DSHWAR 不存密码(硬规则 4)

创建载荷里带 `password` 会得到 400 和一句「请在供给方侧关掉密码同步」——
SCIM 的 User schema 里真的有这个字段,静默丢弃会让部署方以为密码同步成功了。

## filter:未知写法返回 501,不返回全量

只支持 `attr eq "value"`(`userName` / `externalId` / 组的 `displayName`)——
供给方增量同步用的就是这一条。其它写法一律 501。

**静默返回全量是数据泄漏**:供给方以为在查一个人,实际拿到了整个目录。

## 租户映射

- **推荐 SCIM 源用 `issuer` 策略**(一个身份源一个租户,IDENTITY-INTEROP §9 的建议)。
- `strategy: group` 也支持:加进 `tenant:acme` 组决定归属;命中第二个租户组时
  **整个组操作 400**,不静默选一个。注意 authentik 先推 Users 再推 Groups ——
  组未到时用户创建会因映射不出而 400,下个同步周期自愈;不想要这个行为就用 issuer。
- 更新与 PATCH **不因映射问题阻断**:停用必须是最健壮的一条路径。
  重裁失败沿用既有租户并落审计。

## 挂载

```ts
import { createScimApp } from '@dshwar/scim-server'

const scim = createScimApp({
  source: 'authentik', // 一个实例一个身份源
  subjects: subjectStore,
  tenantMap: { strategy: 'issuer', issuers: { authentik: 'acme' } },
  onAudit: (r) => auditSink.record(r),
})
// 网关:app.route('/scim/v2', scim) —— token 鉴权在网关层(Session 6)
```

错误一律是 SCIM 自己的格式(`urn:ietf:params:scim:api:messages:2.0:Error`),
不是 DSHWAR 的 `ErrorResponse` —— 供给方只认前者。

## 许可

MIT
