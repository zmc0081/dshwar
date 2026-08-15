#!/usr/bin/env node
/**
 * CLAUDE.md「PR 自查」清单的可执行版本。
 *
 * 为什么脚本化而不是留一串 grep 命令给人手敲:清单里任何一条都是 PR 阻塞级,
 * 靠自觉执行等于没有。ESLint 已经拦了边界(R2),这里是**第二道保险**——
 * ESLint 依赖 TS 解析,配置写错就静默放行;grep 不依赖任何东西。
 *
 * 退出码:全绿 0,任一违规 1。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { collectFiles, grepFiles, isPackageJson, isTs, repoPath } from './lib/scan.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const p = (...seg) => join(REPO, ...seg)

/** @type {{name: string, rule: string, run: () => {file: string, line: number, text: string}[]}[]} */
const CHECKS = [
  {
    name: '深链上游内部实现',
    rule: 'CLAUDE.md 硬规则 2 —— 只有 adapters/dsh-<version>/ 允许 import 上游内部实现',
    run: () => {
      const files = [...collectFiles(p('packages'), isTs), ...collectFiles(p('gateway'), isTs)]
      return grepFiles(files, /@deepseek-ai\/(dsh-[a-z0-9-]+|cordis)\/(lib|src|dist)\//g, REPO)
    },
  },
  {
    name: '上游依赖未精确锁版',
    rule: 'CLAUDE.md 硬规则 3 —— @deepseek-ai/* 禁止 ^ 与 ~',
    run: () => {
      const files = collectFiles(REPO, isPackageJson)
      return grepFiles(files, /"@deepseek-ai\/[a-z0-9-]+"\s*:\s*"[\^~]/g, REPO)
    },
  },
  {
    name: '密码体系',
    rule: 'CLAUDE.md 硬规则 4 —— DSHWAR 是身份消费者,不存密码、不签发身份令牌',
    run: () => {
      const files = [...collectFiles(p('packages'), isTs), ...collectFiles(p('gateway'), isTs)]
      return grepFiles(files, /\b(bcrypt|argon2|scrypt|passwordHash|password_hash)\b/gi, REPO)
    },
  },
  {
    name: '凭据取值泄漏',
    rule: 'CLAUDE.md 硬规则 5 —— Admin API 只暴露 describe 语义,永不返回凭据值',
    run: () => {
      const files = collectFiles(p('gateway'), isTs)
      return grepFiles(files, /resolve\s*\([^)]*\)\s*[?.]*\.value/g, REPO)
    },
  },
  {
    name: '散落的 env 读取',
    rule: 'CLAUDE.md PR 自查 —— 配置只经 profile 注入,packages/ 内不得直接读 process.env',
    run: () => {
      const files = collectFiles(p('packages'), isTs)
      return grepFiles(files, /process\.env/g, REPO)
    },
  },
  {
    name: 'ANONYMOUS 越界',
    rule: 'CLAUDE.md PR 自查 —— ANONYMOUS 只允许出现在 @dshwar/principal 包内',
    run: () => {
      const files = collectFiles(p('packages'), isTs).filter(
        (f) => !repoPath(REPO, f).startsWith('packages/principal/'),
      )
      return grepFiles(files, /\bANONYMOUS\b/g, REPO)
    },
  },
]

/**
 * 版本锁额外校验:上游依赖必须与 CLAUDE.md 声明的锁定版本一致。
 * 光禁止 ^ 与 ~ 不够 —— 半个仓库锁 0.1.0-rc.6、另外半个锁 0.0.1-rc.1
 * 同样是灾难,而且 grep 看不出来。
 */
function checkUpstreamVersionConsistency() {
  const files = collectFiles(REPO, isPackageJson)
  const seen = new Map() // version -> [{file, dep}]
  for (const file of files) {
    let json
    try {
      json = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [dep, range] of Object.entries(json[field] ?? {})) {
        if (!dep.startsWith('@deepseek-ai/dsh')) continue
        const list = seen.get(range) ?? []
        list.push({ file: repoPath(REPO, file), dep })
        seen.set(range, list)
      }
    }
  }
  if (seen.size <= 1) return []
  const out = []
  for (const [range, list] of seen) {
    for (const { file, dep } of list) {
      out.push({ file, line: 0, text: `${dep} → ${range}` })
    }
  }
  return out
}

let failed = 0
console.log('DSHWAR · PR 自查守卫\n')

for (const check of CHECKS) {
  const hits = check.run()
  if (hits.length === 0) {
    console.log(`  通过  ${check.name}`)
  } else {
    failed += 1
    console.log(`  违规  ${check.name}  (${hits.length} 处)`)
    console.log(`        ${check.rule}`)
    for (const h of hits.slice(0, 10)) {
      console.log(`        ${h.file}${h.line ? `:${h.line}` : ''}  ${h.text.slice(0, 100)}`)
    }
    if (hits.length > 10) console.log(`        ... 另有 ${hits.length - 10} 处`)
  }
}

const inconsistent = checkUpstreamVersionConsistency()
if (inconsistent.length === 0) {
  console.log('  通过  上游锁定版本全仓一致')
} else {
  failed += 1
  console.log(`  违规  上游锁定版本全仓不一致  (${inconsistent.length} 处)`)
  console.log('        CLAUDE.md 第五节 —— 全仓必须锁同一个上游版本')
  for (const h of inconsistent) console.log(`        ${h.file}  ${h.text}`)
}

console.log('')
if (failed > 0) {
  console.log(`${failed} 项守卫未通过。这些是 PR 阻塞级约束,见 CLAUDE.md 第二节。`)
  process.exit(1)
}
console.log('全部守卫通过。')
