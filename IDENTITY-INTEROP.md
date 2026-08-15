# DSHWAR 身份互操作设计

> 对外提供通用用户体系接口,与主流 CMS 及开源后台系统建立管理关联。

---

## 1. 先分清两个方向

"与 CMS 建立关联"是两件截然不同的事,混在一起做必然失败:

| 方向     | 谁是权威              | 典型诉求                                                  | 需要的通道      |
| -------- | --------------------- | --------------------------------------------------------- | --------------- |
| **入站** | CMS / IdP 是身份权威  | 用户已在 WordPress、若依、Keycloak 里,DSHWAR 直接认这些人 | 认证 + 供给     |
| **出站** | DSHWAR 是运营数据权威 | 管理员想在既有后台里看用量、调配额、停用户                | 管理 API + 事件 |

真实项目**几乎总是两个方向同时要**:身份从 CMS 来,运营数据回 CMS 后台展示。所以两组通道都要设计,但要分开命名、分开鉴权、分开版本。

---

## 2. 核心决策:做身份消费者,不做身份提供者

**DSHWAR 永不存储密码、永不签发身份令牌、永不做用户注册流程。**

理由不是懒:

- 任何严肃的部署都已经有 IdP 或有用户的 CMS,再来一套是负担而非价值
- 存密码意味着承担安全产品的责任量级,而这不是项目的价值主张
- 一旦你成了 IdP,和 Keycloak、Casdoor、企业 AD 就从"集成"变成"竞争"

但配额、计费、归属、审计需要一条**本地用户记录**。所以引入的不是 User,是:

### Subject Mirror(身份镜像)

外部身份在 DSHWAR 内的最小投影。它只回答四个问题:这个人是谁、属于哪个租户、什么角色、是否启用。

```
subject
├── id              DSHWAR 内部主键
├── externalId      源系统的稳定标识（sub / user_id）
├── issuer          身份来源（oidc issuer / scim endpoint id）
├── tenantId        租户归属  ★ 见 §6
├── roles[]         角色
├── status          active | suspended | deprovisioned
├── displayName     仅用于后台展示
└── attributes{}    源系统同步来的自定义字段
```

**不含的东西同样重要**:密码、密码哈希、邮箱验证状态、会话、MFA 因子、恢复码。这些永远属于源系统。

---

## 3. 五条对外通道

```
        ┌──────────── 入站 ────────────┐   ┌────────── 出站 ──────────┐

  OIDC / OAuth2        SCIM 2.0          Admin REST API      Webhook
  运行时认证            用户供给            管理与查询           事件推送
  （每次请求）          （批量同步）         （后台 CRUD）        （状态变更）

                            ┌──────────────────┐
                            │  只读数据库视图    │  务实通道，见 §5.5
                            └──────────────────┘
```

### 3.1 OIDC / OAuth2 — 运行时认证

已在 `@dshwar/auth-oidc` 中设计。校验 JWT 签名与 JWKS,把 claims 映射为 `Principal`。首次见到的 subject 自动创建镜像(Just-In-Time Provisioning),可配置关闭。

**支持即意味着接入**:Keycloak、Authentik、Logto、Casdoor、Auth0、Okta、Azure AD、飞书、企业微信、钉钉,以及任何装了 OIDC 插件的 WordPress / Drupal。

### 3.2 SCIM 2.0 — 用户供给 ★ 这是"通用接口"的正确答案

RFC 7643 / 7644。**这是身份领域唯一被广泛实现的用户同步标准。**

暴露 SCIM 2.0 服务端后,以下系统可以零定制代码把用户推进 DSHWAR:Okta、Azure AD / Entra、Keycloak、Authentik、Casdoor、OneLogin、JumpCloud、Directus,以及大量企业 IAM。

自己发明一套 `/api/users` 只能换来"每接一个系统写一次适配";实现 SCIM 换来的是"对方后台点几下就通了"。这个差别决定了它是不是"通用接口"。

**建议实现子集**(完整 SCIM 的过滤语法与 PATCH 语义成本极高,不必一次做全):

| 端点                             | 方法                              | 一期            |
| -------------------------------- | --------------------------------- | --------------- |
| `/scim/v2/Users`                 | GET / POST                        | ✅              |
| `/scim/v2/Users/{id}`            | GET / PUT / PATCH / DELETE        | ✅              |
| `/scim/v2/Groups`                | GET / POST / PATCH                | ✅ 映射为 roles |
| `/scim/v2/ServiceProviderConfig` | GET                               | ✅ 声明支持范围 |
| `filter` 参数                    | `eq` 于 `userName` / `externalId` | ✅ 其余返回 501 |
| Bulk 操作                        | —                                 | ❌ 二期         |

在 `ServiceProviderConfig` 里**诚实声明**支持范围,是 SCIM 允许且推荐的做法。

### 3.3 Admin REST API — 后台管理面

给没有 SCIM 能力的系统(以及所有需要看运营数据的场景)。OpenAPI 3.1 描述,与运行时 API 同源不同前缀:

```
/v1/admin/tenants                     租户
/v1/admin/subjects                    用户镜像 CRUD
/v1/admin/subjects/{id}/quota         配额读写
/v1/admin/subjects/{id}/usage         用量明细
/v1/admin/subjects/{id}/credentials   凭据配置状态（describe，永不返回值）
/v1/admin/usage                       聚合用量，支持按租户/时间/模型分组
/v1/admin/policies                    模型准入与预算策略
/v1/admin/audit                       审计查询
```

设计约束:

- **一切资源支持 `externalId` 查询**,让 CMS 用自己的用户 ID 直接寻址,不必存 DSHWAR 的主键
- **列表端点统一分页与排序参数**,让 Refine / AdminJS / Appsmith 这类工具能自动生成表格
- **凭据只暴露 `describe` 语义**——是否配置、来自哪层、是否可写,**永不返回值**。这是上游 `dsh-credentials` 的既有约束,必须原样传递到 Admin API

### 3.4 Webhook — 出站事件

让 CMS 侧能对状态变化做出反应,而不是轮询。

```
subject.provisioned    subject.suspended     subject.deprovisioned
quota.threshold        quota.exceeded        usage.recorded.daily
billing.invoice.ready  policy.denied
```

HMAC-SHA256 签名 + 时间戳防重放 + 至少一次投递 + 指数退避。事件体只带 ID 与最小上下文,详情让对方回查 Admin API——避免把敏感数据推到第三方端点。

### 3.5 只读数据库视图 — 务实通道

中文 ToB 生态里的主力后台框架(若依 RuoYi、JeecgBoot、以及大量基于 Vue-Element-Admin 的自研后台)有一个共同习惯:**从数据表直接生成 CRUD 界面**。

为这类系统提供一组**版本化的只读视图**,成本几乎为零,收益极大:

```sql
dshwar_v1_subject       -- 用户镜像
dshwar_v1_usage_daily   -- 按天聚合用量
dshwar_v1_quota         -- 当前配额与消耗
dshwar_v1_audit         -- 审计轨迹
```

规则:视图名带版本号、视图是**契约**(和 API 同等的兼容承诺)、底层表随便重构、写操作一律走 Admin API 不走表。

这条通道在英文社区不常见,但在你的目标市场里可能是最快落地的一条。

---

## 4. 集成矩阵

| 系统                                  | 身份入站           | 用户供给            | 后台面           | 优先级            |
| ------------------------------------- | ------------------ | ------------------- | ---------------- | ----------------- |
| Keycloak                              | OIDC               | SCIM                | Admin API        | P0                |
| Casdoor                               | OIDC               | SCIM                | Admin API        | P0 中文生态       |
| Authentik / Logto                     | OIDC               | SCIM                | Admin API        | P1                |
| Okta / Entra ID                       | OIDC               | SCIM                | —                | P1 企业采购       |
| 飞书 / 企微 / 钉钉                    | OIDC(或其开放平台) | 自研同步            | —                | P1 中文 ToB       |
| 若依 / JeecgBoot                      | JWT 透传           | Admin API           | **DB 视图**      | P1                |
| WordPress                             | OIDC 插件          | Webhook + Admin API | 插件             | P2 生态大但身份弱 |
| Strapi / Directus / Payload           | 作 OIDC 提供方     | Directus 支持 SCIM  | Admin API        | P2                |
| Django Admin / Laravel Filament       | JWT                | Admin API           | SDK              | P2                |
| Appsmith / ToolJet / Refine / AdminJS | —                  | —                   | **OpenAPI 直连** | P0 见效最快       |

> **P0 里最容易被低估的是最后一行。** Appsmith / Refine 这类工具能直接吃 OpenAPI 生成后台界面。这意味着只要 Admin API 的契约写得规范,"能对接开源后台系统"这个需求在第一天就部分成立了,不需要为每个 CMS 写插件。

---

## 5. 租户映射:必须先解决的坑

外部系统的用户模型通常是**扁平单租户**的。WordPress 没有租户概念,若依有部门没有租户,SCIM 的 `Group` 语义是组不是租户。

必须提供显式映射规则,不能靠猜:

```yaml
tenantMapping:
  strategy: claim | group | issuer | fixed
  # claim:  从 OIDC claim 取，如 org_id
  claim: org_id
  # group:  从 SCIM Group 名按前缀解析，如 tenant:acme
  groupPrefix: 'tenant:'
  # issuer: 一个身份源 = 一个租户（多 CMS 各自独立时最简单）
  # fixed:  全部归入一个租户（单租户部署）
  fallback: reject # reject | fixed:default
```

**默认 `fallback: reject`。** 一个映射不出租户的用户,宁可拒绝登录,也不能落进默认租户——那会让 A 公司的人看到 B 公司的工作区。这条是安全默认值,不是配置偏好。

---

## 6. 安全模型

三类调用者,三种凭据,三套权限:

| 调用者          | 凭据                  | 可达                        | 说明                                |
| --------------- | --------------------- | --------------------------- | ----------------------------------- |
| 终端用户 / 应用 | 用户 Bearer(OIDC)     | `/v1/sessions` 等运行时 API | 只能操作自己的资源                  |
| 管理后台 / CMS  | 服务账号 API Key      | `/v1/admin/*`               | 按租户限定作用域                    |
| IdP 供给        | SCIM Bearer(独立签发) | `/scim/v2/*`                | **只能写身份镜像,不能读用量与凭据** |

关键约束:

- SCIM 令牌与 Admin 令牌**分离**。供给系统被攻破,不应等于运营数据泄漏。
- Admin API Key **按租户签发**,多租户部署里一把钥匙不能横跨租户。
- 所有 Admin 与 SCIM 调用进入 `@dshwar/audit`,记录调用者、目标、变更前后。**管理面的审计比运行时更重要**——这是合规检查最先看的地方。
- 凭据端点永远只返回 `describe` 三元组(configured / source / writable),不返回值。

---

## 7. 包与部署位置

| 组件                          | 归属平面   | 包                          |
| ----------------------------- | ---------- | --------------------------- |
| Subject Mirror 数据模型与服务 | 控制平面   | `@dshwar/subject`           |
| SCIM 2.0 服务端               | 控制平面   | `@dshwar/scim-server`       |
| Admin REST API                | API 平面   | `gateway/admin`             |
| Webhook 投递                  | 控制平面   | `@dshwar/webhooks`          |
| 只读视图与迁移                | 控制平面   | `dshwar-console/db`         |
| OIDC 认证                     | 运行时平面 | `@dshwar/auth-oidc`(已规划) |

> **注意分布**:身份互操作的绝大部分落在**控制平面**,不在运行时。这进一步印证了控制平面独立仓库、独立部署的决定——它有自己的数据库、自己的对外端口、自己的鉴权体系,和 dsh 运行时的生命周期无关。

---

## 8. 对路线图的影响

原路线里 SCIM 与 Admin API 隐含在 M4(控制平面)。按新要求,需要提前拆分:

| 阶段                           | 原内容              | 调整                                                                               |
| ------------------------------ | ------------------- | ---------------------------------------------------------------------------------- |
| **M2 API 平面**                | 运行时 API + SDK    | **+ Admin API 的 subjects / usage 两组端点**,让 Appsmith / Refine 类工具第一天可用 |
| **M2.5 身份互操作**(新增,2 周) | —                   | Subject Mirror + SCIM 2.0 子集 + 租户映射 + Webhook 骨架                           |
| **M4 控制平面**                | 租户/成员/订阅/后台 | 保持,但用户管理部分已由 M2.5 打底                                                  |

净增约 2 周,换来"能接 CMS"这个能力提前三个月可用。

**新增验收标准**:用 Keycloak 作为身份源,通过 SCIM 把两个用户推进 DSHWAR,其中一个在 Keycloak 侧停用后,该用户下一次请求被拒绝——全程不写一行定制代码。

---

## 9. 立即需要的决定

1. **确认不做 IdP** — 影响是否要建密码与注册体系,工作量差一个数量级
2. **SCIM 子集范围** — 一期是否包含 Group 与 PATCH,建议包含
3. **只读视图是否作为一等契约** — 决定是否面向中文后台生态做重点适配
4. **租户映射的默认策略** — 建议 `issuer`(一个身份源一个租户),最不容易配错
5. **Admin API 与运行时 API 是否同进程** — 建议同进程不同前缀,一期简单;流量分层后再拆
