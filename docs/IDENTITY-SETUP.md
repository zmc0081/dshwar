# 接入身份源(IdP)

面向要把自家 IdP 接到 DSHWAR 的部署方。两条通道,各自独立、通常都要接:

| 通道           | 方向          | 作用                                    |
| -------------- | ------------- | --------------------------------------- |
| **SCIM**       | IdP → DSHWAR  | 用户与组同步进来,**停用在这条路上生效** |
| **OIDC / JWT** | 用户 → DSHWAR | 每次请求的认证                          |

两条都接上之后的效果就是 V0.3.0 的验收标准:**在 IdP 侧停用某用户,
该用户的下一次请求被拒绝 —— 即使他手里的 token 还没过期。**

---

## 1. 原理:为什么停用能立即生效

JWT 是无状态的:IdP 停用用户**不会**让已签发的 token 失效。DSHWAR 的
`auth-jwt` 因此在验签之外多走两步:

```
① 验签与标准声明（iss / aud / exp / nbf）
② 查 Subject Mirror：不存在或 active:false → 拒绝   ← SCIM 写进来的就是这里
③ 租户由 tenant-map 裁决，不信 token 自称
```

SCIM 把 `active:false` 推进镜像,auth 层在下一次请求读到它。两条通道缺一条,
这个保证就不成立 —— 只接 OIDC 不接 SCIM 的部署,停用要等 token 自然过期。

---

## 2. authentik(推荐的自托管选择)

### SCIM

1. **Applications → Providers → Create → SCIM Provider**
2. URL 填 `https://<你的网关>/scim/v2`,Token 填你在网关配置里 `scim.token` 的值
3. 把 Provider 绑到你的 Application,选好要同步的用户组
4. authentik 会先读 `/ServiceProviderConfig` 探测能力(结果缓存一小时),
   然后推送全量;之后生命周期事件即时推送 + 每小时全量对账

⚠️ authentik 更新用户用 **PUT**(整体替换),PATCH 只用于组成员 ——
DSHWAR 两条都支持,无需配置。

### OIDC

1. **Applications → Providers → Create → OAuth2/OpenID Provider**
2. 网关侧用 `@dshwar/auth-oidc`,只需要 issuer URL:

```ts
const auth = await createOidcAuth(ctx, {
  issuer: 'https://authentik.example/application/o/dshwar/',
  audience: '<client_id>',
  source: 'authentik', // 必须与 SCIM 挂载的 source 一致
  subjects: subjectStore, // 必须与 SCIM 写入的是同一个 store
  tenantMap: { strategy: 'issuer', issuers: { '…': 'acme' } },
})
```

⚠️ **`source` 与 `subjects` 必须与 SCIM 侧一致** —— auth 按
`(source, sub)` 查镜像,对不上就是「签名有效但镜像里没有 → 拒绝」。

---

## 3. Microsoft Entra(Azure AD)

### SCIM 的两个著名陷阱

1. **必须映射 `active` 字段。** Entra 的属性映射里若没有 `active`,
   停用用户时它**静默不发任何请求** —— 表现为「在 Entra 里禁用了,
   DSHWAR 毫无反应」。在 Provisioning → Mappings 里确认 `active` 在列。
2. **删除 ≠ 立即 DELETE。** Entra 删除用户先进 30 天软删除,期满才发 DELETE。
   所以**停用请用「禁用账号」或「移出应用」**(它们发 `active:false`),
   不要指望删除立即生效。

Entra 发的 PATCH 有几个怪癖(op 大写、无 path、`active` 是字符串 `"False"`),
DSHWAR 已按实测行为兼容,无需配置。

### OIDC

Entra 的 issuer 是 `https://login.microsoftonline.com/<tenant-id>/v2.0`,
`audience` 是应用的 client id。租户映射推荐 `claim` 策略取 `tid`,
或 `issuer` 策略(一个 Entra 租户 = 一个 DSHWAR 租户)。

---

## 4. 租户映射怎么选

| 场景                                  | 策略                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| 一个 IdP 一个客户(最常见)             | `issuer` —— **最不容易配错,SCIM 源推荐它**                                               |
| 一个 IdP 服务多客户,claim 里有组织 id | `claim`                                                                                  |
| 用组表达租户(`tenant:acme`)           | `group` —— 注意 authentik 先推 Users 再推 Groups,组未到时用户创建会 400,下个同步周期自愈 |
| 单租户部署                            | `fixed`                                                                                  |

**映射不出 = 拒绝登录**(CLAUDE.md 硬规则 7)。这是默认值,改它之前想清楚:
落进默认租户意味着 A 公司的人能看到 B 公司的工作区。

---

## 5. Webhook(可选)

下游系统想知道「有人被停用了」:

```ts
const dispatcher = new WebhookDispatcher(
  [{ url: 'https://your-system.example/hooks', secret: '双方共享的密钥' }],
  { onFailure: (f) => audit.record(...) },
)
// 挂到 SCIM 应用的 onSubjectChange 上
```

验证签名(任何语言,不需要 DSHWAR 的库):

```
expected = "sha256=" + hex(HMAC_SHA256(secret, timestamp_header + "." + raw_body))
比较 expected 与 X-Dshwar-Signature;拒绝时间戳超出 ±300 秒的请求
```

⚠️ **不做投递保证。** 重试三次仍失败只落审计。错过 webhook 的系统请定期拉
`GET /v1/admin/subjects` 兜底 —— 按最终一致设计,不要假设每条事件都到了。

---

## 6. 三类令牌,三把钥匙

| 令牌         | 配在哪                        | 只能做什么      |
| ------------ | ----------------------------- | --------------- |
| 运行时 token | 终端用户手里(IdP 签发)        | `/v1/sessions*` |
| Admin Key    | 运维手里,按租户               | `/v1/admin/*`   |
| SCIM token   | **IdP 的供给配置里**,按身份源 | `/scim/v2/*`    |

SCIM token 配在外部系统里,暴露面最大 —— 它泄漏的爆炸半径被圈定为
「一个身份源的镜像被改」,拿它打 `/v1/` 的任何端点都是 401。
