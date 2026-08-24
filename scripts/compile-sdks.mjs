#!/usr/bin/env node
/**
 * 编译 Kotlin / Swift SDK 的产物 —— 把「生成 → 断言」补成「生成 → 断言 → **编译得过**」。
 *
 * ## 它补的那一段空白
 *
 * `sdk/kotlin` 与 `sdk/swift` 的模型是**生成的**,而且有三道断言盯着
 * (`verify-assertions` 的探针 17 / 18:契约加字段而 SDK 没重新生成 → 变红)。
 * 但那三道断言比的是**文本**:生成出来的东西与契约对不对得上。
 *
 * 🚨 **「生成出来」与「编译得过」是两件事**,而本仓已经付过一次学费:
 * `dist/generated/` 那次,类型坏成 `never` 之后消费方代码反而「编译通过」——
 * 一个坏掉的类型可以完美地满足所有文本比对。
 *
 * 三种 SDK 里,TypeScript 那份由 `tsc` 每次门禁都编一遍;
 * 另外两份**在此之前从未被任何编译器读过**。
 *
 * ## 为什么现在才做:一个被证伪的前提
 *
 * M0.8.0 写着「本机与 CI 都没有 `kotlinc` / `swift`」。**后半句是假的** ——
 * `ubuntu-24.04` 自带 Kotlin 2.4.10 与 Swift 6.3.3。
 * 见 `docs/DECISIONS/unverified-plausible-causation.md` 例 5 的扫描结果。
 * ⇒ 于是这条检查的成本从「搭两套工具链」降到「几行 YAML」。
 *
 * ## 两个入口,两件不同的事
 *
 * | 跑法 | 判的是什么 | 失败意味着 |
 * | --- | --- | --- |
 * | `--require-toolchains` | **真实产物**编译得过 | 生成器产出了编不过的代码 |
 * | `--self-check` | **这条检查自己**认不认得出坏代码 | 检查恒绿了,上面那条的绿不算数 |
 *
 * `--self-check` 两个方向都验(这是「反向对照」那条规则):
 * 原样的副本**必须编过**,植入语法错误的副本**必须编不过**。
 * 少了前一半,一个「永远失败」的调用也能让它显示为通过。
 *
 * ## ⚠️ 不跳过成「静默通过」
 *
 * 没有工具链时**吵着跳过**,并点名 CI 的 `sdk-compile` job 在跑它;
 * 带 `--require-toolchains`(CI 用)时,跳过变成**红**。
 * 一条永远绿的检查与没有检查等价,但更危险:它让人以为有覆盖。
 *
 * 跑法:
 *   node scripts/compile-sdks.mjs                     # 本机,没工具链就吵着跳过
 *   node scripts/compile-sdks.mjs --require-toolchains # CI:必须真编
 *   node scripts/compile-sdks.mjs --self-check         # CI:证明它认得出坏代码
 *
 * @module scripts/compile-sdks
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CI_WORKFLOW = join(REPO, '.github', 'workflows', 'ci.yml')

/** 装依赖 jar 的地方 —— 不进版本控制(见 .gitignore)。 */
const DEP_CACHE = join(REPO, '.sdk-toolchain')

/**
 * Kotlin 侧的编译期依赖 —— **钉版本 + 钉 SHA-256**。
 *
 * ⚠️ 为什么可以联网下载,而 AppImage 的 linuxdeploy 不可以(PACKAGING.md 第六节):
 * 区别不在「联不联网」—— `pnpm install` 与 `cargo install` 本来就联网。
 * 区别在**钉不钉得住**:这里是具体版本号 + 内容哈希,下错一个字节就红;
 * 那边是 `master` 分支上的可执行文件,今天明天不是同一个东西。
 *
 * 为什么不用手写的 stub 顶替这两个 jar(那样连网都不用联):
 * stub 会引入一个**新的、没人验的前提** ——「我们的桩与真库的 API 一致」。
 * 而这个仓库刚刚因为两个没验过的前提付过学费(例 5)。
 * 一个需要联网但**可验证**的依赖,好过一个不需要联网但**不可验证**的假设。
 */
const KOTLIN_DEPS = [
  {
    name: 'kotlinx-serialization-core-jvm-1.11.0.jar',
    url: 'https://repo1.maven.org/maven2/org/jetbrains/kotlinx/kotlinx-serialization-core-jvm/1.11.0/kotlinx-serialization-core-jvm-1.11.0.jar',
    sha256: 'f4a801c647d4351327cd9e1ac4113e2be9ea37a64ab0abae269c25a52e28f35d',
  },
  {
    name: 'kotlinx-serialization-json-jvm-1.11.0.jar',
    url: 'https://repo1.maven.org/maven2/org/jetbrains/kotlinx/kotlinx-serialization-json-jvm/1.11.0/kotlinx-serialization-json-jvm-1.11.0.jar',
    sha256: '563a25b4eb5c9128ae9c2479f3d1a5c44dcd176112b91cf03682e906eba5c935',
  },
]

/**
 * 植入的语法错误。
 *
 * 挑「两种语言都必然解析失败」的形状:一行光秃秃的标点。
 * 不挑类型错误 —— 类型错误可能被某个宽松的编译选项降级成警告,
 * 而解析失败没有那种余地。
 */
const SYNTAX_BREAKAGE = '\n@@@ 负向验证:这一行是故意的语法错误 @@@\n'

/** 收集一个目录下所有指定后缀的文件(递归)。 */
function collectFiles(/** @type {string} */ dir, /** @type {string} */ ext) {
  if (!existsSync(dir)) return []
  /** @type {string[]} */
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(full, ext))
    else if (entry.name.endsWith(ext)) out.push(full)
  }
  return out.sort()
}

/**
 * 两个 SDK 的编译配方。
 *
 * ⚠️ `sources` 收的是 `src/` **整棵树**,不是只收 `src/generated/`:
 * Swift 那边 `Support.swift` 是手写的,而生成的模型引用它(`AnyCodable`)。
 * 只编生成目录会因为「找不到 AnyCodable」而红 —— 一个与生成器无关的红。
 */
const SDKS = [
  {
    id: 'kotlin',
    label: 'Kotlin',
    dir: join(REPO, 'sdk', 'kotlin'),
    ext: '.kt',
    probe: /** @type {[string, string[]]} */ (['kotlinc', ['-version']]),
    hint: 'ubuntu-24.04 自带 Kotlin 2.4.10;本机装法见 https://kotlinlang.org/docs/command-line.html',
    /** @param {string[]} files @param {string} outDir */
    command(files, outDir) {
      const cp = KOTLIN_DEPS.map((d) => join(DEP_CACHE, d.name)).join(
        process.platform === 'win32' ? ';' : ':',
      )
      // `-nowarn`:这条检查判的是「编不编得过」,不是代码风格。
      // 警告变红会让它在下一次 Kotlin 小版本升级时无缘无故失败。
      return /** @type {[string, string[]]} */ ([
        'kotlinc',
        [...files, '-classpath', cp, '-d', outDir, '-nowarn'],
      ])
    },
    needsDeps: true,
  },
  {
    id: 'swift',
    label: 'Swift',
    dir: join(REPO, 'sdk', 'swift'),
    ext: '.swift',
    probe: /** @type {[string, string[]]} */ (['swiftc', ['--version']]),
    hint: 'ubuntu-24.04 自带 Swift 6.3.3;macOS 随 Xcode',
    /** @param {string[]} files */
    command(files) {
      // `-typecheck`:只做解析 + 类型检查,不产码 —— 这正是要判的那件事,
      // 而且比产码快得多。
      return /** @type {[string, string[]]} */ (['swiftc', ['-typecheck', ...files]])
    },
    needsDeps: false,
  },
]

/**
 * 只有 Windows 需要 shell —— 那里 kotlinc / swiftc 是 .bat。
 *
 * ⚠️ Linux 上一律不走 shell:Node 24 对「shell + 数组参数」有 DEP0190 警告,
 * 而它警告的东西是真的(参数不转义,只拼接)。CI 跑在 Linux 上。
 */
const USE_SHELL = process.platform === 'win32'

/** 探一个工具链在不在。用 spawnSync 而不是 execFileSync —— 「不在」是正常情况,不是异常。 */
function hasToolchain(/** @type {typeof SDKS[number]} */ sdk) {
  const [bin, args] = sdk.probe
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: USE_SHELL })
  return r.status === 0
}

/** 下载并校验一个依赖。哈希对不上就抛 —— 不重试、不放行。 */
function ensureDep(/** @type {(typeof KOTLIN_DEPS)[number]} */ dep) {
  const target = join(DEP_CACHE, dep.name)
  if (existsSync(target)) {
    const got = createHash('sha256').update(readFileSync(target)).digest('hex')
    if (got === dep.sha256) return target
    console.log(`  ⚠️  缓存里的 ${dep.name} 哈希对不上,重新下载`)
    rmSync(target, { force: true })
  }
  mkdirSync(DEP_CACHE, { recursive: true })
  console.log(`  下载 ${dep.name}`)
  execFileSync('curl', ['-sSL', '--fail', '--max-time', '180', '-o', target, dep.url], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const got = createHash('sha256').update(readFileSync(target)).digest('hex')
  if (got !== dep.sha256) {
    rmSync(target, { force: true })
    throw new Error(`${dep.name} 的 SHA-256 对不上:期望 ${dep.sha256},实际 ${got}`)
  }
  return target
}

/**
 * 编一次,返回结果 —— **不抛**,由调用方决定这次的失败是好事还是坏事。
 *
 * @param {typeof SDKS[number]} sdk
 * @param {string[]} files
 * @returns {{ ok: boolean, output: string }}
 */
function compile(sdk, files) {
  const outDir = mkdtempSync(join(tmpdir(), `dshwar-${sdk.id}-`))
  try {
    const [bin, args] = sdk.command(files, outDir)
    const r = spawnSync(bin, args, { encoding: 'utf8', shell: USE_SHELL, cwd: REPO })
    return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const requireToolchains = argv.includes('--require-toolchains')
const selfCheck = argv.includes('--self-check')

console.log(
  selfCheck
    ? 'DSHWAR · SDK 编译检查的**自检**(证明它认得出坏代码)'
    : 'DSHWAR · Kotlin / Swift SDK 产物编译检查',
)
console.log('')

let failed = 0
/**
 * 真的编过几个 SDK。
 *
 * ★ 出口计数,不是入口计数:两个都跳过时收尾那句不能说「都编得过」——
 *   那是一张**假成功回执**,与真的编过在输出上一模一样。
 */
let compiled = 0

for (const sdk of SDKS) {
  const files = collectFiles(join(sdk.dir, 'src'), sdk.ext)

  // ★ 出口计数:一个「编译零个文件」的检查会安安静静地成功。
  //   这条要在探工具链**之前** —— 文件没了是代码的问题,与机器上有什么无关。
  if (files.length === 0) {
    failed += 1
    console.log(
      `  违规  ${sdk.label}:${relative(REPO, join(sdk.dir, 'src'))} 下一个 ${sdk.ext} 都没有`,
    )
    console.log('        编译零个文件会安静地成功 —— 那与没有这条检查等价。')
    continue
  }

  if (!hasToolchain(sdk)) {
    if (requireToolchains) {
      failed += 1
      console.log(`  违规  ${sdk.label}:工具链不在,而 --require-toolchains 要求它必须在`)
      console.log(`        ${sdk.hint}`)
      continue
    }
    console.log('')
    console.log(`  ⚠️  跳过  ${sdk.label}:这台机器上没有 ${sdk.probe[0]}`)
    console.log('')
    console.log(`     跳过的是什么:${files.length} 个 ${sdk.ext} 文件编不编得过。`)
    console.log('     那些模型是**生成的**,而「生成出来」与「编译得过」是两件事 ——')
    console.log('     本仓已经付过一次学费:类型坏成 never 时,消费方代码反而「编译通过」。')
    console.log('')
    console.log('     谁在别处跑过它:CI 的 **sdk-compile** job(ubuntu-24.04 自带两套工具链)。')
    console.log(`     想在本机也跑:${sdk.hint}`)
    console.log('')
    continue
  }

  if (sdk.needsDeps) for (const dep of KOTLIN_DEPS) ensureDep(dep)

  if (!selfCheck) {
    const r = compile(sdk, files)
    if (r.ok) {
      compiled += 1
      console.log(`  通过  ${sdk.label}:${files.length} 个文件编译通过`)
    } else {
      failed += 1
      console.log(`  违规  ${sdk.label}:${files.length} 个文件**编译不过**`)
      console.log('        生成器产出了编不过的代码 —— 文本比对的断言看不见这一类。')
      for (const line of r.output.split('\n').slice(0, 25)) console.log(`        ${line}`)
    }
    continue
  }

  // ── --self-check:两个方向都验 ──────────────────────────────────────
  const stage = mkdtempSync(join(tmpdir(), `dshwar-selfcheck-${sdk.id}-`))
  try {
    /** @type {string[]} */
    const copies = []
    for (const f of files) {
      const dest = join(stage, relative(sdk.dir, f))
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(f, dest)
      copies.push(dest)
    }

    // 方向一(反向对照):原样的副本**必须编过**。
    // 少了这一半,一个「永远失败」的调用也能让方向二显示为通过。
    const clean = compile(sdk, copies)
    if (clean.ok) {
      console.log(`  通过  ${sdk.label} 自检 · 反向对照:原样副本编得过(判据不是「永远失败」)`)
    } else {
      failed += 1
      console.log(`  违规  ${sdk.label} 自检 · 反向对照:原样副本**编不过**`)
      console.log('        那么方向二的「编不过」证明不了任何事 —— 它本来就编不过。')
      for (const line of clean.output.split('\n').slice(0, 15)) console.log(`        ${line}`)
      continue
    }

    // 方向二:植入语法错误,**必须编不过**。
    const victim = copies.find((c) => c.includes('generated')) ?? copies[0]
    if (victim === undefined) throw new Error('没有可植入的文件 —— 上面的出口计数应当已经拦住')
    const pristine = readFileSync(victim, 'utf8')
    writeFileSync(victim, pristine + SYNTAX_BREAKAGE, 'utf8')

    // ★ 先证明变异真的改到了东西。锚点失配必须响亮 ——
    //   没改到的那次,结果与「改了但检查不出来」长得一模一样。
    if (readFileSync(victim, 'utf8') === pristine) {
      failed += 1
      console.log(`  违规  ${sdk.label} 自检:变异没改动文件 —— 锚点失配,本条结论作废`)
      continue
    }

    const broken = compile(sdk, copies)
    if (!broken.ok) {
      console.log(`  通过  ${sdk.label} 自检:往 ${relative(stage, victim)} 植入语法错误 → 编译失败`)
    } else {
      failed += 1
      console.log(`  违规  ${sdk.label} 自检:植入语法错误之后**仍然编译通过**`)
      console.log('        这条检查是恒绿的 —— 真实产物那一步的绿不算数。')
    }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

// ── 「谁在别处跑」这句话会过期,所以核对一次 ──────────────────────────
//
// 与 scripts/test-shell.mjs 的 CI 分支同款:跳过的那条路径点名了 sdk-compile job,
// 而那个 job 被删掉之后,跳过就成了一条谎话 —— 且与「已委托」在输出上一模一样。
if (!requireToolchains && !selfCheck) {
  const workflow = existsSync(CI_WORKFLOW) ? readFileSync(CI_WORKFLOW, 'utf8') : ''
  const runs = workflow
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .some((line) => /compile-sdks\.mjs/.test(line))
  if (!runs) {
    failed += 1
    console.log('')
    console.log('🚨 上面那句「CI 的 sdk-compile job 在跑它」是假的 —— ci.yml 里找不到它。')
    console.log('   跳过的前提没了,这个跳过就成了一条谎话。')
  }
}

console.log('')
if (failed > 0) {
  console.log(`${failed} 项未通过。`)
  process.exit(1)
}
if (selfCheck) {
  console.log('这条检查认得出坏代码。')
} else if (compiled === 0) {
  // ⚠️ 一个字都不能说成「都编得过」—— 一个 SDK 都没编。
  console.log('0 个 SDK 真的编过 —— 见上面的跳过说明。这不是「通过」,是「没验」。')
} else {
  console.log(`${compiled} / ${SDKS.length} 个 SDK 编得过。`)
}
