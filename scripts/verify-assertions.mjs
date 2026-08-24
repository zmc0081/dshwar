#!/usr/bin/env node
/**
 * 断言有效性探针 —— V0.4.6 的核心产出。
 *
 * ## 它回答的问题
 *
 * `pnpm test` 全绿证明什么?**只证明测试没报错。** 它不证明测试在实现坏掉时
 * 会报错 —— 而后者才是测试的全部价值。一条永远绿的断言与没有断言等价,
 * 但更危险:它让人以为有覆盖。
 *
 * 本脚本**故意弄坏东西,确认对应的测试真的变红**,然后还原。
 *
 * ## 三类探针,缺一不可
 *
 * V0.4.6 之前踩过的坑正好分三类,每一类现有测试都照不到:
 *
 * 1. **弄坏实现** —— 最直觉的一类。把 `agent.cancel()` 改成空实现之类。
 * 2. **弄坏夹具** —— ★ 被测对象没坏,是**喂给它的东西**坏了。
 *    `pool.test.ts` 用 `Parameters<typeof Supervisor.prototype.constructor>[0]`
 *    做选项类型,而 `Supervisor.prototype.constructor` 的类型是 `Function`,
 *    `Parameters<Function>` 不给任何约束 —— 于是 37 条测试里凡走 `make({...})`
 *    传选项的,**选项名从未被校验过**。只弄坏实现的探针照不到这一整类。
 * 3. **作用域** —— ★ 在**真实时序下**调用被测对象,而不是在测试里直接调。
 *    `fs-tenant` 有 18 处工作区断言全绿,而 agent 执行时的落点是
 *    `anonymous/anonymous/` —— 因为那些测试都在 HTTP 作用域里直接调。
 *
 * ## 刻意不做全量变异测试
 *
 * 投入产出比不划算,且会把 CI 拖到分钟级。这里只挑**核心断言**下手:
 * 取消、隔离、配额、契约,外加上面三类各自的代表。
 *
 * ## 实现方式:改真文件,finally 还原
 *
 * 不用模块 mock —— mock 掉的是测试看到的东西,而这里要弄坏的恰恰是
 * **产品代码**。备份 → 篡改 → 跑测试 → 无条件还原。
 *
 * 退出码:全绿 0,任一探针没能让测试变红 1。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTestsUnderMutation, runVitest, withMutatedFiles } from './lib/mutate.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** @param {...string} seg */
const p = (...seg) => join(REPO, ...seg)

/**
 * 一次探针的结果。
 *
 * ⚠️ `unchanged` **必须出现在每个分支上**,哪怕是 `false`。
 * 之前它只在「锚点没匹配上」那一支里有,于是别处读 `r.unchanged` 拿到的是
 * `undefined` —— 运行时恰好等价,但类型上是不健全的,而**它的后果是诊断信息挑错**:
 * 锚点腐烂时会打印「测试竟然还是绿的」而不是「锚点没匹配上」,
 * 把一个工具问题伪装成一个测试问题。
 * 这个错误是根 `scripts/` 首次纳入类型检查时抓出来的(V0.4.7)。
 *
 * @typedef {{ red: boolean, unchanged: boolean, output?: string }} ProbeResult
 */

/**
 * 跑一组测试,只关心红还是绿。**仅用于基线**(未变异时)。
 *
 * 变异期间不要用它 —— 走 {@link withMutation},那条路会同步 dist。
 * 拉起 vitest 的实现收在 `lib/mutate.mjs`,本文件不自己拼路径:
 * 那条不变式由 `check-guards.mjs` 守着,见该守卫的说明。
 *
 * @param {...string} targets
 * @returns {ProbeResult}
 */
function runTests(...targets) {
  return runVitest(targets)
}

/** @type {{name: string, passed: boolean}[]} */
const results = []
/**
 * @param {string} name
 * @param {boolean} passed
 * @param {string} [detail]
 */
function expect(name, passed, detail) {
  results.push({ name, passed })
  console.log(`  ${passed ? '通过' : '失败'}  ${name}`)
  if (!passed && detail) console.log(`        ${detail}`)
}

/**
 * 篡改一个文件、跑测试、无条件还原。
 *
 * ⚠️ **锚点是源码的精确字符串匹配,所以 Prettier 一改排版它就失配。**
 * 首次 CI(2026-08-16)正是这么暴露的:`check:all` 当时没有 `format:check`,
 * 于是本地长期带着未格式化的源码全绿;补跑 `pnpm format` 之后 Prettier
 * 把 `packages/policy` 里的一个三元折成一行,探针 3 的锚点当场失配。
 *
 * **这不是设计缺陷,是它按设计工作了**:`unchanged` 被判为**失败**而不是通过,
 * 所以锚点腐烂会立刻显形,而不会变成一条永远「通过」的空探针 ——
 * 后者恰恰是本脚本存在的理由。
 *
 * 根因已经堵上:`format:check` 进了 `check:all`,源码不再可能处于未格式化状态。
 *
 * @param {string} rel 仓库相对路径
 * @param {(source: string) => string} mutate 篡改函数
 * @param {string[]} targets 要跑的测试
 * @returns {ProbeResult}
 */
function withMutation(rel, mutate, targets) {
  const target = p(rel)

  // 先判「锚点匹配上了没有」再动文件 —— 没匹配上就完全不碰磁盘。
  const source = readFileSync(target, 'utf8')
  if (mutate(source) === source) {
    return { red: false, unchanged: true }
  }

  // ⚠️ 还原走 scripts/lib/mutate.mjs,不用 copyFileSync + .probebak。
  // 2026-08-16 实测:Windows 上还原那一步的 copyFileSync 会抛 UNKNOWN(-4094),
  // 把 openapi.json 留在篡改状态且不报告 —— 详见该模块的说明。
  //
  // ★ 2026-08-17:改走 runTestsUnderMutation —— 它在变异生效后**同步 dist**。
  // 不同步的话,跨包消费方读到的是未变异的 dist,「没变红」于是有两种含义
  // (断言弱 / 根本没测到),而两者在输出里一模一样。见该函数的说明。
  const r = runTestsUnderMutation([{ path: target, mutate }], targets)
  if (!r.built && !r.red) {
    // 构建没成功 **且** 测试还绿 —— 这个组合无法区分「断言弱」与「dist 是旧的」,
    // 所以不许它冒充通过。类型层探针(故意制造编译错误)不会走到这里:
    // 它们跑的是 tsc 而不是 vitest。
    return { red: false, unchanged: false, output: 'dist 同步失败,本次结论不可信' }
  }
  return r
}

console.log('DSHWAR · 断言有效性探针\n')

// 基线必须是绿的 —— 否则后面所有「红」都说明不了问题
{
  const baseline = runTests()
  if (baseline.red) {
    console.log('基线不干净:未植入任何破坏时测试就已经红。')
    console.log('先修好 pnpm test,再跑本脚本。')
    process.exit(1)
  }
}

// ===========================================================================
// 第一类:弄坏实现
// ===========================================================================

// 1. 取消 —— 把跨进程句柄的 cancel 改成空实现
{
  const r = withMutation(
    'gateway/src/sessions/remote.ts',
    (s) => s.replace('cancel: () => lease.cancel(),', 'cancel: () => {},'),
    ['gateway/test/cross-process-driving.test.ts'],
  )
  expect(
    '1 取消失效 → 取消测试变红',
    r.red,
    r.unchanged ? '锚点没匹配上,探针没生效' : '把 cancel 改成空实现,测试竟然还是绿的',
  )
}

// 2. 隔离 —— 把路径钉死去掉一段(工作区维度)
{
  const r = withMutation(
    'packages/fs-tenant/src/path.ts',
    (s) =>
      s.replace('resolvePath(root, tenant, user, workspace)', 'resolvePath(root, tenant, user)'),
    ['packages/fs-tenant'],
  )
  expect(
    '2 路径少钉一段 → 隔离测试变红',
    r.red,
    r.unchanged ? '锚点没匹配上' : '工作区维度被去掉,fs-tenant 的测试竟然还是绿的',
  )
}

// 3. 配额 —— 精确判定改成永远放行
{
  const r = withMutation(
    'packages/policy/src/index.ts',
    (s) =>
      s.replace(
        "return exhausted ? { kind: 'deny', reason: 'quota_exhausted', quota } : { kind: 'allow', quota }",
        "return { kind: 'allow', quota }",
      ),
    ['packages/policy'],
  )
  expect(
    '3 配额永远放行 → 配额测试变红',
    r.red,
    r.unchanged ? '锚点没匹配上' : '配额判定永远 allow,policy 的测试竟然还是绿的',
  )
}

// 4. 准入 —— 同步的 admit 改成永远放行(V0.4.6 Session 2)
{
  const r = withMutation(
    'packages/policy/src/index.ts',
    (s) =>
      s.replace(
        "    if (snapshot !== undefined && snapshot.exhausted && now - snapshot.at < ttl) {\n      return { kind: 'deny', reason: 'quota_exhausted' }\n    }",
        '    // probe',
      ),
    // ⚠️ **只跑 packages/policy。** 这里原本还挂着 `gateway/test/isolation.test.ts`,
    // 而那是一条**空跑** —— V0.6.5 收官审计逐目标实测:它在「不构建」与
    // 「先构建」两种条件下**都绿**。两个原因叠在一起:
    //   1. isolation.test.ts 注入的是 policy 的 **stub**(`admit: () => allow`),
    //      根本不经过真实的 PolicyService —— 改 policy 的实现它当然照不到
    //   2. 即便它用真实实现,跨包 import 读的也是 dist(见 lib/mutate.mjs)
    // 而整条探针一直报「通过」,因为 packages/policy 那一半真的红了 ——
    // **一个目标的红把另一个目标的空跑盖住了**。
    // 教训:一条探针挂多个目标时,红是「或」,而空跑的那个不会显形。
    ['packages/policy'],
  )
  expect(
    '4 准入永远放行 → 准入测试变红',
    r.red,
    r.unchanged ? '锚点没匹配上' : '准入永远 allow,而「配额耗尽建不了会话」竟然还绿',
  )
}

// ===========================================================================
// 第二类:弄坏夹具 —— 被测对象没坏,是喂给它的东西坏了
// ===========================================================================

// ⚠️ **两条被撤下的探针,理由记在这里。**
//
// 最初写的是「把假模型的 finish reason 改成字符串」与「让假模型不再遵守
// signal」—— 都实测**不会**让任何测试变红。查清之后发现是**探针的前提错了**,
// 不是测试有洞:
//
// - finish reason:全仓没有任何代码读 `finish` chunk 的 `reason`。
//   `turn.completed.reason` 来自 `turn/end` 的 `cancelled` 字段(见
//   `gateway/src/sessions/events.ts`)。那个形状错误由**类型检查**覆盖
//   (`b635a2d` 正是这么抓到的),运行时没有可断言的行为。
// - signal:agent loop 自己会在取消后停止消费流,所以适配器遵不遵守 signal
//   在端到端层面看不出差别。
//
// **教训**:写「弄坏夹具」类探针时,必须先确认那个属性**在下游真的有后果**。
// 否则探针会一直红,而红的原因是它自己没道理 —— 那比没有探针更浪费人。
// 这与 V0.4.6 Session 0 里「在根 ctx 上读 principal」是同一类错误。
//
// 换成两条前提已验证的:

// 5. 假模型少吐一个 token —— 正文断言必须变红
{
  const r = withMutation(
    'gateway/test/harness.ts',
    (s) =>
      s.replace(
        "const tokens = this.options.tokens ?? ['你好', ',', '世界']",
        "const tokens = (this.options.tokens ?? ['你好', ',', '世界']).slice(0, -1)",
      ),
    ['gateway/test/runtime-api.test.ts'],
  )
  expect(
    '5 假模型少吐一个 token → 正文断言变红(弄坏夹具类)',
    r.red,
    r.unchanged ? '锚点没匹配上' : '假模型少吐一个 token,而正文断言竟然还是绿的',
  )
}

// 6. 假模型不再吐推理增量 —— reasoning 的两个方向都必须变红
//    (`includeReasoning: true` 时该出现、false 时该被过滤)
{
  const r = withMutation(
    'gateway/test/harness.ts',
    (s) =>
      s.replace('for (const think of this.options.reasoning ?? []) {', 'for (const think of []) {'),
    ['gateway/test/runtime-api.test.ts'],
  )
  expect(
    '6 假模型不吐推理增量 → reasoning 断言变红(弄坏夹具类)',
    r.red,
    r.unchanged ? '锚点没匹配上' : '假模型不再吐推理增量,而 reasoning 测试竟然还是绿的',
  )
}

// 8. principal 抵达 agent 执行层(V0.4.7)—— 根上 provide 错值
//    这一条同时属于「弄坏实现」与「作用域」两类:它弄坏的是实现,
//    但只有在**真实时序下**(HTTP → 网关 → 子进程 → 适配器)才照得到。
//
//    ★ V0.6.0 改了变异方式:此前是「整个拿掉 provide」,但 current() 现在
//    对未绑定**抛** —— 拿掉 provide 会让冒烟因抛错变红,红的是新机制,
//    不是本探针要照的「principal 静默没抵达执行层」。所以变异改成
//    provide 了但提供错值(ANONYMOUS 顶替真实 principal):不抛、
//    fs-tenant 静默落进 anonymous/anonymous/ —— 这才是 V0.4.7 那个
//    bug 的形状,冒烟必须靠租户目录断言而非异常来抓住它。
{
  const r = withMutation(
    'gateway/src/runtime.ts',
    (s) =>
      s.replace(
        'ctx.provide(PRINCIPAL_BINDING, options.principal ?? ANONYMOUS)',
        'ctx.provide(PRINCIPAL_BINDING, ANONYMOUS)',
      ),
    ['gateway/test/real-path-smoke.test.ts'],
  )
  expect(
    '8 根上 provide 错值(ANONYMOUS 顶替真实 principal)→ 真实路径冒烟变红',
    r.red,
    r.unchanged ? '锚点没匹配上' : '★ 进程档下 principal 不再抵达执行层,而端到端冒烟竟然还是绿的',
  )
}

// 14. ★ **跨包探针 —— 同时验证「变异通路自己在同步 dist」**(V0.6.5 收官审计)
//
//     这一条守的东西比它表面上多一层:
//
//     - 表层:拆掉离线可达性判定,网关的降级 e2e 必须变红
//     - **里层:它是 `runTestsUnderMutation` 里 `syncDist()` 的唯一验证者**
//
//     gateway 的测试经 `@dshwar/llm-local` 消费 dist。若哪天有人把
//     `syncDist()` 从变异通路里拿掉,这条探针会**立刻变绿而报失败** ——
//     那正是 2026-08-17 实测过的形态:同一个变异,不构建时 e2e 绿,
//     构建后才红。
//
//     ⚠️ 所以本条**不能**换成同包目标(packages/llm-local 自己的测试)。
//     换了之后表层断言照样过,而里层的验证会静默消失 ——
//     那恰恰是本次收官审计要根除的那种「看起来在验证」。
{
  const r = withMutation(
    'packages/llm-local/src/offline.ts',
    (s) =>
      s.replace(
        '    const doFetch = this.options.fetchImpl ?? fetch',
        '    return true\n    const doFetch = this.options.fetchImpl ?? fetch',
      ),
    ['gateway/test/offline-fallback.test.ts'],
  )
  expect(
    '14 拆掉离线可达性判定 → 网关降级 e2e 变红(★ 同时验证变异通路在同步 dist)',
    r.red,
    r.unchanged
      ? '锚点没匹配上'
      : '★ 跨包变异没能让 e2e 变红 —— 要么降级断言失效,要么 syncDist 没在同步 dist(后者会让全部跨包探针的结论不可信)',
  )
}

// 15. ★ 卖方未配置时**拒绝出票**,而不是静默降级(V0.6.5 收官)
//
//     这条断言的价值全在「拒绝」两个字上。一个「回落到占位卖方」的实现
//     会让 `expect(invoice.seller).toBeTruthy()` 那种写法**照常通过** ——
//     而它出去的是一张看起来正常、卖方栏是占位符的发票。
//
//     ⚠️ **故障会落在谁头上,决定了这条该怎么写**:拒绝出票 → 我们的运维
//     当场看到「未配置卖方」;静默降级 → 客户的会计把它当成**数据错误**,
//     进对账差异、进人工核查队列,而根因离配置文件已经很远了。
//
//     所以变异植入的正是那种「看起来更友好」的实现。
{
  const r = withMutation(
    'packages/billing-local/src/service.ts',
    (s) =>
      s.replace(
        '    assertSellerConfigured(this.options.seller, SELLER_CONFIG_PATH)',
        "    const _fallback = this.options.seller ?? { legalName: '(未配置)', taxId: null, address: null }\n    void _fallback",
      ),
    ['packages/billing-local/test/seller.test.ts'],
  )
  expect(
    '15 卖方未配置改成静默降级 → 拒绝出票的断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上'
      : '★ 未配置卖方竟然出得了票 —— 那张发票会被客户的会计当成数据错误,而不是被报成配置错误',
  )
}

// 16-18. ★ SDK 与契约的同步 —— **三种语言各一条,不合并**(V0.8.0)
//
//     「改了契约没重新生成 SDK」在 V0.5.0 期间被抓到过一次,那时只有 TS SDK。
//     现在是三种语言,**同一个漏洞面各有一份**。
//
//     ⚠️ **为什么不写成一条循环三个目标的探针**:CLAUDE.md 的「一条探针一个
//     目标」—— 多目标时红是「或」,一个目标的红会盖住另一个的空跑。
//     Kotlin 的渲染器会不会红,与 TS 的渲染器会不会红**没有任何关系**。
//
//     变异改的是**契约本身**,不是渲染器 —— 那才是真实的失败形态:
//     有人改了 Zod schema、跑了 api-contract 的 generate,却忘了跑 SDK 的。
{
  /** @type {[number, string, string][]} */
  const sdks = [
    [16, 'TS', 'sdk/typescript/test/generated.test.ts'],
    [17, 'Kotlin', 'sdk/kotlin/test/generated.test.ts'],
    [18, 'Swift', 'sdk/swift/test/generated.test.ts'],
  ]
  for (const [n, lang, target] of sdks) {
    const r = withMutation(
      'packages/api-contract/openapi.json',
      (s) => {
        const doc = JSON.parse(s)
        doc.components.schemas.Session.properties.stowawayField = { type: 'string' }
        return `${JSON.stringify(doc, null, 2)}\n`
      },
      [target],
    )
    expect(
      `${n} 契约加字段而 ${lang} SDK 未重新生成 → 同步断言变红`,
      r.red,
      r.unchanged
        ? '锚点没匹配上'
        : `★ ${lang} SDK 与契约脱节竟然没被发现 —— 调用方会拿到过期类型,而它编译得过`,
    )
  }
}

// 19. ★ 出厂装配 —— 把 `workbenchRoutes` 那一行从 server.ts 拿掉(V0.8.0)
//
//     这是**第四次同一转向**的负向验证(CLAUDE.md 第六节那张表的第 4 行):
//     判据从「组件能不能装配」挪到「**出厂到底装了什么**」。
//
//     被拿掉的这一行,在仓库里**本来就是缺的,缺了三个版本**:
//     `registerWorkspaceRoutes` 从 V0.5.5 起实现完整、单测齐全,而
//     `server.ts` 从不传它 —— 七条 `/v1/workspaces*` 在真实部署里全部 404,
//     **一道红都没有**。因为工作台测试自己手工调 `createGateway` 把它挂上去。
//
//     ⚠️ 所以这条探针问的不是「工作区端点能不能工作」(那有 workspaces.test.ts),
//     而是「**出厂的 startServer 挂没挂它**」—— 只有 shipped-assembly.test.ts
//     调出厂入口,所以它是唯一目标(CLAUDE.md「一条探针一个目标」)。
//
//     变异后 `workspaces` 与两个 import 变成未使用 → tsc 会失败。
//     那是**预期内**的:目标测试 import 的是 `../src/server.ts`(同包相对路径),
//     不经过 dist,所以构建失败不影响结论;而 `withMutation` 只在
//     「构建失败**且**测试还绿」时才拒绝下结论。
{
  const r = withMutation(
    'gateway/src/server.ts',
    // anchor 到属性名 + 4 空格缩进的收尾,而不是整块字面量 ——
    // 后者被 Prettier 重排注释宽度就会失配,而失配是静默的(报「锚点没匹配上」)。
    (s) => s.replace(/ {4}workbenchRoutes: registerWorkspaceRoutes\(\{[\s\S]*?\n {4}\}\),\n/, ''),
    ['gateway/test/shipped-assembly.test.ts'],
  )
  expect(
    '19 出厂网关不再装配工作台路由 → 出厂装配断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— server.ts 里的 workbenchRoutes 块换了形状,先修锚点'
      : '★ 出厂网关少挂了七条已实现的端点,竟然没被发现 —— ' +
          '这正是它守的那个 bug 本身,而它没守住',
  )
}

// 20-21. ★ 落账审计的**两个方向** —— 漏报与多报(V0.8.0)
//
//     「钱到账、发票转 paid」在合规审查里必须有时间线。V0.8.0 之前
//     `markPaid` 的注释写着「原样落进发票与审计」,而三个 billing 包里
//     一次审计写入都没有 —— 已兑现的前半句掩护了未兑现的后半句。
//
//     ⚠️ **为什么要两条而不是一条**:一个「每次调用都通报」的实现能通过
//     「applied 有通报」那条断言,却会在 Stripe 每次重试时都记一笔收款 ——
//     审计里出现 N 笔不存在的钱。**多报比漏报更难发现**:漏报时审计是空的,
//     一眼看得出;多报时审计满满当当,看起来比正确实现还认真。
//
//     两条各一个目标(同一个测试文件),不合并成「或」。
{
  // 20. 漏报:通报整块删掉
  const r = withMutation(
    'packages/billing-stripe/src/webhook.ts',
    (s) => s.replace(/\n {2}input\.onApplied\?\.\(\{[\s\S]*?\n {2}\}\)/, ''),
    ['packages/billing-stripe/test/webhook.test.ts'],
  )
  expect(
    '20 落账不再通报 → 「applied 恰好一条」的断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— processStripeEvent 里的通报块换了形状'
      : '★ 钱到账、发票转 paid,审计里一条都没有,竟然没被发现',
  )
}

{
  // 21. 多报:在 already-paid 分支上也通报(账本一个字节都没改的那条路径)
  const r = withMutation(
    'packages/billing-stripe/src/webhook.ts',
    (s) =>
      s.replace(
        "        // ★ 刻意不通报:账本一个字节都没改。见 onApplied 的说明。\n        return 'already-paid'",
        '        input.onApplied?.({\n' +
          '          provider: STRIPE_PROVIDER,\n' +
          '          tenantId,\n' +
          '          invoiceId,\n' +
          '          paymentRef: intentId,\n' +
          '          eventId: event.id,\n' +
          '          totalMinor: current.totalMinor,\n' +
          '          currency: current.currency,\n' +
          '        })\n' +
          "        return 'already-paid'",
      ),
    ['packages/billing-stripe/test/webhook.test.ts'],
  )
  expect(
    '21 already-paid 也通报 → 「另外三条路径保持为空」的断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— already-paid 分支换了形状'
      : '★ 重复记账没被发现 —— 这正是「只验有通报、不验没多报」会漏掉的那一半',
  )
}

// 22. ★ 未配置的主色被兜底成一个颜色(V0.9.0 Session 5)
//
//     运行期主题是白牌的落点:安装包中性,租户配置由服务端下发、前端写进
//     CSS 自定义属性。而这条链上最容易悄悄坏掉的是**未配置态**:
//     `applyAccent(null, …)` 只要随手派生一个兜底色,V0.8.0 那次
//     「哨兵默认色 → string | null」的类型层区分就被完全抵消 ——
//     类型上仍然分开,渲染上又合并了。
//
//     ⚠️ 它坏掉时**没有任何现成信号**:界面上只是多了一点颜色,而客户会以为
//     那就是平台的样子。`check-guards.mjs` 那条 `primaryColor ??` 守卫按文本形状扫,
//     拦不住「判空判在函数里、但判完还是派生了」这种形态。
//
//     变异后 `derive(seed ?? '', …)`:空种子经 derive 自己的兜底回落到 #3A5CCC,
//     于是「未配置时一个属性都不写」那条断言必须变红。
{
  const r = withMutation(
    'packages/design-system/src/accent/apply.ts',
    (s) =>
      s.replace(
        "  if (seed === null || seed === '') {\n" +
          '    clearAccent(el)\n' +
          '    return null\n' +
          '  }\n' +
          '  const d = derive(seed, 4.5, theme)',
        "  const d = derive(seed ?? '', 4.5, theme)",
      ),
    ['packages/design-system/test/apply-accent.test.ts'],
  )
  expect(
    '22 未配置的主色被兜底成一个颜色 → 「一个属性都不写」的断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— applyAccent 里的判空块换了形状,先修锚点'
      : '★ 客户没配主色,界面上却出现了一个他没选过的颜色,而断言竟然还是绿的',
  )
}

// 23. ★ 给 Tauri 一个别的宿主没有的开关(V0.9.0 Session 5)
//
//     Session 5 的验收原话是「同一份前端产物在三个宿主下跑通,**差别只有 baseURL**」。
//     那句话本身不可执行 —— 它描述的是一个不变式,而不变式若没有落点,
//     只会在某次「给 Tauri 加个开关」的提交里悄悄失效:三个宿主分家的过程
//     没有任何一步是显眼的,每一步都只是「这里特殊一点」。
//
//     ⚠️ 这条探针问的**不是**「hostConfig 返回值对不对」——
//     那是 `hosts.test.ts` 里别的用例的事。它问的是那条**同构断言**
//     在真的分家时会不会红。没有它,「三份配置逐字段相同」与
//     「三个对象碰巧长得一样」在输出上没有区别。
//
//     变异挑 `authScopes` 而不是塞一个新字段:新字段会撞上 TS 的
//     多余属性检查,变成一条**类型层**的红 —— 那证明的是 tsc 在工作,
//     不是那条断言在工作。多要一个 scope 类型完全合法,
//     而它恰恰是「桌面端多需要一点权限」这个最容易被写出来的分家形态。
{
  const r = withMutation(
    'workbench-web/src/hosts.ts',
    (s) =>
      s.replace(
        '      return { ...HOST_INVARIANT, baseUrl: tauriBaseUrl(runtime.gatewayPort) }',
        '      return {\n' +
          '        ...HOST_INVARIANT,\n' +
          '        baseUrl: tauriBaseUrl(runtime.gatewayPort),\n' +
          "        authScopes: [...HOST_INVARIANT.authScopes, 'tauri.updater'],\n" +
          '      }',
      ),
    ['workbench-web/test/hosts.test.ts'],
  )
  expect(
    '23 Tauri 多要一个 scope → 三宿主同构断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— hostConfig 的 tauri 分支换了形状,先修锚点'
      : '★ 三个宿主的差别已经不只是 baseURL,而验收那条断言竟然还是绿的',
  )
}

// 24. ★ loopback 回调监听绑到 0.0.0.0(V0.9.0 Session 5)
//
//     `listen(port, '127.0.0.1')` 与 `listen(port)` 在开发机上**行为完全一样**:
//     浏览器照样回来、测试照样绿、日志照样干净。差别只在局域网上够不够得着 ——
//     而那正是「授权码暴露给整个局域网」与「没暴露」的全部区别。
//
//     ⚠️ 这类改动最可能以「顺手清理一个参数」的形式发生,而且**没有任何现成信号**:
//     它不报错、不变慢、不改任何返回值。所以判据必须落在
//     `server.address()` 的观测值上,而不是源码里的字面量 ——
//     后者被 `listen(port)`(省掉 host = 绑全网卡)完整绕过。
//
//     变异挑「把回环字面量换成通配地址」,那是这个 bug 真实的长相。
{
  const r = withMutation(
    'packages/auth-pkce/src/loopback.ts',
    (s) => s.replace("? '127.0.0.1' : '::1'", "? '0.0.0.0' : '::'"),
    ['packages/auth-pkce/test/loopback.test.ts'],
  )
  expect(
    '24 loopback 绑到 0.0.0.0 → 「绑的是回环地址」的断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— openLoopbackAt 里挑绑定地址那一行换了形状,先修锚点'
      : '★ 回调端口绑上了全网卡,局域网里谁都够得着那个授权码,而断言竟然还是绿的',
  )
}

// 25. ★ 收到回调之后不关服务器(V0.9.0 Session 5)
//
//     登录**完全正常**:码收到了、页面出来了、token 换到了。唯一的差别是
//     那个回环端口继续听着 —— 一个持续存在的、能被再打一次的回调面。
//
//     ⚠️ 与 24 同一族「坏了也没人看得见」:没有报错、没有性能变化,
//     而且**功能测试全绿**,因为功能确实没坏。能看见它的只有一条
//     「事后再连一次,必须连不上」的断言,而那条断言本身没有任何自然的
//     失败方式 —— 不专门验一次,它是绿是空分不出来。
{
  const r = withMutation(
    'packages/auth-pkce/src/loopback.ts',
    (s) => s.replace('    server.close()\n', ''),
    ['packages/auth-pkce/test/loopback.test.ts'],
  )
  expect(
    '25 收到回调后不关服务器 → 「端口收完就没了」的断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— 回调处理里那句 server.close() 换了位置,先修锚点'
      : '★ 回调端口在登录成功后继续听着,而断言竟然还是绿的 —— 那是一个持续的重放面',
  )
}

// 26. ★ 有人从网关这一头解决跨源(V0.9.0 Session 5)
//
//     桌面壳的跨源有两个解法,代价差得很远:Tauri 侧的允许清单只影响桌面壳,
//     而给网关加 CORS 响应头影响**每一个部署** —— 包括本来就同源的远端 Web。
//
//     ⚠️ 它最可能发生的方式不是有人权衡后选了它。调壳的时候被
//     `TypeError: Failed to fetch` 卡住 —— 那句话**不提 CORS**,与「网关没起来」
//     长得一模一样 —— 于是顺手加一行中间件,当场就通了,然后就留在那儿了。
//
//     变异挑的正是那一行的真实长相(`app.use('*', …)` 打上 Allow-Origin),
//     而不是 import 一个 cors 包:后者会被「源码里有没有 cors 字样」的判据抓到,
//     那证明的是 grep 在工作,不是那条断言在工作。
{
  const r = withMutation(
    'gateway/src/app.ts',
    (s) =>
      s.replace(
        "  app.use('*', requestIdMiddleware())",
        "  app.use('*', requestIdMiddleware())\n" +
          "  app.use('*', async (c, next) => {\n" +
          '    await next()\n' +
          "    c.header('Access-Control-Allow-Origin', '*')\n" +
          '  })',
      ),
    ['gateway/test/shipped-assembly.test.ts'],
  )
  expect(
    '26 网关发 CORS 头 → 「跨源在 Tauri 侧解决」的断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上 —— app.ts 里第一条中间件换了形状,先修锚点'
      : '★ 网关给所有部署开了跨源的口子,而断言竟然还是绿的 —— 收益归桌面壳一家,风险归所有人',
  )
}

// 9. console 契约与领域模型的一致性(V0.5.0)—— **类型层面的探针**
//
//    前八条都靠「跑 vitest 看红不红」。这一条不行:它断言的是**类型**
//    对不对,而 Vitest 用 esbuild 转译、只擦类型不做检查 —— 领域模型
//    改个字段名,测试照样全绿。
//
//    所以它跑的是 `tsc -b tsconfig.test.json`。改 `Subject.userName`
//    的名字,`memberOf()` 的投影立刻编译不过。
//
//    ⚠️ 这正是 CLAUDE.md 第六节元规则要的答案:「谁验证这条一致性断言?」
//    —— 这条探针。没有它,那条断言可能一直是对的、也可能早就名存实亡,
//    而两者在 `pnpm test` 的输出里长得一模一样。
{
  const target = p('packages/subject/src/subject.ts')
  const source = readFileSync(target, 'utf8')
  const anchor = '  readonly userName: string'
  if (!source.includes(anchor)) {
    expect('9 领域模型改字段名 → console 契约的一致性断言编译不过', false, '锚点没匹配上')
  } else {
    const red = withMutatedFiles(
      [{ path: target, mutate: (s) => s.replace(anchor, '  readonly userNameRenamed: string') }],
      () => {
        try {
          execFileSync(
            process.execPath,
            [p('node_modules', 'typescript', 'bin', 'tsc'), '-b', 'tsconfig.test.json'],
            { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
          )
          return false
        } catch {
          return true
        }
      },
    )
    expect(
      '9 领域模型改字段名 → console 契约的一致性断言编译不过(类型层面的探针)',
      red,
      '★ Subject 改了字段名,而 console 契约的投影竟然还编译得过 —— 那条一致性断言是假的',
    )
  }
}

// 10. 认证覆盖(V0.5.5)—— 拿掉一组路由的认证中间件
//
//     这一条不是假想:V0.5.5 加 `/v1/workspaces/*` 时**真的漏了**那两行。
//     handler 写好、测试写好,而没有任何东西要求认证 —— 未认证请求拿到 200。
//
//     漏掉的后果不是「不安全一点」:`c.get('principal')` 为 undefined,
//     而**全部归属判定建立在它之上**,等于所有人共用一个匿名身份。
//
//     ⚠️ 认证中间件按路径前缀单独注册,新增路由不会自动覆盖 ——
//     所以这个洞会**反复出现**,值得一条常驻探针而不只是一次性验证。
{
  // ⚠️ **两行一起删,不能只删一行。**
  //
  // 第一版探针只删了精确路径那行,而 `/v1/workspaces/*` 在 Hono 里
  // **同样匹配 `/v1/workspaces` 本身** —— 于是认证仍然生效,探针报「没变红」。
  //
  // 那一次「失败」是探针自己的问题,不是断言的问题。**探针必须复现真实的
  // 失败形态**(新增一组路由时两行都忘了写),而不是一个不会发生的半吊子状态。
  // 与 V0.4.6 撤下两条前提错误的探针是同一类教训。
  const r = withMutation(
    'gateway/src/app.ts',
    (s) =>
      s.replace(
        "  app.use('/v1/workspaces', runtimeAuth(options.ctx))\n  app.use('/v1/workspaces/*', runtimeAuth(options.ctx))",
        '  // probe: 拿掉工作区的认证',
      ),
    ['gateway/test/auth-coverage.test.ts'],
  )
  expect(
    '10 拿掉一组路由的认证中间件 → 认证覆盖断言变红',
    r.red,
    r.unchanged ? '锚点没匹配上' : '★ 未认证请求能访问 /v1/workspaces,而认证覆盖断言竟然还是绿的',
  )
}

// 11. 策略拒绝不进审计(V0.5.5)—— 把 audit.record 拿掉
//
//     静默拒绝不是「少一条日志」:用户看到动作没生效又没有解释,
//     第一反应是「这是 bug」,然后去想办法绕过 —— 换个工具名、换条路径。
//     **静默的拒绝会主动训练用户去对抗策略。**
//
//     判定与记录被刻意绑在一个入口里(`createPolicyEnforcer` 只暴露 `check`),
//     这条探针验的就是那个绑定真的有效,而不是一句注释。
{
  const r = withMutation(
    'gateway/src/workspaces/enforce.ts',
    (s) => s.replace('        options.audit.record({', '        void ((_ignored) => _ignored)({'),
    ['gateway/test/workspace-policy.test.ts'],
  )
  expect(
    '11 策略拒绝不再进审计 → 审计断言变红',
    r.red,
    r.unchanged ? '锚点没匹配上' : '★ 被拒绝的动作不再进审计,而那条验收断言竟然还是绿的',
  )
}

// 12. 作业恢复不清 claimedBy(V0.5.5)—— 一个「看起来对」的实现
//
//     `recover('requeue')` 若忘了把 `claimedBy` 清成 null,状态确实回到了
//     `queued`,**测试里只看 status 的那一半会通过**。而下一轮恢复会再次
//     把它当成孤儿作业捡起来 —— 作业在两个状态间打转,永远跑不完。
//
//     这一条探的是「断言有没有覆盖到那个容易漏的字段」,不是覆盖到状态机本身。
{
  const r = withMutation(
    'gateway/src/jobs/store.ts',
    (s) =>
      s.replace(
        "{ ...job, status: 'queued', claimedBy: null, updatedAt: now }",
        "{ ...job, status: 'queued', updatedAt: now }",
      ),
    ['gateway/test/jobs.test.ts'],
  )
  expect(
    '12 恢复时不清 claimedBy → 作业恢复断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上'
      : '★ 恢复后 claimedBy 还留着,而断言竟然还是绿的 —— 作业会在两个状态间打转',
  )
}

// 13. 会话回收误删租户级附件(V0.5.5)—— 把严格比对换成宽松匹配
//
//     `reclaimSession` 若用 `a.sessionId ?? sessionId` 之类的宽松匹配,
//     `sessionId === null` 的**租户级**附件会被一起卷进来删掉。
//
//     ⚠️ 这类 bug 的可怕之处在于**它只在清理时发生,而清理是异步的、
//     没人看的**。用户下次来找那个文件时它已经没了,而日志里只有一条
//     「回收了 N 个附件」—— N 比预期大,但没人核对过预期。
{
  const r = withMutation(
    'packages/attachment-tenant/src/index.ts',
    (s) =>
      s.replace(
        '.filter((a) => a.sessionId === sessionId)',
        '.filter((a) => (a.sessionId ?? sessionId) === sessionId)',
      ),
    ['packages/attachment-tenant'],
  )
  expect(
    '13 会话回收改成宽松匹配 → 租户级附件保护断言变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上'
      : '★ 租户级附件被会话回收误删,而断言竟然还是绿的 —— 那是静默的数据丢失',
  )
}

// ===========================================================================
// 第三类:作用域 —— 在真实时序下调用,而不是在测试里直接调
// ===========================================================================

// 7. 守卫本身:principal 消费方白名单
//    这一类没法靠「弄坏实现」测 —— 问题不在实现里,在**谁在什么作用域下调它**。
//    能做的是确认那道兜底真的在。
{
  // 这条不跑 vitest,跑守卫本身 —— 但还原走同一条通路。
  const red = withMutatedFiles(
    [
      {
        path: p('scripts/check-guards.mjs'),
        mutate: (s) =>
          s.replace(
            "    file: 'packages/fs-tenant/src/index.ts',",
            "    file: 'packages/__none__.ts',",
          ),
      },
    ],
    () => {
      try {
        execFileSync(process.execPath, [p('scripts', 'check-guards.mjs')], {
          cwd: REPO,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        return false
      } catch {
        return true
      }
    },
  )
  expect(
    '7 把 fs-tenant 移出 principal 白名单 → 守卫变红(作用域类兜底)',
    red,
    '守卫没拦住 —— V0.4.7 那个「靠人记得」的修法就没有兜底了',
  )
}

console.log('')
const failed = results.filter((x) => !x.passed)
console.log(`共 ${results.length} 条,通过 ${results.length - failed.length},失败 ${failed.length}`)

if (failed.length > 0) {
  console.log('\n有断言在实现坏掉时**没有变红**。')
  console.log('这比测试失败严重得多 —— 它意味着那条断言一直没在测它声称测的东西。')
  for (const f of failed) console.log(`  ${f.name}`)
  process.exit(1)
}
console.log('全部核心断言都真的会红。')
