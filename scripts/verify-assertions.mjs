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
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const p = (...seg) => join(REPO, ...seg)
const VITEST = p('node_modules', 'vitest', 'vitest.mjs')

/** 跑一组测试,只关心红还是绿。 */
function runTests(...targets) {
  try {
    execFileSync(process.execPath, [VITEST, 'run', ...targets], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { red: false }
  } catch (error) {
    return { red: true, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const results = []
function expect(name, passed, detail) {
  results.push({ name, passed })
  console.log(`  ${passed ? '通过' : '失败'}  ${name}`)
  if (!passed && detail) console.log(`        ${detail}`)
}

/**
 * 篡改一个文件、跑测试、无条件还原。
 *
 * @param {string} rel 仓库相对路径
 * @param {(source: string) => string} mutate 篡改函数
 * @param {string[]} targets 要跑的测试
 */
function withMutation(rel, mutate, targets) {
  const target = p(rel)
  const backup = `${target}.probebak`
  copyFileSync(target, backup)
  try {
    const original = readFileSync(target, 'utf8')
    const mutated = mutate(original)
    if (mutated === original) {
      return { red: false, unchanged: true }
    }
    writeFileSync(target, mutated, 'utf8')
    return runTests(...targets)
  } finally {
    copyFileSync(backup, target)
    unlinkSync(backup)
  }
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
    (s) => s.replace('resolvePath(root, tenant, user, workspace)', 'resolvePath(root, tenant, user)'),
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
        'return exhausted\n      ? { kind: \'deny\', reason: \'quota_exhausted\', quota }\n      : { kind: \'allow\', quota }',
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
    ['packages/policy', 'gateway/test/isolation.test.ts'],
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
    (s) => s.replace("const tokens = this.options.tokens ?? ['你好', ',', '世界']", "const tokens = (this.options.tokens ?? ['你好', ',', '世界']).slice(0, -1)"),
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
      s.replace(
        "for (const think of this.options.reasoning ?? []) {",
        'for (const think of []) {',
      ),
    ['gateway/test/runtime-api.test.ts'],
  )
  expect(
    '6 假模型不吐推理增量 → reasoning 断言变红(弄坏夹具类)',
    r.red,
    r.unchanged ? '锚点没匹配上' : '假模型不再吐推理增量,而 reasoning 测试竟然还是绿的',
  )
}

// 8. principal 抵达 agent 执行层(V0.4.7)—— 拿掉根上的 provide
//    这一条同时属于「弄坏实现」与「作用域」两类:它弄坏的是实现,
//    但只有在**真实时序下**(HTTP → 网关 → 子进程 → 适配器)才照得到。
{
  const r = withMutation(
    'gateway/src/runtime.ts',
    (s) =>
      s.replace(
        '    ctx.provide(PRINCIPAL_BINDING, options.principal)',
        '    void PRINCIPAL_BINDING',
      ),
    ['gateway/test/real-path-smoke.test.ts'],
  )
  expect(
    '8 拿掉根上的 principal provide → 真实路径冒烟变红',
    r.red,
    r.unchanged
      ? '锚点没匹配上'
      : '★ 进程档下 principal 不再抵达执行层,而端到端冒烟竟然还是绿的',
  )
}

// ===========================================================================
// 第三类:作用域 —— 在真实时序下调用,而不是在测试里直接调
// ===========================================================================

// 7. 守卫本身:principal 消费方白名单
//    这一类没法靠「弄坏实现」测 —— 问题不在实现里,在**谁在什么作用域下调它**。
//    能做的是确认那道兜底真的在。
{
  // 这条不跑 vitest,跑守卫本身 —— 所以不走 withMutation
  let red = false
  try {
    copyFileSync(p('scripts/check-guards.mjs'), p('scripts/check-guards.mjs.probebak'))
    const src = readFileSync(p('scripts/check-guards.mjs'), 'utf8')
    writeFileSync(
      p('scripts/check-guards.mjs'),
      src.replace("    file: 'packages/fs-tenant/src/index.ts',", "    file: 'packages/__none__.ts',"),
      'utf8',
    )
    try {
      execFileSync(process.execPath, [p('scripts', 'check-guards.mjs')], {
        cwd: REPO,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      red = true
    }
  } finally {
    copyFileSync(p('scripts/check-guards.mjs.probebak'), p('scripts/check-guards.mjs'))
    unlinkSync(p('scripts/check-guards.mjs.probebak'))
  }
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
