/**
 * 控制平面的**线上类型** —— 跨 HTTP 那一层的形状。
 *
 * ## 为什么不直接复用运行时包的类型
 *
 * 「不另起一套模型」这条要求容易被误读成「把 `Subject` 原样导出去」。
 * 那样做有两个具体问题:
 *
 * 1. **消费方被迫装整个运行时。** 控制台前端与 `dshwar-console`(独立仓)
 *    只需要知道 JSON 长什么样,不需要 cordis、不需要 storage 后端。
 *    让它们依赖 `@dshwar/subject` 等于把运行时平面拖进控制平面 ——
 *    而 `CONSOLE-SPLIT.md` 的依赖方向表明确说了这是单向的。
 * 2. **领域类型里有不该上线的东西。** 领域模型会带内部字段、方法、
 *    甚至 store 句柄;线上类型必须是纯数据。
 *
 * ## 那怎么保证不漂
 *
 * **靠类型级一致性测试,不靠人记得同步。**
 * `test/conformance.test-d.ts` 断言每个线上类型都能由对应的领域类型
 * **结构性地满足** —— 领域类型改名、删字段、改类型,那条断言编译不过。
 *
 * 这是「不另起一套模型」的实现方式:**不复制模型,只声明它的投影,
 * 并证明投影仍然对得上。** 复制会漂,投影 + 断言不会。
 *
 * ⚠️ 反过来**不**要求线上类型覆盖领域类型的全部字段 —— 少上线一些字段
 * 是正常的(内部字段本来就不该出去)。断言的方向是单向的:
 * **领域类型能满足线上类型**,不是相等。
 *
 * @module @dshwar/console-contract/wire
 */

/** 成员在控制台里的样子。由 `@dshwar/subject` 的 `Subject` 投影而来。 */
export interface ConsoleMember {
  readonly id: string
  /**
   * 哪个身份源推来的。
   *
   * 管理端**必须**看得见这个字段:多 IdP 并存时,「这条记录归谁管」
   * 是个真实问题 —— B 家的 SCIM token 不得改 A 家推来的记录。
   * 界面上要能解释「为什么这个成员我改不了」。
   */
  readonly source: string
  readonly userName: string
  readonly displayName: string | null
  /** 停用的成员一律拒绝认证。控制台把它显示成一个开关。 */
  readonly active: boolean
  readonly tenantId: string
  readonly emails: readonly { readonly value: string; readonly primary: boolean }[]
  readonly groups: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** 成员的角色。**这是控制平面新增的概念**,运行时不认识它。 */
export type ConsoleRole = 'owner' | 'admin' | 'member'

/**
 * 角色能做什么。
 *
 * ⚠️ **`owner` 与 `admin` 的区别只有一条:能不能改计费与删租户。**
 * 刻意不做更细的权限矩阵 —— 三个角色能说清的事,用九个角色说只会让
 * 管理员选错。要更细的粒度时再加,那时会有真实的诉求指导怎么切。
 */
export interface ConsoleRoleCapabilities {
  /** 增删成员、改配额、改模型准入。 */
  readonly manageMembers: boolean
  /** 看用量与审计。 */
  readonly viewUsage: boolean
  /** 改计费、删租户。**仅 owner**。 */
  readonly manageBilling: boolean
}

/** 配额在控制台里的样子。由 `@dshwar/policy` 的 `QuotaState` 投影而来。 */
export interface ConsoleQuota {
  readonly subjectId: string
  /** `null` = 不限。控制台把它显示成「不限」而不是 0 —— 那是两回事。 */
  readonly tokenLimit: number | null
  readonly tokenUsed: number
  readonly periodStart: string
  readonly periodEnd: string
}

/** 一行日用量。由 `@dshwar/metering` 的 `DailyUsageRow` 投影而来。 */
export interface ConsoleUsageRow {
  readonly subjectId: string
  readonly tenantId: string
  readonly date: string
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  /**
   * 最小货币单位(分)。
   *
   * ⚠️ **不要在契约里用浮点表示钱。** 0.1 + 0.2 !== 0.3 这件事在账单上
   * 就是对不上账,而对不上账的账单会被客户拿去质疑整个系统。
   */
  readonly costMinorUnits: number
  readonly currency: string
}

/** 一条审计。由 `@dshwar/audit` 的 `AuditRecord` 投影而来。 */
export interface ConsoleAuditEntry {
  readonly id: string
  readonly at: string
  readonly actor: string
  readonly tenantId: string
  readonly action: string
  readonly target: string
}

/**
 * 容量信息 —— 控制台首页常驻显示的那三个数(D2)。
 *
 * ## 为什么它值得进契约,而不是前端自己算
 *
 * 因为**算错的后果是管理员照着一个错的上限去加人**,而加到第 N 个人时
 * 才发现起不来。这三个数必须与服务端**同一个来源**
 * (`@dshwar/supervisor` 的 `deriveMaxProcesses`),不是各算各的。
 */
export interface ConsoleCapacity {
  /** `logical` | `process` | `container`。 */
  readonly isolationLevel: string
  /**
   * 当前生效的进程上限。
   *
   * ⚠️ 逻辑档下这个数**没有意义**(不起子进程),此时为 `null` ——
   * 而不是 0 或 1。`null` 逼着前端去想「这一档该显示什么」,
   * 0 会被直接渲染成「上限 0」,那是错的。
   */
  readonly maxProcesses: number | null
  /**
   * 可容纳的成员数上限。
   *
   * 逻辑档恒为 **1**(V0.4.7 起只支持单 principal),进程档等于
   * `maxProcesses`。这正是 D2 要拦在「建第二个成员」那一步的依据。
   */
  readonly memberCap: number
  /** 当前已有多少成员。前端据此显示「3 / 39」。 */
  readonly memberCount: number
  /** 每进程常驻内存(MB),实测值。让管理员看得见代价。 */
  readonly rssPerProcessMb: number
  /** 推导依据,人类可读。一个说不出理由的上限,管理员只能盲信或盲改。 */
  readonly basis: string
}
