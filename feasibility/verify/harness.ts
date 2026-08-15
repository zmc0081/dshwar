/**
 * Session 0 验证脚手架。只做三件事:登记断言、汇总结果、决定退出码。
 * 刻意不引入测试框架 —— 本 Session 的产出是「结论」,不是测试基建;
 * 测试基建在 Session 1 用 Vitest 建。
 */

export interface CheckResult {
  group: string
  name: string
  passed: boolean
  detail: string
}

const results: CheckResult[] = []

/** 登记一条断言。detail always recorded —— 失败时它就是最小复现的线索。 */
export function check(group: string, name: string, passed: boolean, detail = ''): void {
  results.push({ group, name, passed, detail })
  const mark = passed ? '  PASS' : '  FAIL'
  console.log(`${mark}  ${name}${detail ? `  —— ${detail}` : ''}`)
}

/** 断言两值相等(结构化比较),自动把实际值写进 detail。 */
export function checkEqual(group: string, name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(group, name, a === e, a === e ? `= ${a}` : `期望 ${e},实际 ${a}`)
}

/** 捕获同步/异步抛错,用于「必须拒绝」类断言。 */
export async function checkRejects(
  group: string,
  name: string,
  fn: () => unknown | Promise<unknown>,
): Promise<void> {
  try {
    await fn()
    check(group, name, false, '未抛错,但契约要求拒绝')
  } catch (error) {
    check(group, name, true, `已拒绝: ${(error as Error).message.slice(0, 120)}`)
  }
}

export function groupHeader(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`)
}

export function summarize(): CheckResult[] {
  return results
}

export function printSummaryAndExit(): never {
  const failed = results.filter((r) => !r.passed)
  console.log(`\n${'='.repeat(72)}`)
  console.log(
    `总计 ${results.length} 条断言,通过 ${results.length - failed.length},失败 ${failed.length}`,
  )

  const byGroup = new Map<string, { total: number; failed: number }>()
  for (const r of results) {
    const g = byGroup.get(r.group) ?? { total: 0, failed: 0 }
    g.total += 1
    if (!r.passed) g.failed += 1
    byGroup.set(r.group, g)
  }
  console.log('')
  for (const [group, g] of byGroup) {
    console.log(
      `  ${g.failed === 0 ? '通过' : '失败'}  ${group}  (${g.total - g.failed}/${g.total})`,
    )
  }

  if (failed.length > 0) {
    console.log('\n失败明细:')
    for (const r of failed) console.log(`  [${r.group}] ${r.name} —— ${r.detail}`)
  }
  console.log(`${'='.repeat(72)}\n`)
  process.exit(failed.length === 0 ? 0 : 1)
}
