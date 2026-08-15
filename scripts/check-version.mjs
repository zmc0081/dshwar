#!/usr/bin/env node
/**
 * 版本号全仓一致性校验(CLAUDE.md 第四节,发布阻塞级)。
 *
 * 所有 @dshwar/* 包统一版本号(changesets fixed 模式)。以下位置任一不一致即失败:
 *   1. root package.json 的 version
 *   2. 各 workspace 包的 version
 *   3. CLAUDE.md 顶部「当前版本」
 *   4. SESSION_TASKS.md 头部「当前版本(正在开发)」
 *   5. README.md 兼容矩阵中的 DSHWAR 版本行
 *   6. gateway 的 OpenAPI info.version(V0.2.0 起才有,缺失时跳过)
 *
 * 以 root package.json 为基准 —— changesets 提升的就是它,让它当唯一事实源。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const p = (...seg) => join(REPO, ...seg)

const read = (file) => readFileSync(file, 'utf8')

/** @type {{where: string, version: string | null, hint?: string}[]} */
const found = []

// ---------- 1. root package.json(基准) ----------
const rootPkg = JSON.parse(read(p('package.json')))
const expected = rootPkg.version
found.push({ where: 'package.json (root)', version: expected })

// ---------- 2. 各 workspace 包 ----------
for (const area of ['packages', 'adapters', 'gateway', 'examples']) {
  const base = p(area)
  if (!existsSync(base)) continue
  const stat = statSync(base)
  const dirs = stat.isDirectory() && area === 'gateway' ? [base] : []
  if (dirs.length === 0 && stat.isDirectory()) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(base, entry.name))
    }
  }
  for (const dir of dirs) {
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(read(pkgPath))
    // examples/ 与私有包不发布,不参与统一版本号
    if (pkg.private === true) continue
    found.push({
      where: `${area}/${pkg.name ?? dir}`,
      version: pkg.version ?? null,
      hint: 'workspace 包的 version 由 changesets fixed 模式统一提升',
    })
  }
}

// ---------- 3/4. CLAUDE.md 与 SESSION_TASKS.md 的「当前版本」 ----------
// 容忍全角/半角括号与冒号 —— 文档是人写的,不该因标点差异而失败
const CURRENT_VERSION_RE =
  /当前版本\s*[（(]\s*正在开发\s*[）)]\s*[:：]\s*\*\*\s*[Vv]?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\s*\*\*/

for (const [file, label] of [
  ['CLAUDE.md', 'CLAUDE.md 顶部「当前版本」'],
  ['SESSION_TASKS.md', 'SESSION_TASKS.md 头部「当前版本」'],
]) {
  const path = p(file)
  if (!existsSync(path)) {
    found.push({ where: label, version: null, hint: `${file} 不存在` })
    continue
  }
  const m = CURRENT_VERSION_RE.exec(read(path))
  found.push({
    where: label,
    version: m ? m[1] : null,
    hint: m ? undefined : `未匹配到「当前版本(正在开发): **V<x.y.z>**」`,
  })
}

// ---------- 5. README 兼容矩阵 ----------
{
  const path = p('README.md')
  if (!existsSync(path)) {
    found.push({ where: 'README.md 兼容矩阵', version: null, hint: 'README.md 不存在' })
  } else {
    // 矩阵首列即 DSHWAR 版本;取「## 兼容矩阵」之后的第一个数据行
    const readme = read(path)
    const section = readme.split(/^##\s+兼容矩阵\s*$/m)[1] ?? ''
    const rows = section
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()))
    // 跳过表头
    const dataRow = rows.slice(1).find((l) => /\|\s*[0-9]+\.[0-9]+\.[0-9]+/.test(l))
    const m = dataRow
      ? /\|\s*([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\s*\|/.exec(dataRow)
      : null
    found.push({
      where: 'README.md 兼容矩阵',
      version: m ? m[1] : null,
      hint: m ? undefined : '未在「## 兼容矩阵」下找到 DSHWAR 版本行',
    })
  }
}

// ---------- 6. gateway OpenAPI info.version(V0.2.0 起) ----------
for (const candidate of [
  'gateway/openapi.json',
  'gateway/openapi.yaml',
  'gateway/src/openapi.json',
]) {
  const path = p(candidate)
  if (!existsSync(path)) continue
  const text = read(path)
  const m = /["']?version["']?\s*[:=]\s*["']([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)["']/.exec(
    text,
  )
  found.push({
    where: `${candidate} (OpenAPI info.version)`,
    version: m ? m[1] : null,
    hint: m ? undefined : '未解析到 info.version',
  })
}

// ---------- changesets fixed 组覆盖率 ----------
// 光有 fixed 配置不够:漏一个包出去,它就会独立走版本号,而 changesets 不会报错,
// 直到发布那天才发现全仓版本号裂开。这里主动比对。
//
// 注意:包尚未落地时(Session 1),publishable 为空,本项自然通过 ——
// changesets 自己会对 "@dshwar/*" 匹配不到包发出警告,那是预期的,非致命。
function checkFixedCoverage() {
  const configPath = p('.changeset', 'config.json')
  if (!existsSync(configPath)) return null
  let config
  try {
    config = JSON.parse(read(configPath))
  } catch {
    return { ok: false, detail: '.changeset/config.json 解析失败' }
  }

  const publishable = found
    .filter((f) => f.where.startsWith('packages/') || f.where.startsWith('adapters/'))
    .map((f) => f.where.split('/').slice(1).join('/'))
    .filter((name) => name.startsWith('@dshwar/'))

  if (publishable.length === 0) return { ok: true, detail: '尚无可发布的 @dshwar/* 包,跳过' }

  const groups = config.fixed ?? []
  const patterns = groups.flat()
  const uncovered = publishable.filter(
    (name) =>
      !patterns.some((pat) => {
        if (pat === name) return true
        if (!pat.includes('*')) return false
        const re = new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
        return re.test(name)
      }),
  )

  if (uncovered.length > 0) {
    return {
      ok: false,
      detail: `未被 changesets fixed 组覆盖:${uncovered.join(', ')} —— 它们会独立走版本号`,
    }
  }
  return { ok: true, detail: `${publishable.length} 个包全部在 fixed 组内` }
}

// ---------- 判定 ----------
console.log(`DSHWAR · 版本一致性校验\n\n基准(root package.json): ${expected}\n`)

let failed = 0
for (const item of found) {
  const ok = item.version === expected
  if (!ok) failed += 1
  const mark = ok ? '  一致' : '不一致'
  console.log(`  ${mark}  ${item.where.padEnd(42)} ${item.version ?? '（未找到）'}`)
  if (!ok && item.hint) console.log(`          ${item.hint}`)
}

const coverage = checkFixedCoverage()
if (coverage) {
  if (!coverage.ok) failed += 1
  console.log(
    `  ${coverage.ok ? '  一致' : '不一致'}  ${'changesets fixed 组覆盖'.padEnd(40)} ${coverage.detail}`,
  )
}

console.log('')
if (failed > 0) {
  console.log(`${failed} 项未通过。CLAUDE.md 第四节:任一不一致 = 发布阻塞。`)
  console.log('提示:新版本规划确立后、第一个 Session 开工前,须先把全部位置改为正在开发的版本号。')
  process.exit(1)
}
console.log(`全部 ${found.length} 处版本号一致。`)
