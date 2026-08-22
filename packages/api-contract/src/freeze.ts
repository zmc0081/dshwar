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

/**
 * 全部分类码 —— **运行时可枚举**,不只是一个类型联合。
 *
 * ## 为什么它必须是运行时数组
 *
 * 因为有一条规则要靠它才成立:**每个分类码都得有一条独立的负向验证**。
 * 而「每个」需要一份可遍历的清单 —— 类型联合在运行时不存在,
 * 于是「有没有漏掉一个码」就永远只能靠人记得。
 *
 * `scripts/verify-guards.mjs` 遍历这个数组,逐码植入一次真实变更并确认门禁
 * 的反应符合预期;**表里少一个码就红**。所以往这个数组里加一项,
 * 会立刻逼出对应的负向验证 —— 规则由机制执行,不由自觉执行。
 *
 * ⚠️ **这一条是 V0.8.0 补的,起因是它自己漏了六个码。** 那时负向验证只有
 * `path.removed` 与 `enum.value.removed` 两条(八个 breaking 码里的两个),
 * 而门禁输出的「破坏性 0 处」被全项目当成兼容性的权威判定。
 * 实测:把 `GET /v1/sessions` 的 200 响应体换成 `ErrorResponse` ——
 * 对客户端最大级别的破坏 —— 它报「契约未变」,退出码 0。
 */
export const CONTRACT_CHANGE_CODES = [
  'path.removed',
  'path.added',
  'operation.removed',
  'operation.added',
  'schema.removed',
  'schema.added',
  'property.removed',
  'property.added',
  'property.required.added',
  'property.required.relaxed',
  'property.type.changed',
  'enum.value.removed',
  'enum.value.added',
  'parameter.required.added',
  // ---- V0.8.0 补的四条。补之前它们对应的 8 种破坏性变更全部漏报(实测)。----
  'schema.ref.changed',
  'schema.union.changed',
  'response.removed',
  'response.added',
  'operation.security.changed',
] as const

export type ContractChangeCode = (typeof CONTRACT_CHANGE_CODES)[number]

/** OpenAPI 文档 —— 只声明本模块读的部分。 */
interface OpenApiDocument {
  readonly info?: { readonly version?: string }
  readonly paths?: Record<string, Record<string, unknown>>
  readonly components?: { readonly schemas?: Record<string, JsonSchema> }
}

interface JsonSchema {
  /**
   * ⚠️ **V0.8.0 补的字段,补之前它是全模块最大的盲区。**
   *
   * 本仓的契约用 `$ref` 表达**一切跨类型引用** —— 响应体、请求体、
   * 数组元素、嵌套对象。而这个接口此前没有 `$ref`,于是 `diffSchema`
   * 拿到两个只有 `$ref` 的对象时,看到的是「无 type、无 enum、无 properties、
   * 无 items」,判定**无变更**。
   *
   * 实测:把 `ListSessionsResponse.data[]` 的 `$ref` 从 `Session` 换成
   * `ErrorResponse`,`diffContract` 报「破坏 0 / 共 0」。
   * 而 `components.schemas` 恰恰是大家默认「已经覆盖了」的那一维。
   */
  readonly $ref?: string
  readonly type?: string | string[]
  readonly properties?: Record<string, JsonSchema>
  readonly required?: readonly string[]
  readonly enum?: readonly unknown[]
  readonly items?: JsonSchema
  readonly anyOf?: readonly JsonSchema[]
  readonly oneOf?: readonly JsonSchema[]
  readonly allOf?: readonly JsonSchema[]
}

/** 一个 operation —— 只声明本模块读的部分。 */
interface Operation {
  readonly parameters?: unknown[]
  readonly requestBody?: MediaBearer
  readonly responses?: Record<string, MediaBearer>
  /** 认证要求。本仓每个 operation 恰好一项,由 routes.ts 的 `auth:` 决定。 */
  readonly security?: unknown[]
  /** `planned` | `implemented`。只用来识别「转正」这一次被承诺过的收缩,见 {@link diffResponses}。 */
  readonly 'x-dshwar-status'?: string
}

/** 带 `content` 的东西:requestBody 与每一条 response 都是这个形状。 */
interface MediaBearer {
  readonly content?: Record<string, { readonly schema?: JsonSchema }>
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/**
 * 两侧的 `components.schemas` —— 只为一件事存在:**解引用**。
 *
 * ⚠️ 没有它的话,「把内联结构提取成具名类型」会被判成破坏性变更。
 * 这不是假想:V0.5.5 Session 0 把 `/v1/admin/capacity` 的 200 响应
 * 从内联改成 `$ref: Capacity`,**解引用后与原结构逐字节相同** ——
 * 纯重构。逐提交追溯时这条规则的第一版对它报了 8 处破坏性。
 */
interface RefContext {
  readonly before: Record<string, JsonSchema>
  readonly after: Record<string, JsonSchema>
}

/** `#/components/schemas/Foo` → `Foo`。非本文档内的引用返回 undefined。 */
function refName(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined
  const prefix = '#/components/schemas/'
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined
}

/**
 * 顺着 `$ref` 取到真正的结构。
 *
 * `seen` 防的是 `A → B → A` 这类循环引用 —— 本仓今天没有,
 * 但一个会无限递归的比较器在将来某次契约重构时会**挂掉整条门禁**,
 * 而那种失败看起来像「工具坏了」,不像「契约有问题」。
 */
function deref(
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>,
  seen: ReadonlySet<string> = new Set(),
): JsonSchema {
  const name = refName(schema.$ref)
  if (name === undefined || seen.has(name)) return schema
  const target = schemas[name]
  if (target === undefined) return schema
  return deref(target, schemas, new Set([...seen, name]))
}

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
  const ctx: RefContext = {
    before: a.components?.schemas ?? {},
    after: b.components?.schemas ?? {},
  }

  diffPaths(a.paths ?? {}, b.paths ?? {}, ctx, changes)
  diffSchemas(ctx.before, ctx.after, ctx, changes)

  return changes
}

function diffPaths(
  before: Record<string, Record<string, unknown>>,
  after: Record<string, Record<string, unknown>>,
  ctx: RefContext,
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
        const where = `paths.${path}.${method}`
        const beforeOp = beforeOps[method] as Operation
        const afterOp = afterOps[method] as Operation
        diffParameters(beforeOp, afterOp, where, changes)
        diffSecurity(beforeOp, afterOp, where, changes)
        // ⚠️ 下面两行是 V0.8.0 补的。补之前 operation 只比 parameters ——
        // 也就是说**请求体与响应体一个字节都不看**。实测:把 200 响应体
        // 换成 ErrorResponse(对客户端最大级别的破坏),报「契约未变」、退出码 0。
        diffBody(beforeOp.requestBody, afterOp.requestBody, `${where}.requestBody`, ctx, changes)
        diffResponses(
          beforeOp.responses ?? {},
          afterOp.responses ?? {},
          where,
          // 「planned 转正」是契约先行策略**承诺过**会发生的收缩,见 diffResponses。
          beforeOp['x-dshwar-status'] === 'planned' && afterOp['x-dshwar-status'] === 'implemented',
          ctx,
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

/**
 * 响应码的增删,以及每个共有响应码的响应体。
 *
 * ## 为什么「删掉一个已声明的响应码」是破坏性的
 *
 * 因为客户端**按响应码分支**。契约里声明过 404,调用方就可能写了
 * 「404 → 提示资源不存在」;把 404 从契约里删掉意味着这条分支从此
 * 要么是死代码,要么服务端仍会返回它而契约不再承认 —— 两种都是坏的。
 *
 * ⚠️ 与 `enum.value.removed` 是同一条道理:**闭集的收缩总是破坏性的**,
 * 哪怕收缩的是「错误」而不是「数据」。
 *
 * 新增响应码则相容 —— 本仓 V0.8.0 把 `/v1/jobs` 三条标成 planned 时
 * 各加了一个 501,那是正当演进,不该被拦。
 *
 * ## ★ 唯一的豁免:「planned 转正」时那个 501
 *
 * `planned` 端点按契约必须宣告 501;转成 `implemented` 时那个 501 消失。
 * **这是契约先行策略明确承诺过会发生的收缩**,不该要求升大版 ——
 * 否则每一次「兑现承诺」都变成一次破坏性变更,而那会让整个策略无法运转。
 *
 * ⚠️ 豁免的范围钉得很死:**必须同时**满足 `x-dshwar-status` 由 `planned`
 * 变 `implemented`、且被删的**就是 501**。同一次转正里若还删了别的响应码
 * (比如 404),那一条照样判破坏。
 *
 * ⚠️ **这个豁免是追溯实测逼出来的,不是设计时想到的。** 拿当前契约与
 * V0.2.0 首冻基线比,本条规则第一版报了 8 处破坏性 —— 逐条核实后,
 * 8 处**全部**是 Admin 端点 planned→implemented 时掉的那个 501,
 * 而且八个版本里没有任何**其它**响应码被删过。
 *
 * 也就是说:历史演进是干净的,报红的是规则自己。
 * 顺带订正一处旧注释:`routes.ts` 在 `listSubjects` 上写着转正时
 * 「**只有** `x-dshwar-status` 扩展消失」—— 那句话不完整,501 也一起消失了。
 */
function diffResponses(
  before: Record<string, MediaBearer>,
  after: Record<string, MediaBearer>,
  where: string,
  promotedFromPlanned: boolean,
  ctx: RefContext,
  changes: ContractChange[],
): void {
  for (const code of Object.keys(before)) {
    if (!(code in after)) {
      const sanctioned = promotedFromPlanned && code === '501'
      changes.push({
        kind: sanctioned ? 'additive' : 'breaking',
        code: 'response.removed',
        where: `${where}.responses.${code}`,
        detail: sanctioned
          ? 'planned 转正,501 随之消失 —— 契约先行策略承诺过的收缩,不升大版'
          : '已声明的响应码被删除 —— 按它分支的客户端要么变死代码,要么撞上契约不承认的响应',
      })
      continue
    }
    diffBody(before[code], after[code], `${where}.responses.${code}`, ctx, changes)
  }

  for (const code of Object.keys(after)) {
    if (code in before) continue
    changes.push({
      kind: 'additive',
      code: 'response.added',
      where: `${where}.responses.${code}`,
      detail: '新增响应码',
    })
  }
}

/**
 * 一个带 `content` 的东西(requestBody 或一条 response)的正文比对。
 *
 * 逐 media type 比。整块 `content` 的出现/消失不单独立码 ——
 * 它在实践中总是伴随 operation 或 response 的增删,那两条已经报了;
 * 单独立一个码会让同一次变更报两遍,而重复的告警会训练人去忽略告警。
 */
function diffBody(
  before: MediaBearer | undefined,
  after: MediaBearer | undefined,
  where: string,
  ctx: RefContext,
  changes: ContractChange[],
): void {
  const beforeContent = before?.content ?? {}
  const afterContent = after?.content ?? {}

  for (const media of Object.keys(beforeContent)) {
    const b = beforeContent[media]?.schema
    const a = afterContent[media]?.schema
    if (b === undefined || a === undefined) continue
    diffSchema(b, a, `${where}.${media}`, ctx, changes)
  }
}

/**
 * operation 的认证要求变了。
 *
 * ## 两个方向都要显式声明,理由不同
 *
 * | 变化 | 后果 |
 * | --- | --- |
 * | 换方案(`runtimeBearer` → `adminApiKey`) | 该端点的**全部**调用方立刻 401 |
 * | 变成 `[]`(公开) | 不打断任何客户端,但**把一个端点开给了全世界** |
 *
 * 第二种不是「破坏客户端」,可它更该被人看见。本模块里 `breaking` 的
 * 实际含义是「**需要显式声明**」(见 {@link ContractChange.kind} 的说明),
 * 而「某个端点从此不需要认证了」正是最该被显式声明的那一类。
 *
 * ⚠️ 这条与 `gateway/test/auth-coverage.test.ts` **不重叠**:
 * 那条盯的是**网关中间件**有没有挂上,是运行时;这条盯的是**契约文档**
 * 说了什么。两者分家的场景很具体 —— 有人改了契约却没改中间件(或反过来),
 * 那时文档与实现开始互相打架,而两边各自的检查都是绿的。
 */
function diffSecurity(
  before: Operation,
  after: Operation,
  where: string,
  changes: ContractChange[],
): void {
  const norm = (list: unknown[] | undefined) =>
    list === undefined ? undefined : JSON.stringify([...list.map((x) => JSON.stringify(x))].sort())

  const b = norm(before.security)
  const a = norm(after.security)
  if (b === a) return

  changes.push({
    kind: 'breaking',
    code: 'operation.security.changed',
    where: `${where}.security`,
    detail: `认证要求由 ${b ?? '(未声明)'} 改为 ${a ?? '(未声明)'} —— 换方案会让全部调用方 401,改成 [] 则是把端点开给所有人`,
  })
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
  ctx: RefContext,
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
    diffSchema(before[name]!, after[name]!, `components.schemas.${name}`, ctx, changes)
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
  ctx: RefContext,
  changes: ContractChange[],
): void {
  // ★ 先解引用。两侧都是 $ref 时只比引用名(内容由 components.schemas 那一遍去比);
  //   一侧 $ref、一侧内联时,**解开来按结构比** —— 否则「把内联提取成具名类型」
  //   这种纯重构会被判成破坏性变更。
  if (diffRef(before, after, where, changes)) return
  const b = deref(before, ctx.before)
  const a = deref(after, ctx.after)

  diffUnion(b, a, where, changes)

  if (b.type !== undefined && a.type !== undefined) {
    const beforeType = JSON.stringify(b.type)
    const afterType = JSON.stringify(a.type)
    if (beforeType !== afterType) {
      changes.push({
        kind: 'breaking',
        code: 'property.type.changed',
        where,
        detail: `类型由 ${beforeType} 改为 ${afterType}`,
      })
    }
  }

  diffEnum(b, a, where, changes)

  const beforeProps = b.properties ?? {}
  const afterProps = a.properties ?? {}
  const beforeRequired = new Set(b.required ?? [])
  const afterRequired = new Set(a.required ?? [])

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
    diffSchema(beforeProps[key]!, afterProps[key]!, `${where}.${key}`, ctx, changes)
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

  if (b.items !== undefined && a.items !== undefined) {
    diffSchema(b.items, a.items, `${where}[]`, ctx, changes)
  }
}

/**
 * `$ref` 指向变了 —— 那一处的类型换了一个,**内容像不像不重要**。
 *
 * ## 为什么按字符串比,不解引用后比结构
 *
 * 两个理由,第二个更重要:
 *
 * 1. 解引用要处理循环引用,而本仓的契约里 `Job` ↔ `Workspace` 这类
 *    互相引用是可能出现的 —— 为一条判定引入图遍历不划算。
 * 2. **引用的名字本身就是契约的一部分。** 三种 SDK 都拿 schema 名当
 *    生成的类型名(`Session` → `data class Session` / `struct Session`),
 *    所以改名对调用方**就是**破坏性的,哪怕字段一个没动。
 *
 * ⚠️ 顺带说明为什么这不会制造误报:一次**重命名**(A → B,内容不变)
 * 本来就已经被 `schema.removed` 报成破坏性了。这条只是让它在**引用点**
 * 也可见,不引入新的拦截面。
 *
 * ## 一侧具名、一侧内联:解引用后按结构比,相同就不算变更
 *
 * 「把内联结构提取成具名类型」是纯重构 —— 生成出来的 SDK 会多一个具名类型,
 * 但字段一个没动。V0.5.5 Session 0 对 `/v1/admin/capacity` 的 200 响应
 * 正是这么做的,**解引用后与原结构逐字节相同**。
 * 本条规则的第一版把它判成了 8 处破坏性 —— 逐提交追溯时抓到的。
 */
function diffRef(
  before: JsonSchema,
  after: JsonSchema,
  where: string,
  changes: ContractChange[],
): boolean {
  // 两侧都是具名引用 —— 只比名字。相同则这一处无事(内容由 components.schemas
  // 那一遍去比,在这里再比一次会让同一个差异报两遍)。
  if (before.$ref !== undefined && after.$ref !== undefined) {
    if (before.$ref === after.$ref) return true
    changes.push({
      kind: 'breaking',
      code: 'schema.ref.changed',
      where,
      detail: `引用由 ${before.$ref} 改为 ${after.$ref}`,
    })
    return true
  }

  // 一侧具名、一侧内联 —— 交给调用方解引用后按结构比,这里不下结论。
  return false
}

/**
 * `anyOf` / `oneOf` / `allOf` 的分支集合变化。
 *
 * ## 为什么两个方向都判破坏
 *
 * 因为**同一个 schema 既可能出现在请求里,也可能出现在响应里**,
 * 而两侧的方向恰好相反:
 *
 * | | 加一个分支 | 减一个分支 |
 * | --- | --- | --- |
 * | 请求侧 | 放宽,相容 | 收紧,**破坏** |
 * | 响应侧 | 客户端要处理新形状,**破坏** | 客户端的分支变死代码,相容 |
 *
 * 无从在这里知道自己在哪一侧 —— 这与 `property.required.added` /
 * `property.required.relaxed` 的处境完全相同(见那两处的注释),
 * 所以沿用同一条策略:**按更保守的一边判**。
 *
 * ⚠️ 这条最常触发的真实场景是**给字段加可空**:本仓用
 * `anyOf: [{type:'string'},{type:'null'}]` 表达可空,所以
 * 「把响应里某个字段改成可空」会被判破坏 —— **那是对的**:
 * 无条件读它的客户端会拿到 null。想这么改就显式声明并升版本,
 * 这正是契约冻结检查存在的意义。
 *
 * 比较用**集合**而非序列:生成器重排分支顺序不该算变更。
 */
function diffUnion(
  before: JsonSchema,
  after: JsonSchema,
  where: string,
  changes: ContractChange[],
): void {
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const b = before[key]
    const a = after[key]
    if (b === undefined && a === undefined) continue

    const beforeSet = new Set((b ?? []).map((s) => JSON.stringify(s)))
    const afterSet = new Set((a ?? []).map((s) => JSON.stringify(s)))

    const removed = [...beforeSet].filter((s) => !afterSet.has(s))
    const added = [...afterSet].filter((s) => !beforeSet.has(s))
    if (removed.length === 0 && added.length === 0) continue

    changes.push({
      kind: 'breaking',
      code: 'schema.union.changed',
      where: `${where}.${key}`,
      detail:
        `${key} 分支集合变了(去掉 ${removed.length} 个,新增 ${added.length} 个)—— ` +
        '请求侧与响应侧方向相反,按保守的一边判',
    })
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
