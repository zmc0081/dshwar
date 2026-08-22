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

/** @param {string[]} subcommand */
function git(subcommand) {
  return execFileSync('git', subcommand, {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * 找一个能用的基线 ref。
 *
 * ## 为什么 CI 的选择写在这里,而不是 workflow 里
 *
 * 这段逻辑本来在 `ci.yml` 里,用一个三元表达式算出 `--base` 传进来。
 * 那是**门禁的一部分散落进了 CI 配置** —— 而 CI 与本地的漂移正是
 * 首次真实 runner 复盘查出来的根因。收进脚本之后 CI 只需要 `pnpm check:all`,
 * 一处都不用复述。
 *
 * ⚠️ **`origin/main` 在 main 分支的 push 上是个陷阱。** 检出之后
 * `origin/main` 就等于 `HEAD`,自己跟自己比,差异恒为空 ——
 * 检查会**报「无破坏性变更」而不是报「基线取不到」**。
 * 那种绿比红危险得多:它看起来是通过了。所以 CI 上必须显式选 `HEAD~1`。
 */
function resolveBaseRef() {
  if (baseArg !== undefined) return baseArg

  // PR:比目标分支。GITHUB_BASE_REF 只在 pull_request 事件里非空。
  const prBase = process.env['GITHUB_BASE_REF']
  if (prBase !== undefined && prBase !== '') {
    for (const ref of [`origin/${prBase}`, prBase]) {
      try {
        git(['rev-parse', '--verify', `${ref}^{commit}`])
        return ref
      } catch {
        continue
      }
    }
  }

  // push(含 main 自己):比上一个提交。见上面那条陷阱。
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    try {
      git(['rev-parse', '--verify', 'HEAD~1^{commit}'])
      return 'HEAD~1'
    } catch {
      // 首个提交没有 HEAD~1 —— 落到下面的通用回退,由它报「基线取不到」
    }
  }

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

/**
 * 读某个 ref 下的契约。该 ref 下还没有这个文件时返回 undefined。
 * @param {string} ref
 */
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
    if (/['"]@dshwar\/api-contract['"]\s*:\s*major/.test(frontmatter[1] ?? '')) {
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
/**
 * ★ **advisory 只打印,不参与任何退出码判定。**
 *
 * 它收的是「判得出变了、判不出破坏了谁」的那一类 —— 约束收紧的破坏性
 * 取决于调用方实际发送的值,而分类器看不到调用方。
 *
 * ⚠️ 下面这个变量**绝不能进任何 `process.exit` 的条件**。
 * 让它有能力染红门禁的后果很具体:Zod 换一次表示就冒出几十条,
 * 而那正是第五节要求 48 小时跟上上游的时刻 —— 几十条误报会训练人
 * 跳过这条检查,而它刚补完十几个维度。
 * **一条会让人学会忽略它的规则,比一个漏报更贵。**
 *
 * 谁盯着这一点:`verify-guards.mjs` 里那条负向验证 ——
 * 植入一次约束收紧,断言输出里有它**且退出码仍是 0**。
 */
const advisory = changes.filter((c) => c.kind === 'advisory')

/** 提示档的渲染。放在函数里,是为了让「它只被调用、从不参与判定」一眼可见。 */
function printAdvisory() {
  if (advisory.length === 0) return
  console.log(`\n提示 ${advisory.length} 处(不阻塞,需人工判断):`)
  for (const change of advisory.slice(0, 10)) {
    console.log(`    提示  [${change.code}] ${change.where}  ${change.detail}`)
  }
  if (advisory.length > 10) console.log(`    ...  另有 ${advisory.length - 10} 处提示`)
}

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
  console.log(
    additive.length === 0 && advisory.length === 0 ? '\n契约未变。' : '\n全部为相容变更,放行。',
  )
  // ⚠️ 打印在 exit 之前,但**不参与** exit 的条件 —— 这正是 advisory 的定义。
  printAdvisory()
  process.exit(0)
}

printAdvisory()

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
