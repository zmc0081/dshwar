#!/usr/bin/env node
/**
 * 契约冻结检查 —— 把「契约不能随便改」变成机制。
 *
 * ## 基线是 git,不是另一个快照文件
 *
 * 直觉做法是在仓库里另存一份 `openapi.snapshot.json` 当基线。那样行不通:
 * 改契约的人必然会顺手更新快照,于是快照与当前永远相等,检查恒绿。
 * 真正的基线是**上一次提交里的那一份** —— 它不在本次改动者的手边。
 *
 * ## 破坏性变更怎么放行
 *
 * 需要一份 `major` 的 changeset,且点名 `@dshwar/api-contract`。
 * 它同时满足任务书的两个要求:**显式声明**(躺在 PR diff 里,评审看得见)与
 * **升大版**(changesets 据此提升版本号)。写在 PR 描述里的声明做不到第二点,
 * 也留不下痕迹。
 *
 * 用法:
 *   node scripts/check-contract.mjs                  # 与 origin/main 比,自动回退
 *   node scripts/check-contract.mjs --base HEAD~1
 *   node scripts/check-contract.mjs --base <ref> --json
 *
 * 退出码:相容 0;有破坏性变更且未声明 1;基线取不到 0(带说明)。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { breakingChanges, diffContract } from '../packages/api-contract/src/freeze.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT = 'packages/api-contract/openapi.json'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const baseArg = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined

function git(subcommand) {
  return execFileSync('git', subcommand, {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** 找一个能用的基线 ref。CI 上有 origin/main,本地开发时未必。 */
function resolveBaseRef() {
  if (baseArg !== undefined) return baseArg
  for (const ref of ['origin/main', 'main', 'HEAD']) {
    try {
      git(['rev-parse', '--verify', `${ref}^{commit}`])
      return ref
    } catch {
      continue
    }
  }
  return undefined
}

/** 读某个 ref 下的契约。该 ref 下还没有这个文件时返回 undefined。 */
function readContractAt(ref) {
  try {
    return JSON.parse(git(['show', `${ref}:${CONTRACT}`]))
  } catch {
    return undefined
  }
}

/** 本次改动里有没有点名 api-contract 的 major changeset。 */
function findMajorDeclaration() {
  const dir = join(REPO, '.changeset')
  if (!existsSync(dir)) return undefined

  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === 'README.md') continue
    const text = readFileSync(join(dir, name), 'utf8')
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)
    if (frontmatter === null) continue
    // fixed 模式下写哪个包都会一起提升,但这里坚持点名 api-contract ——
    // 破坏的是契约,声明就该落在契约上,而不是随手写在某个实现包上。
    if (/['"]@dshwar\/api-contract['"]\s*:\s*major/.test(frontmatter[1])) {
      return { file: `.changeset/${name}`, reason: text.slice(frontmatter[0].length).trim() }
    }
  }
  return undefined
}

const current = JSON.parse(readFileSync(join(REPO, CONTRACT), 'utf8'))
const baseRef = resolveBaseRef()
const baseline = baseRef === undefined ? undefined : readContractAt(baseRef)

if (baseline === undefined) {
  // 首次提交契约,或仓库里还没有基线。不是错误,但要说出来 ——
  // 静默通过会让人以为检查跑过了。
  console.log('DSHWAR · 契约冻结检查\n')
  console.log(`  跳过  取不到基线(ref=${baseRef ?? '无'})—— 契约尚未进入版本历史`)
  process.exit(0)
}

const changes = diffContract(baseline, current)
const breaking = breakingChanges(changes)
const additive = changes.filter((c) => c.kind === 'additive')

if (asJson) {
  console.log(JSON.stringify({ baseRef, changes }, null, 2))
}

console.log('DSHWAR · 契约冻结检查\n')
console.log(`基线: ${baseRef}:${CONTRACT}`)
console.log(`差异: 破坏性 ${breaking.length} 处,相容 ${additive.length} 处\n`)

for (const change of additive.slice(0, 20)) {
  console.log(`    相容  [${change.code}] ${change.where}  ${change.detail}`)
}
if (additive.length > 20) console.log(`    ...  另有 ${additive.length - 20} 处相容变更`)

if (breaking.length === 0) {
  console.log(additive.length === 0 ? '\n契约未变。' : '\n全部为相容变更,放行。')
  process.exit(0)
}

console.log('')
for (const change of breaking) {
  console.log(`  破坏性  ${change.where}`)
  console.log(`          [${change.code}] ${change.detail}`)
}

const declaration = findMajorDeclaration()
if (declaration !== undefined) {
  console.log(`\n已声明:${declaration.file}`)
  console.log('破坏性变更已显式声明并将升大版,放行。')
  console.log('⚠️ 提醒:v1 与新版本需并行不少于 6 个月(本版本红线第 4 条)。')
  process.exit(0)
}

console.log(`
契约出现破坏性变更,但没有声明。

要么把它改成相容的(加字段请加成可选、加错误码请另开大版),
要么加一份点名契约包的 major changeset:

    ---
    '@dshwar/api-contract': major
    ---

    说清楚破坏了什么、为什么值得、老客户端怎么迁移。

CLAUDE.md 与本版本红线第 4 条:/v1/ 路径版本化,破坏性变更升大版,
双版本并行不少于 6 个月。`)
process.exit(1)
