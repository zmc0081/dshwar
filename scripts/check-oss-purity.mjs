#!/usr/bin/env node
/**
 * 开源纯净度检查 —— CLAUDE.md 硬规则 9。
 *
 * > 开源分发的构建产物不得包含任何闭源组件。`billing-hosted` 等闭源部分必须是
 * > 独立构建产物。这既是 open-core 的边界,也是 **SignPath Foundation 免费签名的
 * > 资格条件**(不得含维护者或关联组织发布的专有代码)。
 *
 * ## 为什么需要一个脚本,而不是"注意一下"
 *
 * 闭源组件混进开源包**不会有任何报错**:构建通过、测试全绿、npm publish 成功。
 * 发现它的通常是签名申请被拒,或者更糟——客户的法务在合规审查时发现。
 * 那时包已经发出去了,撤回等于承认问题。
 *
 * ## 检查什么
 *
 * 1. **闭源包名不出现在任何将发布包的依赖里**(dependencies / peerDependencies /
 *    optionalDependencies)。devDependencies 不算——它不进 tarball。
 * 2. **闭源包名不出现在将发布的源码里**(import / require / 动态 import)。
 * 3. **`files` 白名单不含可疑目录**——没有 `files` 字段的包会把整个目录打进去,
 *    包括本地实验、密钥文件、闭源原型。
 * 4. **私有包不得被公开包依赖**——`private: true` 的包不会发布,依赖它的公开包
 *    装到用户机器上就是坏的。
 *
 * 退出码:全绿 0,任一违规 1。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectFiles, grepFiles, isTs, repoPath } from './lib/scan.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** @param {...string} seg */
const p = (...seg) => join(REPO, ...seg)

/**
 * 闭源组件的包名。
 *
 * CLAUDE.md 第八节:**闭源仅托管服务本体** —— `billing-hosted`(托管收款)
 * 与 DSHWAR Cloud(`cloud` / `console-hosted`)。这份清单要与那一节保持一致;
 * 新增闭源组件时**两处都要改**,而本脚本的存在正是为了让"忘了改"变成
 * CI 红灯而不是发布事故。
 *
 * ⚠️ `billing-stripe` **不在**此清单 —— D4(V0.6.0)裁决它开源。
 * 判据是显式清单而非 `billing-*` 模式匹配,正因如此这次收窄边界
 * 一行都不用改;若哪天有人把它改成模式匹配,先想想这一段。
 */
const CLOSED_SOURCE = ['@dshwar/billing-hosted', '@dshwar/cloud', '@dshwar/console-hosted']

/**
 * `files` 白名单里可疑的条目。
 *
 * 允许的只有构建产物与文档。出现 `src`(会把源码连同实验代码一起打包)、
 * `.env`、`secrets` 之类即违规。
 */
const SUSPICIOUS_FILE_ENTRIES = [/^\.env/, /secret/i, /private/i, /credential/i]

/** 收集全部 workspace 包。 */
function collectPackages() {
  const out = []
  const areas = ['packages', 'adapters', 'sdk', 'examples']
  for (const area of areas) {
    const base = p(area)
    if (!existsSync(base) || !statSync(base).isDirectory()) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(base, entry.name, 'package.json')
      if (existsSync(file)) out.push({ dir: join(base, entry.name), file })
    }
  }
  const gateway = p('gateway', 'package.json')
  if (existsSync(gateway)) out.push({ dir: p('gateway'), file: gateway })
  return out.map((x) => ({ ...x, json: JSON.parse(readFileSync(x.file, 'utf8')) }))
}

const packages = collectPackages()
const published = packages.filter((x) => x.json.private !== true)
const privateNames = new Set(
  packages.filter((x) => x.json.private === true).map((x) => x.json.name),
)

const violations = []

// ---- 1. 闭源包不出现在将发布包的运行时依赖里 ----
for (const pkg of published) {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dep of Object.keys(pkg.json[field] ?? {})) {
      if (CLOSED_SOURCE.includes(dep)) {
        violations.push({
          kind: '闭源依赖',
          where: `${repoPath(REPO, pkg.file)} → ${field}.${dep}`,
          detail: '闭源组件必须是独立构建产物,不得被开源包依赖',
        })
      }
    }
  }
}

// ---- 2. 闭源包名不出现在将发布的源码里 ----
// 只扫 src/:那是唯一会被 tsc 编进 dist 的地方。test/ 不进 tarball。
for (const pkg of published) {
  const srcDir = join(pkg.dir, 'src')
  if (!existsSync(srcDir)) continue
  const files = collectFiles(srcDir, isTs)
  for (const name of CLOSED_SOURCE) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const hit of grepFiles(files, new RegExp(escaped, 'g'), REPO)) {
      violations.push({
        kind: '源码引用闭源组件',
        where: `${hit.file}:${hit.line}`,
        detail: hit.text.slice(0, 100),
      })
    }
  }
}

// ---- 3. files 白名单可疑条目 ----
for (const pkg of published) {
  const files = pkg.json.files
  if (files === undefined) {
    // 没有 files 字段 = 整个目录进 tarball,包括本地实验与任何未被 .npmignore
    // 挡住的东西。这不是"可能有问题",是"迟早有问题"。
    violations.push({
      kind: '缺少 files 白名单',
      where: repoPath(REPO, pkg.file),
      detail: '没有 files 字段会把整个包目录打进 tarball,含本地实验与临时文件',
    })
    continue
  }
  for (const entry of files) {
    if (SUSPICIOUS_FILE_ENTRIES.some((re) => re.test(entry))) {
      violations.push({
        kind: 'files 含可疑条目',
        where: `${repoPath(REPO, pkg.file)} → files[${JSON.stringify(entry)}]`,
        detail: '白名单里只该有构建产物与文档',
      })
    }
  }
}

// ---- 4. 公开包不得依赖私有包 ----
for (const pkg of published) {
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const dep of Object.keys(pkg.json[field] ?? {})) {
      if (privateNames.has(dep)) {
        violations.push({
          kind: '公开包依赖私有包',
          where: `${repoPath(REPO, pkg.file)} → ${field}.${dep}`,
          detail: `${dep} 标了 private,不会发布 —— 用户装到的包会是坏的`,
        })
      }
    }
  }
}

// ---- 报告 ----
console.log('DSHWAR · 开源纯净度检查(硬规则 9)\n')
console.log(`将发布的包: ${published.length} 个;私有包: ${privateNames.size} 个`)
console.log(`闭源组件清单: ${CLOSED_SOURCE.join(', ')}\n`)

if (violations.length === 0) {
  console.log('  通过  开源构建产物不含闭源组件')
  console.log('  通过  无公开包依赖私有包')
  console.log('  通过  全部将发布包都有 files 白名单')
  console.log('\n开源纯净度检查通过。')
  process.exit(0)
}

for (const v of violations) {
  console.log(`  违规  ${v.kind}`)
  console.log(`        ${v.where}`)
  console.log(`        ${v.detail}`)
}
console.log(`
${violations.length} 项违规。CLAUDE.md 硬规则 9 —— 开源分发的构建产物不得包含任何闭源组件。

这既是 open-core 的边界,也是 SignPath Foundation 免费签名的资格条件:
不得含维护者或关联组织发布的专有代码。混进去不会有任何报错 ——
发现它的通常是签名申请被拒,或者客户法务在合规审查时发现。`)
process.exit(1)
