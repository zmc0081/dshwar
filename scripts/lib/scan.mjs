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
 * 在若干文件中查找匹配行。
 *
 * 带 `dshwar-guard-allow: <理由>` 标记的行会被跳过,理由为空则**不算豁免**。
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
