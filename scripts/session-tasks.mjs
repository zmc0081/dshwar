#!/usr/bin/env node
/**
 * `SESSION_TASKS.md` 的结构化维护工具 —— 翻状态、压缩归档、跑三条校验。
 *
 * ## 它替掉了什么,以及为什么必须替
 *
 * 此前这三件事都靠临时的 `node -e "…"` 内联脚本干。那条路有**两种**
 * 会静默吃掉内容的失效方式,四五次事故各占一半:
 *
 * ### 1. shell 把反引号当命令替换(根因,发生 5 次)
 *
 * ```bash
 * node -e "…'| `@dshwar/llm-local` |'…"      # ← 未转义的反引号
 * ```
 *
 * bash 在**双引号内**仍会做命令替换:`@dshwar/llm-local` 被当成命令跑,
 * 报 `No such file or directory` 到 stderr,替换结果是**空串**,
 * 而整条命令**退出码 0**。于是表格单元格变空,一切看起来正常。
 *
 * ⇒ **本工具的内容一律从文件读**(`--summary-file`),命令行只传路径与
 * 短标识符。内容不进 shell 字符串,这一整类就没有发生的余地。
 *
 * ### 2. 正则匹配整行,Prettier 一重排列宽就失配(发生 2 次)
 *
 * `s.replace(/\| 2 +\| 离线判定[^\n]*\n/, …)` —— 空格数变了就不匹配,
 * `replace` 安静返回原文,状态**退回上一个值**。
 *
 * ⇒ 定位改走 `lib/md-table.mjs` 的**按列内容匹配**,列宽无关;
 * 且定位失败**抛错**而不是不改。
 *
 * ## 用法
 *
 * ```bash
 * # 翻一个 Session 的状态(定位靠列内容,不靠行正则)
 * node scripts/session-tasks.mjs status --version 0.6.5 --session 2 --mark ✅
 *
 * # 压缩归档:把版本块里的 ### 小节移进 HISTORY,正文换成摘要文件的内容
 * node scripts/session-tasks.mjs archive --version 0.6.5 --summary-file <path>
 *
 * # 三条校验(CLAUDE.md 第三节)
 * node scripts/session-tasks.mjs check
 * ```
 *
 * 每个写操作都**回读并断言**,失败以非零码退出。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTableCell, TableEditError } from './lib/md-table.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = join(REPO, 'SESSION_TASKS.md')
const HISTORY = join(REPO, 'SESSION_TASKS_HISTORY.md')

/** CLAUDE.md 第三节的上限。 */
const MAX_CHARS = 150_000
/** 合法的状态图例。传别的值直接拒 —— 图例统一是文档纪律的一部分。 */
const MARKS = ['✅', '🔄', '⬜', '🟠']

/**
 * 极简参数解析。与 `gateway/src/server.ts` 同款理由:几个参数不值得一个依赖。
 * @param {readonly string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined || !arg.startsWith('--')) continue
    const next = argv[i + 1]
    out[arg.slice(2)] = next === undefined || next.startsWith('--') ? 'true' : next
    if (next !== undefined && !next.startsWith('--')) i += 1
  }
  return out
}

/**
 * 找一个版本块的字符区间 `[start, end)`。
 *
 * ⚠️ **必须锚在 `## ` 标题行上,不能拿 `indexOf('M0.6.5')` 了事。**
 * 版本号在文件顶部的「版本路线」表与各处交叉引用里也出现,而那些位置
 * 排在真正的版本块**之前** —— 按裸 `indexOf` 找,区间会从路线图开始、
 * 到下一个 `## ` 结束,于是**整个版本块都不在范围里**。
 *
 * 本模块第一版就是这么写的,结果 `check` 报了三个假阳性(说 0.5.5 /
 * 0.5.0 / 0.4.5 缺归档指针,而三个都有)。逐个人工核对才发现是工具的错。
 * 记在这里:**一个报错的工具与一个不报错的工具,同样需要被核对。**
 *
 * @param {string} md
 * @param {string} version
 */
function versionBlockRange(md, version) {
  // 版本块标题形如:`## <span …>●</span> M0.6.5 · 本地模型 …`
  const heading = new RegExp(`^## .*\\bM${version.replace(/\./g, '\\.')}\\b.*$`, 'm')
  const m = heading.exec(md)
  if (m === null || m.index === undefined) {
    throw new TableEditError(`找不到形如 "## … M${version} …" 的版本块标题`)
  }
  const start = m.index

  // ⚠️ 区间的**下界是下一个版本块标题**,不是「下一个 `## `」。
  //
  // 文档里的层级并不统一:V0.5.5 与 V0.5.0 的小节用了 `## `(其余版本用
  // `###`)。按「下一个 `## `」收界,这两块的区间会在第一个小节处截断,
  // 于是块末尾的归档指针落在区间外 —— `check` 因此报了两个假阳性。
  //
  // 「版本块到下一个版本块为止」才是这里真正要表达的意思,所以直接这么写。
  const versionHeading = /^## .*\bM\d+\.\d+\.\d+\b/gm
  versionHeading.lastIndex = start + 1
  const next = versionHeading.exec(md)
  return { start, end: next === null ? md.length : next.index }
}

/** 翻一个 Session 的状态。 */
function cmdStatus(/** @type {Record<string,string>} */ args) {
  const { version, session, mark } = args
  if (version === undefined || session === undefined || mark === undefined) {
    throw new TableEditError('用法: status --version <v> --session <n> --mark <✅|🔄|⬜|🟠>')
  }
  if (!MARKS.includes(mark)) {
    throw new TableEditError(`状态必须是 ${MARKS.join(' / ')} 之一,收到 ${JSON.stringify(mark)}`)
  }

  const md = readFileSync(MAIN, 'utf8')
  const { start, end } = versionBlockRange(md, version)
  const next = setTableCell(md, {
    from: start,
    to: end,
    matchColumn: 0, // Session 号
    matchValue: session,
    setColumn: -1, // 状态是最后一列
    setValue: mark,
  })
  writeFileSync(MAIN, next, 'utf8')

  // ★ 回读断言 —— 写完不等于写对。这条是前几次静默退回唯一的捕手,
  //   现在留着当第二道:定位失败已经会抛,但回读能抓住「抛了却写进去别的」。
  const back = readFileSync(MAIN, 'utf8')
  const { start: s2, end: e2 } = versionBlockRange(back, version)
  const row = back
    .slice(s2, e2)
    .split('\n')
    .find((l) => /^\s*\|/.test(l) && l.split('|')[1]?.trim() === session)
  if (row === undefined || !row.includes(mark)) {
    throw new TableEditError(`回读失败:Session ${session} 的状态没有变成 ${mark}`)
  }
  console.log(`✔ V${version} Session ${session} → ${mark}`)
  console.log(`  ${row.trim()}`)
}

/** 压缩归档:抽出版本块里的 `###` 小节 → HISTORY 开头,正文换成摘要文件。 */
function cmdArchive(/** @type {Record<string,string>} */ args) {
  const { version } = args
  const summaryFile = args['summary-file']
  if (version === undefined || summaryFile === undefined) {
    throw new TableEditError('用法: archive --version <v> --summary-file <path>')
  }

  const md = readFileSync(MAIN, 'utf8')
  const { start, end } = versionBlockRange(md, version)
  const block = md.slice(start, end)

  const firstSection = block.indexOf('\n### ')
  if (firstSection === -1) throw new TableEditError(`版本块 M${version} 里没有 ### 小节可归档`)

  const detail = block.slice(firstSection + 1)
  // 归档前先记下全部小节标题 —— 校验 2 要用它们逐条比对
  const titles = [...detail.matchAll(/^### .+$/gm)].map((m) => m[0])
  if (titles.length === 0) throw new TableEditError('抽取到的内容里没有 ### 小节,拒绝归档')

  // 摘要**从文件读** —— 不经 shell,反引号与竖线都安全
  const summary = readFileSync(resolve(summaryFile), 'utf8')

  const nextMain = md.slice(0, start) + block.slice(0, firstSection + 1) + summary + md.slice(end)
  const history = readFileSync(HISTORY, 'utf8')
  const nextHistory = `# M${version} —— 实现细节归档\n\n---\n\n${detail}\n${history}`

  writeFileSync(MAIN, nextMain, 'utf8')
  writeFileSync(HISTORY, nextHistory, 'utf8')

  // ★ 回读:每个被抽走的小节标题必须能在主文件或归档里找到(校验 2)
  const backMain = readFileSync(MAIN, 'utf8')
  const backHistory = readFileSync(HISTORY, 'utf8')
  const lost = titles.filter((t) => !backMain.includes(t) && !backHistory.includes(t))
  if (lost.length > 0) {
    throw new TableEditError(`归档丢了 ${lost.length} 个小节:\n  ${lost.join('\n  ')}`)
  }
  console.log(`✔ M${version} 归档 ${titles.length} 个小节,摘要来自 ${summaryFile}`)
}

/** CLAUDE.md 第三节的三条校验。 */
function cmdCheck() {
  const md = readFileSync(MAIN, 'utf8')
  let failed = 0

  // 1. 字符数(不是字节 —— 中文差 1.6 倍)
  const chars = md.length
  const ok1 = chars < MAX_CHARS
  console.log(
    `  ${ok1 ? '通过' : '违规'}  主文件 ${chars.toLocaleString()} 字符 < ${MAX_CHARS.toLocaleString()}`,
  )
  if (!ok1) failed += 1
  else if (chars > (MAX_CHARS * 2) / 3) console.log(`        ⚠️ 已过上限 2/3,该准备压缩了`)

  // 3. 不得残留 Session prompt
  const prompts = (md.match(/^读取 CLAUDE\.md/gm) ?? []).length
  const ok3 = prompts === 0
  console.log(`  ${ok3 ? '通过' : '违规'}  主文件残留 Session prompt: ${prompts} 处(须为 0)`)
  if (!ok3) failed += 1

  // 2. 已压缩的版本块必须指向归档(校验 2 的可自动化部分:
  //    「小节标题都能找到」需要压缩前的快照,那一条在 archive 时当场回读)
  const compressed = [...md.matchAll(/^## .*?M(\d+\.\d+\.\d+).*\[开发完成\]/gm)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  )
  const missingPointer = compressed.filter((v) => {
    const { start, end } = versionBlockRange(md, v)
    return !md.slice(start, end).includes('实现细节见 SESSION_TASKS_HISTORY.md')
  })
  const ok2 = missingPointer.length === 0
  console.log(
    `  ${ok2 ? '通过' : '违规'}  ${compressed.length} 个已压缩版本块都指向归档` +
      (ok2 ? '' : `(缺:${missingPointer.join(', ')})`),
  )
  if (!ok2) failed += 1

  if (failed > 0) {
    console.log(`\n${failed} 项未通过。见 CLAUDE.md 第三节。`)
    process.exit(1)
  }
  console.log('\n文档瘦身校验通过。')
}

const [, , cmd, ...rest] = process.argv
const args = parseArgs(rest)

try {
  if (cmd === 'status') cmdStatus(args)
  else if (cmd === 'archive') cmdArchive(args)
  else if (cmd === 'check') cmdCheck()
  else {
    console.error('用法: session-tasks.mjs <status|archive|check> [选项]')
    console.error('详见本文件头部的说明。')
    process.exit(2)
  }
} catch (error) {
  console.error(`\n🚨 ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
