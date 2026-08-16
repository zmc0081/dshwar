/**
 * Principal 类型与其构造/校验。
 *
 * principal 是 DSHWAR 引入的**唯一**新概念:上游 Harness 是单用户运行时,
 * 「这次操作是谁发起的」这个问题在那里不存在。其余所有 DSHWAR 包
 * (`credentials-multiuser` / `fs-tenant` / `storage-scoped` …)都是上游已有契约的
 * 替代实现,只有它是新的。
 *
 * @module @dshwar/principal
 */

/**
 * 一次操作的发起者。
 *
 * 全部字段 readonly,且实例经 {@link createPrincipal} 冻结 —— 因为 principal 会被
 * 交给下游插件(凭据解析、路径钉死、存储前缀)当作**权威判据**。一个可变的
 * principal 意味着任何一个插件都能悄悄改写「我是谁」,而这种越权在事后审计里
 * 看不出任何痕迹。
 */
export interface Principal {
  /**
   * 稳定且**不可轮换**的主体标识。
   *
   * 必须来自身份提供方的不可变主键(OIDC `sub`、Keycloak/Entra 的 object id、
   * SCIM `id`),**不得使用邮箱、用户名、手机号**。
   *
   * 理由不是洁癖:这些字段会变,而 principal id 是租户数据的归属键。
   * 用邮箱当 id,`alice@corp.com` 改名成 `alice.wong@corp.com` 之后,她的工作区、
   * 凭据、会话历史全部变成孤儿;更糟的是邮箱会被回收 —— 半年后入职的新同事拿到
   * 同一个地址,于是**继承了前任的全部数据**。
   *
   * {@link createPrincipal} 会拒绝邮箱形状的 id,这是刻意的硬拦截。
   */
  readonly id: string

  /**
   * 主体所属租户。
   *
   * 隔离的第一判据:`fs-tenant` 用它钉死工作区根,`storage-scoped` 用它派生键前缀。
   * 映射不出租户时**宁可拒绝登录**也不要落进默认租户 —— 那意味着 A 公司的人
   * 能看到 B 公司的工作区(CLAUDE.md 硬规则 7)。
   */
  readonly tenantId: string

  /**
   * 角色标签,供 `policy` 包(V0.4.0)做授权判定。
   *
   * 本包**不解释**角色语义,只负责原样传播 —— 角色体系属于治理层,
   * 各家企业的定义互不相同,在这里固化任何一套都是错的。
   */
  readonly roles: readonly string[]

  /**
   * 来自身份提供方的附加断言(部门、成本中心、许可等级……)。
   *
   * 刻意用 `unknown` 而非 `any`:消费方必须显式收窄。claims 的内容由外部 IdP 决定,
   * 假设它的形状就是在假设一个我们控制不了的契约。
   */
  readonly claims: Readonly<Record<string, unknown>>
}

/**
 * 构造 {@link Principal} 时的入参。`roles` 与 `claims` 可省,省略即空。
 */
export interface PrincipalInit {
  readonly id: string
  readonly tenantId: string
  readonly roles?: readonly string[]
  readonly claims?: Readonly<Record<string, unknown>>
}

/** 构造非法 principal 时抛出。 */
export class InvalidPrincipalError extends Error {
  override readonly name = 'InvalidPrincipalError'
  constructor(message: string) {
    super(message)
  }
}

/**
 * 标识符里绝不允许出现的字符:路径分隔符、控制字符、DEL。
 *
 * 这里用**黑名单**而非白名单,和 `fs-tenant`(Session 5)相反,是刻意的:
 *
 * - 真实 IdP 的主体标识形状五花八门 —— Auth0 是 `auth0|5f3c…`,某些 SAML 部署是
 *   URN,Entra 是带连字符的 GUID。白名单会把合法用户挡在门外,而被挡住的人
 *   只会得到一句「登录失败」,排查成本极高。
 * - 但路径分隔符、控制字符、空字节没有任何合法用途,拦掉零误伤。
 *
 * **本层不是路径安全的防线。** `fs-tenant` 会对参与路径拼接的值做独立的白名单
 * 校验 —— 路径安全从不依赖单层检查。这里拦的是「明显不该进入系统的东西」,
 * 不是「可以安全拼进路径的东西」。
 *
 * 写成显式谓词而非正则字符类,是因为后者在这个场景里密集到没人能一眼读对:
 * 一个位置放错的 `-` 就会把连字符也拦掉,而那会拒绝所有 GUID 形状的 id。
 */
function hasForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    if (character === '/' || character === '\\') return true
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** 邮箱形状:含 @ 且 @ 后有点。宁可漏判也不误判,真正的硬约束写在 TSDoc 里。 */
const EMAIL_SHAPED = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function assertIdentifier(value: string, field: 'id' | 'tenantId'): void {
  if (value.length === 0) {
    throw new InvalidPrincipalError(`principal.${field} 不得为空`)
  }
  if (value.trim() !== value) {
    throw new InvalidPrincipalError(
      `principal.${field} 首尾不得有空白 —— 它是归属键,"a" 与 "a " 会静默分裂成两个主体`,
    )
  }
  if (hasForbiddenCharacter(value)) {
    throw new InvalidPrincipalError(
      `principal.${field} 含路径分隔符或控制字符,拒绝构造(收到 ${JSON.stringify(value)})`,
    )
  }
  if (value === '.' || value === '..') {
    throw new InvalidPrincipalError(`principal.${field} 不得为 "." 或 ".."`)
  }
}

/**
 * 身份层的保留字。**现在就保留,而不是等到需要时再说。**
 *
 * ## 为什么现在做
 *
 * `shared` 是「一租户一进程」形态里共享工作区的候选哨兵值
 * (见 `docs/DECISIONS/one-process-per-tenant.md`)。那个形态**尚未采纳**,
 * 但保留字必须**在有存量数据之前**定下来 —— 等将来真走那条路时再处理碰撞,
 * 手里已经有一批 id 是 `shared` 的真实用户,那时只剩迁移一条路。
 *
 * 现在保留的成本是零(拒绝一个几乎不会有人用的 id),将来的代价是一次迁移。
 *
 * ⚠️ **保留的是 id,不是 tenantId。** 租户名叫 `shared` 完全合理
 * (一家公司真的可能这么起名),而哨兵值只出现在 userId 那一段。
 *
 * 与 `fs-tenant` 的 `DEFAULT_WORKSPACE_ID`(`default`)同款处理:
 * 那里也是一个约定位置,靠「它走与任何其它值完全相同的校验路径」保证安全。
 */
const RESERVED_IDS = new Set(['shared'])

/**
 * 构造一个冻结的 {@link Principal}。
 *
 * 这是构造 principal 的**唯一**受祝福路径。直接写对象字面量在类型上也能通过,
 * 但会绕开这里的校验,把一个邮箱形状的 id 或带路径分隔符的 tenantId 放进系统 ——
 * 而这两样东西一旦落到存储里,清理成本远高于构造时拒绝。
 *
 * @param init 主体字段;`roles` 与 `claims` 省略即空
 * @returns 冻结的 principal(`roles` 与 `claims` 一并冻结)
 * @throws {InvalidPrincipalError} id/tenantId 为空、含路径分隔符或控制字符、
 *   首尾有空白,或 id 形如邮箱
 */
export function createPrincipal(init: PrincipalInit): Principal {
  assertIdentifier(init.id, 'id')
  assertIdentifier(init.tenantId, 'tenantId')

  if (RESERVED_IDS.has(init.id.toLowerCase())) {
    throw new InvalidPrincipalError(
      `principal.id 不得使用保留字 ${JSON.stringify(init.id)}(保留:${[...RESERVED_IDS].join(' / ')})。` +
        '保留字被留给路径与键前缀里的约定位置 —— 一个真实用户占用它,' +
        '会让他的工作区与那个约定位置指向同一个目录。',
    )
  }

  if (EMAIL_SHAPED.test(init.id)) {
    throw new InvalidPrincipalError(
      `principal.id 不得使用邮箱(收到 ${JSON.stringify(init.id)})。` +
        '邮箱会变更、会被回收 —— 用它当归属键,改名会让数据变成孤儿,' +
        '地址被回收则会让新同事继承前任的全部数据。' +
        '请改用 IdP 的不可变主键(OIDC sub / SCIM id / 目录 object id)。',
    )
  }

  return Object.freeze({
    id: init.id,
    tenantId: init.tenantId,
    roles: Object.freeze([...(init.roles ?? [])]),
    claims: Object.freeze({ ...(init.claims ?? {}) }),
  })
}

/**
 * 匿名主体 —— 「这次操作没有已认证的发起者」。
 *
 * ⚠️ **匿名不是一种降级,是一种拒绝。**
 *
 * 下游必须对它 fail closed(CLAUDE.md 硬规则 6):`credentials-multiuser` 在匿名下
 * 解析不到任何凭据,且**不得**回退到默认值、共享 key 或环境变量。宁可跑不起来,
 * 也不要在组合配错时悄悄用运营方的 key 替一个不知道是谁的人付费。
 *
 * 它的 `tenantId` 是 `'anonymous'` 而非空字符串:空值在路径拼接与键前缀里
 * 会静默塌陷成「无前缀」,那正好等于越过隔离。给它一个真实存在、且永远不会
 * 与真租户重名的值,任何误用都会明确地指向一个不存在的租户,而不是指向所有人。
 *
 * 单用户场景(`profiles/single-user.yml`)下解析为本值 —— 那里的语义是
 * 「本来就只有一个人」,与多租户下的「认不出是谁」不同,但 fail closed 的
 * 行为要求一致:上游原生 `credentials-local` 从环境变量取 key,那是**上游的**
 * 语义,不是 DSHWAR 的回退。
 */
export const ANONYMOUS: Principal = Object.freeze({
  id: 'anonymous',
  tenantId: 'anonymous',
  roles: Object.freeze([] as readonly string[]),
  claims: Object.freeze({}),
})

/**
 * 判断是否为匿名主体。
 *
 * 按 `id` 比对而非引用相等 —— principal 可能经过序列化往返(网关反序列化、
 * 跨进程传递),引用相等在那些路径上会静默失效,而「静默把匿名当成具名」
 * 正是硬规则 6 要防的事故。
 *
 * @param principal 待判定的主体
 * @returns 是否为匿名
 */
export function isAnonymousPrincipal(principal: Principal): boolean {
  return principal.id === ANONYMOUS.id
}
