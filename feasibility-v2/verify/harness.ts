/**
 * V0.2.0 Session 0 的验证脚手架。与 V0.1.0 的同款,刻意不引测试框架 ——
 * 本 Session 的产出是「结论」,不是测试基建。
 */
export interface CheckResult {
  group: string
  name: string
  passed: boolean
  detail: string
}

const results: CheckResult[] = []

export function check(group: string, name: string, passed: boolean, detail = ''): void {
  results.push({ group, name, passed, detail })
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`)
}

export function checkEqual(group: string, name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(group, name, a === e, a === e ? `= ${a}` : `期望 ${e},实际 ${a}`)
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
