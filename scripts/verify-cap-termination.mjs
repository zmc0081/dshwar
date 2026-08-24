#!/usr/bin/env node
/**
 * 上限类守卫的负向验证 —— **预期结果是「挂住」,不是「红」**。
 *
 * ## 为什么它不能待在 `verify-guards.mjs` 里
 *
 * 那个脚本的每一条都是「植入违规 → 跑一次检查 → 断言它红」。
 * 而这一条植入违规之后**被测的东西不终止** ——
 * 放进去会把整个脚本挂住,而挂住的表现在输出里是**什么都没有**。
 *
 * ⇒ 单开一个入口,用超时把「不终止」变成一个**有限时间内的结论**。
 *
 * ## 判据:超时 = 通过
 *
 * | 结果 | 结论 |
 * | --- | --- |
 * | **超时** | ✅ 去掉上限之后它确实不终止 —— **那正是上限的价值** |
 * | 终止了 | 🚨 那条上限没有承担终止性,它可能是装饰 |
 *
 * ⚠️ 超时值要**明显小于**框架与 CI 的超时,否则报出来的仍是它们的
 * 「timeout」而不是这里的结论 —— 那种含糊的错误正是要避免的。
 *
 * ## 两层还原
 *
 * `try/finally` 挡异常与正常退出;`beginMutation` 的清单落盘挡 SIGKILL。
 * 后者是 V0.9.0 收尾实测出来的:那次去掉 `MAX_PAGES` 之后挂了十分钟,
 * 强杀之后变异过的 `api.ts` 留在了工作区。
 *
 * 跑法:`node scripts/verify-cap-termination.mjs`(已进 `check:all`)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnVitestWithTimeout } from './lib/mutate.mjs'
import { beginMutation, reclaimMutations } from './lib/mutation-journal.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 超时。20 秒 —— vitest 默认单条 5 秒、整体无上限,CI 是分钟级。 */
const TIMEOUT_MS = 20_000

/**
 * 一条上限 × 去掉它的方式 × 一个「去掉之后会不终止」的测试。
 *
 * ⚠️ 表里每一条都必须**真的会挂**。一条「去掉之后仍然终止」的条目
 * 会让本脚本报红 —— 那是对的:它说明那条上限没在承担终止性,
 * 而一条不承担终止性的上限,与没有上限的区别只在注释里。
 */
const CAPS = [
  {
    name: 'console-web collectPages 的 MAX_PAGES',
    file: 'console-web/src/api.ts',
    /** 去掉上限的那一行。 */
    remove: 'if (pages >= MAX_PAGES) return { data, requestIds, complete: false }',
    /** 去掉之后会不终止的那条测试。 */
    test: 'console-web/test/pagination.test.ts',
    why: '服务端每页回同一个 cursor 时,没有上限就永远翻不完',
  },
]

let failed = 0

// 开机自愈:上一次跑崩留下的变异
reclaimMutations(REPO)

console.log('DSHWAR · 上限类守卫的终止性验证')
console.log('  预期结果是「超时」——挂住证明了那条上限在承担终止性\n')

for (const cap of CAPS) {
  const abs = resolve(REPO, cap.file)
  const before = readFileSync(abs, 'utf8')

  if (!before.includes(cap.remove)) {
    console.log(`  失败  ${cap.name}`)
    console.log('        🚨 锚点失配 —— 本条结论作废(不是「上限失效了」)')
    console.log(`        找不到:${cap.remove}`)
    failed += 1
    continue
  }

  // ★ 先落盘,再动手。顺序是硬的 —— 见 beginMutation 的注释。
  const session = beginMutation(REPO, [cap.file])
  /** @type {boolean} */
  let timedOut
  try {
    writeFileSync(abs, before.replace(cap.remove, ''), 'utf8')

    // ⚠️ 走**受控通路**的 `spawnVitestWithTimeout`,不自己拼 vitest 路径 ——
    //   `check-guards.mjs` 的「拉起 vitest 的地方只有 lib/mutate.mjs」守卫
    //   盯着这件事,而它拦得对:第一版正是自己 spawn 的。
    //
    //   ⚠️ 那一版还犯了第二个错:用 `execFileSync` 包在 Promise 里。
    //   同步调用**阻塞事件循环**,`setTimeout` 根本没机会触发 ——
    //   于是等到子进程自己结束为止(实测 >600 秒),然后报出「它终止了」,
    //   **一个假的结论**。判据观测不到真正的结论,与「判据打在输出的
    //   某个片段上」是同一族。理由记在 `spawnVitestWithTimeout` 的注释里。
    const result = await spawnVitestWithTimeout([cap.test], TIMEOUT_MS)
    timedOut = result.timedOut
  } finally {
    session.restore()
  }

  if (timedOut) {
    console.log(`  通过  ${cap.name} —— 去掉上限后不终止(超时 ${TIMEOUT_MS / 1000}s)`)
    console.log(`        ${cap.why}`)
  } else {
    failed += 1
    console.log(`  失败  ${cap.name} —— 去掉上限之后它**仍然终止了**`)
    console.log('        那条上限没有承担终止性 —— 它与没有上限的区别只在注释里。')
    console.log('        要么终止性来自别处(那么这条验证该改),')
    console.log('        要么这条上限是装饰(那么该删掉它,别留一个假的保障)。')
  }
}

console.log(
  `\n共 ${String(CAPS.length)} 条,通过 ${String(CAPS.length - failed)},失败 ${String(failed)}`,
)
if (failed > 0) {
  console.log('\n有上限没有承担它声称的终止性。')
  process.exit(1)
}
console.log('全部上限都真的在挡住不终止。')
