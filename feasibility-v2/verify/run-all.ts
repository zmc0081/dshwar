/**
 * V0.2.0 Session 0 验证入口。
 *
 * 止损判定:验证 A 或 C 失败 → 进程内驱动不可行或无法取消 →
 * `supervisor` 从 V0.4.0 提前到本版本。
 */
import { runA } from './a-inprocess.ts'
import { runB } from './b-streaming.ts'
import { runC } from './c-cancel.ts'
import { runD } from './d-concurrency.ts'
import { printSummaryAndExit, summarize } from './harness.ts'
import { REQUIRED_PLUGINS } from './runtime.ts'

console.log('DSHWAR V0.2.0 Session 0 · 网关可行性证伪')
console.log(`平台: ${process.platform} ${process.arch} · Node ${process.version}`)
console.log('上游: @deepseek-ai/dsh-* 0.1.0-rc.6 · cordis 4.0.1')
console.log(`时间: ${new Date().toISOString()}`)
console.log('')
console.log('进程内组装所需插件:')
for (const p of REQUIRED_PLUGINS) console.log(`  · ${p}`)

await runA()
await runB()
await runC()
await runD()

const results = summarize()
const aFailed = results.some((r) => r.group.startsWith('验证 A') && !r.passed)
const cFailed = results.some((r) => r.group.startsWith('验证 C') && !r.passed)
const dFailed = results.some((r) => r.group.startsWith('验证 D') && !r.passed)

if (aFailed) {
  console.log('\n止损触发:验证 A 失败 —— 进程内无法驱动 agent。')
  console.log('   网关只能拉起 dsh 进程走 stdio JSON-RPC,而该协议无 cancel。')
  console.log('   supervisor 必须从 V0.4.0 提前到本版本。')
}
if (cFailed) {
  console.log('\n止损触发:验证 C 失败 —— 无法取消。')
  console.log('   SSE 断连时停不掉正在跑的 turn,每个断开的客户端都会留下一个')
  console.log('   继续烧 token 的 fiber。supervisor 提前,「终止进程即是取消」。')
}
if (dFailed) {
  console.log('\n止损触发:验证 D 失败 —— 并发会话串号。')
  console.log('   逻辑隔离在 agent 层不成立,必须改为一 principal 一进程。')
}

printSummaryAndExit()
