#!/usr/bin/env node
/**
 * Stop 钩子：没跑到目标版本就不许停。
 *
 * 上一次四版连跑在 V0.5.0 Session 2 之后自己收了尾——指令里写了「不要停」，
 * 但那只是话，回合结束不需要征求确认，所以它没有违反任何东西。
 * 这个钩子把「不要停」从话变成机制。
 *
 * 事实源是 SESSION_TASKS.md：
 *   1) 文件头「当前版本(正在开发): **V0.x.y**」
 *   2) 当前开发中版本块里 Session 标题行的状态图例
 * 任务书本来就要求每完成一个 Session 就更新图例，这里让它变成硬约束。
 *
 * 目标版本来自环境变量 DSHWAR_TARGET（如 "0.6.5"）。未设置时放行，
 * 保证平时交互完全不受影响。
 */
import { readFileSync } from 'node:fs'

const raw = readFileSync(0, 'utf8')
let input = {}
try {
  input = JSON.parse(raw)
} catch {
  process.exit(0)
}

// 防死循环：已因上一次 block 进入强制续跑状态时直接放行
if (input.stop_hook_active) process.exit(0)

const target = process.env.DSHWAR_TARGET
if (!target) process.exit(0)

let doc = ''
try {
  doc = readFileSync('SESSION_TASKS.md', 'utf8')
} catch {
  process.exit(0)
}

const cmp = (a, b) => {
  const pa = a.split('.').map(Number),
    pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// ① 当前开发版本号
const head = doc.match(/当前版本[（(]正在开发[）)]\s*[:：]\s*\*\*V?([0-9]+\.[0-9]+\.[0-9]+)\*\*/)
const current = head?.[1]

// ② 当前版本块里未完成的 Session（✅ 与 🟠 视为完成）
const blockStart = doc.search(/^##\s.*\[(?:未上线|开发中)\]/m)
const block = blockStart === -1 ? '' : doc.slice(blockStart)
const nextVer = block.slice(3).search(/^##\s.*·/m)
const scope = nextVer === -1 ? block : block.slice(0, nextVer + 3)
const pending = [...scope.matchAll(/^###\s*(\S+)\s*Session\s+(\d+)\s*[:：]/gm)]
  .filter((m) => m[1] !== '✅' && m[1] !== '🟠')
  .map((m) => m[2])

const versionDone = current && cmp(current, target) >= 0 && pending.length === 0
if (versionDone) process.exit(0)

const reason = []
if (pending.length > 0) {
  reason.push(
    `V${current} 尚未完成：Session ${pending.join(' / ')} 仍未标记为 ✅。`,
    ``,
    `继续执行 Session ${pending[0]}：`,
    `1. 先重读 SESSION_TASKS.md 中该 Session 的完整任务详情（上下文可能已被压缩多次，务必重读，不要凭记忆）`,
    `2. 按其执行，跑 pnpm check:all 并贴出实际输出`,
    `3. git commit + git push（每个 Session 都要 push）`,
    `4. 把该 Session 标题行与状态表的图例改为 ✅`,
  )
} else {
  reason.push(
    `V${current} 的 Session 已全部完成，但目标是 V${target}，还没到。`,
    ``,
    `现在做版本收尾并立即开下一版：`,
    `1. 按 CLAUDE.md §3 压缩本版块并归档到 SESSION_TASKS_HISTORY.md（触发条件是"开发完成后"，不等发布）`,
    `2. 报告主文件字符数`,
    `3. CHANGELOG 补本版节`,
    `4. 按 §4 立项下一版并同步全部版本号`,
    `5. 直接开始下一版 Session 0`,
  )
}

reason.push(
  ``,
  `不要在此询问我是否继续，也不要写进度小结就结束回合——写小结不算完成。`,
  `只有三类情况允许停下：需要我提供外部凭据、要做 /v1 契约的破坏性变更、`,
  `发现安全边界问题。其余一律往下走，有争议的记进 docs/DECISIONS/AUTOPILOT-LOG.md。`,
)

console.log(JSON.stringify({ decision: 'block', reason: reason.join('\n') }))
process.exit(0)
