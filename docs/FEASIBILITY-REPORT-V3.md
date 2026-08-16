# V0.3.0 Session 0 · SCIM 供给链可行性报告

> 日期:2026-08-16 · 对应 `SESSION_TASKS.md` M0.3.0 Session 0(止损点)
> 结论:**止损未触发,但验收标准必须改**,且任务书里一条关于 PATCH 的假设是错的。

---

## 0. 一句话结论

`IDENTITY-INTEROP.md` §8 写的验收标准 ——「用 **Keycloak** 作为身份源,通过 SCIM 把两个
用户推进 DSHWAR……全程不写一行定制代码」—— **按原文无法达成**:Keycloak 没有 SCIM
出站客户端。改用 **authentik** 后可达成。

同时发现:**「PATCH 是停用的主要动作」这句话只对一半供给方成立。** 任务书原写
「缺 PATCH 则验收走不通」,实际是**缺 PUT 一样走不通** —— 两者都得做。

---

## 1. 本次验证的方法与边界

⚠️ **本报告是文档级与协议级的确认,不是容器实测。** 与 V0.1.0 / V0.2.0 的 Session 0
不同:那两次验证的是**上游代码的实际行为**,只能靠跑;这次验证的是**第三方供给方的
协议行为**,权威来源是各家官方文档与协议 RFC。

因此本报告的断言分两类,逐条标注:

| 标记 | 含义                                     |
| ---- | ---------------------------------------- |
| 📄   | 官方文档 / RFC 明确写出                  |
| ⚠️   | 文档未写明,需在 Session 7 端到端验收实测 |

**凡标 ⚠️ 的,不得当成已验证的事实写进产品文档。**

---

## 2. 验证 A —— Keycloak 能不能推?

### 结论:**不能。** 📄

Keycloak **不提供任何 SCIM 出站供给(outbound provisioning)的内置支持**。

容易误判的一点:Keycloak 26.6 确实有了 SCIM,但**方向是反的**。
`--features=scim-api`(realm 上 `scimApiEnabled=true`)开出来的是
`/realms/{realm}/scim/v2` —— 这让 **Keycloak 成为 SCIM 服务提供方**,
即别人往 Keycloak 里推用户。官方原话是「你可以用任何 SCIM 客户端来管理你 realm 里的
用户与组资源」。

DSHWAR 需要的恰好相反:**DSHWAR 是服务提供方,供给方要往 DSHWAR 推**。

社区扩展(`suvera/keycloak-scim2-storage`、`Termindiego25/keycloak-scim-outbound`、
商业的 scim-for-keycloak)能补上出站能力,但那违反验收标准里「不写一行定制代码」的
精神 —— 装一个第三方扩展是部署方的额外负担,且成熟度与 Keycloak 主线版本的兼容性
都要我们背书。

### 影响

`IDENTITY-INTEROP.md` §8 的验收标准点名 Keycloak,**该句必须改**。
本报告 §6 给出替代方案。

---

## 3. 验证 B —— 换谁?

### 结论:**authentik。** 📄

选型对比:

| 供给方          | 出站 SCIM | 自托管     | 许可     | 适合做本项目的验收基线 |
| --------------- | --------- | ---------- | -------- | ---------------------- |
| **authentik**   | ✅ 原生   | ✅         | MIT      | **✅ 选它**            |
| Okta            | ✅        | ❌ 仅 SaaS | 商业     | CI 里跑不了,要账号     |
| Microsoft Entra | ✅        | ❌ 仅 SaaS | 商业     | 同上                   |
| Keycloak        | ❌        | ✅         | Apache-2 | 出站能力要装第三方扩展 |

选 authentik 的三条理由:

1. **出站 SCIM 是原生能力**,不是扩展。Applications → Providers → SCIM Provider,
   填目标 URL 与 bearer token 即可。
2. **MIT 许可、可自托管、可容器化** —— 与本仓已有的 `pnpm test:linux`(Docker 复跑)
   路数一致,端到端验收能进 CI,而不是变成「在某人机器上跑过一次」。
3. 生命周期事件即时推送 + **每小时全量同步**一次,两条路径都能覆盖到我们的实现。

⚠️ 待实测(Session 7):authentik 把用户从应用解绑时,发的到底是
`PUT active:false`、`PATCH active:false` 还是 `DELETE` —— **官方文档没写明**。
这一条直接决定 R10 验收怎么写,必须实测,不能推断。

---

## 4. 验证 C —— PATCH 的停用语义 ★ 推翻了任务书的假设

### 结论:**各家不一致,PUT 与 PATCH 都必须支持。** 📄

| 供给方              | 用户属性更新(含停用) | 组成员增删 | 硬删除                        |
| ------------------- | -------------------- | ---------- | ----------------------------- |
| **Microsoft Entra** | `PATCH active:false` | PATCH      | `DELETE`,但**延迟 30 天**才发 |
| **Okta**            | `PATCH active:false` | PATCH      | DELETE                        |
| **authentik**       | **`PUT`(整体替换)**  | PATCH      | ⚠️ 未写明                     |

authentik 官方原话:「若服务提供方支持 PATCH,authentik 用 PATCH 请求增删组成员。
**其它所有更新 —— 例如用户更新与其它组更新 —— 使用 PUT 请求。**」

### 这推翻了什么

`SESSION_TASKS.md` M0.3.0 的「开工前已确认的决定」第 2 条写着:

> 缺 PATCH,本版本的验收标准「停用后下次请求被拒」直接走不通。

**这句话只对 Entra / Okta 成立。** 对 authentik —— 也就是我们刚选定的验收基线 ——
走不通的是**缺 PUT**。

正确的结论是:**`User` 资源的 `PUT` 与 `PATCH` 都必须实现,且两条路径都要能把
`active:false` 落到 Subject Mirror 的停用。** 只做一条,就会出现「在 A 家能停用、
在 B 家停不掉」——而停不掉意味着离职员工仍能调用模型。

Session 5 的任务书据此更新(见 §6)。

### 另一个部署期陷阱 📄

**Entra 不会自动发 `active:false`** —— 除非部署方在属性映射里显式映射了 `active`
字段。没映射就静默不发,表现为「在 Entra 里禁用了,DSHWAR 这边毫无反应」。
这条要写进 `docs/IDENTITY-SETUP.md`,否则每个接 Entra 的客户都会踩一次。

Entra 的另一个反直觉行为:在 Entra 里**删除**用户不会立刻触发下游 DELETE,
账号先进 30 天软删除态,期满才发。所以**不能把 DELETE 当作停用的可靠信号**,
停用判定必须以 `active:false` 为准。

---

## 5. 验证 D —— `/ServiceProviderConfig` 是承重的,不是装饰

### 结论:📄 authentik 读它,而且**缓存一小时**。

authentik 通过 `/ServiceProviderConfig` 探测目标是否支持 PATCH,并缓存 1 小时。

两条直接后果:

1. **不能虚报能力。** 我们在 `/ServiceProviderConfig` 里写 `patch.supported: true`,
   就必须真的实现 PATCH —— 供给方会照着它选请求方法。
2. **报错了要等一小时。** 缓存意味着一次错误的响应会让供给方在接下来一小时里
   持续用错方法。这条决定了 `/ServiceProviderConfig` 必须在 Session 5 一开始就
   正确落地,不能留到最后补。

---

## 6. 对任务书的修改

Session 0 的任务书写明:「若验收标准无法按原文达成,在报告里给出替代方案并更新任务书。」
以下修改已同步进 `SESSION_TASKS.md`:

### 6.1 验收标准(R10 / Session 7)

原文(`IDENTITY-INTEROP.md` §8):

> 用 Keycloak 作为身份源,通过 SCIM 把两个用户推进 DSHWAR,其中一个在 Keycloak 侧
> 停用后,该用户下一次请求被拒绝——全程不写一行定制代码。

改为:

> 用 **authentik** 作为身份源,通过 SCIM 把两个用户推进 DSHWAR,其中一个在 authentik
> 侧停用后,该用户下一次请求被拒绝——全程不写一行定制代码,且 authentik 以**容器**
> 起在 CI 里,不依赖任何 SaaS 账号。

`IDENTITY-INTEROP.md` §8 同步加一条勘误,不删原文 —— 删掉会让读过旧版的人以为
自己记错了。

### 6.2 Session 5 的 SCIM 范围

原写「User + Group + PATCH」,PATCH 被当成停用的主路径。改为:

- `User`:`POST` / `GET` / **`PUT`** / **`PATCH`** / `DELETE`,
  **PUT 与 PATCH 两条路径都必须能落停用**
- `Group`:同上,成员增删以 PATCH 为主
- `/ServiceProviderConfig`:第一优先级,且**如实**声明能力
- `DELETE` **不得**被当作停用信号(Entra 延迟 30 天才发)

### 6.3 Session 0 未能实测的部分

authentik 解绑用户时的确切请求形状标 ⚠️,留给 Session 7 端到端验收实测。
在那之前,Session 5 按「PUT 与 PATCH 都支持 `active:false`」实现 —— 这个实现
对两种可能的行为都成立,不赌。

---

## 7. 止损判据的裁决

任务书写的止损条件:

> 若没有任何供给方能零定制代码推送用户,本版本改为「只做 Subject 契约 + Admin 端点」,
> SCIM 推迟。

**未触发。** authentik 原生支持出站 SCIM,自托管、MIT、可容器化。V0.3.0 按原计划进行。

---

## 8. 断言汇总

| #   | 断言                                                  | 结果       | 依据 |
| --- | ----------------------------------------------------- | ---------- | ---- |
| A1  | Keycloak 内置出站 SCIM 客户端                         | **否**     | 📄   |
| A2  | Keycloak 26.6 的 `scim-api` 是入站(Keycloak 作服务方) | 是         | 📄   |
| A3  | authentik 原生支持出站 SCIM 供给                      | 是         | 📄   |
| A4  | authentik 可自托管、MIT、可容器化                     | 是         | 📄   |
| B1  | Entra 停用发 `PATCH active:false`                     | 是         | 📄   |
| B2  | Okta 停用发 `PATCH active:false`                      | 是         | 📄   |
| B3  | authentik 用户更新发 **PUT**,PATCH 只用于组成员       | 是         | 📄   |
| B4  | 仅实现 PATCH 即可满足全部供给方                       | **否**     | 📄   |
| B5  | Entra 未映射 `active` 时不发停用                      | 是         | 📄   |
| B6  | Entra 硬删除延迟 30 天才发 DELETE                     | 是         | 📄   |
| C1  | authentik 读 `/ServiceProviderConfig` 探测 PATCH 支持 | 是         | 📄   |
| C2  | 该探测结果缓存 1 小时                                 | 是         | 📄   |
| D1  | authentik 解绑用户时发的确切请求形状                  | **未确定** | ⚠️   |
| D2  | 多 Group 命中时的租户裁决(需实测样本)                 | **未确定** | ⚠️   |
| E1  | JWKS `kid` 轮换的实际行为                             | **未确定** | ⚠️   |

📄 = 官方文档 / RFC · ⚠️ = 留给 Session 7 实测

D2 与 E1 不阻塞 Session 1-4:租户映射的多值裁决按「歧义即拒绝」实现(比取第一个安全,
且与硬规则 7 的 fail closed 一致),JWKS 轮换按 RFC 7517 的 `kid` 语义实现并在
Session 3 用自建 JWKS 做契约测试。

---

## 参考

- [Keycloak · SCIM Realm API as an Experimental Feature](https://www.keycloak.org/2026/04/scim-as-experimental-feature)
- [Keycloak · Thanks for your feedback on SCIM support](https://www.keycloak.org/2026/02/scim-support-survey-feedback)
- [authentik · SCIM Provider](https://docs.goauthentik.io/add-secure-apps/providers/scim/)
- [SSOJet · SCIM Deprovisioning: The Part Every SaaS Gets Wrong](https://ssojet.com/blog/scim-deprovisioning-saas-guide)
- [Microsoft Learn · How SCIM provisioning works](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/how-provisioning-works)
- [RFC 7644 §3.5.2 · SCIM PATCH](https://datatracker.ietf.org/doc/html/rfc7644#section-3.5.2)
