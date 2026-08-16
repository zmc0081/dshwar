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
import { existsSync, readFileSync } from 'node:fs'
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
    // 范围严格对齐 CLAUDE.md 的原文 grep:`packages/*/src`,只管产品源码。
    //
    // test/ 刻意不在范围内,且这不是放水:规则的目的是让产品代码没法绕过
    // fail closed —— 拿到 ANONYMOUS 就意味着有人在写「如果是匿名就……」的分支,
    // 而正确写法是让下游自然地解析不到东西。测试恰恰相反,它必须能构造匿名主体
    // 来断言 fail closed 真的发生了。把测试也拦掉,等于禁止验证这条规则本身。
    run: () => {
      const files = collectFiles(p('packages'), isTs).filter((f) => {
        const rel = repoPath(REPO, f)
        return rel.includes('/src/') && !rel.startsWith('packages/principal/')
      })
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

/**
 * 每个带 tsconfig.json 的 workspace 项目都必须登记进根 tsconfig 的 references。
 *
 * 为什么值得单独一条:根 `typecheck` 是 `tsc -b`,它**只构建 references 里列出的
 * 项目**。漏登记的项目不会报错,只是安静地不被检查 —— 而 Vitest 用 esbuild 转译、
 * 不做类型检查,所以测试照样全绿、lint 照样全绿。
 *
 * 这不是假想:V0.2.0 Session 5 补登记 gateway 时,一次性炸出 4 类真实类型错误,
 * 而它们已经跟着 Session 2/3/4 三次「全绿」提交进了仓库。
 */
function checkTsconfigReferences() {
  const root = JSON.parse(stripJsonComments(readFileSync(p('tsconfig.json'), 'utf8')))
  const referenced = new Set(
    (root.references ?? []).map((r) => r.path.replace(/^\.\//, '').replace(/\/$/, '')),
  )

  const projects = collectFiles(REPO, (f) => f.endsWith('tsconfig.json'))
    .map((f) => repoPath(REPO, dirname(f)))
    .filter((rel) => rel !== '' && rel !== '.')

  return projects
    .filter((rel) => !referenced.has(rel))
    .map((rel) => ({ file: 'tsconfig.json', line: 0, text: `未登记 ${rel}` }))
}

/**
 * 每个带 `test/` 的项目都必须有 `tsconfig.test.json`,且已登记进根
 * `tsconfig.test.json` 的 references。
 *
 * 为什么与上一条分开写:上一条守的是「产品代码被检查」,这一条守的是
 * 「**测试代码**被检查」,而后者曾经整仓都没有 —— 各包的 tsconfig.json
 * 一律把测试文件写进 `exclude`,全仓 40+ 个测试文件从没被 tsc 看过。
 *
 * 这个坑与上一条是同一类:失败是**静默**的。Vitest 用 esbuild 转译,只擦类型
 * 不做检查,所以测试跑绿、lint 跑绿,而测试里 import 了一个根本不存在的导出
 * 也照样合入。V0.4.5 Session 3 一次会话里踩了三次(不存在的 `recordUsage`、
 * 漏掉必填的 `tenantId`、把 async 的 `query()` 当同步用),三次都是编译期
 * 一眼可见的错误,却全靠运行时排查 —— 其中两次表现为「计量静默无数据」。
 *
 * 所以新增包时漏建或漏登记测试项目,必须在这里变红,而不是等下一次事故。
 */
function checkTestTsconfigReferences() {
  const rootFile = p('tsconfig.test.json')
  let root
  try {
    root = JSON.parse(stripJsonComments(readFileSync(rootFile, 'utf8')))
  } catch {
    return [{ file: 'tsconfig.test.json', line: 0, text: '根测试解决方案文件缺失或无法解析' }]
  }
  const referenced = new Set(
    (root.references ?? []).map((r) => r.path.replace(/^\.\//, '').replace(/\/$/, '')),
  )

  const projectDirs = collectFiles(REPO, (f) => f.endsWith('tsconfig.json'))
    .map((f) => repoPath(REPO, dirname(f)))
    .filter((rel) => rel !== '' && rel !== '.')

  const out = []
  for (const rel of projectDirs) {
    const hasTests = collectFiles(p(rel, 'test'), isTs).length > 0
    const exists = existsSync(p(rel, 'tsconfig.test.json'))

    if (hasTests && !exists) {
      out.push({
        file: `${rel}/tsconfig.json`,
        line: 0,
        text: `${rel} 有 test/ 却没有 tsconfig.test.json`,
      })
    } else if (exists && !referenced.has(`${rel}/tsconfig.test.json`)) {
      out.push({ file: 'tsconfig.test.json', line: 0, text: `未登记 ${rel}/tsconfig.test.json` })
    }
  }
  return out
}

/**
 * `test/` 下的 `.mjs` 夹具必须被 `checkJs` 覆盖。
 *
 * 上面那条 `checkTestTsconfigReferences` 只看 `.ts` —— 一个**只有** `.mjs`
 * 夹具的包对它完全不可见。而 `.mjs` 夹具不是边角料:它们是 `fork` 出去的
 * 子进程入口,承载着「跨进程行为与进程内一致」这类断言的全部可信度。
 *
 * 实证:`child-agent.mjs` 里 `reason: 'stop'`(正确写法 `{ kind: 'stop' }`)
 * 活了一整个版本。同款错误在 7 个 `.ts` 测试文件里被类型检查一次抓出来,
 * 而 `.mjs` 那份只能靠人看见。开了 `checkJs` 之后,它报的是
 * `Type 'string' is not assignable to type 'FinishReason'`。
 */
function checkMjsFixtureCoverage() {
  const isMjs = (f) => f.endsWith('.mjs')
  const projectDirs = collectFiles(REPO, (f) => f.endsWith('tsconfig.json'))
    .map((f) => repoPath(REPO, dirname(f)))
    .filter((rel) => rel !== '' && rel !== '.')

  const out = []
  for (const rel of projectDirs) {
    if (collectFiles(p(rel, 'test'), isMjs).length === 0) continue

    const cfgPath = p(rel, 'tsconfig.test.json')
    if (!existsSync(cfgPath)) {
      out.push({ file: rel, line: 0, text: `${rel} 有 .mjs 夹具却没有 tsconfig.test.json` })
      continue
    }
    let cfg
    try {
      cfg = JSON.parse(stripJsonComments(readFileSync(cfgPath, 'utf8')))
    } catch {
      out.push({ file: rel, line: 0, text: `${rel}/tsconfig.test.json 无法解析` })
      continue
    }
    const opts = cfg.compilerOptions ?? {}
    const includes = (cfg.include ?? []).some((g) => g.includes('.mjs'))
    if (opts.checkJs !== true || opts.allowJs !== true || !includes) {
      out.push({
        file: `${rel}/tsconfig.test.json`,
        line: 0,
        text: `${rel} 的 .mjs 夹具未被 checkJs 覆盖(需 allowJs + checkJs + include 含 *.mjs)`,
      })
    }
  }
  return out
}

/** `scripts/` 版本的同款检查。构建脚本生成的是契约与 SDK 类型,出错落在仓库之外。 */
function checkScriptsTsconfigReferences() {
  const rootFile = p('tsconfig.scripts.json')
  let root
  try {
    root = JSON.parse(stripJsonComments(readFileSync(rootFile, 'utf8')))
  } catch {
    return [{ file: 'tsconfig.scripts.json', line: 0, text: '根脚本解决方案文件缺失或无法解析' }]
  }
  const referenced = new Set(
    (root.references ?? []).map((r) => r.path.replace(/^\.\//, '').replace(/\/$/, '')),
  )

  const projectDirs = collectFiles(REPO, (f) => f.endsWith('tsconfig.json'))
    .map((f) => repoPath(REPO, dirname(f)))
    .filter((rel) => rel !== '' && rel !== '.')

  const out = []
  for (const rel of projectDirs) {
    const hasScripts = collectFiles(p(rel, 'scripts'), isTs).length > 0
    const exists = existsSync(p(rel, 'tsconfig.scripts.json'))

    if (hasScripts && !exists) {
      out.push({
        file: `${rel}/tsconfig.json`,
        line: 0,
        text: `${rel} 有 scripts/*.ts 却没有 tsconfig.scripts.json`,
      })
    } else if (exists && !referenced.has(`${rel}/tsconfig.scripts.json`)) {
      out.push({
        file: 'tsconfig.scripts.json',
        line: 0,
        text: `未登记 ${rel}/tsconfig.scripts.json`,
      })
    }
  }
  return out
}

/**
 * 有 TS 源码却**完全没有** `tsconfig.json` 的 workspace 成员。
 *
 * ⚠️ 这条堵的是上面两条自己的洞。它们都从「有 tsconfig.json 的目录」出发遍历 ——
 * 于是一个**根本没有** tsconfig 的包对它们完全不可见,悄悄躺在类型检查之外。
 *
 * `examples/minimal-server` 正是这样漏掉的:它是 README 首屏那段代码的可运行版本,
 * 新人第一眼看到的东西,却从 V0.1.0 起就没被 tsc 看过。而隔壁
 * `examples/sdk-session` 一直有 tsconfig —— 两者不一致,守卫却查不出来,
 * 因为它只问「登记了没」,不问「该有的缺不缺」。
 */
function checkMissingTsconfig() {
  const manifests = collectFiles(REPO, isPackageJson)
    .map((f) => repoPath(REPO, dirname(f)))
    .filter((rel) => rel !== '' && rel !== '.')

  const out = []
  for (const rel of manifests) {
    if (collectFiles(p(rel, 'src'), isTs).length === 0) continue
    if (existsSync(p(rel, 'tsconfig.json'))) continue
    out.push({
      file: `${rel}/package.json`,
      line: 0,
      text: `${rel} 有 src/*.ts 却没有 tsconfig.json —— 它整个在类型检查之外`,
    })
  }
  return out
}

/**
 * `ctx.principal.current()` 的登记白名单。
 *
 * ## 为什么这条守卫存在
 *
 * V0.4.6 Session 0 实测:principal 的作用域(AsyncLocalStorage)**只活在 HTTP
 * 请求内**,而 agent loop 在请求返回之后才真正跑 —— 于是 loop 内读到的是
 * ANONYMOUS。凭据那处 fail closed(拒绝服务,吵闹);`fs-tenant` 那处**不**
 * fail closed,它老老实实往 `anonymous/anonymous/` 里写文件,跨租户共用一个目录。
 *
 * V0.4.7 的修法(逐点显式重入)**靠人记得**,而忘掉的那次是静默的 ——
 * 正是这次的失败模式。所以每个读环境 principal 的地方都必须在这里登记,
 * 新增未登记的调用点即 CI 红,逼写的人先回答一个问题:
 * **这个调用会不会发生在 agent loop 内?**
 *
 * 详见 `docs/DECISIONS/principal-scope-binding.md`。
 */
const PRINCIPAL_CONSUMERS = [
  {
    file: 'packages/principal/src/service.ts',
    why: '定义方 —— PrincipalService.current() 本身就在这里实现',
  },
  {
    file: 'packages/principal/src/index.ts',
    why: '定义方 —— 模块文档里的用法示例',
  },
  {
    file: 'packages/principal/src/principal.ts',
    why: '定义方 —— ANONYMOUS 与其判定',
  },
  {
    file: 'packages/credentials-multiuser/src/index.ts',
    why: '⚠️ 受影响:loop 内解析成匿名 → fail closed → agent 拿不到凭据。V0.4.7 修',
  },
  {
    file: 'packages/fs-tenant/src/index.ts',
    why: '🚨 受影响且不 fail closed:loop 内落进 anonymous/anonymous/,跨租户共用。V0.4.7 修',
  },
  {
    file: 'packages/storage-scoped/src/index.ts',
    why: '⚠️ 受影响:同 fs-tenant。当前未装配,V0.5.5 工作台后端会装配 —— 必须赶在那之前修',
  },
]

/** 未登记的 `principal.current()` 调用点。 */
function checkPrincipalConsumers() {
  const registered = new Set(PRINCIPAL_CONSUMERS.map((c) => c.file))
  // 只扫产品源码。测试里调 `principal.current()` 是正当的 —— 它们不是消费方,
  // 而且断言作用域行为本来就得读它。范围与 CLAUDE.md 自查项的 `packages/*/src` 一致。
  const inSrc = (f) => isTs(f) && /[\\/]src[\\/]/.test(f)
  const files = [...collectFiles(p('packages'), inSrc), ...collectFiles(p('gateway'), inSrc)]
  const hits = grepFiles(files, /principal\.current\s*\(/g, REPO)

  const out = []
  const seen = new Set()
  for (const hit of hits) {
    const rel = hit.file.split('\\').join('/')
    if (registered.has(rel) || seen.has(rel)) continue
    seen.add(rel)
    out.push({
      file: rel,
      line: hit.line,
      text: `未登记的 principal.current() 调用点:${rel}:${hit.line}`,
    })
  }
  return out
}

/** 白名单里已经不存在的条目 —— 否则清单会变成噪音。 */
function checkStalePrincipalConsumers() {
  return PRINCIPAL_CONSUMERS.filter((c) => !existsSync(p(c.file))).map((c) => ({
    file: c.file,
    line: 0,
    text: `白名单里的 ${c.file} 已不存在`,
  }))
}

/** 去掉 JSONC 注释。根 tsconfig 里有大段说明性注释,JSON.parse 咽不下。 */
function stripJsonComments(text) {
  return text.replace(/^\s*\/\/.*$/gm, '')
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

const unreferenced = checkTsconfigReferences()
if (unreferenced.length === 0) {
  console.log('  通过  全部 TS 项目已登记进根 tsconfig references')
} else {
  failed += 1
  console.log(`  违规  有 TS 项目未登记进根 tsconfig references  (${unreferenced.length} 处)`)
  console.log('        根 typecheck 是 tsc -b,未登记的项目会被安静跳过,不做任何类型检查')
  for (const h of unreferenced) console.log(`        ${h.text}`)
}

const testUnreferenced = checkTestTsconfigReferences()
if (testUnreferenced.length === 0) {
  console.log('  通过  全部 test/ 已登记进根 tsconfig.test.json references')
} else {
  failed += 1
  console.log(`  违规  有测试目录未纳入类型检查  (${testUnreferenced.length} 处)`)
  console.log('        Vitest 用 esbuild 转译、不做类型检查,漏掉的测试文件里')
  console.log('        即便 import 了不存在的导出,门禁也全绿。见 pnpm typecheck:test')
  for (const h of testUnreferenced) console.log(`        ${h.text}`)
}

const mjsUncovered = checkMjsFixtureCoverage()
if (mjsUncovered.length === 0) {
  console.log('  通过  test/ 下的 .mjs 夹具都被 checkJs 覆盖')
} else {
  failed += 1
  console.log(`  违规  有 .mjs 夹具在类型检查之外  (${mjsUncovered.length} 处)`)
  console.log('        .mjs 夹具是 fork 出去的子进程入口 —— 跨进程断言的可信度全靠它们。')
  console.log('        child-agent.mjs 的 finish reason 形状错误就这样活了一整个版本。')
  console.log('        决策见 docs/DECISIONS/typecheck-mjs-fixtures.md')
  for (const h of mjsUncovered) console.log(`        ${h.text}`)
}

const scriptsUnreferenced = checkScriptsTsconfigReferences()
if (scriptsUnreferenced.length === 0) {
  console.log('  通过  全部 scripts/ 已登记进根 tsconfig.scripts.json references')
} else {
  failed += 1
  console.log(`  违规  有构建脚本未纳入类型检查  (${scriptsUnreferenced.length} 处)`)
  console.log('        构建脚本生成的是对外契约与客户手里的 SDK 类型,')
  console.log('        它们出错的后果落在仓库之外。见 pnpm typecheck:scripts')
  for (const h of scriptsUnreferenced) console.log(`        ${h.text}`)
}

const noTsconfig = checkMissingTsconfig()
if (noTsconfig.length === 0) {
  console.log('  通过  有 TS 源码的包都有 tsconfig.json')
} else {
  failed += 1
  console.log(`  违规  有包整个在类型检查之外  (${noTsconfig.length} 处)`)
  console.log('        上面两条守卫都从「有 tsconfig 的目录」出发遍历,')
  console.log('        所以一个根本没有 tsconfig 的包对它们不可见 —— 这条堵那个洞。')
  for (const h of noTsconfig) console.log(`        ${h.text}`)
}

const unregistered = checkPrincipalConsumers()
const stale = checkStalePrincipalConsumers()
if (unregistered.length === 0 && stale.length === 0) {
  console.log('  通过  principal.current() 调用点全部已登记')
} else {
  failed += 1
  console.log(
    `  违规  principal.current() 的登记白名单不同步  (${unregistered.length + stale.length} 处)`,
  )
  console.log('        新增的 principal 消费方必须先回答:这个调用会不会发生在 agent loop 内?')
  console.log(
    '        loop 内读到的是 ANONYMOUS —— fs-tenant 那一类不 fail closed,会静默跨租户混放。',
  )
  console.log('        登记处见 scripts/check-guards.mjs 的 PRINCIPAL_CONSUMERS,')
  console.log('        背景见 docs/DECISIONS/principal-scope-binding.md')
  for (const h of [...unregistered, ...stale]) console.log(`        ${h.text}`)
}

console.log('')
if (failed > 0) {
  console.log(`${failed} 项守卫未通过。这些是 PR 阻塞级约束,见 CLAUDE.md 第二节。`)
  process.exit(1)
}
console.log('全部守卫通过。')
