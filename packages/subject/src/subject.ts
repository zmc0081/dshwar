/**
 * Subject —— 外部身份源里某个用户在 DSHWAR 这一侧的**镜像**。
 *
 * ## 「镜像」这两个字是承重的
 *
 * DSHWAR 不是身份提供者(CLAUDE.md 硬规则 4)。客户的用户目录在他们自己的 IdP 里,
 * 这里保存的只是一份用于**归属与授权**的副本:这个 token 背后是谁、属于哪个租户、
 * 现在还有没有效。
 *
 * 由此推出三条设计约束,它们不是风格偏好:
 *
 * 1. **没有密码字段。** 契约层就不留位置 —— 与 `CredentialDescriptor` 同款做法。
 *    留一个 optional 的密码字段,迟早有人往里写东西。
 * 2. **没有「新建用户」入口。** 只有 {@link SubjectStore.upsert},且必须带 `source`。
 *    DSHWAR 凭空造出来的用户在上游 IdP 里不存在,下一次全量同步就会变成孤儿。
 * 3. **停用不删除。** `active: false` 是一个状态,不是一次删除。审计要能回答
 *    「这个人是什么时候被停的」,删掉就答不了。
 *
 * @module @dshwar/subject/subject
 */

/** 一个邮箱。SCIM 的 `emails` 是多值属性,`primary` 用于挑主邮箱。 */
export interface SubjectEmail {
  readonly value: string
  readonly primary: boolean
}

/**
 * 身份镜像记录。
 *
 * ⚠️ **这个接口里永远不会有密码、口令、密钥或它们的哈希。** 若某次改动看起来
 * 需要往这里加一个凭据字段,那是设计错了:凭据走
 * `@dshwar/credentials-multiuser`,且只暴露 describe 语义(硬规则 5)。
 */
export interface Subject {
  /** DSHWAR 内部 id。与 `Principal.id` 同一个命名空间。 */
  readonly id: string
  /**
   * 哪个身份源推来的。
   *
   * 多 IdP 并存时,两家可能给出相同的 `externalId` —— 只有配上 source 才能唯一定位。
   * 它也是「这条记录归谁管」的凭据:B 家的 SCIM token 不得改 A 家推来的记录。
   */
  readonly source: string
  /** 供给方那边的稳定 id(SCIM 的 `externalId`,OIDC 的 `sub`)。 */
  readonly externalId: string
  /** 登录名(SCIM 的 `userName`)。 */
  readonly userName: string
  /** 停用的用户一律拒绝认证。**这是本版本存在的理由。** */
  readonly active: boolean
  /** 由 `@dshwar/tenant-map` 裁决,不直接信供给方传来的字段。 */
  readonly tenantId: string
  readonly emails: readonly SubjectEmail[]
  /** 所属组名。租户映射 `strategy: group` 从这里取。 */
  readonly groups: readonly string[]
  readonly displayName: string | null
  /** ISO 8601。 */
  readonly createdAt: string
  readonly updatedAt: string
}

/** upsert 的入参。`id` / `createdAt` / `updatedAt` 由 store 决定,调用方给不了。 */
export interface SubjectInput {
  readonly source: string
  readonly externalId: string
  readonly userName: string
  readonly tenantId: string
  readonly active?: boolean
  readonly emails?: readonly SubjectEmail[]
  readonly groups?: readonly string[]
  readonly displayName?: string | null
}

/** 输入不合法。**拒绝**而不是修正 —— 悄悄修正会让上游的错配置一直藏着。 */
export class SubjectError extends Error {
  override readonly name = 'SubjectError'
  constructor(message: string) {
    super(message)
  }
}

/**
 * 供给方推来的字段里,哪些是我们**拒绝接收**的。
 *
 * SCIM 的 `User` schema 里有 `password`(RFC 7643 §4.1.1)。供给方**会**发它 ——
 * 这不是假想:Azure AD 在初次创建用户时可以配置发送密码。收下它就等于开始存密码,
 * 违反硬规则 4。
 *
 * 因此:见到这些键**报错**,而不是静默丢弃。静默丢弃会让部署方以为密码同步成功了。
 */
// dshwar-guard-allow: 这份清单是硬规则 4 的**执行者** —— 要拒绝密码字段,就得写出它的名字
const REJECTED_KEYS = ['password', 'passwordhash', 'password_hash', 'secret', 'credentials']

/**
 * 检查一个原始的供给方载荷里有没有我们不该收的东西。
 *
 * @param payload 供给方发来的原始对象
 * @throws {SubjectError} 载荷里含密码类字段
 */
export function assertNoCredentialFields(payload: object): void {
  for (const key of Object.keys(payload)) {
    if (REJECTED_KEYS.includes(key.toLowerCase())) {
      throw new SubjectError(
        `subject: 载荷里含 ${JSON.stringify(key)} —— DSHWAR 不存密码(CLAUDE.md 硬规则 4)。` +
          '请在供给方侧关掉密码同步。',
      )
    }
  }
}

/** 与 `@dshwar/principal` 一致的禁用字符判定。id 会进日志、审计与存储键。 */
function hasForbiddenCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    if (code < 0x20 || code === 0x7f) return true
    if (ch === '/' || ch === '\\') return true
  }
  return false
}

function requireField(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new SubjectError(`subject: ${field} 不得为空`)
  }
  if (hasForbiddenCharacter(trimmed)) {
    throw new SubjectError(`subject: ${field} 含路径分隔符或控制字符:${JSON.stringify(value)}`)
  }
  return trimmed
}

/**
 * 校验并规范化一条 upsert 输入。
 *
 * @param input 供给方映射后的字段
 * @returns 规范化后的输入
 * @throws {SubjectError} 任一必填字段为空或含禁用字符
 */
export function normalizeInput(input: SubjectInput): Required<Omit<SubjectInput, 'displayName'>> & {
  displayName: string | null
} {
  const emails = input.emails ?? []
  for (const email of emails) {
    if (email.value.trim().length === 0) throw new SubjectError('subject: 邮箱不得为空字符串')
  }

  // 多个 primary 是歧义 —— 取第一个意味着顺序变了主邮箱就变了
  if (emails.filter((e) => e.primary).length > 1) {
    throw new SubjectError('subject: 只能有一个 primary 邮箱')
  }

  return {
    source: requireField(input.source, 'source'),
    externalId: requireField(input.externalId, 'externalId'),
    userName: requireField(input.userName, 'userName'),
    tenantId: requireField(input.tenantId, 'tenantId'),
    // 供给方没说时默认**启用** —— SCIM RFC 7643 §4.1.1 的 active 缺省即启用。
    // 默认停用会让每次创建用户都要额外一次 PATCH。
    active: input.active ?? true,
    emails,
    groups: input.groups ?? [],
    displayName: input.displayName ?? null,
  }
}

/** 主邮箱;没有标 primary 时取第一个;一个都没有时 `null`。 */
export function primaryEmail(subject: Subject): string | null {
  return (subject.emails.find((e) => e.primary) ?? subject.emails[0])?.value ?? null
}
