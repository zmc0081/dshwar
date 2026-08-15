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
  // Session 0 验证工作区不受产品代码纪律约束(feasibility/README.md 有说明)
  'feasibility',
])

/**
 * 递归收集文件。
 * @param {string} root 起始目录（不存在时返回空数组，未落地的目录不算违规）
 * @param {(path: string) => boolean} accept 以仓库相对路径判定是否收录
 * @returns {string[]} 绝对路径列表
 */
export function collectFiles(root, accept) {
  const out = []
  let stat
  try {
    stat = statSync(root)
  } catch {
    return out
  }
  if (!stat.isDirectory()) return out

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

/** 以正斜杠归一化仓库相对路径,好让规则在 Windows 与 Linux 上写法一致。 */
export function repoPath(repoRoot, absolute) {
  return relative(repoRoot, absolute).split(sep).join('/')
}

/**
 * 在若干文件中查找匹配行。
 * @param {string[]} files 绝对路径
 * @param {RegExp} pattern 需带 g 标志的正则
 * @param {string} repoRoot
 * @returns {{file: string, line: number, text: string}[]}
 */
export function grepFiles(files, pattern, repoRoot) {
  const hits = []
  for (const file of files) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i] ?? ''
      pattern.lastIndex = 0
      if (pattern.test(text)) {
        hits.push({ file: repoPath(repoRoot, file), line: i + 1, text: text.trim() })
      }
    }
  }
  return hits
}

/** 常用的文件类型判定 */
export const isTs = (p) => /\.(ts|tsx|mts|cts)$/.test(p) && !/\.d\.ts$/.test(p)
export const isPackageJson = (p) => p.endsWith('package.json')
