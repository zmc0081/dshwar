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
/** @param {...string} seg */
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
    (root.references ?? []).map((/** @type {{path: string}} */ r) =>
      r.path.replace(/^\.\//, '').replace(/\/$/, ''),
    ),
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
    (root.references ?? []).map((/** @type {{path: string}} */ r) =>
      r.path.replace(/^\.\//, '').replace(/\/$/, ''),
    ),
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
  const isMjs = (/** @type {string} */ f) => f.endsWith('.mjs')
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
    const includes = (cfg.include ?? []).some((/** @type {string} */ g) => g.includes('.mjs'))
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
    (root.references ?? []).map((/** @type {{path: string}} */ r) =>
      r.path.replace(/^\.\//, '').replace(/\/$/, ''),
    ),
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
  const inSrc = (/** @type {string} */ f) => isTs(f) && /[\\/]src[\\/]/.test(f)
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

/**
 * 守卫脚本不得越权写仓库。
 *
 * 起因是一次真实事故:`verify-guards` 还原 `openapi.json` 时 `copyFileSync`
 * 抛了 `UNKNOWN(-4094)`,**把对外契约留在篡改状态、留下 .guardbak、
 * 且崩在 `finally` 里一句话不说**。若那次没人看工作区,一个残缺的契约会被提交,
 * 而契约冻结检查会拿它当新基线 —— **一个守卫的失败,悄悄拆掉了另一个守卫。**
 *
 * 两条断言,对应 `docs/DECISIONS/guards-must-not-write.md` 的前两档:
 *
 * 1. **`check-*.mjs` 一律只读。** 检查的定义就是「看一眼,给个结论」;
 *    需要改仓库才能得出结论的检查,基本是把验证与被验证的东西搞混了。
 * 2. **`verify-*.mjs` 不得自己造备份。** 它们确实要改真文件(Vitest 解析的是
 *    磁盘路径),但只能走 `scripts/lib/mutate.mjs` —— 那里原文留在内存、
 *    还原带退避重试、真失败时打印恢复命令并非零退出。
 *
 * ⚠️ 第 2 条查的是 `copyFileSync` 与 `.guardbak` / `.probebak` 这类**落盘备份**
 * 的痕迹,不是 `writeFileSync` 本身 —— 后者是篡改与造夹具正当需要的。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkGuardScriptsDoNotWrite() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  const scriptFiles = collectFiles(p('scripts'), (/** @type {string} */ f) => f.endsWith('.mjs'))

  for (const file of scriptFiles) {
    const rel = repoPath(REPO, file)
    const base = rel.split('/').pop() ?? ''
    // 受控通路自己当然要写 —— 它就是那条通路。
    if (rel === 'scripts/lib/mutate.mjs') continue

    const isCheck = base.startsWith('check-')
    const isVerify = base.startsWith('verify-')
    if (!isCheck && !isVerify) continue

    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (const [i, line] of lines.entries()) {
      // 注释里提到这些名字是正常的(事故记录、说明),只看真正的调用
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue

      // ★ 行级豁免,与 `scripts/lib/scan.mjs` 的 ALLOW_MARKER 同款。
      //   执行一条规则的代码往往长得像违反那条规则 —— 本条守卫的**负向测试**
      //   就必须在源码里写出 `copyFileSync(` 这串字面量,否则它没法植入违规。
      //   (这个洞是本守卫第一次跑时抓住它自己发现的。)
      //   空理由不算豁免,判据与 scan.mjs 一致。
      if (
        /dshwar-guard-allow:\s*\S/.test(line) ||
        /dshwar-guard-allow:\s*\S/.test(lines[i - 1] ?? '')
      )
        continue

      if (
        isCheck &&
        /\b(write|copy|append|rename|unlink|mkdir|rm)FileSync|\brmSync\s*\(/.test(line)
      ) {
        out.push({
          file: rel,
          line: i + 1,
          text: `${rel}:${i + 1} check-* 必须只读,这里有写调用`,
        })
      }
      if (isVerify && /\bcopyFileSync\s*\(|\.(guardbak|probebak)\b/.test(line)) {
        out.push({
          file: rel,
          line: i + 1,
          text: `${rel}:${i + 1} verify-* 自己造了落盘备份 —— 请走 scripts/lib/mutate.mjs`,
        })
      }
    }
  }
  return out
}

/**
 * 登记进解决方案的项目必须**真的检查了什么**。
 *
 * ## 起因
 *
 * `tsconfig.scripts.json` 的 `include` 是 `[]`,只 reference 了两个包的脚本项目。
 * 于是 `pnpm typecheck:scripts` 从来没看过根 `scripts/` 一眼 ——
 * 而那里放的是**全部门禁脚本**。守卫自己在检查之外,整整两个版本。
 *
 * ⚠️ **根解决方案文件本身的 `include: []` 是合法的** —— 它就是个转发器,
 * 内容全在 `references` 里。所以这条守卫查的是**被登记的那一端**:
 * 一个 leaf 项目(自己没有 references)若 `include` 与 `files` 都是空的,
 * 它编译零个文件,**`tsc -b` 会安静地成功**。
 *
 * 那种绿是最坏的一种:它与「检查过且通过」在输出上一模一样。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkEmptyIncludeProjects() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  const solutions = ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.scripts.json']

  for (const solution of solutions) {
    if (!existsSync(p(solution))) continue
    let root
    try {
      root = JSON.parse(stripJsonComments(readFileSync(p(solution), 'utf8')))
    } catch {
      continue
    }
    for (const ref of root.references ?? []) {
      // references 里的 path 可能是目录(隐含 tsconfig.json)也可能是具体文件
      const raw = String(ref.path).replace(/^\.\//, '').replace(/\/$/, '')
      const target = raw.endsWith('.json') ? raw : `${raw}/tsconfig.json`
      if (!existsSync(p(target))) {
        out.push({ file: solution, line: 0, text: `登记了不存在的项目 ${target}` })
        continue
      }
      let cfg
      try {
        cfg = JSON.parse(stripJsonComments(readFileSync(p(target), 'utf8')))
      } catch {
        out.push({ file: target, line: 0, text: `${target} 无法解析` })
        continue
      }
      // 自己也是转发器的,由它自己的 references 那一层负责
      if ((cfg.references ?? []).length > 0) continue
      const covers = (cfg.include ?? []).length > 0 || (cfg.files ?? []).length > 0
      if (!covers) {
        out.push({
          file: target,
          line: 0,
          text: `${target} 的 include 与 files 都是空的 —— 它编译零个文件,tsc 会安静地通过`,
        })
      }
    }
  }
  return out
}

/**
 * 根 `scripts/` 下的 `.mjs` 必须被 checkJs 覆盖。
 *
 * ## 为什么 {@link checkScriptsTsconfigReferences} 照不到它
 *
 * 那一条从「含 `tsconfig.json` 的目录」出发遍历,并且**把仓库根显式过滤掉了**
 * (`rel !== ''`)。根 `scripts/` 不是任何 workspace 成员的子目录,
 * 于是对它天生不可见 —— 这不是它写错了,是它的遍历起点决定了有个盲区。
 *
 * ## 为什么单独一条,而不是把上面那条改宽
 *
 * 因为这是**同一个模式的第三次**:测试文件不被检查(V0.4.6)→
 * CI 不跑 verify:assertions(V0.4.7)→ 守卫脚本自己不被检查(这里)。
 * 每次都是「检查机制自己的那一层没人管」,而每次的补法都是**再加一条盯着它**。
 * 与 {@link checkMissingTsconfig} 堵 17/18 的洞是同一个套路。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkRootScriptsCoverage() {
  const isMjs = (/** @type {string} */ f) => f.endsWith('.mjs')
  if (collectFiles(p('scripts'), isMjs).length === 0) return []

  const cfgPath = 'scripts/tsconfig.scripts.json'
  if (!existsSync(p(cfgPath))) {
    return [
      {
        file: 'scripts',
        line: 0,
        text: `根 scripts/ 有 .mjs 却没有 ${cfgPath} —— 门禁脚本自己在类型检查之外`,
      },
    ]
  }
  let cfg
  try {
    cfg = JSON.parse(stripJsonComments(readFileSync(p(cfgPath), 'utf8')))
  } catch {
    return [{ file: cfgPath, line: 0, text: `${cfgPath} 无法解析` }]
  }
  const opts = cfg.compilerOptions ?? {}
  const covers = (cfg.include ?? []).some((/** @type {string} */ g) => g.includes('.mjs'))
  if (opts.allowJs !== true || opts.checkJs !== true || !covers) {
    return [
      { file: cfgPath, line: 0, text: `${cfgPath} 没有同时开 allowJs + checkJs 并 include .mjs` },
    ]
  }

  // 登记与否交给 checkEmptyIncludeProjects 之外的这一句:没登记就等于没跑。
  const root = JSON.parse(stripJsonComments(readFileSync(p('tsconfig.scripts.json'), 'utf8')))
  const referenced = (root.references ?? []).map((/** @type {{path: string}} */ r) =>
    r.path.replace(/^\.\//, ''),
  )
  if (!referenced.includes(cfgPath)) {
    return [{ file: 'tsconfig.scripts.json', line: 0, text: `未登记 ${cfgPath}` }]
  }
  return []
}

/**
 * CI 不得枚举门禁 —— 门禁的唯一清单是 `check:all`。
 *
 * ## 为什么这条守卫存在
 *
 * 首次真实 runner 复盘查出:本地 `check:all` 与 `ci.yml` 跑的不是同一组,
 * 两边各有对方没有的项(CI 少 `typecheck:scripts` 与 `verify:assertions`,
 * 本地少 `format:check` / `test:contract` / `verify:guards`)。
 * 于是「本地全绿」从来就不代表 CI 会绿,而**漂移的那一刻是静默的**。
 *
 * 当时的修法是把两边对齐,再写一条「改门禁要同时改两处」的规矩。
 * **规矩不够**:这个项目已经三次证明靠人记住的事会被忘
 * (principal 消费方登记、新包的 test tsconfig、ci.yml 同步),
 * 而每一次的最终解法都是加守卫。
 *
 * ## 这条守卫比「断言两个清单相等」更强
 *
 * 相等性守卫承认两个清单存在,只是要求同步。这条不允许第二个清单存在:
 * **ci.yml 里除了 `pnpm check:all` 之外,不得出现 check:all 里的任何一条。**
 * 漂移不是被检测到,是在结构上不可能发生。
 *
 * 两个方向都要断言,少一个就有绕过的路:
 * 1. ci.yml **必须**有一步跑 `pnpm check:all` —— 否则删掉入口即可全绿
 * 2. ci.yml **不得**单列 check:all 里的任何一条 —— 否则枚举会慢慢长回来
 *
 * ## 什么可以留在 ci.yml 里
 *
 * 判据是「**在开发机上跑没有意义**」:性能基线依赖固定机器规格、
 * PTY 依赖 Linux。它们不属于 check:all,所以不在这条守卫的管辖内 ——
 * 守卫只看 `pnpm <script>` 形式的调用,那两个 job 跑的是
 * `node scripts/...` 与 `pnpm build`,不会误伤。
 */
function checkCiEnumeratesGates() {
  const ciPath = p('.github/workflows/ci.yml')
  if (!existsSync(ciPath)) {
    return [{ file: '.github/workflows/ci.yml', line: 0, text: 'CI workflow 不存在' }]
  }
  const ci = readFileSync(ciPath, 'utf8')

  // 门禁清单从 package.json 的 check:all 里现取 —— 不在这里另抄一份,
  // 否则这条守卫自己就成了第二个清单,正是它要消灭的东西。
  /** @type {string} */
  const checkAll = JSON.parse(readFileSync(p('package.json'), 'utf8')).scripts?.['check:all'] ?? ''
  const gates = checkAll
    .split('&&')
    .map((s) => s.trim().replace(/^pnpm\s+/, ''))
    .filter((s) => s !== '')

  const hits = []

  // 方向 1:入口必须在
  if (!/\bpnpm\s+check:all\b/.test(ci)) {
    hits.push({
      file: '.github/workflows/ci.yml',
      line: 0,
      text: 'CI 里找不到 `pnpm check:all` —— 门禁入口被删了',
    })
  }

  // 方向 2:不得单列任何一条
  const lines = ci.split(/\r?\n/)
  for (const [i, line] of lines.entries()) {
    // 只看真正执行的地方(run:),注释与 name: 里提到脚本名是正常的说明文字
    const run = /^\s*(?:-\s*)?run:\s*(.+)$/.exec(line)
    if (run === null) continue
    const command = run[1] ?? ''
    for (const gate of gates) {
      if (gate === 'check:all') continue
      // 词边界:避免 `check:contract` 被 `check:contract-foo` 之类误伤
      if (
        new RegExp(`\\bpnpm\\s+${gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\S)`).test(command)
      ) {
        hits.push({
          file: '.github/workflows/ci.yml',
          line: i + 1,
          text: `单列了门禁 \`pnpm ${gate}\` —— 它已在 check:all 里,这里重复即是第二份清单`,
        })
      }
    }
  }
  return hits
}

/**
 * 去掉 JSONC 注释。根 tsconfig 里有大段说明性注释,JSON.parse 咽不下。
 * @param {string} text
 */
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

const guardWrites = checkGuardScriptsDoNotWrite()
if (guardWrites.length === 0) {
  console.log('  通过  守卫脚本不越权写仓库(check-* 只读,verify-* 走受控通路)')
} else {
  failed += 1
  console.log(`  违规  守卫脚本越权写仓库  (${guardWrites.length} 处)`)
  console.log('        起因是真实事故:还原 openapi.json 失败,把对外契约留在篡改状态,')
  console.log('        且崩在 finally 里一句话不说 —— 一个守卫的失败会拆掉另一个守卫。')
  console.log('        原则与三档划分见 docs/DECISIONS/guards-must-not-write.md')
  for (const h of guardWrites) console.log(`        ${h.text}`)
}

const emptyProjects = checkEmptyIncludeProjects()
if (emptyProjects.length === 0) {
  console.log('  通过  登记进解决方案的项目都真的检查了文件')
} else {
  failed += 1
  console.log(`  违规  有项目被登记了却编译零个文件  (${emptyProjects.length} 处)`)
  console.log('        `tsc -b` 对空项目会**安静地成功** —— 那种绿与「检查过且通过」')
  console.log('        在输出上一模一样。tsconfig.scripts.json 正是这么让根 scripts/')
  console.log('        在类型检查之外躺了两个版本。')
  for (const h of emptyProjects) console.log(`        ${h.text}`)
}

const rootScripts = checkRootScriptsCoverage()
if (rootScripts.length === 0) {
  console.log('  通过  根 scripts/ 的 .mjs 被 checkJs 覆盖(门禁脚本自己也被检查)')
} else {
  failed += 1
  console.log(`  违规  门禁脚本自己在类型检查之外  (${rootScripts.length} 处)`)
  console.log('        这是同一个模式的第三次:测试文件不被检查 → CI 不跑断言探针 →')
  console.log('        守卫脚本自己不被检查。每次都是「检查机制自己的那一层没人管」。')
  for (const h of rootScripts) console.log(`        ${h.text}`)
}

const ciDrift = checkCiEnumeratesGates()
if (ciDrift.length === 0) {
  console.log('  通过  CI 只调 check:all 一个入口,没有第二份门禁清单')
} else {
  failed += 1
  console.log(`  违规  CI 与 check:all 之间出现了第二份门禁清单  (${ciDrift.length} 处)`)
  console.log('        门禁的唯一清单是 package.json 的 check:all。ci.yml 只调那一个入口。')
  console.log('        首次真实 runner 复盘的根因就是两边各有对方没有的项 ——')
  console.log('        而漂移的那一刻是静默的:本地全绿,CI 才红。')
  for (const h of ciDrift) console.log(`        ${h.file}:${h.line}  ${h.text}`)
}

console.log('')
if (failed > 0) {
  console.log(`${failed} 项守卫未通过。这些是 PR 阻塞级约束,见 CLAUDE.md 第二节。`)
  process.exit(1)
}
console.log('全部守卫通过。')
