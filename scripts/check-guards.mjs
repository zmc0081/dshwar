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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
 * ★ **包根的 `.ts` 不得落在所有 tsconfig 之外。**
 *
 * ## 它守的是「谁验证它」的第八次
 *
 * 前七次的清单在 CLAUDE.md 第六节。这一次的形状是:
 * **一个文件既在守卫的扫描范围内、又在类型检查的范围外。**
 *
 * `checkMissingTsconfig` 查的是「有 `src/*.ts` 却没有 tsconfig.json」——
 * 它假设一个包的 TS 都在 `src/` 下。而工具类配置(`vite.config.ts`、
 * `tailwind.config.ts`、`playwright.config.ts`)按惯例放在**包根**,
 * 那里既不在产品项目的 `include: ["src/**"]` 里,也不在 `test/**
 * ★ **eslint 的分域规则必须覆盖每一个前端包。**
 *
 * ## 它守的是「范围写成手写清单」这一族的第四次
 *
 * 前三次都在本版本内:
 *
 * | # | 哪张清单 | 谁逃出去了 |
 * | --- | --- | --- |
 * | 1 | 前端三条约束的 `p('console-web','src')` | design-system 与将来的每个前端包 |
 * | 2 | `checkPrimaryColorHasNoFallback` 的 `roots` 数组 | 根级的 workbench-web |
 * | 3 | `checkSdkHasSyncAssertion` 的「sdk/ 下任何目录」 | 反过来:把 docs 目录**误当成** SDK |
 * | 4 | **本条** —— `eslint.config.js` 的分域 glob | 两个根级前端 + 全部 `.tsx` |
 *
 * 第 4 次的具体后果:`argsIgnorePattern: '^_'` 在 `packages/**` 下生效,
 * 在 `console-web/` 与 `workbench-web/` 下不生效。于是**同一个约定
 * 在两处有不同的效力**,而差别的原因藏在一行 glob 里 ——
 * 撞上的人只会觉得「这个 lint 规则怎么时灵时不灵」。
 *
 * ## 判据
 *
 * 前端包按形状发现(依赖里有 `react`)。对每一个,断言它的路径前缀
 * 出现在 `eslint.config.js` 的某条 `files:` 里。
 *
 * ⚠️ **不解析 eslint 配置,只做文本包含判断。** 解析要跑 eslint 自己的
 * 配置加载器,而那会把守卫变成「eslint 能不能启动」的测试。
 * 文本判断会有假阴性(比如用了一个更宽的 glob 却没写包名)——
 * 那种情况**报出来让人看一眼**,比放过去好:多报的成本是读一行,
 * 漏报的成本是一个包悄悄少了几条规则。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkEslintCoversFrontendPackages() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  const configPath = p('eslint.config.js')
  if (!existsSync(configPath)) {
    return [{ file: 'eslint.config.js', line: 0, text: 'eslint.config.js 不存在 —— 本条无从检查' }]
  }
  const config = readFileSync(configPath, 'utf8')

  const pkgs = frontendPackages()
  if (pkgs.length === 0) {
    return [
      {
        file: 'package.json',
        line: 0,
        text: '全仓找不到任何前端包 —— 本条会退化成空集扫描,永远绿',
      },
    ]
  }

  for (const pkg of pkgs) {
    // `packages/design-system` → 前缀 `packages/`;`workbench-web` → `workbench-web`
    const segments = pkg.rel.split('/')
    const prefix = segments.length > 1 ? `${segments[0] ?? ''}/**` : `${pkg.rel}/**`
    if (!config.includes(prefix)) {
      out.push({
        file: 'eslint.config.js',
        line: 0,
        text: `前端包 ${pkg.rel} 的路径前缀 ${prefix} 不在任何 files: glob 里 —— 它少了分域规则`,
      })
    }
  }
  return out
}

/**` 里。
 *
 * 后果不是「少查一个文件」:
 *
 * | 谁 | 看得见它吗 |
 * | --- | --- |
 * | 前端三条约束、交互态样式、回执守卫 | ✅ 看得见(它们扫 `pkg.dir` 全目录) |
 * | `tsc -b` | ❌ **完全看不见** |
 *
 * 于是它是一个**被守卫盯着、却不被编译器检查**的文件 ——
 * 而「守卫全绿」很容易被读成「这个文件没问题」。
 *
 * ## 它是怎么被抓到的(V0.9.0 Session 2)
 *
 * 我自己刚制造了一个:`packages/design-system/vite.config.ts`。
 * 植入 `const x: number = '字符串'`,`pnpm typecheck` **照样全绿**。
 * 并进 `tsconfig.test.json` 之后,打开的第一刻就抓到一处真错误 ——
 * `esbuild: { jsx: 'automatic' }` 在 Vite 8 的 `ESBuildOptions` 里根本不存在,
 * 而它一直「工作正常」,只因为 Vite 本来就从 tsconfig 读 `jsx`,
 * 那一行从头到尾没起过任何作用。
 *
 * **一个从未起作用的配置项,与一个正确的配置项,在行为上一模一样。**
 *
 * ## 判据
 *
 * 对每个有 `package.json` 的目录,找它**直接子级**(不递归)的 `.ts` / `.tsx`,
 * 若该文件不被这个包的任何一份 tsconfig 的 `include` 覆盖 → 报出来。
 *
 * ⚠️ 只查直接子级:再深就是 `src/` / `test/` / `scripts/`,
 * 那三处各自已有守卫(`checkMissingTsconfig` / `checkTestTsconfigReferences` /
 * `checkScriptsTsconfigReferences`)。本条补的是它们之间的那道缝。
 *
 * @returns {{out: {file: string, line: number, text: string}[], scanned: number}}
 */
function checkRootLevelTsIsChecked() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  const manifests = collectFiles(REPO, isPackageJson)
    .map((f) => dirname(f))
    .filter((dir) => repoPath(REPO, dir) !== '' && repoPath(REPO, dir) !== '.')

  let scanned = 0
  for (const dir of manifests) {
    /** @type {string[]} */
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts'))
        .map((e) => e.name)
    } catch {
      continue
    }
    if (entries.length === 0) continue

    // 收集这个包所有 tsconfig 的 include 模式
    /** @type {string[]} */
    const patterns = []
    for (const name of readdirSync(dir).filter((n) => /^tsconfig(\..+)?\.json$/.test(n))) {
      try {
        const raw = readFileSync(join(dir, name), 'utf8')
        // tsconfig 允许注释,先剥掉行注释再解析
        const json = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''))
        for (const inc of json.include ?? []) patterns.push(String(inc))
        for (const f of json.files ?? []) patterns.push(String(f))
      } catch {
        // 解析不了就当它没有 include —— 宁可多报,不可漏报
      }
    }

    for (const file of entries) {
      scanned += 1
      const covered = patterns.some((pat) => {
        if (pat === file) return true
        // 把 include 的 glob 转成正则:** → .*,* → [^/]*
        const re = new RegExp(
          '^' +
            pat
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*\*\//g, '(?:.*/)?')
              .replace(/\*\*/g, '.*')
              .replace(/\*/g, '[^/]*') +
            '$',
        )
        return re.test(file)
      })
      if (!covered) {
        out.push({
          file: `${repoPath(REPO, dir)}/${file}`,
          line: 0,
          text: `包根的 ${file} 不在本包任何 tsconfig 的 include 里 —— 守卫扫得到它,tsc 看不见它`,
        })
      }
    }
  }

  // ⚠️ **这里刻意不报「空集扫描」违规。** 别处的出口计数报违规,是因为空集
  //   意味着**退化**(该扫的东西逃出了范围)。这里不一样:「一个包根 .ts 都没有」
  //   是**理想状态**,V0.9.0 之前的仓库正是如此。
  //
  //   但「零个对象」仍不该被读成「查过了」—— 所以把数量印进通过行,
  //   让「通过(0 个)」与「通过(3 个)」一眼可分。
  return { out, scanned }
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
 * ★ **Session 标 ✅,交付里点名的产物就必须存在。**
 *
 * ## 它守的是任务书自身的诚实性
 *
 * 本仓有一整套机制盯着「代码有没有说到做到」——守卫、探针、契约冻结、
 * 出厂装配。**唯独没有东西盯着任务书。** 而任务书的进度标记是所有人
 * (包括下一个会话的我)判断「哪些做完了」的唯一依据。
 *
 * ⚠️ **它已经错过一次。** V0.8.0 的 `62878be` 把 Session 1/2/3 三个 ⬜
 * **一次性批量翻成 ✅**,而那个提交自己的交付清单只写了「各 42 个模型」——
 * 从未声称做了客户端或示例。结果:Session 1/2 声明要交付
 * `examples/kotlin-session` / `examples/swift-session`,两个目录都不存在,
 * 而标记说做完了。
 *
 * 这与本仓反复抓的「注释承诺、实现只做一半」是同一族,
 * 只是发生在**任务书**这一层 —— 而这一层此前一道检查都没有。
 *
 * ## 判据:两条
 *
 * 1. ✅ 的 Session,其 `**交付**` 行**必须至少有一个反引号路径**。
 *    ——「做完了」而说不出一个具体产物,那句「做完了」不可核对。
 * 2. 那些路径**必须真的存在**。
 *
 * ## 范围:只查还带 `**交付**` 行的版本块
 *
 * 已压缩的版本块按第三节把实现细节移进了归档,块里只剩「改了什么」——
 * 那里没有 `**交付**` 行,自然不参与。这不是漏检:那些版本的产物
 * 早已被后续版本的测试与守卫持续使用着,缺了会以别的方式红。
 *
 * ## ⚠️ 明写的局限:**括号里的第二个产物仍然逃得掉**
 *
 * 判据 1 收紧成「每条列举项都要有路径」之后,纯散文的列举项被堵住了。
 * 但**同一个列举项内部**仍有一条缝:
 *
 * ```
 * `sdk/kotlin`(生成的模型 + 客户端)      ← 括号里是**第二个产物**
 * `design-kit-adoption.md`(两条裁决与实测判据) ← 括号里是**对这个产物的说明**
 * ```
 *
 * **两者结构完全一样**,而语义相反。任何解析器都分不出来 ——
 * 这不是实现偷懒,是这条缝在文本层面不可判定。
 *
 * 实测后果:V0.8.0 缺的四处产物里,收紧后的判据抓得到两个示例目录
 * (它们本来就写成了独立的列举项),**抓不到两个「客户端」** ——
 * 它们藏在 `` `sdk/kotlin`(生成的模型 + 客户端) `` 的括号里。
 *
 * ⇒ **唯一的真修法是写法约定,不是判据**:
 * **一个产物一个列举项,不要把第二个产物塞进括号。**
 * 括号里只写「这个产物是什么」,不写「另外还交付了什么」。
 *
 * 这条约定本身没有守卫盯着(盯不了,理由同上)——
 * 所以它写在这里,而不是写在只有人会读的地方。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkSessionStatusHasArtifacts() {
  const file = p('SESSION_TASKS.md')
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    return [{ file: 'SESSION_TASKS.md', line: 0, text: '读不到任务书 —— 本条无从判定' }]
  }

  const lines = source.split(/\r?\n/)

  // 版本块的边界:`## …M<版本>…`。Session 编号是**块内**的,所以必须分块处理。
  /** @type {{ title: string, start: number, end: number }[]} */
  const blocks = []
  for (let i = 0; i < lines.length; i += 1) {
    if (/^## .*M\d+\.\d+\.\d+/.test(lines[i] ?? '')) {
      const prev = blocks[blocks.length - 1]
      if (prev !== undefined) prev.end = i
      blocks.push({ title: (lines[i] ?? '').slice(0, 60), start: i, end: lines.length })
    }
  }

  let checked = 0
  for (const block of blocks) {
    const body = lines.slice(block.start, block.end)

    // 1. 块内的 Session 状态表:`| 0 | 标题 | ✅ |`
    /** @type {Map<string, string>} */
    const status = new Map()
    for (const line of body) {
      const m = /^\|\s*(\d+)\s*\|[^|]*\|\s*(✅|🔄|⬜|🟠)\s*\|/.exec(line)
      if (m) status.set(m[1] ?? '', m[2] ?? '')
    }
    if (status.size === 0) continue

    // 2. 块内的 `### Session N · …` 与紧随其后的 `**交付**` 行
    for (let i = 0; i < body.length; i += 1) {
      const head = /^### Session (\d+)/.exec(body[i] ?? '')
      if (head === null) continue
      const n = head[1] ?? ''
      if (status.get(n) !== '✅') continue

      // 交付行可能折行 —— 收到下一个空行为止
      let delivery = ''
      for (let j = i + 1; j < body.length && !/^### /.test(body[j] ?? ''); j += 1) {
        if (!/^\*\*交付\*\*/.test(body[j] ?? '')) continue
        for (let k = j; k < body.length && (body[k] ?? '').trim() !== ''; k += 1) {
          delivery += `${body[k]}\n`
        }
        break
      }
      if (delivery === '') continue

      const lineNo = block.start + i + 1
      /** 反引号里像仓库路径的:带 `/`、不含空格、不是 URL。 */
      // ⚠️ **不是每个带斜杠的反引号都是仓库路径。** 交付行里最常见的三种非路径:
      //   · API 端点 `/v1/workspaces*` —— 以 `/` 开头(仓库相对路径不会)
      //   · npm 包名 `@dshwar/sdk` —— 以 `@` 开头
      //   · URL —— 以 `http` 开头
      //
      //   V0.9.0 Session 2 的交付行同时踩到前两种,守卫报「`/v1/workspaces*` 不存在」——
      //   **那是误报**,而按它去改会把一行准确的描述改坏。
      //   (顺带:`dist/` 这种「像路径但不是仓库里的路径」的写法仍会被报出来,
      //    那是对的 —— 它确实读起来像一个交付物,该换个说法。)
      const pathsIn = (/** @type {string} */ text) =>
        [...text.matchAll(/`([^`\s]+)`/g)]
          .map((m) => m[1] ?? '')
          .filter(
            (s) =>
              s.includes('/') && !s.startsWith('http') && !s.startsWith('@') && !s.startsWith('/'),
          )

      // ---- 判据 1:**每一条列举项**都要能指向一个路径 ----
      //
      // ⚠️ 这一条 2026-08-22 从「该 Session 有**任一**路径即可」收紧。
      // 放宽版漏掉的形态很具体:V0.8.0 的 Session 1 交付写的是
      // 「`sdk/kotlin`(生成的模型 + 客户端)、`examples/kotlin-session`、
      // 同步断言 + 覆盖断言」——只要有一个路径就整条放行,
      // 于是「同步断言 + 覆盖断言」这类**纯散文列举项**一路溜过去。
      // 收紧当天的代价实测为 **0 处**(主文件里标 ✅ 的 Session 全部合规)。
      const items = delivery
        .replace(/^\*\*交付\*\*[::]/, '')
        .replace(/\s+/g, ' ')
        .replace(/[。\s]+$/, '')
        .split(/[、;;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      if (items.length === 0) {
        out.push({
          file: 'SESSION_TASKS.md',
          line: lineNo,
          text: `${block.title.replace(/<[^>]+>/g, '').trim()} 的 Session ${n} 标 ✅,而交付行是空的`,
        })
        continue
      }

      let anyProse = false
      for (const item of items) {
        if (pathsIn(item).length > 0) continue
        anyProse = true
        out.push({
          file: 'SESSION_TASKS.md',
          line: lineNo,
          text: `Session ${n} 标 ✅,但交付项「${item.slice(0, 30)}」说不出一个可核对的路径`,
        })
      }
      if (anyProse) continue

      const paths = pathsIn(delivery)

      for (const rel of paths) {
        checked += 1
        if (existsSync(p(rel))) continue
        out.push({
          file: 'SESSION_TASKS.md',
          line: lineNo,
          text: `Session ${n} 标 ✅,但交付点名的 \`${rel}\` 不存在`,
        })
      }
    }
  }

  // ★ 出口计数。一个「一条路径都没查到」的检查与没有检查等价,
  //   而它在输出里显示为「通过」——本仓反复抓的那个形状。
  if (checked === 0) {
    out.push({
      file: 'SESSION_TASKS.md',
      line: 0,
      text: '一条产物路径都没查到 —— 任务书里没有 ✅ 的 Session 带交付路径,本条退化成空集扫描',
    })
  }

  return out
}

/**
 * 前端三条约束(D7,为 Tauri 套壳预留)。
 *
 * 三个宿主(远端 Web / 本地 sidecar / Tauri)要跑**同一份代码**,
 * 唯一的差别是 baseURL。违反任一条在 Tauri 里都不是「表现不好」,
 * 是**根本跑不起来** —— 而那时前端已经写了几十个组件,改起来是重构。
 *
 * ## ⚠️ 扫描范围:从「哪个目录」改成「什么形状」(V0.9.0)
 *
 * 第一版写死 `console-web/src`,豁免写死单个 `console-web/src/api.ts`。
 * 那在只有一个前端包时够用,而 V0.9.0 要新增 `packages/design-system`、
 * 工作台、Tauri 前端 —— **它们全部逃出扫描范围,而守卫照样绿**。
 *
 * 这与「一维内部还有没有未被触及的表达方式」是同一形状:维度打了勾,
 * 而它只覆盖了自己的一部分。
 *
 * ⇒ 改成按**形状**发现:**前端包 = `package.json` 的依赖里有 `react`**。
 * 新增前端包不需要在任何地方登记 —— 没有清单可忘,也就没有「忘了登记」这回事。
 *
 * ## 但「不声明 react」是一条逃逸路径,所以单独堵上
 *
 * 一个包写了 `.tsx` 却不在 `package.json` 里声明 `react`,就从判据里溜了。
 * 这条本身要红:**认不出的前端包比违规的前端包更危险** ——
 * 后者会被报出来,前者悄无声息。
 *
 * ## 约束 3 的判据也跟着变:每个前端包**恰好一个** api 出口
 *
 * 从「只有 `console-web/src/api.ts` 可以碰网络」改成「每个前端包
 * `src/api.ts` 恰好一个,且只有它可以碰网络」。三种坏法各自报出来:
 *
 * | 坏法 | 为什么坏 |
 * | --- | --- |
 * | 零个出口而包里有网络调用 | 请求散落了,三个宿主换 baseURL 时改不动 |
 * | 两个出口 | 「唯一出口」不再唯一,注入 baseURL 时会漏掉一个 |
 * | 非出口文件里有网络调用 | 同第一条 |
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
/**
 * 前端包 = `package.json` 的依赖里有 `react` 的包。
 *
 * 按**形状**发现,不按清单登记 —— 没有清单可忘,也就没有「忘了登记」这回事。
 * 逃逸路径(写了 .tsx 却不声明 react)由 {@link checkFrontendConstraints} 单独堵。
 *
 * @returns {{ dir: string, rel: string }[]}
 */
function frontendPackages() {
  const pkgFiles = collectFiles(REPO, isPackageJson)
  /** @type {{ dir: string, rel: string }[]} */
  const frontendPkgs = []
  for (const file of pkgFiles) {
    let json
    try {
      json =
        /** @type {{dependencies?: Record<string,string>, devDependencies?: Record<string,string>}} */ (
          JSON.parse(readFileSync(file, 'utf8'))
        )
    } catch {
      continue
    }
    const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) }
    if (deps['react'] === undefined) continue
    frontendPkgs.push({ dir: dirname(file), rel: repoPath(REPO, dirname(file)) })
  }
  return frontendPkgs
}

/**
 * ★ **前端不得持有长效凭据。**
 *
 * ## 它守的是什么
 *
 * V0.9.0 Session 4 的验收:「前端代码里**搜不到长效凭据**」。
 *
 * 那句话不是一条 grep 规则,是**架构约束**:浏览器里没有钥匙串,
 * 而 `localStorage` / `sessionStorage` / cookie 都对任何一段同源脚本可读 ——
 * 一次 XSS 就能把 refresh token 整个带走,而它的价值恰恰在于**长期有效**。
 *
 * access token 是短效的,泄漏的窗口以分钟计;refresh token 泄漏等于
 * **把账号交出去**,而且用户不会收到任何提示。两者的处置完全不同,
 * 所以这条守卫只拦后者。
 *
 * ## 判据
 *
 * 前端包(依赖里有 `react` 的包)里,不得出现
 * 「把 refresh token 交给浏览器存储」这个形状:
 *
 * ```
 * localStorage.setItem(..., refreshToken)
 * sessionStorage.setItem('refresh_token', ...)
 * document.cookie = `refresh_token=...`
 * ```
 *
 * ⚠️ **只看「浏览器存储 × refresh」的组合**,不单看任何一半:
 *
 * | 只看这一半 | 会误伤什么 |
 * | --- | --- |
 * | 见到 `refreshToken` 就红 | 传递一个短效 token 的正常代码;讲这条规则的注释 |
 * | 见到 `localStorage` 就红 | 存 UI 偏好(折叠状态、上次选的租户)—— 那是合法用途 |
 *
 * ⚠️ 而 `localStorage` 本身已被**约束 2** 禁掉(它在 Tauri 里语义不同)。
 * 本条与那条**不重复**:约束 2 管的是「跨宿主能不能用」,
 * 这条管的是「就算能用,也不许放这个东西」。
 * 两条的范围不同 —— 将来 Tauri 侧放开某种存储时,这一条仍然要拦。
 *
 * ## ⚠️ 守卫不能惩罚记录
 *
 * 走 `grepFiles`,它已经跳过整行注释 —— `host.ts` 里那段讲
 * 「为什么 Web 宿主不存 refresh token」的 JSDoc 因此不会被点名。
 * 负向验证 40b 就是这个形态。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkNoLongLivedCredentialInFrontend() {
  const pkgs = frontendPackages()
  if (pkgs.length === 0) {
    return [
      {
        file: 'package.json',
        line: 0,
        text: '全仓找不到任何前端包 —— 本条会退化成空集扫描,永远绿',
      },
    ]
  }

  /** 浏览器存储 × refresh 的组合。两半都要出现在同一行。 */
  const PATTERN =
    /(localStorage|sessionStorage|document\.cookie|indexedDB)[^\n]*\b(refresh[_-]?token|refreshToken)\b|\b(refresh[_-]?token|refreshToken)\b[^\n]*(localStorage|sessionStorage|document\.cookie|indexedDB)/gi

  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  let scanned = 0
  for (const pkg of pkgs) {
    const files = collectFiles(pkg.dir, isTs)
    scanned += files.length
    out.push(...grepFiles(files, PATTERN, REPO))
  }

  if (scanned === 0) {
    out.push({
      file: 'package.json',
      line: 0,
      text: '前端包里一个 .ts/.tsx 都没有 —— 本条退化成空集扫描,永远绿',
    })
  }
  return out
}

/**
 * ★ **成功回执必须在成功之后给。**
 *
 * ## 它守的是「假成功回执」—— 本仓最贵的那一族
 *
 * V0.9.0 移植设计 kit 时抓到的原型(`CodeRef.jsx`):
 *
 * ```js
 * try { void navigator.clipboard.writeText(text) } catch {}
 * setDone(true)                 // ← 在 try **之外**
 * ```
 *
 * 两处错叠在一起:
 *
 * 1. `setDone(true)` 在 try 之外 —— 同步抛出时照样翻成「已复制」;
 * 2. 更隐蔽的一处:`writeText` 返回 **Promise**,而同步 `try/catch`
 *    **捕不到 Promise 的拒绝**。而真实的失败形态(权限被拒、非安全上下文)
 *    恰恰是拒绝 —— 所以那个 catch 块**在最常见的失败路径上从来不会执行**。
 *
 * 后果不是「少一条日志」:**操作没成功,而界面说成功了。**
 * 用户以为串进了剪贴板,粘贴出来是上一次的内容 —— 而他不会怀疑这个按钮,
 * 只会怀疑自己。这与 V0.8.0 的 `markPaid` 审计承诺、`memberCount ?? 0`
 * 是同一族:**系统给出的回执与它实际做到的事不一致。**
 *
 * ## 判据
 *
 * 前端源码里,把状态设成「完成/已复制/已保存/成功」这一类值的赋值,
 * **不得出现在 `try` 块之外的同一个函数体里** —— 更准确地说:
 * 一个文件里若同时出现
 *
 * - 一个 `try {` … `catch`,**且**
 * - 一处「回执赋值」出现在 `catch` 块**结束之后**、仍在同一层
 *
 * 就报出来。这是**形状**判据,不做数据流分析 —— 它抓的是那个具体的坏形状,
 * 不是「所有可能的假回执」。抓不全,但抓得准。
 *
 * ## ⚠️ 它抓不到什么(明写)
 *
 * - Promise 的拒绝路径本身:`p.then(ok)` 少写一个 `onRejected`,本条看不见。
 *   那要数据流分析,而一条看不懂的守卫会被绕过。
 * - 回执写在别的函数里、由回调调用的情形。
 *
 * ⇒ **它守的是「已经发生过的那个形状」,不是这一族的全部。**
 * 这句话写在这里,是为了让下一个撞见漏网之鱼的人知道那不是 bug,是边界。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkNoReceiptOutsideTry() {
  const pkgs = frontendPackages()
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []

  if (pkgs.length === 0) {
    return [
      {
        file: 'package.json',
        line: 0,
        text: '全仓找不到任何前端包 —— 本条会退化成空集扫描,永远绿',
      },
    ]
  }

  /** 「设成完成态」的赋值:`setXxx(true)` / `setState('copied')` 这一类。 */
  const RECEIPT =
    /\bset[A-Z]\w*\(\s*(true|['"](?:done|copied|saved|success|succeeded|ok|complete[d]?)['"])\s*\)/

  let scanned = 0
  for (const pkg of pkgs) {
    const files = collectFiles(pkg.dir, (/** @type {string} */ f) => /\.tsx?$/.test(f))
    scanned += files.length
    for (const file of files) {
      let lines
      try {
        lines = readFileSync(file, 'utf8').split(/\r?\n/)
      } catch {
        continue
      }
      // 只在**出现过 try/catch 的文件**里找 —— 没有 try 的文件里,
      // 一处 setDone(true) 就是普通的状态更新,不是回执问题。
      if (!lines.some((l) => /\btry\s*\{/.test(l))) continue

      let depth = 0
      let afterCatch = false
      lines.forEach((line, i) => {
        // ⚠️ 跳过注释行。**记录反面写法的注释正是好代码该有的东西** ——
        //   本条第一次跑就误报了 CodeRef 顶部那段「原版为什么错」的 JSDoc。
        //   一条会拦住「解释这个 bug」的守卫,会让人把解释删掉 —— 而那比 bug 本身更贵。
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        if (/\bcatch\b[^{]*\{/.test(line)) {
          afterCatch = true
          depth = 0
        }
        if (afterCatch) {
          depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
          // catch 块闭合之后,同一层里再出现回执赋值 —— 就是那个形状。
          if (depth <= 0 && !/\bcatch\b/.test(line) && RECEIPT.test(line)) {
            out.push({
              file: repoPath(REPO, file),
              line: i + 1,
              text: `${line.trim().slice(0, 80)} —— 回执在 catch 之外,失败时照样报成功`,
            })
            afterCatch = false
          }
        }
      })
    }
  }

  if (scanned === 0) {
    out.push({
      file: 'package.json',
      line: 0,
      text: '前端包里一个 .ts/.tsx 都没有 —— 本条退化成空集扫描,永远绿',
    })
  }

  return out
}

/**
 * ★ **前端不得用 JS 承载 hover / active / focus 的样式。**
 *
 * ## 它守的是一条会在移植时被原样带进来的写法
 *
 * 设计 kit 的 21 个组件全部用 JS style 对象 + React state 表达交互态:
 *
 * ```jsx
 * const [hover, setHover] = React.useState(false)
 * onMouseEnter={() => setHover(true)}
 * onFocus={e => { e.currentTarget.style.boxShadow = 'var(--focus-ring)' }}
 * ```
 *
 * 移植时要改成 CSS 类 + `:hover` / `:active` / `:focus-visible`。
 * **而如果只是改一遍不加守卫,下一个人会照着旧 kit 的写法加组件** ——
 * kit 会一直在那里,它就是最方便的参照。
 *
 * ## 为什么这不是风格偏好
 *
 * | 后果 | 为什么严重 |
 * | --- | --- |
 * | **没有 `:focus-visible`** | `onFocus` 对鼠标点击也触发,焦点环因此常亮。而设计语言明写「键盘可达性不依赖颜色差异」、焦点环是那条通道的指示 —— 它对所有人常亮,那条规则就名存实亡 |
 * | **写不了媒体查询** | Tauri 桌面窗口可缩放,而工作台是三栏布局。没有断点就没有三栏 |
 * | 每次 hover 一次 re-render | 次要,但表格里每行一个组件时看得见 |
 * | 触屏上 `onMouseEnter` 语义不对 | 次要,但白牌客户可能上平板 |
 *
 * ## 判据:两条,都窄到能说清「为什么这一个不行」
 *
 * 1. `onMouseEnter` / `onMouseLeave` / `onMouseOver` / `onMouseOut`
 *    —— CSS `:hover` 覆盖了这个用例。真需要鼠标进出事件的场景
 *    (拖放、画布命中测试)加 `dshwar-guard-allow: <理由>`。
 * 2. `.style.<属性> = ` —— 直接改内联样式。焦点环、选中态这类
 *    都该由 CSS 伪类接管。
 *
 * ⚠️ 刻意**不**禁 `style={{...}}` 本身:一次性的布局(`gridTemplateColumns`
 * 按数据算)用内联是合理的,禁掉等于禁止写动态布局。禁的是**用 JS 表达
 * 那些 CSS 伪类本来就能表达的状态**。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkNoJsInteractionStyles() {
  const pkgs = frontendPackages()
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []

  // ★ 空集守卫 —— 与三条约束共用同一个发现逻辑,所以同一个坏法也共用。
  if (pkgs.length === 0) {
    return [
      {
        file: 'package.json',
        line: 0,
        text: '全仓找不到任何前端包 —— 本条会退化成空集扫描,永远绿',
      },
    ]
  }

  let scanned = 0
  for (const pkg of pkgs) {
    const files = collectFiles(pkg.dir, (/** @type {string} */ f) => /\.(ts|tsx)$/.test(f))
    scanned += files.length
    if (files.length === 0) continue

    out.push(
      ...grepFiles(files, /\bon(MouseEnter|MouseLeave|MouseOver|MouseOut)\b/g, REPO).map((h) => ({
        ...h,
        text: `${h.text} —— hover 态走 CSS :hover,不要用 JS 状态`,
      })),
    )
    out.push(
      ...grepFiles(files, /\.style\.[A-Za-z][A-Za-z0-9]*\s*=[^=]/g, REPO).map((h) => ({
        ...h,
        text: `${h.text} —— 直接改内联样式;焦点环走 :focus-visible,选中态走 CSS 类`,
      })),
    )
  }

  // ★ 出口计数:前端包在、但一个源文件都没有 —— 同样是空集扫描。
  if (scanned === 0) {
    out.push({
      file: 'package.json',
      line: 0,
      text: '前端包里一个 .ts/.tsx 都没有 —— 本条退化成空集扫描,永远绿',
    })
  }

  return out
}

/**
 * 前端三条约束(D7)—— 完整说明见 {@link frontendPackages} 与本函数体内注释。
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkFrontendConstraints() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  const frontendPkgs = frontendPackages()

  // ---- 逃逸路径:写了 .tsx 却没声明 react ----
  const inFrontend = (/** @type {string} */ f) =>
    frontendPkgs.some((pkg) => repoPath(REPO, f).startsWith(`${pkg.rel}/`))
  for (const tsx of collectFiles(REPO, (f) => f.endsWith('.tsx'))) {
    if (inFrontend(tsx)) continue
    out.push({
      file: repoPath(REPO, tsx),
      line: 0,
      text: '[范围] 这个 .tsx 不属于任何声明了 react 的包 —— 它逃出了三条约束的扫描',
    })
  }

  // ★ 空集守卫。没有它,前端包全没了会让三条约束「通过」。
  if (frontendPkgs.length === 0) {
    out.push({
      file: 'package.json',
      line: 0,
      text: '[范围] 全仓找不到任何前端包(依赖里有 react 的包)—— 三条约束会退化成空集扫描,永远绿',
    })
    return out
  }

  let scanned = 0
  for (const pkg of frontendPkgs) {
    const files = collectFiles(pkg.dir, (/** @type {string} */ f) => /\.(ts|tsx)$/.test(f))
    scanned += files.length
    if (files.length === 0) continue

    // 约束 1:路由。禁 history router 与 history API。
    out.push(
      ...grepFiles(
        files,
        /\b(createBrowserRouter|BrowserRouter|history\.pushState|history\.replaceState|useHistory)\b/g,
        REPO,
      ).map((h) => ({ ...h, text: `[约束1 路由] ${h.text}` })),
    )

    // 约束 2:浏览器专有 API。
    //
    // ⚠️ 刻意**不**禁 `document` 与 `window` 本身 —— React 组件树、事件、
    // 测试夹具都要用到它们,禁掉等于禁止写前端。禁的是**那些在 Tauri 里
    // 语义不同或不可用的具体入口**。规则要窄到能说清「为什么这一个不行」,
    // 宽泛的禁令只会被加豁免绕过。
    out.push(
      ...grepFiles(
        files,
        /\b(localStorage|sessionStorage|window\.location\s*=|location\.assign|location\.replace|navigator\.serviceWorker|indexedDB)\b/g,
        REPO,
      ).map((h) => ({ ...h, text: `[约束2 浏览器专有 API] ${h.text}` })),
    )

    // 约束 3:每个前端包**恰好一个** api 出口。
    const NET = /\b(fetch\s*\(|XMLHttpRequest|axios|EventSource\s*\()/g
    // `api.ts` 与 `api.tsx` 都算出口 —— 同包并存是真会犯的错(改扩展名时忘了删旧的),
    // 而只认其中一个的话,那种错会安静地变成「两个出口,守卫只看见一个」。
    const exits = files.filter((f) => {
      const rel = repoPath(REPO, f)
      return rel === `${pkg.rel}/src/api.ts` || rel === `${pkg.rel}/src/api.tsx`
    })
    const nonExit = files.filter((f) => !exits.includes(f))
    const strayNet = grepFiles(nonExit, NET, REPO)

    if (exits.length > 1) {
      out.push({
        file: pkg.rel,
        line: 0,
        text: `[约束3 统一 SDK 层] 这个前端包有 ${exits.length} 个 api 出口 —— 「唯一出口」不再唯一,注入 baseURL 时会漏掉一个`,
      })
    } else if (exits.length === 0 && strayNet.length > 0) {
      out.push({
        file: pkg.rel,
        line: 0,
        text: '[约束3 统一 SDK 层] 这个前端包没有 src/api.ts,却有网络调用 —— 请求散落之后,三个宿主换 baseURL 时改不动',
      })
    }

    out.push(
      ...strayNet.map((h) => ({
        ...h,
        text: `[约束3 统一 SDK 层] ${h.text} —— 请求只能在 ${pkg.rel}/src/api.ts 里发生`,
      })),
    )
  }

  // ★ 出口计数。前端包在、源码全没了 —— 与「一个前端包都没有」同样是空集扫描,
  //   而这一条是改成按形状发现之后**新出现**的路径:第一版扫的是写死的目录,
  //   目录空了立刻报;现在包还在,只是里面没文件,循环会安静地跳过。
  if (scanned === 0) {
    out.push({
      file: 'package.json',
      line: 0,
      text: '[范围] 前端包里一个 .ts/.tsx 都没有 —— 三条约束会退化成空集扫描,永远绿',
    })
  }

  return out
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
/**
 * ★ **变异后跑测试必须先同步 dist** —— 只允许 `scripts/lib/mutate.mjs` 拉起 vitest。
 *
 * ## 它防的是一类「结论不可信」,而不是一个 bug
 *
 * 各包 `main` 指向 `dist/`,Vitest 没有把 `@dshwar/*` 指回 `src` 的 alias。
 * 于是跨包的测试消费的是 **dist**,而 `check:all` 的 `typecheck` 跑在探针
 * **之前** —— dist 是用未变异的源码构建的。改坏 A 包的 src、跑 B 包的测试,
 * 「没变红」于是有两种含义,而它们在输出里长得一模一样:
 *
 * 1. 断言弱(真问题)
 * 2. **根本没测到改动**(工具问题)
 *
 * 2026-08-17 实测撞到过:离线降级的 e2e 拆掉可达性判定后仍绿,重建后才红。
 * 按含义 1 处理的话,会基于误判去「加强」一条本来正确的断言。
 *
 * ## 判据:结构性,不靠人记得
 *
 * 拉起 vitest 的路径**收敛到一处**(`lib/mutate.mjs` 的 `runTestsUnderMutation`
 * 与 `runVitest`),那一处必定同步 dist。于是「忘了构建」在结构上不可能发生,
 * 而本守卫只需检查一件容易检查的事:**别处不得出现 vitest 的路径字面量**。
 */
function checkVitestSpawnIsCentralized() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  const scriptFiles = collectFiles(p('scripts'), (/** @type {string} */ f) => f.endsWith('.mjs'))

  for (const file of scriptFiles) {
    const rel = repoPath(REPO, file)
    // 受控通路自己当然要拉起 vitest —— 它就是那条通路。
    if (rel === 'scripts/lib/mutate.mjs') continue

    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (const [i, line] of lines.entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
      if (
        /dshwar-guard-allow:\s*\S/.test(line) ||
        /dshwar-guard-allow:\s*\S/.test(lines[i - 1] ?? '')
      )
        continue
      if (/['"]vitest\.mjs['"]|vitest\/vitest\.mjs/.test(line)) {
        out.push({ file: rel, line: i + 1, text: `${rel}:${i + 1}  ${line.trim()}` })
      }
    }
  }
  return out
}

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
/**
 * 每个 CI job 的**实质检查**登记在哪 —— 新增 job 必须同时在此登记。
 *
 * 「登记」不是形式主义:填的是**「这个 job 的检查坏掉时,谁会红」**。
 * 答不上来的 job 就是一个没人看着的绿勾,而那正是本守卫要消灭的东西。
 *
 * ⚠️ 双向校验:ci.yml 里有而这里没有 = 漏登记;这里有而 ci.yml 里没有 =
 * 登记表腐烂。只查一个方向的登记表迟早会变成一份историческая 摆设。
 */
const CI_JOB_VERIFICATION = {
  gate: 'check:all 本体 —— 其下每一项各自有守卫(check-guards)或探针(verify-assertions)',
  'process-cost':
    'verify-guards 27a/27b —— 把阈值调到 0 必须红;删掉平台条目 + --require-threshold 必须红',
}

/**
 * ★ **CI job 必须做实质检查,且在 {@link CI_JOB_VERIFICATION} 里登记。**
 *
 * ## 它防的是一个真发生过的形状
 *
 * `terminal-contract` 这个 job 只 `echo` 一行就退出 —— 在 GitHub 面板上
 * **永远是绿勾**,而它一次检查都没做过。它还指向一个不存在的任务
 * (注释里的「Session 7」在当前规划里查无此项)。
 *
 * **一个不检查的 job 比没有 job 更糟:它占一个绿勾。**
 *
 * ## 两条判据
 *
 * 1. **实质性**:去掉准备步骤(checkout / setup / install / build)之后,
 *    至少还要剩一条不是 `echo` / `true` / `:` 的 `run`
 * 2. **已登记**:job 名必须在登记表里,且登记表里不得有 ci.yml 没有的项
 *
 * 判据 2 比判据 1 强得多 —— 一个 job 可以跑一条真命令却没人验证那条命令
 * 是否真的会红(`measure-process-cost --assert` 在 2026-08-17 之前正是如此)。
 */
/**
 * ★ **`primaryColor` 的 null 不许被兜底掉。**
 *
 * ## 它防的是「类型层刚分开的两种状态,在第一个调用点又被合并」
 *
 * V0.8.0 把 `primaryColor` 从 `string`(哨兵默认 `#2F6FEB`)改成 `string | null`,
 * 为的是让**「未配置」与「配置成某个值」在类型层可分**。
 *
 * 而一行 `branding.primaryColor ?? '#2F6FEB'` 就能把这次改动**完全抵消** ——
 * 类型上仍然是分开的,行为上又合并了,**而且没有任何东西会变红**。
 *
 * ⚠️ 判空必须**收敛在派生入口一处**(`derive(seed: string | null)`),
 * 不在调用点判。每个调用点各判一次的后果是:总有一个点判错,
 * 而那个点的表现是「这个租户的界面莫名其妙有颜色」。
 *
 * ## 判据
 *
 * 出现 `primaryColor` 后接 `??` / `||` 再接一个颜色字面量或建议色常量,即违规。
 * 行级豁免走 `dshwar-guard-allow:`(与其它守卫同款)。
 */
function checkPrimaryColorHasNoFallback() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  // ⚠️ **扫描范围按形状发现,不写死目录名。**
  //
  //   原先是 `['packages', 'gateway', 'console-web', 'sdk']` —— 一张手写清单。
  //   V0.9.0 Session 1 已经因为同一形状改过一次前端守卫(那次是
  //   `p('console-web','src')` 写死),而这里漏了。
  //
  //   后果很具体:Session 2 新建的根级前端包 `workbench-web/` 不在清单里,
  //   于是它里面写 `branding.primaryColor ?? '#2F6FEB'` **不会红** ——
  //   V0.8.0 那次「未配置 vs 配置成某个值」的类型层区分,
  //   在**最新的那个前端**里悄悄停止生效,而门禁全绿。
  //
  //   ⇒ 改成**扫全仓的 .ts / .tsx**(`SKIP_DIRS` 已排除 node_modules / dist /
  //     .git / feasibility 等)。新包、新目录、根级还是 packages/ 下,一律在范围内。
  //
  //   ⚠️ 中途试过一版「有 package.json 的目录才扫」—— 那是在**另一个维度上收窄**:
  //     负向验证的夹具 `packages/__guard_fixture__/` 只有 `src/theme.ts`、
  //     没有 manifest,于是 30a/30b 立刻变红。反向对照抓住了这次回归,
  //     记在这里:**扩范围的改动同样会缩范围**,两个方向都要验。
  for (const file of collectFiles(REPO, isTs)) {
    const rel = repoPath(REPO, file)
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (const [i, line] of lines.entries()) {
      // 跳过注释行 —— 讲「不许这么写」的说明与违规在文本上一模一样。
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
      if (
        /dshwar-guard-allow:\s*\S/.test(line) ||
        /dshwar-guard-allow:\s*\S/.test(lines[i - 1] ?? '')
      )
        continue
      // primaryColor ?? '#xxx'  /  primaryColor || "#xxx"  /  primaryColor ?? SUGGESTED_...
      if (/primaryColor\s*(\?\?|\|\|)\s*(['"`]#|SUGGESTED_PRIMARY_COLOR)/.test(line)) {
        out.push({ file: rel, line: i + 1, text: `${rel}:${i + 1}  ${line.trim()}` })
      }
    }
  }
  return out
}

/**
 * ★ **任何一处都不许自带「币种 → 最小单位指数」对照表。**
 *
 * ## 它防的是什么(V0.9.0 Session 5.5)
 *
 * 金额是最小货币单位的整数,而 minor → major 的指数**不都是 2**:
 * JPY 是 0,KWD 是 3。谁想显示金额,谁就需要指数。
 *
 * 曾经有两处各自解决了这个问题,而它们**已经不一致**:
 *
 * | 位置 | 当时的做法 | JPY 的答案 |
 * | --- | --- | --- |
 * | `console-web/src/view/overview.ts` | 自带 11 条的表 | 对 |
 * | `console-web/src/view/usage.ts` | 写死 `÷ 100` | **差 100 倍** |
 *
 * 一个前端里的两个事实源。⇒ 现在指数**随金额一起从契约来**
 * (`Cost.currencyExponent`),而它与服务端的价格出自同一段配置。
 *
 * ⚠️ **服务端同样不许有这张表。** 那会是一份**会过期的数据**(币种改制真的发生过),
 * 而它一过期,正确的配置反而会被判成错的。所以这条守卫扫全仓,不只扫前端。
 *
 * ## 判据
 *
 * 一行里出现「三个大写字母 + 冒号 + 0–4 的整数」即违规 —— 那是这张表的长相。
 *
 * ⚠️ 判据**刻意偏宽**:它可能误伤一个恰好长这样的常量(`{ GET: 1 }` 之类)。
 * 取这个宽度的理由是代价不对称 —— 误伤一次加一个带理由的豁免标记就过去了,
 * 而漏一次是账目差 10 的整数次幂,且**看起来完全正常**。
 * 实测:本仓当下命中 **0 处**,所以这个宽度今天不产生任何噪声。
 *
 * 反向对照(`verify-guards.mjs` 42b/42c)钉住两个合法形态:
 * `currency: 'JPY'`(币种是**值**,不是键)与 `currencyExponent: 2`(从契约收下来的那个数)。
 *
 * @returns {{file: string, line: number, text: string}[]}
 */
function checkNoCurrencyExponentTable() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  // 与 primaryColor 那条同款:**扫全仓的 .ts / .tsx**,不写死目录清单。
  // 写死清单的后果在 Session 1/2 已经付过两次学费(新建的根级前端包不在清单里)。
  const files = collectFiles(REPO, isTs)
  out.push(
    ...grepFiles(files, /\b[A-Z]{3}\s*:\s*[0-4]\b/g, REPO).map((h) => ({
      ...h,
      text: `${h.file}:${String(h.line)}  ${h.text}`,
    })),
  )
  // ★ 出口计数:全仓一个 .ts 都没扫到 = 空集扫描,而它显示为「通过」。
  if (files.length === 0) {
    out.push({
      file: 'package.json',
      line: 0,
      text: '全仓一个 .ts 都没扫到 —— 本条退化成空集扫描,永远绿',
    })
  }
  return out
}

/**
 * ★ **每个 SDK 都要有「与契约同步」的断言。**
 *
 * ## 它防的是「加了第四种语言,而没人盯着它」
 *
 * 「改了契约没重新生成 SDK」在 V0.5.0 期间被抓到过一次 —— 那时只有 TS SDK。
 * 三种语言之后,**同一个漏洞面各有一份**;而加第四种语言时,漏掉那份断言
 * 不会让任何东西变红:新 SDK 的产物照样生成、照样提交,只是永远不再校验。
 *
 * ## 判据:每个 `sdk/*` 都必须同时有
 *
 * 1. `scripts/render.ts` —— 纯渲染函数(生成脚本与测试**共用**的那条路径)
 * 2. `test/**` 里引用 `render`,且断言「重渲染 == 已提交」
 *
 * ⚠️ 第 2 条查的是**测试引用了渲染函数**,而不是「有测试文件」——
 * 一个不调渲染函数的测试证明不了产物是最新的。
 *
 * ⚠️ **第一版判据是错的,而且它报了假阳性。** 原先写成
 * `/toBe\(render/`,而 TS SDK 把渲染结果先存进变量再比对
 * (`.toBe(regenerated.trim())`)—— 于是守卫指着一个**完全合规**的 SDK
 * 说它缺断言。
 *
 * 这是「一个报错的工具与一个不报错的工具同样需要被核对」的第二例
 * (第一例是 `session-tasks.mjs check` 的三个假阳性)。
 * 判据改成三条合取:**引用渲染函数 + 读已提交的产物 + 有等值断言** ——
 * 三者缺一都不足以证明「产物是最新的」。
 *
 * ## ⚠️ 第三例假阳性(V0.9.0 Session 2):它把**自己的说明书**判成了违规
 *
 * 「哪些目录算一个 SDK」原先写成 **`sdk/` 下的任何目录**。于是
 * `sdk/docs/`(里面只有 `why-sync-assertion.md` —— 一份 104 行的裁决文档,
 * 讲的正是**本守卫为什么存在**)被当成一个缺 `render.ts` 的 SDK,报违规。
 *
 * 这是 CLAUDE.md「**守卫不能惩罚记录**」那条规则的第一个真实命中,
 * 而且形状比那条规则写的更宽:本守卫**不按文本判定**,按**目录形状**判定。
 * 说明书落进扫描范围,不是因为它的文字像违规,是因为它的**位置**像。
 *
 * ⇒ 判据改成「**有 `package.json` 的目录才是一个 SDK**」——
 * 与 `pnpm-workspace.yaml` 认包的方式一致,也是三个真实 SDK 的共同标记。
 * 纯文档目录没有 manifest,自然不在范围内。
 *
 * ⚠️ 这个改动**不放宽真正的判据**:一个有 `package.json` 却没有
 * `render.ts` 的新 SDK 照样红。负向验证见 `verify-guards.mjs` 的 35a/35b。
 */
function checkSdkHasSyncAssertion() {
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  const sdkRoot = p('sdk')
  if (!existsSync(sdkRoot)) return out

  let considered = 0
  for (const entry of readdirSync(sdkRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    // 「是不是一个 SDK」的标记:有 manifest。纯文档目录没有,于是不在范围内。
    if (!existsSync(join(sdkRoot, name, 'package.json'))) continue
    considered += 1
    const render = join(sdkRoot, name, 'scripts', 'render.ts')
    if (!existsSync(render)) {
      out.push({
        file: `sdk/${name}`,
        line: 0,
        text: `sdk/${name} 没有 scripts/render.ts —— 生成脚本与校验测试就无法共用同一条渲染路径`,
      })
      continue
    }

    const testDir = join(sdkRoot, name, 'test')
    const tests = existsSync(testDir) ? collectFiles(testDir, isTs) : []
    const hasSync = tests.some((f) => {
      const src = readFileSync(f, 'utf8')
      // 三条合取,缺一都证明不了「产物是最新的」:
      //   ① 引用了那条共用的渲染路径
      //   ② 读了**已提交的产物**(只渲染不读,比的是渲染器与自己)
      //   ③ 有等值断言(`toBe(` —— 注意 `toBeGreaterThan(` 不匹配)
      return (
        /from '\.\.\/scripts\/render\.ts'/.test(src) &&
        /src['"\s,]+.{0,4}generated/.test(src) &&
        /\.toBe\(/.test(src)
      )
    })
    if (!hasSync) {
      out.push({
        file: `sdk/${name}/test`,
        line: 0,
        text: `sdk/${name} 缺「重渲染 == 已提交」的同步断言 —— 契约改了不重新生成不会有人发现`,
      })
    }
  }

  // ★ 出口计数。收窄判据(只认有 manifest 的目录)之后多了一条退化路径:
  //   若哪天 `sdk/*` 全都没有 package.json,循环一次都不进,本守卫**恒绿** ——
  //   而那与「三个 SDK 全部合规」在输出上一模一样。
  if (considered === 0) {
    out.push({
      file: 'sdk',
      line: 0,
      text: 'sdk/ 下一个带 package.json 的目录都没有 —— 本守卫退化成空集扫描,永远绿',
    })
  }
  return out
}

function checkCiJobsAreSubstantive() {
  const ciPath = p('.github/workflows/ci.yml')
  /** @type {{file: string, line: number, text: string}[]} */
  const out = []
  if (!existsSync(ciPath)) {
    return [{ file: '.github/workflows/ci.yml', line: 0, text: 'CI workflow 不存在' }]
  }
  const lines = readFileSync(ciPath, 'utf8').split(/\r?\n/)

  // 极简 YAML 扫描:`jobs:` 之后,缩进 2 空格的键即 job id。
  // 不引 YAML 解析器 —— 门禁脚本刻意零依赖,而这里只需要认两种行。
  let inJobs = false
  /** @type {string | undefined} */
  let current
  /** @type {Map<string, {line: number, runs: string[]}>} */
  const jobs = new Map()

  for (const [i, line] of lines.entries()) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue
    // ⚠️ 空行与**顶格注释**不结束 jobs 段 —— YAML 里注释不结束任何块。
    // 第一版把 `^\S` 一律当成段落结束,于是本文件末尾那段顶格的说明注释
    // 之后再加 job 就扫不到了。26a/26b 两条负向验证当场把它照了出来:
    // **守卫自己也需要负向验证,而不只是「跑过一次看着对」。**
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    if (/^\S/.test(line)) {
      inJobs = false // 顶层又出现别的键,jobs 段结束
      continue
    }

    const jobKey = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobKey?.[1] !== undefined) {
      current = jobKey[1]
      jobs.set(current, { line: i + 1, runs: [] })
      continue
    }
    if (current === undefined) continue

    const run = /^\s*(?:-\s*)?run:\s*(.+)$/.exec(line)
    if (run?.[1] !== undefined) jobs.get(current)?.runs.push(run[1].trim())
  }

  /** 准备步骤 —— 它们不构成「检查」。 */
  const isSetup = (/** @type {string} */ cmd) =>
    /^pnpm\s+(install|build)\b/.test(cmd) || /^(npm|corepack|node --version)\b/.test(cmd)
  /** 空操作 —— 它们更不构成检查。 */
  const isNoop = (/** @type {string} */ cmd) => /^(echo\b|true$|:$|#)/.test(cmd)

  for (const [name, job] of jobs) {
    const substantive = job.runs.filter((r) => !isSetup(r) && !isNoop(r))
    if (substantive.length === 0) {
      out.push({
        file: '.github/workflows/ci.yml',
        line: job.line,
        text: `job "${name}" 没有任何实质检查(只有准备步骤或 echo)—— 它在面板上是个恒绿的绿勾`,
      })
      continue
    }
    if (!(name in CI_JOB_VERIFICATION)) {
      out.push({
        file: '.github/workflows/ci.yml',
        line: job.line,
        text: `job "${name}" 没在 CI_JOB_VERIFICATION 里登记 —— 请写明「它的检查坏掉时谁会红」`,
      })
    }
  }

  // 反方向:登记表不得有 ci.yml 里没有的 job(否则登记表会烂成摆设)
  for (const name of Object.keys(CI_JOB_VERIFICATION)) {
    if (!jobs.has(name)) {
      out.push({
        file: 'scripts/check-guards.mjs',
        line: 0,
        text: `CI_JOB_VERIFICATION 里的 "${name}" 在 ci.yml 里不存在 —— 登记表腐烂了`,
      })
    }
  }

  return out
}

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

const eslintScope = checkEslintCoversFrontendPackages()
if (eslintScope.length === 0) {
  console.log('  通过  eslint 的分域规则覆盖了每一个前端包')
} else {
  failed += 1
  console.log(`  违规  有前端包不在 eslint 分域规则的 glob 里  (${eslintScope.length} 处)`)
  console.log('        分域规则是一张**手写清单**,而前端包是按形状发现的 ——')
  console.log('        新建一个包不会让任何东西变红,它只是悄悄少了几条规则。')
  for (const h of eslintScope) console.log(`        ${h.text}`)
}

const rootTs = checkRootLevelTsIsChecked()
if (rootTs.out.length === 0) {
  // ★ 数量印在**下一行**,不进守卫名。
  //   守卫名要稳定 —— 完备性断言(verify-guards 的 31)是按名字登记的,
  //   把随仓库变化的计数写进名字,等于每加一个配置文件就要改一次登记表。
  //   而「0 个对象」与「都查过了」仍要能区分,所以数量必须印出来。
  console.log('  通过  包根的 .ts 都在某份 tsconfig 的 include 里')
  console.log(`        (本轮检查对象 ${rootTs.scanned} 个 —— 0 个不等于查过了)`)
} else {
  failed += 1
  console.log(`  违规  包根的 .ts 落在所有 tsconfig 之外  (${rootTs.out.length} 处)`)
  console.log('        守卫扫得到它(它们扫整个包目录),tsc 看不见它 ——')
  console.log('        于是「守卫全绿」会被读成「这个文件没问题」。')
  console.log('        V0.9.0 实测:vite.config.ts 里写错的一个选项名藏了整整一轮。')
  for (const h of rootTs.out) console.log(`        ${h.file}  ${h.text}`)
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

const longLived = checkNoLongLivedCredentialInFrontend()
if (longLived.length === 0) {
  console.log('  通过  前端不持有长效凭据(refresh token 不进浏览器存储)')
} else {
  failed += 1
  console.log(`  违规  前端把长效凭据交给了浏览器存储  (${longLived.length} 处)`)
  console.log('        refresh token 泄漏等于把账号交出去,而用户不会收到任何提示')
  console.log('        access token 是短效的,泄漏窗口以分钟计 —— 两者的处置完全不同')
  for (const h of longLived.slice(0, 10)) console.log(`        ${h.file}:${h.line}  ${h.text}`)
}

const fakeReceipt = checkNoReceiptOutsideTry()
if (fakeReceipt.length === 0) {
  console.log('  通过  成功回执不在 catch 之外(没有假的成功回执)')
} else {
  failed += 1
  console.log(`  违规  成功回执在 catch 之外  (${fakeReceipt.length} 处)`)
  console.log('        操作没成功而界面说成功了 —— 用户不会怀疑这个按钮,只会怀疑自己')
  for (const h of fakeReceipt.slice(0, 10)) {
    console.log(`        ${h.file}:${h.line}  ${h.text}`)
  }
}

const jsInteraction = checkNoJsInteractionStyles()
if (jsInteraction.length === 0) {
  console.log('  通过  前端交互态样式走 CSS 伪类,不用 JS 承载')
} else {
  failed += 1
  console.log(`  违规  前端用 JS 承载 hover / active / focus  (${jsInteraction.length} 处)`)
  console.log('        没有 :focus-visible 意味着鼠标点击也显示焦点环 —— 而焦点环是设计语言里')
  console.log('        明写的键盘可达性通道。内联样式还写不了媒体查询,而工作台是三栏布局。')
  for (const h of jsInteraction.slice(0, 10)) {
    console.log(`        ${h.file}:${h.line}  ${h.text}`)
  }
}

const sessionArtifacts = checkSessionStatusHasArtifacts()
if (sessionArtifacts.length === 0) {
  console.log('  通过  Session 标 ✅ 的交付产物都真的存在(任务书自身的诚实性)')
} else {
  failed += 1
  console.log(`  违规  Session 标 ✅ 但产物缺失  (${sessionArtifacts.length} 处)`)
  console.log(
    '        进度标记是判断「哪些做完了」的唯一依据 —— 它错了,后面每个决定都建在错的基础上',
  )
  for (const h of sessionArtifacts.slice(0, 10)) {
    console.log(`        ${h.file}:${h.line}  ${h.text}`)
  }
}

const frontend = checkFrontendConstraints()
if (frontend.length === 0) {
  console.log('  通过  前端三条约束(路由 / 浏览器专有 API / 统一 SDK 层)')
} else {
  failed += 1
  console.log(`  违规  前端三条约束(D7,为 V0.7.0 Tauri 套壳预留)  (${frontend.length} 处)`)
  console.log('        三个宿主要跑同一份代码。违反任一条在 Tauri 里都不是「表现不好」,')
  console.log('        是**根本跑不起来** —— 而那时前端已经写了几十个组件,改起来是重构。')
  for (const h of frontend.slice(0, 10)) console.log(`        ${h.file}:${h.line}  ${h.text}`)
}

const vitestSpawns = checkVitestSpawnIsCentralized()
if (vitestSpawns.length === 0) {
  console.log('  通过  变异后跑测试走受控通路(拉起 vitest 的地方只有 lib/mutate.mjs)')
} else {
  failed += 1
  console.log(`  违规  有脚本自己拉起 vitest,绕开了 dist 同步  (${vitestSpawns.length} 处)`)
  console.log('        跨包测试消费的是 dist,而 dist 是用**未变异**的源码构建的 ——')
  console.log('        绕开受控通路,「没变红」就分不清「断言弱」与「根本没测到改动」。')
  console.log('        改用 lib/mutate.mjs 的 runTestsUnderMutation / runVitest。')
  for (const h of vitestSpawns) console.log(`        ${h.text}`)
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

const colorFallback = checkPrimaryColorHasNoFallback()
if (colorFallback.length === 0) {
  console.log('  通过  primaryColor 的 null 没有被兜底掉(未配置 ≠ 配置成某个值)')
} else {
  failed += 1
  console.log(`  违规  primaryColor 被兜底成了默认色  (${colorFallback.length} 处)`)
  console.log('        V0.8.0 把它改成 string | null,为的是让「未配置」与「配置成某个值」')
  console.log('        在类型层可分。一行 `?? "#2F6FEB"` 就把这次改动完全抵消 ——')
  console.log('        类型上仍分开,行为上又合并,而且没有任何东西会变红。')
  console.log('        判空收敛在派生入口一处(derive(seed: string | null)),不在调用点判。')
  for (const h of colorFallback) console.log(`        ${h.text}`)
}

const currencyTable = checkNoCurrencyExponentTable()
if (currencyTable.length === 0) {
  console.log('  通过  没有人自带「币种 → 指数」对照表(指数随金额从契约来)')
} else {
  failed += 1
  console.log(`  违规  有人自带了币种指数表  (${currencyTable.length} 处)`)
  console.log('        minor → major 的指数不都是 2(JPY 是 0,KWD 是 3),而自带一张表')
  console.log('        就是**第二个事实源** —— 它与服务端的计价口径迟早分家,')
  console.log('        分家的表现是账目差 10 的整数次幂,且没人知道该信哪一边。')
  console.log('        V0.9.0 Session 5.5 之前 console-web 里就有两处,答案已经不一致。')
  console.log('        ⇒ 指数随金额一起从契约来:Cost.currencyExponent。')
  for (const h of currencyTable) console.log(`        ${h.text}`)
}

const sdkSync = checkSdkHasSyncAssertion()
if (sdkSync.length === 0) {
  console.log('  通过  每个 SDK 都有「与契约同步」的断言(逐语言,不共用)')
} else {
  failed += 1
  console.log(`  违规  有 SDK 缺同步断言  (${sdkSync.length} 处)`)
  console.log('        「改了契约没重新生成」在 V0.5.0 抓到过一次,那时只有 TS SDK。')
  console.log('        每多一种语言,漏洞面就多一份 —— 断言也必须多一份。')
  for (const h of sdkSync) console.log(`        ${h.file}  ${h.text}`)
}

const ciHollow = checkCiJobsAreSubstantive()
if (ciHollow.length === 0) {
  console.log('  通过  CI job 都做实质检查且已登记(没有恒绿的绿勾)')
} else {
  failed += 1
  console.log(`  违规  CI 里有 job 恒绿或未登记  (${ciHollow.length} 处)`)
  console.log('        一个不检查的 job 比没有 job 更糟 —— 它在面板上占一个绿勾。')
  console.log('        登记表要回答的是「这个 job 的检查坏掉时,谁会红」。')
  for (const h of ciHollow) console.log(`        ${h.file}:${h.line}  ${h.text}`)
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
