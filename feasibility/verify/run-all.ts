/**
 * Session 0 验证入口。四项验证按 A → B → C → D 顺序跑,任一止损点失败
 * 退出码非 0,并在汇总里指出触发哪条止损路径。
 */
import { runA } from './a-isolate.ts'
import { runB, runB10 } from './b-credentials.ts'
import { runC } from './c-concurrency.ts'
import { runD } from './d-pty.ts'
import { printSummaryAndExit, summarize } from './harness.ts'

console.log('DSHWAR Session 0 · 可行性证伪')
console.log(`平台: ${process.platform} ${process.arch} · Node ${process.version}`)
console.log(`上游: @deepseek-ai/dsh-* 0.1.0-rc.6 · cordis 4.0.1`)
console.log(`时间: ${new Date().toISOString()}`)

await runA()
await runB()
await runB10()
await runC()
await runD()

// 止损判定:验证 A 或 C 失败 → cordis 作用域机制与文档不符
const results = summarize()
const aFailed = results.some((r) => r.group.startsWith('验证 A') && !r.passed)
const bFailed = results.some((r) => r.group.startsWith('验证 B ·') && !r.passed)
const cFailed = results.some((r) => r.group.startsWith('验证 C') && !r.passed)

if (aFailed || cFailed) {
  console.log('\n止损触发:验证 A 或 C 失败 —— cordis 作用域机制与文档不符。')
  console.log('   架构须改为「进程级隔离优先」,supervisor 从 V0.4.0 提前到 V0.1.0,')
  console.log('   并同步修订 ARCHITECTURE.md §2.4 与版本路线图。')
}
if (bFailed) {
  console.log('\n止损触发:验证 B 失败 —— 凭据换绑需要重启插件。')
  console.log('   会话级 principal 绑定不可行,需改为每 principal 一个运行时。')
}

printSummaryAndExit()
