# CHANGELOG

> ⚠️ **本仓至今未发布到 npm。** 首发被 npm 组织占名与 GitHub 仓库创建阻塞
> (见 [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md))。
> 因此**首个公开版本将是 0.4.5**,内容包含下面全部六节。
>
> 相应地,各版本的变更集在版本号提升时**并入本文件并删除** ——
> 否则 `changeset version` 会把 0.4.1 再推成 0.5.0,而 CLAUDE.md 第四节承诺
> 「开发版本号 = 最终发布版本号,发布时无需再改」。
> changesets 记录的是**发布之间的增量**,而首发之前不存在「之间」。
>
> 发布之后恢复正常流程:每个改动写 changeset,`changeset version` 生成条目。

---

## 0.6.5 —— 本地模型 + 离线能力(开发完成,未发布)

> 开源版最有说服力的差异化:「完全本地运行、数据不出内网、可自建用户体系的
> AI 工作台」—— 涉密、内网、金融、医疗客户只有这一个选择。

### 新增

- **`@dshwar/llm-local`** —— 本地模型 provider(Ollama / llama.cpp 的
  OpenAI 兼容端点)。**复用上游 `DeepSeekAdapter`(公开导出),一行模型
  调用代码都不写** —— 治理层三件事:provider 注册(独立显示名,不借上游
  牌子)、keyless 凭据策略(本地端点没有凭据可保护;baseUrl 只收
  loopback/私网,公网拒启动防共享匿名访问)、模型清单声明(不探测 ——
  配置错误炸给部署的人)。决策记录:
  `docs/DECISIONS/llm-local-reuses-upstream-adapter.md`。
- **离线判定与自动降级**(`OfflineFallback` + 网关裁决链)—— 三态:
  云端可达原样;不可达且本地活着 → 换本地模型(**可见**:响应头 +
  审计 `model.offline-downgraded`,降级目标再过一次准入);两边都不可达 →
  **503** 与可行动的信息。可达性判据在连接层(云端 500 也算可达 ——
  降级会掩盖真实故障);探测结果按 TTL 缓存,网络恢复自动回在线。
- **本地用量统计**(`summarizeLocalUsage`)—— **统计,不是计费**:
  本地算力花的是部署方自己的电,不存在计量对象,所以没有离线额度、
  预授权、签名账本。同一条 metering 管道、`billedInputTokens` 口径,
  与云端可比;账单上本地行金额恒 0 但 token 完整可见(不计费 ≠ 隐身)。

### 变更

- README 增〈本地模型与离线能力〉与真离线硬边界表(会话/文件 ✅ ·
  本地工具 ✅ · Agent 推理 ❌ 除非本地模型 · 云端 token ❌)。
- `docs/GOVERNANCE.md`:「本地 provider 不要配价」是价格表配全规则的
  唯一例外 —— 配上价反而把不存在的钱写进客户账单。
- 网关 `ModelGateLike` 增 `unavailable` 态(503,与 403 分开:一个找
  管理员改策略,一个等网络或装 Ollama);`governance.offline` 整段可选。

---

## 0.6.0 —— 支付(开发完成,未发布)

> 🔴 **开源边界在本版本改动(D4)**:Stripe 适配器**开源**,闭源收窄到
> 托管服务本体。开源许可不可撤回 —— 回滚窗口只到首次发布前。

### 新增

- **principal 绑定改造**(A4,非支付)—— 装配点无条件 provide,
  `current()` 对未绑定抛 `PrincipalUnboundError`:「装配没跑」从静默配置
  错误变成启动即知。⚠️ 它**不防**漏挂中间件(那种情形回落根绑定,不抛),
  那条防线仍是 auth-coverage + 探针 10 —— 这条否定性事实写成了测试
  (`middleware-absence.test.ts`),防重构时被无声改掉。
- **`@dshwar/billing`(契约)** —— 计量 → 计费 → 出账。发票状态机
  draft→issued→paid(paid 终态,退钱走退款流程不抹账);钱一律最小货币
  单位整数,`assertMinorUnits` 抛而不 round;`PaymentGateway` 接缝与
  `assertPayable` 唯一判据(draft/paid/void/0 元一律拒)。
- **`@dshwar/billing-local`** —— 只记账不收款。出账幂等(同周期非 void
  直接返回);每行整期累加后只 round 一次(实测与逐条舍入差 25 分/百条);
  计费口径 `billedInputTokens` 含缓存读写(裸 inputTokens 少计 10 倍)。
- **`@dshwar/billing-stripe`(开源,D4)** —— 裸 fetch 零第三方依赖,
  幂等键 = 发票 id;webhook 三防线:HMAC 验签(v1 多值支持轮换)、
  时间戳容差 300s、事件 id + 账本双层幂等,顺序「先记账后记 id」。
  D5 三层测试:fetch spy / stripe-mock(CI service container)/ live smoke。
- **契约与网关** —— `POST /v1/billing/webhooks/stripe`(path.added 相容);
  `AuthScheme` 加 `signature`;验签失败统一 401 无原因;**未配置支付的
  部署同一路径也是 401 而非 404**(配没配从外面看不出来)。

### 变更

- 开源/闭源边界文档(CLAUDE.md §8 / README)同步 D4 口径;
  Stripe live smoke(`STRIPE_TEST_KEY`,只认 `sk_test_`)进发布清单。
- 探针 8 变异方式随 A4 改造调整:从「拿掉 provide」(现在会因抛错变红,
  红的是新机制)改为「provide 错值」—— 照的仍是 principal 静默没抵达执行层。

---

## 0.5.5 —— 工作台后端(开发完成,未发布)

> 工作台不是「画个界面」。本版本补齐后端地基,让 V0.7.0 只剩画界面与套壳。

### 新增

- **工作台契约**(`workbench.ts`)—— 工作区 / 产物 / 作业 / 附件 / 策略,
  **一次定完**。四类之间有引用关系,分四次定会让前三次不得不猜第四次的形状。
  契约冻结:**破坏性 0 处,相容 25 处**(全部 `path.added` / `schema.added`)。
- **工作区 CRUD 与产物浏览** —— 产物**即工作区文件**,不建产物表。
  判据是「谁是唯一事实」:agent 随时在写文件,表与文件必然漂。
- **策略预授权**(不做运行时审批弹窗)—— 判定与审计**绑在一个入口**,
  没有「只判不记」的路。默认最紧:空数组 = 全部禁止,`allowShell` 默认 `false`。
- **作业队列** —— 状态外置,支持跨重启恢复。`interrupted` 与 `failed` 分开:
  前者是承载进程没了(直接重试),后者是它自己错了(查输入)。
- **`@dshwar/attachment-tenant`** —— 附件的租户隔离存储,复用 `fs-tenant` 的
  编码规则。会话回收**不得误删**租户级附件。
- **认证覆盖断言** —— 遍历契约,每个 `/v1` 端点无凭证时必须 401。

### 修复

- 🚨 **`/v1/workspaces/*` 的认证中间件漏挂** —— 未认证请求曾拿到 200。
  认证中间件按路径前缀单独注册,新增路由不会自动覆盖。修法是加遍历契约的
  断言,而不只是补那两行。

### 纪律

- CLAUDE.md 新增:**凡遍历集合做断言处,必须断言「真的断言过至少一次」**。
  判据在**出口**不在入口 —— 嵌套 `continue` 过滤时,「集合非空」拦不住空跑。

---

## 0.5.0 —— 控制平面 / 企业自服务配置台(开发完成,未发布)

### 新增

- **`@dshwar/console-contract`** —— 控制平面契约。租户 / 成员 / 角色 / 配额 /
  用量 / 审计查询的**线上类型**。与 `/v1` 运行时契约分开版本化:
  前者承诺给管理端,后者承诺给最终用户,混在一起会让「改一个管理端字段」
  变成「破坏运行时契约」。
- **`GET /v1/admin/capacity`** —— 部署容量端点。契约变更为 `path.added`(相容)。
  返回值与 `deriveMaxProcesses()` **同一个来源**,不另算一遍。
- **开户闸门** —— 隔离档的约束表达在「建第二个成员」那一步(不是登录时)。
  装饰 `SubjectStore` 而不是加在端点上,所有创建路径穿过同一个点。
- **`console-web/`** —— 最小但真实的控制台前端,首页常驻显示容量信息。
- **前端三条约束的守卫**(为 V0.7.0 Tauri 套壳预留):hash / memory 路由、
  不依赖浏览器专有 API、请求走统一 SDK 层。五条负向验证,含**空集守卫**。
- `DshwarAdminClient.capacity()`。

### 决策

- **工作区语义定案**:每用户多工作区,工作区是项目容器,**不跨用户共享**。
  据此**关闭**「一租户一进程」方案 —— 它把 `userId` 变成常量哨兵,
  与该语义在工作区归属、计量归属、配额粒度、路径含义四个维度上全部相反。
- 开源/闭源边界的调整见 0.6.0 节。

### 修复

- `guardMemberCapacity` 曾用 `{ ...inner }` 转发 —— 对**类实例**展开不复制
  原型方法,而 TypeScript 认为复制了。改为显式转发,类型检查随即报出漏掉的方法。

---

## 0.4.7 —— principal 抵达 agent 执行层(开发完成,未发布)

> **这一版解除了此前唯一的发布阻塞项。**

### 修复

- **进程隔离档的 principal 现在能抵达 agent 执行层。** 装配时把本进程唯一的
  主体钉在根上(`ctx.provide(PRINCIPAL_BINDING, …)`),agent 的 ctx 由此继承。
  此前所有 agent 都读到 `ANONYMOUS`,文件落进 `anonymous/anonymous/`。

### 变更

- **逻辑隔离档只支持单个 principal。** 这是**架构限制而非待办** ——
  四条修法全部走不通(根上 provide 对所有 agent 生效 / 每 agent provide 第二个
  报 already registered / fiber 链被 inject 守卫挡住 / 服务实例遮蔽同样被拒)。
  配置层闸门:逻辑档 + 多用户身份**拒绝启动**,错误信息带出路与代价。
- `maxProcesses` 改为**按机器内存推导**:`min(64, ⌊总内存 × 0.6 ÷ 63 MB⌋)`。
  固定值 64 在 4 GB 机器上算术塞得下(4032 MB)却什么都不剩 —— 连网关自己
  (实测 80 MB)都放不下。**算得下、跑不起来。**
- `shared` 成为身份层保留字(为将来可能的租户级共享形态预留,零成本)。
- Linux 性能基线接入 CI 常驻门禁:**86 ms / 63 MB**。

### 已知的口径

- README 的规模对照表**只算子进程** —— 网关自身与操作系统都不在里面。

---

## 0.4.6 —— 测试有效性与门禁补强(开发完成,未发布)

### 新增

- **断言有效性探针**(`scripts/verify-assertions.mjs`)—— 故意弄坏实现,
  确认对应的测试真的变红。`pnpm test` 全绿只证明测试没报错,不证明它在
  实现坏掉时会报错,而后者才是测试的全部价值。
- **测试文件纳入类型检查**(`tsconfig.test.json`)—— 此前全仓 40+ 个测试文件
  从没被 tsc 看过。Vitest 用 esbuild 只擦类型不检查,所以测试跑绿、lint 跑绿,
  而测试里 import 一个根本不存在的导出也照样合入。
- `agent/error → error` 接线 —— 此前 agent 报错时客户端的流只是**静默停住**,
  无从区分「模型在想」与「已经炸了」。
- 网关自持事件序号,不再借上游 seq。
- 错误码新增 `unavailable`。

---

## 0.4.5 —— 进程隔离(开发完成,未发布)

**这一版换来的是「敢卖给互不信任的用户」。** 在此之前隔离级别只有逻辑隔离,
而逻辑隔离只适用于互相信任的用户 —— 那把产品挡在「一家公司内部」这个天花板下。
一 principal 一进程之后,越界成本从「一段提示词」升到「一个进程逃逸漏洞」。

### 新增

- **`@dshwar/supervisor`** —— 进程池,一 principal 一进程。
  同一 principal 的并发会话**共用一个进程**、各持一个 `Lease`,IPC 消息打
  `leaseId` 标签,取消因此只作用于本路会话。进程上限、空闲回收、
  两种健康检查(活着 / 能响应)、僵尸进程防护。
- **`gateway/src/worker.ts`** —— 子进程入口。装配逻辑一行不重复,直接调
  `assembleRuntime()`,这是「切到进程隔离后行为不变」的前提。
- **`gateway/src/isolation.ts`** —— 三档隔离(`logical` / `process` /
  `container`)的分派点。**分派只在这一处**。
- **崩溃不静默丢失**:子进程死亡 → 会话终结 → SSE 推 `error` 事件后收流,
  而不是让客户端的流停在那里。

### 行为

- **默认不变。** 隔离级别默认仍是 `logical`,升级不会自动改变它。
  配错级别时**拒绝启动**而不是静默回退 —— 那是安全等级的差别。
- **`/v1` 契约零变更。** `process` 档复用既有验收路径一字不改跑通,
  两档的事件类型序列相同。客户端不该知道自己跑在哪种隔离下。
- **取消语义不退化。** 走 IPC 送指令而非杀进程(杀进程会连坐同一 principal
  的其他会话)。
- 进程池满时返回 `429`。语义上更贴切的是 503,但契约的 `ErrorCode` 是闭集,
  加新码即破坏性变更。契约下次开口时应补 `unavailable`。

### 代价(实测,五次采样)

| 指标         | 实测        |
| ------------ | ----------- |
| 冷启动       | ~115 ms     |
| 其中插件装配 | ~13 ms      |
| 常驻内存     | ~58 MB/进程 |

冷启动九成花在进程创建与模块加载上 —— 优化装配代码没用,只能压进程复用率。
明细见 `docs/FEASIBILITY-REPORT-V45.md` §6。

### 一处文档更正

路线图与 `ARCHITECTURE.md` 曾把「解决上游没有 cancel」列为进程隔离的收益。
**方向是反的**:进程内的 `Agent.cancel()` 从 V0.2.0 起就实测可用,
进程隔离是把一个已经好用的取消变成了需要重新解决的问题。已在
`CLAUDE.md` 第七节与 `ARCHITECTURE.md` §2.4 更正。

### 已知缺口

- 进程隔离**不是容器**:不防内核提权、不限资源、不隔离网络,
  也不隔离同一 principal 的多个会话。
- 配额判定挂在发起轮次上,而进程在建会话时就起来 ——
  配额耗尽的租户仍能占用进程槽位。
- `container` 档只是配置位,实现交给部署方的编排系统。

---

## 0.4.1 —— `fs-tenant` 多工作区改造(开发完成,未发布)

**有时限的改动**:`fs-tenant` 属于 V0.1.0 且尚未 publish,此刻改路径模型是普通改动;
一旦发布出去就是破坏性变更,要升大版本、写迁移、维护双版本。

### 变更

- **路径模型改为四段**:`{root}/{tenantId}/{userId}/{workspaceId}`。
  `workspaceId` 与另两段**同级对待** —— 同一套白名单校验与 SHA-256 编码,
  不因它来自请求而放松。
- **校验顺序是四步**:先逐段校验 → 拼接 → resolve → 断言仍在根内。
  不能用「拼接后再检查」替代「拼接前先校验」:一个叫 `..` 的 workspaceId 会先把
  路径抬回用户根、再由后续段落补回来,最终 `isWithin` 通过,但落在别人的目录下。
- **缺省工作区 `default`**:未指定时落到它,改造前的调用方零改动仍能工作。
  缺省**只发生在取值阶段,不发生在校验阶段** —— 非法的 workspaceId 直接拒绝,
  不回落到 `default`。给缺省值开旁路,那条旁路就是攻击面。
- 新增 `tenantUserRoot()`(工作区的上一层,仅用于列举),文档写明不得当读写根。
- `/v1` 携带工作区:**建会话时传一次,之后由会话 id 承载**。
  发轮 / SSE / 删除都不必再带,消除了「漏带参数静默落到 default」这一整类错误。
- `@dshwar/policy` 增加工作区配额:数量与容量两条上限。
- 新增 `pnpm check:oss`(硬规则 9):开源构建产物不含闭源组件 ——
  这既是 open-core 边界,也是 SignPath Foundation 免费签名的资格条件。

### 契约兼容性

**相容变更,不升大版本。** 实测:

```
差异: 破坏性 0 处,相容 2 处
  [property.added] Session.workspaceId               新增可选字段
  [property.added] CreateSessionRequest.workspaceId  新增可选字段
```

`Session.workspaceId` 语义上恒有值但 schema 上**必须可选** —— 进 `required`
会让老客户端的响应校验失败,那是破坏性变更。

### 两份决策文档

- [`storage-workspace-scoping.md`](docs/DECISIONS/storage-workspace-scoping.md) ——
  `storage-scoped` **不加**工作区维度。storage 的键对我们不透明,一刀切会把用户级
  数据也切开;同一用户的两个工作区不是信任边界;作用域在 `open()` 时定格,时机对不上。
- [`workspace-in-api.md`](docs/DECISIONS/workspace-in-api.md) —— 选项 A′ 及其兼容性声明。

### 测试

630 条。`fs-tenant` 的逃逸测试按新增路径段**全量重写**(95 条,+28):
每种绕过手法都在 workspaceId 这一段上重验一遍,外加跨工作区隔离的正反向断言。
符号链接测试在 Linux 容器复验,确认真的执行而非静默跳过。

---

## 0.4.0 —— 计量与治理(开发完成,未发布)

### 新增

| 包 | 作用 |
| --- | --- |
| `@dshwar/audit` | 仅追加审计 —— 类型层没有 update / delete |
| `@dshwar/metering` | 用量归属与成本核算 |
| `@dshwar/policy` | 配额判定(判定与执行分离) |
| `@dshwar/model-router` | 模型准入与预算降级 |

`/v1/admin` 的 `usage` / `quota` / `audit` / `policies` 端点由 501 转为实现。
**契约里的 `planned` 至此清零** —— v1 定义的每个端点都有实现,有测试钉住。

### 四条红线

1. **计量只观测,不阻断。** 丢一条用量记录是账目问题,断一次会话是事故。
2. **判定与执行分离。** `policy` 只回答「能不能」,429 由网关发。
3. **超限拒绝,不静默降级。** 降级是 `model-router` 的显式配置,且三处可见:
   响应头、会话记录、审计 —— 用户有权知道自己被换了模型。
4. **审计仅追加。** 改得掉的审计等于没有审计。

### 两处容易算错的地方

- **计费口径按 DISJOINT 加**:上游 `inputTokens` 只算未命中缓存的输入,
  计费输入 = `input + cacheRead + cacheWrite`。直接用 `inputTokens` 会**少计费**。
- **配额 fail open**:计量读不到时放行并落审计。与身份层 fail closed 方向相反 ——
  计量是账目组件不是安全组件,把它放进关键路径的故障域,等于造一个
  「记账挂了所以谁都不能用」的事故模式。

---

## 0.3.0 —— 身份互操作(开发完成,未发布)

### 新增

| 包 | 作用 |
| --- | --- |
| `@dshwar/subject` | Subject Mirror —— 外部身份源的用户镜像 |
| `@dshwar/tenant-map` | 租户映射,四种策略 |
| `@dshwar/auth-jwt` | JWKS 验签 |
| `@dshwar/auth-oidc` | 填一个 issuer URL 即接入 |
| `@dshwar/scim-server` | SCIM 2.0 子集(User + Group) |
| `@dshwar/webhooks` | 出站事件投递,签名可独立验证 |

### 核心语义

- ★ **验签通过 ≠ 放行**:IdP 侧停用不会让已签发的 token 失效,每次 `verify()`
  必查 Subject Mirror 的 `active`。这是本版本验收标准的落点。
- **停用的两条路径都做**:Entra / Okta 发 `PATCH`,authentik 发 `PUT` ——
  只做一条就会「在 A 家能停用、在 B 家停不掉」,而停不掉意味着离职员工仍能调模型。
- **三类令牌分离签发**:运行时 token / Admin Key / SCIM token,互斥有负向测试。
- **租户由映射裁决,不信 token 自称**;映射不出与歧义**都拒绝**;
  镜像与裁决冲突时拒绝而非选一边 —— 选任何一边都是猜,猜错就是跨租户可见。
- **只接受非对称算法**,传入对称算法在构造时抛错(JWKS 分发的是公钥)。
- **Subject 契约里没有任何凭据字段**,供给方载荷带 `password` 时报错而非静默丢弃。

### 可行性裁决

**Keycloak 没有 SCIM 出站客户端** —— 它 26.6 的 `scim-api` 方向是反的
(让 Keycloak 成为服务提供方)。验收基线由 Keycloak 换为 **authentik**
(原生出站 SCIM、MIT、可容器化)。详见 [`docs/FEASIBILITY-REPORT-V3.md`](docs/FEASIBILITY-REPORT-V3.md)。

---

## 0.2.0 —— API 平面(开发完成,未发布)

### 新增

| 包 | 作用 |
| --- | --- |
| `@dshwar/api-contract` | API v1 契约 —— **护城河本体** |
| `@dshwar/gateway` | API 平面服务(Hono),含可执行入口 |
| `@dshwar/sdk` | TS SDK,由 OpenAPI 生成 |

### 核心语义

- ★ **契约是单一事实源**:Zod → OpenAPI 3.1 → SDK。任何一处手写都是第二个事实源,
  而两个事实源迟早分叉 —— 分叉的表现是客户按文档写的客户端在生产上炸掉。
- **契约完整,实现分期**:未实现端点返回 501 并标 `x-dshwar-status: planned`,
  而不是 404 —— 404 会让第三方以为路径写错了,从而去猜别的路径。
  planned 清单**从契约里读**而非手写。
- **契约冻结的基线取自 git,不是快照文件**:另存快照行不通,改契约的人必然顺手
  更新它,检查恒绿。破坏性变更需一份点名契约包的 `major` changeset。
- **闭集枚举加值判为破坏性**:错误码定成 `z.enum` 就是为了让下游写出可穷举的
  `switch`,多一个值就让已写全的 `switch` 编译失败。这是设计后果,不是判定过严。
- **跨 principal 一律 404 而非 403** —— 403 会泄漏 id 存在性,且与「不存在」响应完全一致。
- **凭据永不返回值**:契约层就没给值字段留位置,SDK 生成的类型里同样没有。
- SSE 带单调 `id`,支持 `Last-Event-ID` 断线续传;有界缓冲避免长连接 OOM;
  断连即移除订阅(有度量测试,不靠肉眼)。
- 网关**只消费装好的 `ctx`**,不组装 harness;装配在 `runtime.ts` 里单列一层,
  与 `profiles/gateway.yml` 的漂移由测试拦住。

### 验收

第三方仅凭 SDK 完成一次完整会话,不接触 dsh。[`examples/sdk-session`](examples/sdk-session)
**只依赖 `@dshwar/sdk`** —— 依赖面由测试钉住,对着绑真实端口的 HTTP 服务器跑通。

---

## 0.1.0 —— 运行时平面 MVP(开发完成,未发布)

**核心论点已被证明:Harness 的服务契约可以被换成多用户实现,消费方零改动。**

### 新增

| 包 | 作用 |
| --- | --- |
| `@dshwar/principal` | principal 传播 —— DSHWAR 引入的唯一新概念 |
| `@dshwar/auth` | 认证契约:token → Principal |
| `@dshwar/auth-static` | 静态 token 映射(开发与测试,**禁止部署**) |
| `@dshwar/credentials-multiuser` | per-principal 凭据 + 网关短时效 token 遮蔽 |
| `@dshwar/fs-tenant` | 工作区根按租户钉死 —— 隔离的真实边界 |
| `@dshwar/storage-scoped` | 租户维度的存储作用域 |
| `adapters/dsh-0.1.0` | 唯一允许感知上游内部的目录 + 上游契约测试 |

### 核心语义

- **fail closed**:匿名 principal 解析不到任何凭据,不回退默认值 / 共享 key / 环境变量
- **不跨操作缓存**:凭据每次操作现场解析,相邻两次操作可能属于不同的人
- **`describe` 永不返回值**:只暴露 `configured` / `source` / `writable`
- **不做 IdP**:不存密码、不签发身份令牌、不实现注册流程
- **`AuthError` 不携带失败原因**:认证接口是预言机,区分失败原因等于给攻击者探针

### 工程纪律

- adapters 边界:ESLint + grep 双重强制,且**豁免本身**也有负向测试
- PR 自查清单整条脚本化(`pnpm check:guards`)
- 守卫的负向测试(`pnpm verify:guards`)—— 确认每道守卫真的会拦
- 版本号全仓一致性检查,含 changesets fixed 组覆盖
- CI:守卫单独成 job + Node 22/24 构建矩阵

### 测试

含并发 100 组 principal 无串号(三处随机挂起制造交错)、路径逃逸全谱
(`../`、绝对路径、UNC、8.3 短名、NTFS 数据流、Windows 保留名、URL 编码、
Unicode 规范化、同前缀兄弟目录的 off-by-one)、符号链接逃逸(对着真实 `fs-local`,
须在 Linux 验证)、R9 双 profile 对照。

### 已知限制

见 [README 的已知限制](README.md#已知限制)。

### 兼容性

上游 `@deepseek-ai/dsh-*` **0.1.0-rc.6**,cordis 4.0.1,Node `^22.19.0 || >=24`。
