#!/usr/bin/env node
/**
 * 把一段失败日志压成 **GitHub annotation** —— 关键行提取,不是「末 40 行」。
 *
 * ## 为什么要有 annotation 这一层
 *
 * job 的完整日志**只有对仓库有 admin 权限的人下得到**(API 对其余人 403),
 * 而 annotation 是**公开可读**的。于是「CI 为什么红」对提 PR 的外部贡献者、
 * 对手机上看面板的人,从「看不到」变成「看得到一段」。
 *
 * ⚠️ 它不是第二份门禁清单:跑的仍然只有 `check:all` / `pack:desktop` 一条命令,
 * 这一层只做「把失败复述一遍」。
 *
 * ## 为什么不是 `tail -n 40 | tr | cut`(它的第一次真实运行就露了三个洞)
 *
 * V0.9.0 Session 6 首次真跑 CI,门禁那一步的 annotation 是这么产的:
 *
 * ```sh
 * echo "::error::$(tail -n 40 /tmp/gate.log | tr '\n' ' | ' | cut -c1-1500)"
 * ```
 *
 * 三个洞,**每一个都静默**:
 *
 * | # | 洞 | 实测表现 |
 * | --- | --- | --- |
 * | 1 | `cut -c1-1500` 保的是**开头** | 结论在末尾,而末尾正好被切掉 —— 那条 annotation 停在 `must contain its parent direc` |
 * | 2 | `tr` 的 SET2 会被截成**一个字符** | 想要的分隔符**从来没出现过**,全成了空格,几十行挤成一坨 |
 * | 3 | 末 40 行几乎全是噪音 | cargo 的 `cargo:rerun-if-env-changed=…` 刷屏,根因是**碰巧**落在窗口里的 |
 *
 * 🚨 第 1 条最值得记:`tail` 取的是末尾,`cut -c1-N` 取的是开头 ——
 * 两个方向相反的截断串在一起,留下的是**倒数第 40 行往后数 1500 字符**,
 * 也就是这段日志里信息量最低的那一块。而它看起来完全正常。
 *
 * ⇒ 判据换成:**按内容挑,不按位置挑**;截断时**从头截**,因为结论在末尾。
 *
 * ## 谁验证它
 *
 * `scripts/ci-annotate.test.mts` —— 夹具就是上面那次真实失败的日志形状:
 * 一堆 cargo 噪音 + 一行根因。断言根因**在输出里**。
 * 另有一条钉住截断方向:超长时被丢掉的必须是开头,不是结尾。
 *
 * 跑法:`node scripts/ci-annotate.mjs <日志文件> <标题>`
 * 永远退出 0 —— 它是**报信的**,报信的东西自己红会盖住真正的失败。
 *
 * @module scripts/ci-annotate
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * annotation 消息的字符预算。
 *
 * GitHub 的硬上限远大于这个数,但面板上超过几十行就要展开才看得到 ——
 * 而这一层的用户是「扫一眼面板」的人。挑得准比给得多重要。
 */
const BUDGET = 3000

/** 关键行最多留几条(从**末尾**数,越靠后离失败点越近)。 */
const MAX_KEY_LINES = 24

/** 无论如何都附上的末尾行数 —— 结论通常就在这里。 */
const TAIL_LINES = 12

/**
 * 一行「像是失败原因」吗。
 *
 * 中英混排:本仓的脚本用中文报错,工具链(cargo / pnpm / tsc / vitest)用英文。
 * 只认一边等于漏掉另一边的全部。
 */
const KEY = new RegExp(
  [
    '🚨',
    '✗',
    '违规',
    '失败',
    '未通过',
    '不存在',
    '错误',
    '\\berror\\b',
    '\\bError\\b',
    '\\bERROR\\b',
    '\\bfailed\\b',
    '\\bFAILED\\b',
    '\\bFAIL\\b',
    '\\bpanic',
    '\\bnot found\\b',
    "\\bcan't\\b",
    '\\bcannot\\b',
    '\\bCannot\\b',
    '\\bELIFECYCLE\\b',
    '\\bERR_[A-Z_]+',
    'could not compile',
    'exited with',
    'exit code',
  ].join('|'),
)

/**
 * 明显是进度噪音的行。
 *
 * ⚠️ 只在**关键行判定之后**用它 —— 一行既像噪音又像根因时,根因优先。
 * (`Downloading …` 通常是噪音,但 appimage 那次的根因正好挨着一串 Downloading。)
 */
const NOISE = /^(?:cargo:|\s*(?:Compiling|Downloading|Downloaded|Updating|Fresh|Checking)\s)/

/**
 * ANSI 转义序列。
 *
 * ⚠️ 必须锚在 **ESC 字节**(``)上。写成 `/\[[0-9;]*[A-Za-z]/` 看起来等价 ——
 * 实际会把普通文本里的 `[abc]` 咬掉一半,而日志里方括号到处都是。
 * ESC 本身在 annotation 里不显示,所以这个错误**在输出上看不出来**:
 * 那次真实失败的第一行就是 `ESC[1mESC[92m   CompilingESC[0m getrandom v0.2.17`。
 */
/* eslint-disable no-control-regex -- ANSI 的锚点就是 ESC 字节本身,不用它就锚不住 */
const ANSI_CSI = /\[[0-9;?]*[ -/]*[@-~]/g
const ANSI_OSC = /\][^]*(?:|\\)/g

/** 去掉 ANSI 转义 —— 它们在 annotation 里显示成一串看不懂的方括号。 */
function stripAnsi(/** @type {string} */ s) {
  return s.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(//g, '')
}
/* eslint-enable no-control-regex */

/** GitHub workflow command 的转义:换行要写成 `%0A`,否则整条消息在第一个换行处截断。 */
function escapeData(/** @type {string} */ s) {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

/** 标题里 `:` 与 `,` 是 workflow command 的分隔符,必须转义。 */
function escapeProperty(/** @type {string} */ s) {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

/**
 * 从一段日志里挑出「值得贴到面板上」的部分。
 *
 * @param {string} log 原始日志(可含 ANSI)
 * @returns {string} 多行文本,已去噪、已去重、已按预算截断
 */
export function extractAnnotation(log) {
  const lines = stripAnsi(log)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))

  // 末尾这一段也要去噪 —— 否则 cargo 刷屏时「末尾 12 行」可能一条信息都没有
  // (实测:那次门禁失败的最后 12 行里,7 行是 `cargo:rerun-if-env-changed=`)。
  //
  // ⚠️ 往回数的是**去噪之后**的行数,所以噪音多少都不影响拿到 12 行有效内容。
  //    全是噪音时退回原样 —— 「什么都没有」也是信息,不该被过滤成空白。
  const tail = []
  let tailStart = lines.length
  for (let i = lines.length - 1; i >= 0 && tail.length < TAIL_LINES; i -= 1) {
    const line = lines[i] ?? ''
    tailStart = i
    if (line.trim() === '' || NOISE.test(line)) continue
    tail.unshift(line)
  }
  if (tail.length === 0) {
    tailStart = Math.max(0, lines.length - TAIL_LINES)
    tail.push(...lines.slice(tailStart).filter((l) => l.trim() !== ''))
  }

  // 关键行只从**末尾之前**挑 —— 末尾那几行反正会整段附上,挑进来只会重复。
  const key = []
  for (const [i, line] of lines.entries()) {
    if (i >= tailStart) break
    if (line.trim() === '') continue
    if (!KEY.test(line)) continue
    if (NOISE.test(line)) continue
    key.push(line.trim())
  }

  // 同一条错误常被工具重复打印(cargo 的 warning 会跟一遍 error)。
  const deduped = [...new Set(key)].slice(-MAX_KEY_LINES)

  const parts = []
  if (deduped.length > 0) {
    parts.push(`★ 关键行(${key.length} 条命中,取最后 ${deduped.length} 条):`)
    for (const l of deduped) parts.push(`  ${l}`)
    parts.push('')
  }
  parts.push(`── 末尾 ${tail.length} 行(已去掉进度噪音)──`)
  for (const l of tail) parts.push(`  ${l.trim()}`)

  const text = parts.join('\n')
  if (text.length <= BUDGET) return text

  // 🚨 **从头截,不从尾截。** 结论在末尾 —— 这正是被替掉的那个一行命令
  //    (`tail | cut -c1-1500`)反过来做的事,它把根因切掉了。
  return `…(前面 ${text.length - BUDGET} 字符已截断)\n${text.slice(-BUDGET)}`
}

// ── 命令行入口 ────────────────────────────────────────────────────────
// 被 import 进来跑测试时不执行(测试只要 extractAnnotation)。
//
// ⚠️ 判据用 realpath 比较,不用 `import.meta.url.endsWith(argv[1])`:
//    本仓的路径里有中文,URL 形式是百分号编码的,endsWith 永远为 false。
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  const [, , logPath, title = '失败'] = process.argv
  /** @type {string} */
  let log
  try {
    log = logPath === undefined ? '' : readFileSync(logPath, 'utf8')
  } catch {
    // 日志文件不见了本身就是信息 —— 说出来,不要静默产出一条空 annotation。
    log = `(读不到日志文件 ${String(logPath)} —— 那一步可能在 tee 之前就死了)`
  }
  console.log(`::error title=${escapeProperty(title)}::${escapeData(extractAnnotation(log))}`)
}
