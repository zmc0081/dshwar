#!/usr/bin/env node
/**
 * Stop 钩子（v2）：没跑到目标版本就不许停。
 *
 * v1 有一个 fail-open 的 bug：Session 标题行没匹配上时，pending 为空，
 * 被当成「本版全部完成」而放行——于是它催 Claude 去压缩一个开发中的版本块，
 * 而 CLAUDE.md §3 明写「未发布版本永不压缩」。Claude 拒绝执行并去核对事实，
 * 才没有酿成删除任务详情的后果。
 *
 * v2 改成 fail-closed，并用两个事实源交叉验证：
 *   源 A：`### <图例> Session N:` 标题行
 *   源 B：「Session 状态」小结表里的图例
 * 解析不出、两源不一致、或有未完成项 —— 一律 block 并说明原因。
 * 只有「两源都解析成功且都判定全部完成」才放行。
 *
 * 目标版本来自 DSHWAR_TARGET（如 "0.6.5"）。未设置时放行。
 */
import { readFileSync } from 'node:fs'

const DONE = new Set(['✅', '🟠'])

const raw = readFileSync(0, 'utf8')
let input = {}
try {
  input = JSON.parse(raw)
} catch {
  process.exit(0)
}
if (input.stop_hook_active) process.exit(0)

const target = process.env.DSHWAR_TARGET
if (!target) process.exit(0)

const block = (lines) => {
  console.log(JSON.stringify({ decision: 'block', reason: lines.join('\n') }))
  process.exit(0)
}

let doc = ''
try {
  doc = readFileSync('SESSION_TASKS.md', 'utf8')
} catch {
  block([
    '钩子读不到 SESSION_TASKS.md（工作目录可能不对）。',
    '不要据此做任何版本收尾或压缩动作。先报告当前工作目录与文件是否存在。',
  ])
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

// ── 当前开发版本号 ──────────────────────────────────────────────
const head = doc.match(
  /当前版本[（(]正在开发[）)]\s*[:：]\s*\*{0,2}V?([0-9]+\.[0-9]+\.[0-9]+)\*{0,2}/,
)
if (!head) {
  block([
    '钩子解析不出「当前版本(正在开发)」那一行——文件头格式可能变了。',
    '这是 fail-closed：解析不出就不放行，绝不据此推断版本已完成。',
    '',
    '请人工核对 SESSION_TASKS.md 头部格式，并报告实际那一行的原文。',
  ])
}
const current = head[1]

// ── 当前开发中版本块 ────────────────────────────────────────────
const startIdx = doc.search(/^##\s.*\[(?:未上线|开发中)\]/m)
if (startIdx === -1) {
  block([
    '钩子找不到标记为 [未上线] 或 [开发中] 的版本块。',
    'fail-closed：不放行。请人工核对当前版本块的标题标记。',
  ])
}
const tail = doc.slice(startIdx)
const nextIdx = tail.slice(3).search(/^##\s/m)
const scope = nextIdx === -1 ? tail : tail.slice(0, nextIdx + 3)

// ── 源 A：Session 标题行 ────────────────────────────────────────
const headings = [...scope.matchAll(/^###\s*(\S+)?\s*Session\s+(\d+)\s*[:：]/gm)]
const pendingA = headings.filter((m) => !DONE.has(m[1])).map((m) => m[2])

// ── 源 B：状态小结表 ────────────────────────────────────────────
const tableRows = [...scope.matchAll(/^\|\s*(\d+)[^|]*\|\s*([^\s|]+)[^|]*\|/gm)]
const pendingB = tableRows.filter((m) => !DONE.has(m[2])).map((m) => m[1])

// ── fail-closed 判定 ────────────────────────────────────────────
if (headings.length === 0 && tableRows.length === 0) {
  block([
    `钩子在 V${current} 的版本块里一个 Session 状态都没解析出来。`,
    '',
    '⚠️ 这**不代表**版本已完成，只代表钩子读不懂格式。这是 fail-closed。',
    '绝对不要据此做版本收尾或压缩——CLAUDE.md §3 明写「未发布版本永不压缩」。',
    '',
    '请报告：该版本块里 Session 标题行与状态表的实际原文格式，我来修钩子的匹配规则。',
  ])
}

const allPending = [...new Set([...pendingA, ...pendingB])].sort((a, b) => a - b)

// 两源都解析到了，但结论不一致 → 也不放行
const bothParsed = headings.length > 0 && tableRows.length > 0
if (bothParsed && pendingA.join(',') !== pendingB.join(',')) {
  block([
    `V${current} 的两个事实源不一致——标题行判定未完成：[${pendingA.join(', ') || '无'}]，`,
    `状态表判定未完成：[${pendingB.join(', ') || '无'}]。`,
    '',
    '先以「未完成」的并集为准继续做，并顺手把两处对齐。',
    `待办 Session：${allPending.join(' / ')}`,
    '',
    '⚠️ 另外请用 git log 核对一遍——进度标记脚本此前有过静默退回的 bug，文档不是唯一事实源。',
  ])
}

if (allPending.length === 0 && cmp(current, target) >= 0) process.exit(0)

if (allPending.length > 0) {
  block([
    `V${current} 尚未完成：Session ${allPending.join(' / ')} 未标记为 ✅。`,
    '',
    `继续执行 Session ${allPending[0]}：`,
    '1. 先重读 SESSION_TASKS.md 中该 Session 的完整任务详情（上下文可能已压缩，务必重读）',
    '2. 按其执行，跑 pnpm check:all 并贴出实际输出',
    '3. git commit + git push（每个 Session 都要 push）',
    '4. 把该 Session 的标题行与状态表图例一并改为 ✅',
    '',
    '⚠️ 不要压缩本版块——CLAUDE.md §3：未发布版本永不压缩。',
    '⚠️ 若契约里已标 status: implemented 但实现不存在，那是要修的 bug，不是要跳过的步骤。',
    '',
    '不要在此询问是否继续，也不要写进度小结就结束回合——写小结不算完成。',
    '只有三类情况允许停下：需要外部凭据、要做 /v1 契约破坏性变更、发现安全边界问题。',
  ])
}

block([
  `V${current} 的 Session 已全部完成，但目标是 V${target}，还没到。`,
  '',
  '⚠️ 动手前先自查一次：这个「全部完成」是真的吗？',
  '用 git log 核对每个 Session 是否都有对应提交；若契约声明了 status: implemented，',
  '确认实现真的存在。文档图例不是唯一事实源。',
  '不一致就先修，不要往下走。',
  '',
  '核对无误后做版本收尾并立即开下一版：',
  '1. 按 CLAUDE.md §3 压缩本版块并归档到 SESSION_TASKS_HISTORY.md',
  '2. 报告主文件字符数',
  '3. CHANGELOG 补本版节',
  '4. 按 §4 立项下一版并同步全部版本号',
  '5. 直接开始下一版 Session 0',
  '',
  '不要在此询问是否继续，也不要写进度小结就结束回合。',
  '只有三类情况允许停下：需要外部凭据、要做 /v1 契约破坏性变更、发现安全边界问题。',
])
