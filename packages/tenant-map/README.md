# @dshwar/tenant-map

从身份源的字段裁决「这个用户属于哪个租户」。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 为什么需要它

外部系统的用户模型通常是**扁平单租户**的:WordPress 没有租户概念,若依有部门但没有
租户,SCIM 的 `Group` 语义是组不是租户。把它们映射到 DSHWAR 的租户,必须有**显式
规则**,不能靠猜。

## 四种策略

```ts
import { resolveTenant } from '@dshwar/tenant-map'

// claim —— 从 OIDC claim 取
resolveTenant({ claims: { org_id: 'acme' } }, { strategy: 'claim', claim: 'org_id' })

// group —— 从 SCIM Group 名按前缀解析
resolveTenant({ groups: ['tenant:acme'] }, { strategy: 'group', groupPrefix: 'tenant:' })

// issuer —— 一个身份源一个租户（多 CMS 各自独立时最简单）
resolveTenant(
  { issuer: 'https://idp.acme.example' },
  { strategy: 'issuer', issuers: { 'https://idp.acme.example': 'acme' } },
)

// fixed —— 全部归入一个租户（单租户部署）
resolveTenant({}, { strategy: 'fixed', tenantId: 'acme' })
```

## 每一次拒绝都是安全行为

### 映射不出 → 默认拒绝

CLAUDE.md 硬规则 7。一个映射不出租户的用户,**宁可拒绝登录**,也不能落进默认租户 ——
那会让 A 公司的人看到 B 公司的工作区。

改成 `fallback: { kind: 'fixed', tenantId: 'default' }` 需要在 PR 描述里显式说明理由,
并且**必须写出租户名**:空字符串等于「落进无名租户」。

### 歧义 → 拒绝,而不是取第一个

用户命中两个 `tenant:` 组、或 claim 是个多值数组时,**拒绝**。

取第一个意味着组的顺序变了归属就变了 —— 而组的顺序没有任何人在维护。

歧义**不会**落进 fallback:歧义是「材料自相矛盾」,不是「没有材料」。
让两个租户的人都掉进同一个默认租户,比拒绝更糟。

### 非字符串的值 → 不做隐式转换

`org_id: 42` 会被拒绝而不是变成租户 `"42"`。隐式转换会凭空造出租户。

## 启动时就校验配置

```ts
import { validateConfig } from '@dshwar/tenant-map'
validateConfig(config) // 部署时调，不要等第一个用户登录才发现配错
```

`groupPrefix: ''` 会被拒绝 —— 空前缀会把用户的**每个**组都当成租户,
用户加进 `engineering` 组就多出一个租户。

## 许可

MIT
