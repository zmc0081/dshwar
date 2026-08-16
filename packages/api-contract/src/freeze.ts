/**
 * 契约冻结:比对两版 OpenAPI,把差异分成「破坏性」与「相容」。
 *
 * **为什么这段逻辑在契约包里,而不是在 `scripts/` 的某个脚本里。**
 * 「哪种改动算破坏性」是契约本身的语义,不是构建工具的实现细节。放在这里它能被
 * 单测覆盖 —— 一条判错的规则比没有规则更糟:它会给出「已检查」的假象,然后放行
 * 一次让所有客户端在运行时崩掉的变更。
 *
 * 判定只看**结构**,不看措辞。改一段 description 不该拦人。
 *
 * @module @dshwar/api-contract/freeze
 */

/** 一处契约差异。 */
export interface ContractChange {
  /** `breaking` 需显式声明并升大版;`additive` 直接放行。 */
  readonly kind: 'breaking' | 'additive'
  /** 机器可读的分类,便于测试与后续统计。 */
  readonly code: ContractChangeCode
  /** 出问题的位置,如 `paths./v1/sessions.get`。 */
  readonly where: string
  readonly detail: string
}

export type ContractChangeCode =
  | 'path.removed'
  | 'path.added'
  | 'operation.removed'
  | 'operation.added'
  | 'schema.removed'
  | 'schema.added'
  | 'property.removed'
  | 'property.added'
  | 'property.required.added'
  | 'property.required.relaxed'
  | 'property.type.changed'
  | 'enum.value.removed'
  | 'enum.value.added'
  | 'parameter.required.added'

/** OpenAPI 文档 —— 只声明本模块读的部分。 */
interface OpenApiDocument {
  readonly info?: { readonly version?: string }
  readonly paths?: Record<string, Record<string, unknown>>
  readonly components?: { readonly schemas?: Record<string, JsonSchema> }
}

interface JsonSchema {
  readonly type?: string | string[]
  readonly properties?: Record<string, JsonSchema>
  readonly required?: readonly string[]
  readonly enum?: readonly unknown[]
  readonly items?: JsonSchema
  readonly anyOf?: readonly JsonSchema[]
  readonly oneOf?: readonly JsonSchema[]
  readonly allOf?: readonly JsonSchema[]
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/**
 * 比对两版契约。
 *
 * @param before 基线(上一次提交里的那份)
 * @param after 当前
 * @returns 全部差异,含相容的那些 —— 调用方需要知道「改了什么」,不只是「能不能过」
 */
export function diffContract(before: unknown, after: unknown): ContractChange[] {
  const a = before as OpenApiDocument
  const b = after as OpenApiDocument
  const changes: ContractChange[] = []

  diffPaths(a.paths ?? {}, b.paths ?? {}, changes)
  diffSchemas(a.components?.schemas ?? {}, b.components?.schemas ?? {}, changes)

  return changes
}

function diffPaths(
  before: Record<string, Record<string, unknown>>,
  after: Record<string, Record<string, unknown>>,
  changes: ContractChange[],
): void {
  for (const path of Object.keys(before)) {
    if (!(path in after)) {
      changes.push({
        kind: 'breaking',
        code: 'path.removed',
        where: `paths.${path}`,
        detail: '端点被删除 —— 已接入的客户端会拿到 404',
      })
      continue
    }

    const beforeOps = before[path]!
    const afterOps = after[path]!
    for (const method of HTTP_METHODS) {
      const had = method in beforeOps
      const has = method in afterOps
      if (had && !has) {
        changes.push({
          kind: 'breaking',
          code: 'operation.removed',
          where: `paths.${path}.${method}`,
          detail: '方法被删除',
        })
      } else if (!had && has) {
        changes.push({
          kind: 'additive',
          code: 'operation.added',
          where: `paths.${path}.${method}`,
          detail: '新增方法',
        })
      }

      if (had && has) {
        diffParameters(
          beforeOps[method] as { parameters?: unknown[] },
          afterOps[method] as { parameters?: unknown[] },
          `paths.${path}.${method}`,
          changes,
        )
      }
    }
  }

  for (const path of Object.keys(after)) {
    if (path in before) continue
    changes.push({
      kind: 'additive',
      code: 'path.added',
      where: `paths.${path}`,
      detail: '新增端点',
    })
  }
}

/** 把一个可选参数改成必填,老客户端的请求立刻全部变成 400。 */
function diffParameters(
  before: { parameters?: unknown[] } | undefined,
  after: { parameters?: unknown[] } | undefined,
  where: string,
  changes: ContractChange[],
): void {
  const index = (list: unknown[] | undefined) =>
    new Map(
      (list ?? []).map((p) => {
        const param = p as { name?: string; in?: string; required?: boolean }
        return [`${param.in ?? '?'}:${param.name ?? '?'}`, param.required === true] as const
      }),
    )

  const beforeParams = index(before?.parameters)
  const afterParams = index(after?.parameters)

  for (const [key, required] of afterParams) {
    if (!required) continue
    // 新增的必填参数与「原本可选、现在必填」都会打断已接入的调用方
    if (beforeParams.get(key) !== true) {
      changes.push({
        kind: 'breaking',
        code: 'parameter.required.added',
        where: `${where}.parameters.${key}`,
        detail: '参数变为必填 —— 未传该参数的老客户端会拿到 400',
      })
    }
  }
}

function diffSchemas(
  before: Record<string, JsonSchema>,
  after: Record<string, JsonSchema>,
  changes: ContractChange[],
): void {
  for (const name of Object.keys(before)) {
    if (!(name in after)) {
      changes.push({
        kind: 'breaking',
        code: 'schema.removed',
        where: `components.schemas.${name}`,
        detail: '类型被删除',
      })
      continue
    }
    diffSchema(before[name]!, after[name]!, `components.schemas.${name}`, changes)
  }

  for (const name of Object.keys(after)) {
    if (name in before) continue
    changes.push({
      kind: 'additive',
      code: 'schema.added',
      where: `components.schemas.${name}`,
      detail: '新增类型',
    })
  }
}

function diffSchema(
  before: JsonSchema,
  after: JsonSchema,
  where: string,
  changes: ContractChange[],
): void {
  if (before.type !== undefined && after.type !== undefined) {
    const beforeType = JSON.stringify(before.type)
    const afterType = JSON.stringify(after.type)
    if (beforeType !== afterType) {
      changes.push({
        kind: 'breaking',
        code: 'property.type.changed',
        where,
        detail: `类型由 ${beforeType} 改为 ${afterType}`,
      })
    }
  }

  diffEnum(before, after, where, changes)

  const beforeProps = before.properties ?? {}
  const afterProps = after.properties ?? {}
  const beforeRequired = new Set(before.required ?? [])
  const afterRequired = new Set(after.required ?? [])

  for (const key of Object.keys(beforeProps)) {
    if (!(key in afterProps)) {
      changes.push({
        kind: 'breaking',
        code: 'property.removed',
        where: `${where}.${key}`,
        detail: '字段被删除 —— 读它的客户端会拿到 undefined',
      })
      continue
    }
    diffSchema(beforeProps[key]!, afterProps[key]!, `${where}.${key}`, changes)
  }

  for (const key of Object.keys(afterProps)) {
    if (key in beforeProps) continue
    // 新增必填字段是破坏性的:它出现在**请求**里时,老客户端一律 400。
    // 无从在这里区分请求还是响应 —— 同一个 schema 两边都可能被引用,
    // 所以按更保守的一边判。想加字段,把它加成可选。
    if (afterRequired.has(key)) {
      changes.push({
        kind: 'breaking',
        code: 'property.required.added',
        where: `${where}.${key}`,
        detail: '新增的是必填字段 —— 加成可选即可放行',
      })
    } else {
      changes.push({
        kind: 'additive',
        code: 'property.added',
        where: `${where}.${key}`,
        detail: '新增可选字段',
      })
    }
  }

  // 原有字段由可选变必填 —— 与新增必填同理
  for (const key of afterRequired) {
    if (!(key in beforeProps)) continue
    if (!beforeRequired.has(key)) {
      changes.push({
        kind: 'breaking',
        code: 'property.required.added',
        where: `${where}.${key}`,
        detail: '字段由可选改为必填',
      })
    }
  }

  // 反向:必填改可选。对**请求**是放松,对**响应**是破坏 ——
  // 客户端本来可以无条件读它。同样按保守的一边判。
  for (const key of beforeRequired) {
    if (!afterRequired.has(key) && key in afterProps) {
      changes.push({
        kind: 'breaking',
        code: 'property.required.relaxed',
        where: `${where}.${key}`,
        detail: '字段由必填改为可选 —— 无条件读它的客户端会拿到 undefined',
      })
    }
  }

  if (before.items !== undefined && after.items !== undefined) {
    diffSchema(before.items, after.items, `${where}[]`, changes)
  }
}

/**
 * 枚举的两个方向都算破坏性,理由不同:
 *
 * - **删值**:服务端不再接受某个入参取值。
 * - **加值**:这条容易被误判成「加东西不算破坏」。但闭集枚举正是为了让客户端
 *   写出可穷举的 `switch` —— 契约把错误码定成 `z.enum` 而不是 `z.string()`,
 *   换来的就是编译器查漏。多一个值,下游已经写全的 `switch` 立刻编译失败。
 *   这是**有意为之**的设计后果,不是判定过严。
 */
function diffEnum(
  before: JsonSchema,
  after: JsonSchema,
  where: string,
  changes: ContractChange[],
): void {
  if (before.enum === undefined || after.enum === undefined) return

  const beforeValues = new Set(before.enum.map((v) => JSON.stringify(v)))
  const afterValues = new Set(after.enum.map((v) => JSON.stringify(v)))

  for (const value of beforeValues) {
    if (!afterValues.has(value)) {
      changes.push({
        kind: 'breaking',
        code: 'enum.value.removed',
        where,
        detail: `枚举值 ${value} 被删除`,
      })
    }
  }
  for (const value of afterValues) {
    if (!beforeValues.has(value)) {
      changes.push({
        // V0.4.6:从 breaking 改为 additive。
        //
        // ⚠️ **改判据必须连理由一起改。** 这里原本写着「闭集枚举加值会让下游
        // 已写全的 switch 编译失败」—— 那句话在**没有**契约级规定时是**对的**。
        // 放宽的前提是 `@dshwar/api-contract/common` 里那条「客户端必须优雅
        // 处理未知枚举值」:先立规定,再放宽检查。只做后者是把安全网剪个洞。
        //
        // 为什么值得放宽:不加值的代价是让语义失真。V0.4.5 曾把「进程池满」
        // 映射成 `rate_limited`(你请求太多),于是客户端错误地限制自己,
        // 运维照着 429 曲线去调客户端限额,而根因是容量不足。
        //
        // `enum.value.removed` **仍是破坏性变更** —— 删值会让下游正在处理的
        // 分支变成死代码,`default` 兜不住。
        kind: 'additive',
        code: 'enum.value.added',
        where,
        detail: `枚举值 ${value} 被新增 —— 客户端须有 default 分支(契约级要求)`,
      })
    }
  }
}

/** 只挑出破坏性的那些。 */
export function breakingChanges(changes: readonly ContractChange[]): ContractChange[] {
  return changes.filter((c) => c.kind === 'breaking')
}
