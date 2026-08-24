/**
 * 极简文件遍历与正则扫描。刻意不引依赖:守卫脚本必须在 `pnpm install` 之前
 * 也能跑(CI 的 install 步骤挂掉时,守卫的错误信息比 install 的更有用)。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.changeset',
  'coverage',
  // Session 0 验证工作区不受产品代码纪律约束(各自的 README 有说明)
  'feasibility',
  'feasibility-v2',
  // git worktree 在仓库内部展开时会带来一份完整副本。扫进去的话,守卫会把
  // 副本里的每个包都报成「未登记进根 tsconfig」—— 而它们本来就登记在
  // 副本自己的根 tsconfig 里。那份副本跑它自己的门禁。
  '.claude',
])

/**
 * 递归收集文件。
 * @param {string} root 起始目录（不存在时返回空数组，未落地的目录不算违规）
 * @param {(path: string) => boolean} accept 以仓库相对路径判定是否收录
 * @returns {string[]} 绝对路径列表
 */
export function collectFiles(root, accept) {
  /** @type {string[]} */
  const out = []
  let stat
  try {
    stat = statSync(root)
  } catch {
    return out
  }
  if (!stat.isDirectory()) return out

  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name))
      } else if (entry.isFile()) {
        const full = join(dir, entry.name)
        if (accept(full)) out.push(full)
      }
    }
  }
  walk(root)
  return out
}

/**
 * 以正斜杠归一化仓库相对路径,好让规则在 Windows 与 Linux 上写法一致。
 * @param {string} repoRoot
 * @param {string} absolute
 */
export function repoPath(repoRoot, absolute) {
  return relative(repoRoot, absolute).split(sep).join('/')
}

/**
 * 行级豁免标记。
 *
 * ## 为什么必须有这个东西
 *
 * 执行一条规则的代码,往往长得像违反那条规则。`@dshwar/subject` 里那份
 * **拒绝**密码字段的清单必须写出 `password` 这个词,于是它撞上了「不得出现
 * password」的守卫 —— 而那份清单正是硬规则 4 的执行者。
 *
 * 没有豁免机制时,人会去做更糟的事:弱化守卫的正则,或者把字符串拆成
 * `'pass' + 'word'` 绕过。前者让所有人失去保护,后者让代码变得没法读。
 *
 * ## 为什么是这个形状
 *
 * - **行级**,不是文件级或目录级 —— 豁免一整个文件等于在最该看紧的地方关掉监控。
 *   写在被豁免行的**本行或上一行**,与 `eslint-disable-next-line` 的惯例一致。
 * - **必须写理由**,空理由不算豁免。理由是给未来的评审看的,不是给脚本看的。
 * - **可被一条 grep 审计完**:`grep -rn "dshwar-guard-allow" packages/ gateway/`
 *   一次列出全仓所有豁免。豁免变多时是看得见的。
 */
const ALLOW_MARKER = /dshwar-guard-allow:\s*(\S.*)$/

/**
 * 单次进程内的文件内容缓存(按行切好)。
 *
 * ## 为什么值得
 *
 * `check-guards.mjs` 有二十多条守卫,其中八条各自 grep 一遍 `packages/` 与
 * `gateway/` 的全部 TS 文件 —— 同一批文件被**读了八遍、切了八遍行**。
 * 实测:一次 check-guards 约 506 ms,其中 node 启动 91 ms、`collectFiles`
 * 只有 4 ms,剩下的四百多毫秒基本都在这里。
 *
 * 而 `verify-guards.mjs` 要 fork 它**四十次**(每条负向验证一次)——
 * 于是这个缓存是唯一一处「改一行、四十处都快」的地方。
 *
 * ⚠️ **缓存只活在一次进程里,这一点是必须的。** 守卫脚本是一次性的:
 * 起来、扫一遍、退出。而 `verify-guards` 每次植入夹具后都**重新 fork**,
 * 拿到的是全新的进程和空缓存 —— 所以不存在「夹具写了但守卫读到旧内容」。
 * 若哪天有人把守卫改成常驻或在同一进程里跑两遍,这个缓存**会**给出陈旧结果;
 * 那时要么按 mtime 失效,要么显式清空。这句话留在这里就是为了那一天。
 */
const contentCache = new Map()

/** @param {string} file @returns {string[] | undefined} 按行切好的内容;读不到返回 undefined */
function linesOf(file) {
  const cached = contentCache.get(file)
  if (cached !== undefined) return cached === null ? undefined : cached
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    contentCache.set(file, null)
    return undefined
  }
  const lines = content.split(/\r?\n/)
  contentCache.set(file, lines)
  return lines
}

/**
 * 这一行**整行是注释**吗。
 *
 * ## 为什么所有文本形状守卫都要跳过它 —— CLAUDE.md「守卫不能惩罚记录」
 *
 * 一条守卫要拦的形状,恰恰是最值得在注释里**写下来**的那个。
 * 两者在文本上一模一样,语义相反:一处是在犯,一处是在讲这是错的。
 *
 * 而这一族误报的代价比普通误报更贵:**人不会绕过它,人会照它说的改** ——
 * 而唯一能改的就是把那段解释删掉。于是守卫成功地让仓库变得更难懂,
 * 并且全程显示为绿。
 *
 * ### 实测(V0.9.0 Session 2,两次)
 *
 * 1. 回执守卫第一次跑就报了 `CodeRef.tsx:18` —— 一段讲「原版为什么错」的 JSDoc;
 * 2. 约束 1 的路由守卫报了 `App.tsx:102` ——
 *    `// ⚠️ 赋值给 location.hash 而不是 history.pushState ——`
 *    那一行**正是在解释为什么遵守这条约束**。
 *
 * ## ⚠️ 判据是「这一行**是**注释」,不是「这一行**含**注释标记」
 *
 * 后者会放过 `import x from '@deepseek-ai/dsh-fs/lib/x.js' // TODO` ——
 * 把一个记录问题的修复,变成一个真实的漏报。
 *
 * 而「整行是注释」的代码**不执行**,所以跳过它不可能藏住真违规:
 * 注释掉的深链 import 不会 import 任何东西。
 *
 * @param {string} line
 */
export function isWholeLineComment(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/**
 * 这一段字符串内容是**说明**,还是一个**标识符**?
 *
 * 判据只有一条:**带空格或非 ASCII 字符的是说明**。
 *
 * | 内容 | 判定 | 为什么 |
 * | --- | --- | --- |
 * | `浏览器里的 localStorage 对任何脚本可读` | 说明 | 有空格、有中文 |
 * | `不要把 refreshToken 放进 localStorage` | 说明 | 同上 |
 * | `localStorage` | **标识符** | `window['localStorage']` 的下标就长这样 |
 * | `@deepseek-ai/dsh-fs/lib/x.js` | **标识符** | import 的模块名不带空格 |
 *
 * ⚠️ 判据必须窄成这样,否则会开出一条真实的绕过路径:
 * 「字符串里的一律不算」会让 `window['localStorage']` 与
 * `require('@dshwar/billing-hosted')` 一起变成合法写法 ——
 * 那不是少报一次误报,那是把守卫拆了。
 *
 * @param {string} body 引号之间的内容
 */
function isProse(body) {
  return /\s/.test(body) || /[^ -~]/.test(body)
}

/**
 * 把一行里**说明性字符串**的内容抹成空格,其余原样。
 *
 * ## 为什么要有这一步 —— CLAUDE.md「守卫不能惩罚记录」的第二种载体
 *
 * {@link isWholeLineComment} 覆盖的是「整行是注释」。但同一段说明还有
 * 第二种写法:**它是一句抛出去的错误信息**。
 *
 * V0.9.0 Session 5 实测:`workbench-web/src/hosts.ts` 里
 * `hostSecrets('remote-web', …)` 抛的那句话解释「浏览器里为什么不能存长效凭据」,
 * 而约束 2 的守卫把它判成了「在用浏览器存储」。两者文本一模一样、语义相反,
 * 与 CodeRef.tsx 那次 JSDoc 是同一个形状,只是换了个载体。
 *
 * 这一族误报的代价见 CLAUDE.md:**人不会绕过它,人会照它说的改** ——
 * 而唯一能改的就是把那句解释删掉,或者更糟:给一条**安全守卫**开豁免标记。
 *
 * ## ⚠️ 模板串里的 `${…}` 不抹
 *
 * `` `${localStorage.getItem(k)} 条` `` 的插值段是**真代码**。
 * 整段抹掉的话,一个带中文的模板串就成了藏违规的地方。
 *
 * ## 已知边界(写出来,免得被读成「都盖住了」)
 *
 * `eval("localStorage.setItem('k', v)")` 这类**把代码写在带空格的字符串里**的
 * 写法会被放过。判据认不出它 —— 而这一族本来也不该由文本形状守卫来拦。
 *
 * @param {string} line
 */
export function withoutStringProse(line) {
  return line.replace(
    /(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g,
    (/** @type {string} */ whole, /** @type {string} */ quote, /** @type {string} */ body) => {
      if (quote !== '`') return isProse(body) ? `${quote}${' '.repeat(body.length)}${quote}` : whole
      const kept = body.replace(/\$\{[^}]*\}|(?:(?!\$\{)[\s\S])+/g, (chunk) =>
        chunk.startsWith('${') || !isProse(chunk) ? chunk : ' '.repeat(chunk.length),
      )
      return `${quote}${kept}${quote}`
    },
  )
}

/**
 * 在若干文件中查找匹配行。
 *
 * 三类命中会被跳过:
 *
 * 1. **整行是注释**的 —— 见 {@link isWholeLineComment}。守卫不能惩罚记录。
 * 2. 只落在**说明性字符串**里的 —— 见 {@link withoutStringProse}。同一条规则,
 *    换了个载体(错误信息、文案、任务书里的引文)。
 * 3. 带 `dshwar-guard-allow: <理由>` 标记的,理由为空则**不算豁免**。
 *
 * ⚠️ 第 2 条只跳过**说明**,不跳过字符串本身:`window['localStorage']` 与
 * `from '@deepseek-ai/dsh-fs/lib/x'` 里的字符串不带空格,照旧红。
 *
 * @param {string[]} files 绝对路径
 * @param {RegExp} pattern 需带 g 标志的正则
 * @param {string} repoRoot
 * @returns {{file: string, line: number, text: string}[]}
 */
export function grepFiles(files, pattern, repoRoot) {
  /** @type {{file: string, line: number, text: string}[]} */
  const hits = []
  for (const file of files) {
    const lines = linesOf(file)
    if (lines === undefined) continue
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i] ?? ''
      pattern.lastIndex = 0
      if (!pattern.test(text)) continue
      if (isWholeLineComment(text)) continue
      // ⚠️ 判定用抹掉说明的那一份,报告仍然用原行 —— 报出来的要是被抹过的行,
      //   人对着一串空格没法判断这条红对不对。
      pattern.lastIndex = 0
      if (!pattern.test(withoutStringProse(text))) continue
      if (ALLOW_MARKER.test(text) || ALLOW_MARKER.test(lines[i - 1] ?? '')) continue
      hits.push({ file: repoPath(repoRoot, file), line: i + 1, text: text.trim() })
    }
  }
  return hits
}

/** 常用的文件类型判定 @param {string} p */
export const isTs = (p) => /\.(ts|tsx|mts|cts)$/.test(p) && !/\.d\.ts$/.test(p)
/** @param {string} p */
export const isPackageJson = (p) => p.endsWith('package.json')
