/**
 * 模型中间表示(IR)—— OpenAPI schema → 与语言无关的模型清单。
 *
 * ## 为什么它在契约包里,而不是各 SDK 里
 *
 * 因为它**是契约的一部分**:「`anyOf: [string, null]` 表示可空的字符串」
 * 这个判读一旦各 SDK 各写一份,三份实现会慢慢分家 —— 而分家的那一刻
 * 是静默的:每个 SDK 自己的测试都还绿着。
 *
 * ## 它刻意**不**做的事
 *
 * 不生成任何语言的源码。IR 只回答「契约里有哪些模型、每个字段是什么形状」;
 * 「Kotlin 里该写 `String?` 还是 `Optional<String>`」是发射器的事。
 *
 * **这条分界让「漏字段」与「映射错」变成两类可以分别断言的错**:
 * 前者查 IR 与契约的对应,后者查发射结果与 IR 的对应。混在一起的话,
 * 一条断言要同时管两件事,而它红的时候你不知道是哪件。
 *
 * @module @dshwar/api-contract/model-ir
 */

/** 与语言无关的字段类型。 */
export type IrType =
  | { readonly kind: 'string' }
  | { readonly kind: 'integer' }
  | { readonly kind: 'boolean' }
  /** ISO 8601 日期时间。单列是因为三种语言的映射各不相同。 */
  | { readonly kind: 'datetime' }
  /** 引用另一个命名模型。 */
  | { readonly kind: 'ref'; readonly name: string }
  | { readonly kind: 'array'; readonly items: IrType }
  /** 字符串枚举。`values` 是闭集。 */
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  /** 结构不透明的自由对象(如 webhook 事件体)。 */
  | { readonly kind: 'unknown' }

export interface IrField {
  readonly name: string
  readonly type: IrType
  /** `anyOf: [T, null]` 或不在 `required` 里 —— 两者在目标语言里都是可空。 */
  readonly nullable: boolean
  readonly description: string | undefined
}

export interface IrModel {
  readonly name: string
  readonly fields: readonly IrField[]
  readonly description: string | undefined
}

/** 契约里出现了 IR 认不出的形状 —— **拒绝生成**,不猜。 */
export class UnsupportedSchemaError extends Error {
  constructor(where: string, shape: string) {
    super(
      `契约里的 ${where} 是 IR 不认识的形状:${shape}。\n` +
        `  **拒绝生成,而不是猜一个映射** —— 猜错的后果是三种语言各拿到一个` +
        `编译得过、运行时对不上的模型,而那要到集成时才发现。\n` +
        `  要支持它:在 packages/api-contract/src/model-ir.ts 里加一条映射,` +
        `并给三种语言的发射器各补一条映射断言。`,
    )
    this.name = 'UnsupportedSchemaError'
  }
}

/** OpenAPI schema 节点的结构性子集。不引 OpenAPI 类型库 —— 只读这几个键。 */
interface SchemaNode {
  readonly type?: string
  readonly format?: string
  readonly enum?: readonly string[]
  readonly items?: SchemaNode
  readonly properties?: Record<string, SchemaNode>
  readonly required?: readonly string[]
  readonly anyOf?: readonly SchemaNode[]
  readonly oneOf?: readonly SchemaNode[]
  readonly description?: string
  readonly $ref?: string
}

/**
 * 一个 schema 会不会出一个具名模型 —— **本模块唯一的判据**。
 *
 * ⚠️ 必须只有这一处。上一版 {@link extractModels} 与 {@link objectSchemaNames}
 * 各写了一份**内容相同**的谓词,而后者的注释说它们「分开实现是刻意的」,
 * 理由是「共用同一段过滤逻辑会让两边一起漏掉」。
 *
 * 🚨 **分开写同一条规则不叫独立** —— 它只是把同一个判据抄了两遍,
 * 而两遍会一起对、一起错。JobStatus 就是这么同时逃出「应出模型」与
 * 「已出模型」两个集合的:覆盖断言拿两个都排除了它的集合互相印证,全绿。
 *
 * ⇒ 现在共用一处,而**真正的独立断言换成了另一件事**:
 * IR 里的每个引用都必须指向一个真的出了模型的名字(见 extractModels 末尾)。
 * 那一条问的是「引用 ⊆ 声明」,与「object ⊆ 模型」不是同一个问题 ——
 * 前者才是当时坏掉的那个。
 */
function isModelSchema(
  s: SchemaNode | undefined,
): s is SchemaNode & { readonly properties: Record<string, SchemaNode> } {
  return s !== undefined && s.type === 'object' && s.properties !== undefined
}

/** `#/components/schemas/Foo` → `Foo`。 */
function refName(ref: string): string {
  const name = ref.split('/').pop()
  if (name === undefined || name === '') throw new UnsupportedSchemaError('$ref', ref)
  return name
}

/**
 * 判读一个字段节点。
 *
 * ⚠️ **认不出就抛**(见 {@link UnsupportedSchemaError})。回落到「字符串」
 * 之类的默认值是本模块最不该做的事:它把一个契约问题变成三个运行时问题。
 */
function readType(
  node: SchemaNode,
  where: string,
  schemas: Record<string, SchemaNode>,
  seen: readonly string[] = [],
): { type: IrType; nullable: boolean } {
  if (node.$ref !== undefined) {
    const name = refName(node.$ref)
    const target = schemas[name]

    // 契约自己就悬空 —— 抛,不猜。这与本函数「认不出就抛」是同一条。
    if (target === undefined) throw new UnsupportedSchemaError(where, `$ref → ${name}(找不到)`)

    // 🚨 **只有会出模型的 schema 才配得上一个 ref。**
    //
    // 上一版无条件返回 `{kind:'ref'}`,于是指向**非 object** 的 `$ref`
    // 会生成一个**引用了不存在类型**的字段。实测代价:`Job.status` 指向
    // 顶层字符串枚举 `JobStatus`,而 `extractModels` 只给 object 出模型 ——
    // Kotlin 与 Swift 的产物里 `JobStatus` 被引用却从未声明,
    // 两种语言都编译不过,而这件事**两个版本里没有任何东西发现**:
    // 三道同步断言比的是文本(引用被忠实地生成了),覆盖断言两侧用的是
    // 同一个谓词(JobStatus 被同时排除在「应出模型」与「已出模型」之外)。
    //
    // ⇒ 指向非 object 的 `$ref` 按**别名**处理:递归读目标本身。
    //   顶层字符串枚举于是与内联枚举走同一条路(渲染成 String + 取值注释),
    //   与「SDK 不因为契约加一个枚举值就变成破坏性升级」那个既定决定一致。
    if (isModelSchema(target)) return { type: { kind: 'ref', name }, nullable: false }

    // 别名链成环时停下 —— object 目标不递归,所以成环只可能发生在非 object 之间。
    if (seen.includes(name))
      throw new UnsupportedSchemaError(where, `$ref 成环:${[...seen, name].join(' → ')}`)
    return readType(target, `${where} → ${name}`, schemas, [...seen, name])
  }

  // **空 schema `{}` = 无约束**。这是 JSON Schema 的定义,不是猜测 ——
  // 契约里它来自 `z.unknown()`(如 AuditEntry 的 before/after:审计记录的
  // 变更前后值,形状由被审计的对象决定,契约层面确实不该有约束)。
  //
  // ⚠️ 这一条是 IR 第一次跑就撞到的 —— 它当时**拒绝生成并指出了位置**,
  // 而不是回落成 string。那正是 UnsupportedSchemaError 存在的意义。
  if (
    node.type === undefined &&
    node.enum === undefined &&
    node.anyOf === undefined &&
    node.oneOf === undefined
  ) {
    return { type: { kind: 'unknown' }, nullable: false }
  }

  // anyOf: [T, null] —— 契约里表达可空的唯一形式
  if (node.anyOf !== undefined) {
    const nonNull = node.anyOf.filter((v) => v.type !== 'null')
    const hasNull = node.anyOf.length !== nonNull.length
    if (nonNull.length !== 1) throw new UnsupportedSchemaError(where, `anyOf[${node.anyOf.length}]`)
    const inner = readType(nonNull[0] as SchemaNode, where, schemas, seen)
    return { type: inner.type, nullable: hasNull || inner.nullable }
  }

  // oneOf 目前只出现在流式事件的判别联合上 —— 对 SDK 模型层按不透明处理。
  // 这不是偷懒:判别联合的正确映射三种语言各不相同(sealed class / enum with
  // associated values / discriminated union),值得单独一版而不是在这里将就。
  if (node.oneOf !== undefined) return { type: { kind: 'unknown' }, nullable: false }

  if (node.enum !== undefined) {
    if (node.type !== 'string') throw new UnsupportedSchemaError(where, `enum:${node.type}`)
    return { type: { kind: 'enum', values: [...node.enum] }, nullable: false }
  }

  switch (node.type) {
    case 'string':
      return {
        type: node.format === 'date-time' ? { kind: 'datetime' } : { kind: 'string' },
        nullable: false,
      }
    case 'integer':
    case 'number':
      return { type: { kind: 'integer' }, nullable: false }
    case 'boolean':
      return { type: { kind: 'boolean' }, nullable: false }
    case 'array': {
      if (node.items === undefined) throw new UnsupportedSchemaError(where, 'array without items')
      return {
        type: { kind: 'array', items: readType(node.items, where, schemas, seen).type },
        nullable: false,
      }
    }
    case 'object':
      // 有 properties 的内联对象没有名字,发射器无从命名 —— 按不透明处理
      return { type: { kind: 'unknown' }, nullable: false }
    default:
      throw new UnsupportedSchemaError(where, `type=${String(node.type)}`)
  }
}

/**
 * 从 OpenAPI 文档抽出模型清单。
 *
 * **按 schema 名排序**,不依赖 JSON 的键序 —— 否则重新生成的产物会因为
 * 无关的键序变动而与已提交的不一致,那种红没有信息量。
 */
export function extractModels(document: Record<string, unknown>): IrModel[] {
  const components = document['components'] as { schemas?: Record<string, SchemaNode> } | undefined
  const schemas = components?.schemas ?? {}

  const models = Object.keys(schemas)
    .sort()
    .flatMap((name) => {
      const schema = schemas[name] as SchemaNode
      // 顶层不是 object 的(如判别联合、顶层枚举)不出模型。
      // 它们被**引用**时不会悬空:readType 把那种 $ref 当别名展开。
      if (!isModelSchema(schema)) return []

      const required = new Set(schema.required ?? [])
      const fields: IrField[] = Object.keys(schema.properties)
        .sort()
        .map((field) => {
          const node = (schema.properties as Record<string, SchemaNode>)[field] as SchemaNode
          const { type, nullable } = readType(node, `${name}.${field}`, schemas)
          return {
            name: field,
            type,
            nullable: nullable || !required.has(field),
            description: node.description,
          }
        })

      return [{ name, fields, description: schema.description }]
    })

  assertRefsResolve(models)
  return models
}

/** 一个类型里出现的全部模型引用名(数组会嵌套)。 */
function refNamesIn(type: IrType): string[] {
  if (type.kind === 'ref') return [type.name]
  if (type.kind === 'array') return refNamesIn(type.items)
  return []
}

/**
 * ★ **引用完整性:IR 里每个 ref 都必须指向一个真的出了模型的名字。**
 *
 * 这是 JobStatus 那次的直接教训,而它是一条**与覆盖断言方向不同**的断言:
 *
 * | 断言 | 问的是 | JobStatus 那次 |
 * | --- | --- | --- |
 * | 覆盖断言 | 每个 object schema 都出模型了吗 | ✅ 绿(JobStatus 两边都不在) |
 * | **本条** | 每个被引用的名字都声明了吗 | ❌ 会红 |
 *
 * 生成期抛,而不是等编译期 —— 生成的人立刻看到位置,
 * 而不是把一份编不过的产物提交上去,等 CI 的 sdk-compile job 去发现。
 */
function assertRefsResolve(models: readonly IrModel[]): void {
  const declared = new Set(models.map((m) => m.name))
  for (const m of models) {
    for (const f of m.fields) {
      for (const ref of refNamesIn(f.type)) {
        if (!declared.has(ref)) {
          throw new UnsupportedSchemaError(
            `${m.name}.${f.name}`,
            `引用了 ${ref},而它不出模型 —— 生成的代码会引用一个不存在的类型`,
          )
        }
      }
    }
  }
}

/**
 * 契约里**应当**出模型的 schema 名 —— 覆盖断言的对照基准。
 *
 * ⚠️ ~~与 {@link extractModels} 分开实现是刻意的~~ —— **那句话被证伪过**。
 * 上一版这里抄了一份与 extractModels 内容相同的谓词,而注释说这样能防住
 * 「两边一起漏掉」。**抄一遍不是独立**:JobStatus 同时逃出了两个集合,
 * 覆盖断言拿两个都排除了它的集合互相印证,绿了两个版本。
 *
 * 现在共用 {@link isModelSchema},而真正独立的那条断言是**引用完整性**
 * (extractModels 末尾)—— 它问的是另一个问题,所以才独立。
 */
export function objectSchemaNames(document: Record<string, unknown>): string[] {
  const components = document['components'] as { schemas?: Record<string, SchemaNode> } | undefined
  const schemas = components?.schemas ?? {}
  return Object.keys(schemas)
    .filter((n) => isModelSchema(schemas[n]))
    .sort()
}
