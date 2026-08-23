#!/usr/bin/env node
/**
 * 守卫的负向测试 —— Session 1 的验收标准。
 *
 * 一条永远返回「通过」的守卫和没有守卫是一回事,而且更危险:它给人虚假的安全感。
 * 本脚本临时植入违规、确认守卫真的报错、再清理干净。
 *
 * 任务书要求的三条:
 *   1. 故意写一行深链 import           → 必须失败
 *   2. 故意把上游依赖改成 ^            → 必须失败
 *   3. 故意改乱一处版本号              → check-version 必须失败
 *
 * 另加几条,理由见各自的注释:
 *   4. adapters/ 的深链**必须放行**    → 证明豁免有效,而非「一律禁止」
 *   5. Service 子类的 #private        → 必须失败(Session 0 §4.1)
 *   6. 篡改 adapters 的上游版本假设    → 契约测试必须红(Session 7 验收)
 *   7. TS 项目未登记进根 references    → 必须失败(V0.2.0 Session 5 实测教训)
 *   8. 破坏性契约变更                  → 必须失败(Session 6 验收)
 *   9. 加一个可选字段                  → **必须放行**(Session 6 验收,另一个方向)
 *  13. 公开包依赖闭源组件              → 必须失败(硬规则 9,V0.4.1)
 *  14. 有 test/ 却没有测试 tsconfig    → 必须失败(V0.4.5,与第 7 条同源)
 *  15. 测试项目未登记进根测试解决方案  → 必须失败(同上)
 *  16. 未登记的 principal.current() 调用点 → 必须失败(V0.4.6)
 *  16b 测试文件里的 principal.current()    → **必须放行**(另一个方向)
 *  17. scripts/*.ts 没有脚本 tsconfig      → 必须失败(V0.4.6 Session 1)
 *  18. 脚本项目未登记进根解决方案          → 必须失败(同上)
 *  19. 有 src/*.ts 却完全没有 tsconfig     → 必须失败(堵 17/18 自己的洞)
 *  20. .mjs 夹具未被 checkJs 覆盖          → 必须失败(同上,另一个盲区)
 *  9b. 枚举**删值**                        → 必须失败(V0.4.6 红线 3)
 *  9c. 枚举**加值**                        → **必须放行**(V0.4.6 决策 1)
 *
 * 退出码:全绿 0,任一守卫没拦住 1。
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { runTestsUnderMutation, withRestoredFiles } from './lib/mutate.mjs'
import { collectFiles, isPackageJson } from './lib/scan.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** @param {...string} seg */
const p = (...seg) => join(REPO, ...seg)

const ESLINT_BIN = p('node_modules', 'eslint', 'bin', 'eslint.js')

/**
 * 跑一条命令,只关心它是成功还是失败。
 *
 * @param {string[]} args
 * @returns {{ ok: boolean, output: string }}
 */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output: stdout }
  } catch (error) {
    const e = /** @type {{stdout?: unknown, stderr?: unknown}} */ (error)
    return {
      ok: false,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}`,
    }
  }
}

/** @param {string} target */
const runEslint = (target) => run([ESLINT_BIN, target, '--max-warnings', '0'])
const runGuards = () => run([p('scripts', 'check-guards.mjs')])
const runVersion = () => run([p('scripts', 'check-version.mjs')])

/**
 * 记录被本脚本创建的路径,finally 里无条件清理。
 * @type {string[]}
 */
/**
 * 开机自愈:把上一次跑崩时遗留的前端包搬回原位。
 *
 * ## 为什么需要它,而不是「加个 finally 就够了」
 *
 * 24d 要验「前端包整个消失时守卫会不会红」,做法是把它们 `rename` 进
 * `node_modules/__fe_stash_N__`(那里在扫描的 SKIP_DIRS 里),跑完再搬回来。
 * finally 挡得住异常与正常退出 —— **挡不住 SIGKILL**。
 *
 * 2026-08-23 就真的发生了一次:一个跑本脚本的子进程在两次 rename 之间被杀,
 * `console-web/` 整个从工作区消失。后果不是「少个目录」那么直白 ——
 * 后续的 check-guards 报的是
 *
 *   · Session 标 ✅ 但交付点名的 `console-web/src` 不存在
 *   · 登记了不存在的项目 console-web/tsconfig.json
 *
 * **两条都指向症状,一条都没指向原因。** 而这两条看起来像是任务书写错了
 * 或 tsconfig 配错了 —— 顺着它们改,会把两处**本来正确**的东西改坏。
 *
 * ⇒ 所以自愈要**吵**:搬回来的同时打印发生了什么,
 * 免得下一个人只看到「莫名其妙好了」。
 *
 * ⚠️ 只在**目标不存在**时搬 —— 目标已经存在说明有人手工恢复过,
 * 这时覆盖会毁掉他的工作。那种情况留着残骸并报出来,由人裁决。
 */
function reclaimOrphanedStashes() {
  const nm = p('node_modules')
  if (!existsSync(nm)) return
  for (const entry of readdirSync(nm, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^__fe_stash_\d+__$/.test(entry.name)) continue
    const stash = join(nm, entry.name)
    let name
    try {
      name = JSON.parse(readFileSync(join(stash, 'package.json'), 'utf8')).name
    } catch {
      console.log(`⚠️  ${entry.name} 里没有可读的 package.json —— 无法判断它该回哪,留着待查`)
      continue
    }
    // 包名 `@dshwar/console-web` → 目录名 `console-web`。目录可能在根,也可能在 packages/。
    const base = String(name).split('/').pop() ?? ''
    const candidates = [p(base), p('packages', base)]
    const target = candidates.find((c) => !existsSync(c))
    if (target === undefined) {
      console.log(`⚠️  ${entry.name}(${name})的原位已存在 —— 不覆盖,残骸留在 ${stash} 待人裁决`)
      continue
    }
    renameSync(stash, target)
    console.log(`♻️  上次跑崩遗留:已把 ${name} 从 ${entry.name} 搬回 ${target}`)
    console.log('    (24d 会把前端包临时挪进 node_modules;进程被强杀时搬不回来)')
  }
}

reclaimOrphanedStashes()

/** @type {string[]} */
const created = []
/**
 * @param {string} relPath
 * @param {string} content
 */
function writeFixture(relPath, content) {
  const full = p(relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
  created.push(full)
  return full
}

/** @type {{name: string, passed: boolean, detail: string | undefined}[]} */
const results = []
/**
 * @param {string} name
 * @param {boolean} passed
 * @param {string} [detail]
 */
function expect(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`  ${passed ? '通过' : '失败'}  ${name}`)
  if (detail) console.log(`        ${detail}`)
}

/**
 * ★ **顺路批量,失败时逐条回落。**
 *
 * ## 约束:批量化不得让「哪一条红了」变模糊
 *
 * 一次跑多个夹具能省下 fork 的钱(check-guards 单次 321 ms,verify-guards
 * 要 fork 它四十次),但天真的批量会把失败信息退化成「有 N 条失败」——
 * **那省下的时间会在排查时全部还回去,而且更贵**。
 *
 * 所以这里的批量只覆盖**顺路**:全批通过时,一次运行、逐条报通过。
 * 只要有**任何一条**不符合预期,就**整批丢弃结果,逐条单独重跑** ——
 * 于是失败路径上的行为与批量化之前**逐字节相同**,包括每条的名字与说明。
 *
 * 代价刚好落在对的地方:**通过时省时间,失败时花时间**。
 * 而失败是少数情况,排查才是贵的那一头。
 *
 * ⚠️ 为什么不能靠「从批量输出里按夹具路径归属」:`check-guards` 每条守卫
 * 只打印前 10 条命中(`hits.slice(0, 10)`),第 11 条起只剩一句「另有 N 处」。
 * 按路径归属在批量下随时会因为截断而认错人 —— 这个坑本轮已经踩过一次
 * (判据写成 `includes(夹具路径)`,而输出被截断,于是把「守卫报了 14 处违规」
 * 读成了「守卫没反应」)。
 *
 * @template T
 * @param {T[]} items 一批检查项
 * @param {{
 *   write: (item: T) => void,
 *   clean: () => void,
 *   run: () => { ok: boolean, output: string },
 *   verdict: (item: T, r: { ok: boolean, output: string }) => boolean,
 *   explain: (item: T, r: { ok: boolean, output: string }) => string,
 *   label: (item: T) => string,
 * }} hooks write=写这一项的夹具 · clean=清掉全部夹具 · run=跑一次被测脚本 ·
 *   verdict=这一项过没过 · explain=失败说明 · label=这一项的名字
 */
function batchedChecks(items, { write, clean, run, verdict, explain, label }) {
  if (items.length === 0) {
    // 空批与「全部通过」在输出上一模一样 —— 不许它悄悄发生。
    throw new Error('batchedChecks 收到空批 —— 本组检查空跑了')
  }

  clean()
  for (const item of items) write(item)
  const batch = run()
  clean()

  const allPassed = items.every((item) => verdict(item, batch))
  if (allPassed) {
    for (const item of items) expect(label(item), true, undefined)
    return
  }

  // 有失败 —— 整批结果作废,逐条单独重跑。**失败路径 = 批量化之前的行为。**
  for (const item of items) {
    clean()
    write(item)
    const solo = run()
    clean()
    const passed = verdict(item, solo)
    expect(label(item), passed, passed ? undefined : explain(item, solo))
  }
}

console.log('DSHWAR · 守卫的负向测试\n')

// 先确认基线是干净的 —— 否则后面所有「失败」都说明不了问题
{
  const guards = runGuards()
  const version = runVersion()
  if (!guards.ok || !version.ok) {
    console.log('基线不干净:守卫在未植入任何违规时就已经失败。')
    console.log('先修好 pnpm check:guards 与 pnpm check:version,再跑本脚本。')
    process.exit(1)
  }
}

try {
  // ---------------------------------------------------------------------
  // 1. 深链 import(任务书第 1 条)
  //    ESLint 与 grep 双保险,两道都必须拦住。
  // ---------------------------------------------------------------------
  {
    const fixture = writeFixture(
      'packages/__guard_fixture__/src/deep-link.ts',
      [
        '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。',
        "import { CredentialProvider } from '@deepseek-ai/dsh-credentials/lib/index.js'",
        'export const probe = CredentialProvider',
        '',
      ].join('\n'),
    )

    const lint = runEslint(fixture)
    expect(
      '1a 深链 import 被 ESLint 拦住(no-restricted-imports)',
      !lint.ok && /no-restricted-imports|硬规则 2/.test(lint.output),
      lint.ok ? 'ESLint 放行了深链 —— R2 边界规则失效' : undefined,
    )

    const guards = runGuards()
    expect(
      '1b 深链 import 被 grep 守卫拦住(双保险)',
      !guards.ok && /深链上游内部实现/.test(guards.output),
      guards.ok ? 'check-guards 放行了深链' : undefined,
    )

    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 2. 上游依赖用 ^(任务书第 2 条)
  // ---------------------------------------------------------------------
  {
    writeFixture(
      'packages/__guard_fixture__/package.json',
      JSON.stringify(
        {
          name: '@dshwar/__guard_fixture__',
          version: '0.1.0',
          private: true,
          dependencies: { '@deepseek-ai/dsh-credentials': '^0.1.0-rc.6' },
        },
        null,
        2,
      ) + '\n',
    )

    const guards = runGuards()
    expect(
      '2 上游依赖用 ^ 被守卫拦住(硬规则 3)',
      !guards.ok && /上游依赖未精确锁版/.test(guards.output),
      guards.ok ? 'check-guards 放行了 caret range' : undefined,
    )

    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 3. 版本号不一致(任务书第 3 条)
  //    改真实文件,备份后还原 —— 用夹具文件测不出真正的比对逻辑。
  // ---------------------------------------------------------------------
  {
    const target = p('README.md')
    withRestoredFiles([target], () => {
      const original = readFileSync(target, 'utf8')
      // 把兼容矩阵里的 DSHWAR 版本行改乱。
      // 不写死版本号,也不假设表格补白 —— prettier 会把表格列对齐,
      // 写死 `| 0.1.0 |` 会在下一次 format 后静默失配,让本条测试变成假绿。
      const current = JSON.parse(readFileSync(p('package.json'), 'utf8')).version
      const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const tampered = original.replace(new RegExp(`\\|(\\s*)${escaped}(\\s*)\\|`), '|$10.9.9$2|')
      if (tampered === original) {
        expect('3 版本号不一致被 check-version 拦住', false, '夹具未能改动 README 兼容矩阵行')
      } else {
        writeFileSync(target, tampered, 'utf8')
        const version = runVersion()
        expect(
          '3 版本号不一致被 check-version 拦住(第四节,发布阻塞)',
          !version.ok && /不一致/.test(version.output),
          version.ok ? 'check-version 放行了不一致的版本号' : undefined,
        )
      }
    })
  }

  // ---------------------------------------------------------------------
  // 4. adapters/ 豁免必须有效
  //
  //    为什么单列一条:一个「无论如何都报错」的规则也能通过前三条测试。
  //    不验豁免,就不知道拦住的是违规还是所有人。adapters/ 正是用来碰
  //    上游内部的地方,它被误伤会让 Session 7 无法落地。
  // ---------------------------------------------------------------------
  {
    const fixture = writeFixture(
      'adapters/__guard_fixture__/src/allowed-deep-link.ts',
      [
        '// 负向测试夹具:adapters/ 是唯一允许感知上游内部的目录。',
        "import { CredentialProvider } from '@deepseek-ai/dsh-credentials/lib/index.js'",
        'export const probe = CredentialProvider',
        '',
      ].join('\n'),
    )

    const lint = runEslint(fixture)
    expect(
      '4a adapters/ 的深链被 ESLint 放行(豁免有效)',
      lint.ok,
      lint.ok ? undefined : `adapters 豁免失效,Session 7 将无法落地:\n${lint.output.slice(0, 300)}`,
    )

    const guards = runGuards()
    expect(
      '4b adapters/ 的深链不触发 grep 守卫',
      guards.ok,
      guards.ok ? undefined : 'check-guards 误伤了 adapters/',
    )

    rmSync(p('adapters/__guard_fixture__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 5. cordis Service 子类里的 #private(Session 0 §4.1)
  //
  //    这条不在任务书里,是 Session 0 实测出来的地雷:cordis 用 Proxy 包装服务,
  //    #private 在 wrapper 上访问必抛 TypeError,而报错信息完全指不到根因。
  // ---------------------------------------------------------------------
  {
    const fixture = writeFixture(
      'packages/__guard_fixture__/src/private-field.ts',
      [
        '// 负向测试夹具:Service 子类不得使用 #private。',
        "import { Service } from '@deepseek-ai/cordis'",
        '',
        'export class Probe extends Service {',
        "  #secret = 'unreachable-through-the-cordis-proxy'",
        '  read(): string {',
        '    return this.#secret',
        '  }',
        '}',
        '',
      ].join('\n'),
    )

    const lint = runEslint(fixture)
    expect(
      '5 Service 子类的 #private 被 ESLint 拦住(FEASIBILITY-REPORT §4.1)',
      !lint.ok && /no-restricted-syntax|#private/.test(lint.output),
      lint.ok ? 'ESLint 放行了 #private —— Session 4 会撞上无法定位的 TypeError' : undefined,
    )

    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }
  // ---------------------------------------------------------------------
  // 6. 篡改 adapters 内的一个假设,契约测试必须红(Session 7 验收)
  //
  //    契约测试的全部价值在于「上游改了语义,它立刻跑红」。若篡改假设之后
  //    它依然是绿的,那它测的就不是上游 —— 而这一点只有主动破坏才能发现。
  // ---------------------------------------------------------------------
  {
    const target = p('adapters/dsh-0.1.0/src/version-guard.ts')
    if (!existsSync(target)) {
      expect('6 篡改 adapters 假设后契约测试变红', false, 'adapters/dsh-0.1.0 尚未落地')
    } else {
      const original = readFileSync(target, 'utf8')
      /** @param {string} s */
      const tamper = (s) =>
        s.replace(
          /export const EXPECTED_UPSTREAM_VERSION = '[^']+'/,
          "export const EXPECTED_UPSTREAM_VERSION = '9.9.9-tampered'",
        )
      if (tamper(original) === original) {
        expect('6 篡改 adapters 假设后契约测试变红', false, '未能改动 EXPECTED_UPSTREAM_VERSION')
      } else {
        // ★ 走 runTestsUnderMutation:它在变异生效后同步 dist。
        // 本条现在是同包(adapters/src → adapters/test,相对 import),
        // 不同步也照得到;但通路统一是**结构性**的保证 ——
        // 哪天这条测试改成跨包 import,不需要有人记得回来加一次构建。
        const contract = runTestsUnderMutation(
          [{ path: target, mutate: tamper }],
          ['--dir', 'adapters'],
        )
        expect(
          '6 篡改 adapters 内的上游版本假设,契约测试立刻变红',
          contract.red,
          contract.red ? undefined : '契约测试放行了错误的上游版本假设 —— 它没在测上游',
        )
      }
    }
  }

  // ---------------------------------------------------------------------
  // 7. 新增一个未登记进根 tsconfig references 的 TS 项目
  //
  //    根 typecheck 是 `tsc -b`,只构建 references 里列出的项目。漏登记的
  //    项目会被安静跳过 —— 而 Vitest 不做类型检查、ESLint 也照样全绿,
  //    于是「三道门禁全绿」可以完全不覆盖这个包。
  //
  //    V0.2.0 Session 5 补登记 gateway 时一次性炸出 4 类真实类型错误,
  //    它们已经跟着三次「全绿」提交进了仓库。这条守卫就是为此加的。
  // ---------------------------------------------------------------------
  {
    writeFixture(
      'packages/__guard_fixture__/tsconfig.json',
      `${JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src'] }, null, 2)}\n`,
    )

    const guards = runGuards()
    expect(
      '7 未登记进根 tsconfig references 的项目被拦住',
      !guards.ok && /未登记 packages\/__guard_fixture__/.test(guards.output),
      guards.ok ? '守卫放行了未登记的 TS 项目 —— 该项目将不被任何类型检查覆盖' : undefined,
    )
  }

  // ---------------------------------------------------------------------
  // 14/15. 测试文件没被纳入类型检查
  //
  //     与第 7 条同源,但坑得更深:产品项目**存在且已登记**,只是它一律
  //     `exclude` 掉测试文件。于是 typecheck 全绿、lint 全绿、Vitest 全绿,
  //     而测试里 import 一个根本不存在的导出照样能合入 —— V0.4.5 Session 3
  //     一次会话踩了三次,两次表现为「计量静默收不到数据」,排查了两轮。
  //
  //     14 —— 有 test/ 却没建 tsconfig.test.json
  //     15 —— 建了但忘了登记进根 tsconfig.test.json
  //     两种漏法的后果完全一样:那个包的测试回到不检查的状态。
  // ---------------------------------------------------------------------
  {
    writeFixture(
      'packages/__guard_fixture__/tsconfig.json',
      `${JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src'] }, null, 2)}\n`,
    )
    writeFixture(
      'packages/__guard_fixture__/test/probe.test.ts',
      ['// 负向测试夹具:有测试目录就必须有测试 tsconfig。', 'export const probe = 1', ''].join(
        '\n',
      ),
    )

    const missing = runGuards()
    expect(
      '14 有 test/ 却没有 tsconfig.test.json 被拦住',
      !missing.ok && /有 test\/ 却没有 tsconfig\.test\.json/.test(missing.output),
      missing.ok ? '守卫放行了没有测试项目的包 —— 该包的测试不被任何类型检查覆盖' : undefined,
    )

    writeFixture(
      'packages/__guard_fixture__/tsconfig.test.json',
      `${JSON.stringify({ extends: './tsconfig.json', include: ['test'] }, null, 2)}\n`,
    )

    const unregistered = runGuards()
    expect(
      '15 测试项目未登记进根 tsconfig.test.json 被拦住',
      !unregistered.ok &&
        /未登记 packages\/__guard_fixture__\/tsconfig\.test\.json/.test(unregistered.output),
      unregistered.ok ? '守卫放行了未登记的测试项目 —— tsc -b 会安静跳过它' : undefined,
    )

    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 33. 前端三条约束**按形状发现**之后的新形态(V0.9.0)
  //
  //     扫描范围从写死的 `console-web/src` 改成「依赖里有 react 的包」,
  //     约束 3 的豁免从写死的单个文件改成「每个前端包恰好一个 api 出口」。
  //     判据从「哪个文件」变成「什么形状」—— 于是**坏法也变了形状**,
  //     旧的 24a–24e 覆盖不到新的那几种。
  //
  //     ⚠️ 这一组必须在**移植之前**就位。移植会带进来三千多行前端代码,
  //     先写代码再扩守卫的话,那三千行是在没有守卫的情况下写的。
  // ---------------------------------------------------------------------
  {
    const drop = () => {
      rmSync(p('packages/__fe_fixture__'), { recursive: true, force: true })
      rmSync(p('packages/__fe_fixture2__'), { recursive: true, force: true })
    }
    const pkgJson = (/** @type {string} */ name, /** @type {boolean} */ withReact) =>
      JSON.stringify(
        {
          name: `@dshwar/${name}`,
          version: '0.9.0',
          private: true,
          ...(withReact ? { devDependencies: { react: '19.2.0' } } : {}),
        },
        null,
        2,
      ) + '\n'

    /** @type {{ label: string, blocked: boolean, hint: string, write: () => void }[]} */
    const FE_CASES = [
      {
        label: '33a 新建前端包写了 .tsx 却不声明 react → 守卫变红(它逃出了扫描)',
        blocked: true,
        hint: '认不出的前端包比违规的前端包更危险 —— 后者会被报出来,前者悄无声息',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', false))
          writeFixture('packages/__fe_fixture__/src/Page.tsx', 'export const Page = () => null\n')
        },
      },
      {
        label: '33b 一个前端包有两个 api 出口 → 守卫变红',
        blocked: true,
        hint: '「唯一出口」不再唯一,三个宿主注入 baseURL 时会漏掉一个',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture('packages/__fe_fixture__/src/api.ts', 'export const a = 1\n')
          // 同一个包里 api.ts 与 api.tsx 并存 —— 改扩展名时忘了删旧的,真会发生
          writeFixture('packages/__fe_fixture__/src/api.tsx', 'export const b = 1\n')
        },
      },
      {
        label: '33c 前端包零个 api 出口而代码里有 fetch → 守卫变红',
        blocked: true,
        hint: '请求散落之后,三个宿主换 baseURL 时改不动 —— 那正是 D7 说的「事后补是重构」',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture(
            'packages/__fe_fixture__/src/Page.tsx',
            "export const load = () => fetch('/v1/sessions')\n",
          )
        },
      },
      {
        label: '33d 正向对照:合法的单出口前端包 → 放行(规则不是「见到前端包就红」)',
        blocked: false,
        hint: '',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture(
            'packages/__fe_fixture__/src/api.ts',
            'export const load = (base: string) => fetch(`${base}/v1/sessions`)\n',
          )
          writeFixture('packages/__fe_fixture__/src/Page.tsx', 'export const Page = () => null\n')
        },
      },
      {
        label: '33e 前端里用 onMouseEnter 承载 hover → 守卫变红',
        blocked: true,
        hint: 'hover 态走 CSS :hover —— 否则移植完了,下一个人会照着旧 kit 的写法加组件',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture(
            'packages/__fe_fixture__/src/Hover.tsx',
            'export const H = (p: { on: () => void }) => <div onMouseEnter={p.on} />\n',
          )
        },
      },
      {
        label: '33f 前端里直接改 .style.X → 守卫变红(焦点环该走 :focus-visible)',
        blocked: true,
        hint: 'onFocus 对鼠标点击也触发,焦点环因此常亮 —— 键盘可达性通道名存实亡',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture(
            'packages/__fe_fixture__/src/Focus.tsx',
            'export const F = (e: { currentTarget: HTMLElement }) => {\n' +
              "  e.currentTarget.style.boxShadow = 'var(--focus-ring)'\n" +
              '}\n',
          )
        },
      },
      {
        label: '33g 成功回执写在 catch 之外 → 守卫变红',
        blocked: true,
        hint: '操作没成功而界面说成功了 —— 用户不会怀疑这个按钮,只会怀疑自己',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture(
            'packages/__fe_fixture__/src/Copy.tsx',
            'export function copy(t: string, setDone: (v: boolean) => void): void {\n' +
              '  try {\n' +
              '    void navigator.clipboard.writeText(t)\n' +
              '  } catch {\n' +
              '    // 吞掉\n' +
              '  }\n' +
              '  setDone(true)\n' +
              '}\n',
          )
        },
      },
      {
        label: '33h 正向对照:回执写在 try 内 → 放行(规则不是「见到 setDone 就红」)',
        blocked: false,
        hint: '',
        write: () => {
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture(
            'packages/__fe_fixture__/src/Copy.tsx',
            'export function copy(run: () => void, setDone: (v: boolean) => void): void {\n' +
              '  try {\n' +
              '    run()\n' +
              '    setDone(true)\n' +
              '  } catch {\n' +
              '    setDone(false)\n' +
              '  }\n' +
              '}\n',
          )
        },
      },
      {
        label: '33i 正向对照:注释里描述这个反面写法 → 放行(拦住解释比拦住 bug 更贵)',
        blocked: false,
        hint: '',
        write: () => {
          // ⚠️ 这个形态**真实存在**:`CodeRef.tsx` 顶部那段 JSDoc 就在讲原版为什么错,
          //   而本条守卫第一版正是被它误报的。夹具摆在这里是为了让对照独立于那个文件 ——
          //   哪天 CodeRef 的注释改了措辞,这条对照仍然守着同一件事。
          writeFixture('packages/__fe_fixture__/package.json', pkgJson('__fe_fixture__', true))
          writeFixture(
            'packages/__fe_fixture__/src/Doc.tsx',
            'export function ok(run: () => void): void {\n' +
              '  try {\n' +
              '    run()\n' +
              '  } catch {\n' +
              '    return\n' +
              '  }\n' +
              '}\n' +
              '// 反例(勿照抄):setDone(true) 写在 catch 之外,失败时照样报成功。\n',
          )
        },
      },
    ]

    for (const c of FE_CASES) {
      drop()
      c.write()
      const r = runGuards()
      // ⚠️ 判据打在**前端守卫自己的标记**上,不是全局退出码。
      //   夹具包没有 tsconfig.json,会撞上「有包整个在类型检查之外」那条无关守卫 ——
      //   拿 r.ok 当判据的话,正向对照会因为一条不相干的守卫而失败,
      //   而那是夹具的问题不是被测守卫的问题。
      const hit =
        /\[(约束[123]|范围)/.test(r.output) ||
        /JS 承载 hover/.test(r.output) ||
        /回执在 catch 之外/.test(r.output)
      const passed = c.blocked ? hit : !hit
      expect(
        c.label,
        passed,
        passed
          ? undefined
          : c.blocked
            ? `守卫放行了这种形态 —— ${c.hint}`
            : `守卫冤枉了一个合法的前端包:\n${r.output
                .split('\n')
                .filter((l) => /违规|约束|范围/.test(l))
                .slice(0, 4)
                .join('\n')}`,
      )
    }
    drop()
  }

  // ---------------------------------------------------------------------
  // 34. 任务书自身的诚实性(V0.9.0)
  //
  //     Session 标 ✅ 而产物不存在 —— 这一族此前**一道检查都没有**,
  //     而它已经错过一次:V0.8.0 的 62878be 把三个 ⬜ 一次性批量翻成 ✅,
  //     其中两个 Session 声明的四处产物一处都没交付。
  // ---------------------------------------------------------------------
  {
    const tasks = p('SESSION_TASKS.md')
    const runDocsGuard = () => runGuards()

    withRestoredFiles([tasks], (restore) => {
      // 34a —— ✅ 的 Session 交付点名一个不存在的路径
      {
        restore()
        const before = readFileSync(tasks, 'utf8')
        const mutated = before.replace(
          '**交付**:`docs/DECISIONS/design-kit-adoption.md`',
          '**交付**:`docs/DECISIONS/__does_not_exist__.md`',
        )
        if (mutated === before) {
          expect('34a ✅ 的 Session 交付点名不存在的产物 → 守卫变红', false, '锚点失配,本条作废')
        } else {
          writeFileSync(tasks, mutated, 'utf8')
          const r = runDocsGuard()
          expect(
            '34a ✅ 的 Session 交付点名不存在的产物 → 守卫变红',
            !r.ok && /产物缺失/.test(r.output),
            !r.ok
              ? undefined
              : '★ 任务书说做完了而产物不在,竟然没人红 —— 进度标记是所有后续判断的地基',
          )
        }
      }

      // 34b —— ✅ 的 Session 交付里一个反引号路径都没有
      {
        restore()
        const before = readFileSync(tasks, 'utf8')
        const mutated = before.replace(
          // ⚠️ 那一行有**两个**反引号路径 —— 只去掉一个的话判据 1 仍然满足,
          //   这条负向验证会因为夹具太弱而失败。两个一起去掉。
          '**交付**:`docs/DECISIONS/design-kit-adoption.md`(两条裁决与实测判据)、\n' +
            '`scripts/check-guards.mjs` 的「Session 标 ✅ 的交付产物都真的存在」守卫。',
          '**交付**:两条裁决与实测判据,以及那条盯任务书的守卫。',
        )
        if (mutated === before) {
          expect('34b ✅ 的 Session 交付说不出可核对的产物 → 守卫变红', false, '锚点失配,本条作废')
        } else {
          writeFileSync(tasks, mutated, 'utf8')
          const r = runDocsGuard()
          expect(
            '34b ✅ 的 Session 交付说不出可核对的产物 → 守卫变红',
            !r.ok && /产物缺失/.test(r.output),
            !r.ok
              ? undefined
              : '「做完了」而说不出一个具体产物,那句「做完了」不可核对 —— 判据 1 正是为了逼出写路径的习惯',
          )
        }
      }

      // 34d —— ★ 判据 1 **收紧**之后才拦得住的形态:
      //         交付里有路径,但**另一条列举项**是纯散文。
      //
      //         放宽版(「有任一路径即可」)会整条放行 —— V0.8.0 的
      //         「同步断言 + 覆盖断言」当年正是这么溜过去的。
      //         这一条与 34b 的分工:34b 验「一个路径都没有」,
      //         34d 验「有路径但不是每项都有」。少了 34d,收紧就没人验。
      {
        restore()
        const before = readFileSync(tasks, 'utf8')
        const mutated = before.replace(
          '`scripts/check-guards.mjs` 的「Session 标 ✅ 的交付产物都真的存在」守卫。',
          '那条盯任务书的守卫。',
        )
        if (mutated === before) {
          expect('34d 交付里有路径但另一项是纯散文 → 守卫变红', false, '锚点失配,本条作废')
        } else {
          writeFileSync(tasks, mutated, 'utf8')
          const r = runDocsGuard()
          expect(
            '34d 交付里有路径但另一项是纯散文 → 守卫变红',
            !r.ok && /说不出一个可核对的路径/.test(r.output),
            !r.ok
              ? undefined
              : '★ 判据 1 还停在「有任一路径即可」—— 那正是「客户端」当年溜掉的那条缝',
          )
        }
      }

      // 34c —— 正向对照:原样的任务书必须通过
      {
        restore()
        const r = runDocsGuard()
        expect(
          '34c 正向对照:合规的任务书被放行(规则不是「见到 ✅ 就红」)',
          r.ok,
          r.ok ? undefined : `守卫把合规的任务书也拦了:\n${r.output.slice(0, 300)}`,
        )
      }
    })
  }

  // ---------------------------------------------------------------------
  // 36. 包根的 .ts 必须被某份 tsconfig 覆盖(V0.9.0 Session 2)
  //
  //     起因是自造的一个盲点:`packages/design-system/vite.config.ts`
  //     在包根,而产品项目是 `rootDir: "./src"` —— 它落在所有 tsconfig 之外。
  //     植入 `const x: number = '字符串'`,`pnpm typecheck` 照样全绿。
  //
  //     并进 tsconfig 的第一刻就抓到一处真错误:`esbuild: { jsx: 'automatic' }`
  //     在 Vite 8 里根本不存在,而它一直「工作正常」——
  //     **一个从未起作用的配置项,与一个正确的配置项,在行为上一模一样。**
  // ---------------------------------------------------------------------
  {
    const dropRoot = () => {
      rmSync(p('packages/__rootts_fixture__'), { recursive: true, force: true })
    }
    const fixturePkg = (/** @type {string[]} */ include) => {
      writeFixture(
        'packages/__rootts_fixture__/package.json',
        JSON.stringify(
          { name: '@dshwar/rootts-fixture', version: '0.9.0', private: true },
          null,
          2,
        ) + '\n',
      )
      writeFixture(
        'packages/__rootts_fixture__/tsconfig.json',
        JSON.stringify({ include }, null, 2) + '\n',
      )
      writeFixture('packages/__rootts_fixture__/src/index.ts', 'export const x = 1\n')
      writeFixture('packages/__rootts_fixture__/tool.config.ts', 'export default { a: 1 }\n')
    }

    // 36a 包根 .ts 不在任何 include 里 → 变红
    {
      dropRoot()
      fixturePkg(['src/**/*.ts'])
      const r = runGuards()
      const hit =
        /包根的 \.ts 落在所有 tsconfig 之外/.test(r.output) && /tool\.config\.ts/.test(r.output)
      expect(
        '36a 包根的 .ts 不被任何 tsconfig 覆盖 → 守卫变红',
        hit,
        hit ? undefined : '守卫放过了一个 tsc 完全看不见、而其它守卫扫得到的文件',
      )
      dropRoot()
    }

    // 36b 正向对照:被 include 覆盖 → 放行
    //     ⚠️ 少了这条,36a 的红无法与「见到包根 .ts 就红」区分 ——
    //        而那种实现会逼着人把配置文件挪走或改成 .js,两者都更糟。
    {
      dropRoot()
      fixturePkg(['src/**/*.ts', 'tool.config.ts'])
      const r = runGuards()
      const hit = /tool\.config\.ts/.test(r.output)
      expect(
        '36b 正向对照:包根 .ts 已被 include 覆盖 → 放行(规则不是「见到就红」)',
        !hit,
        hit ? '守卫把一个已经在类型检查里的配置文件也报了' : undefined,
      )
      dropRoot()
    }
  }

  // ---------------------------------------------------------------------
  // 35. SDK 同步断言守卫:收窄「什么算一个 SDK」之后的两向(V0.9.0)
  //
  //     起因是一处**假阳性**:判据原先是「`sdk/` 下的任何目录」,
  //     于是 `sdk/docs/`(只有一份讲**本守卫为什么存在**的裁决文档)
  //     被判成缺 `render.ts` 的 SDK。
  //
  //     这是 CLAUDE.md「守卫不能惩罚记录」的第一个真实命中,
  //     而且**不是文本形状** —— 本守卫按目录形状判定,说明书落进范围
  //     是因为它的**位置**像 SDK,不是它的文字像违规。
  //
  //     收窄之后必须两向都验,否则「不再误报」很容易滑成「不再报」。
  // ---------------------------------------------------------------------
  {
    const sdkRoot = p('sdk')
    const dropSdk = () => {
      rmSync(p('sdk/__doc_fixture__'), { recursive: true, force: true })
      rmSync(p('sdk/__sdk_fixture__'), { recursive: true, force: true })
    }

    // 35a 正向对照:纯文档目录(有 .md,没有 package.json)→ 放行
    //     ⚠️ 夹具必须在场。真实的 `sdk/docs/` 已经是这个形状,但对照
    //        不该依赖它 —— 那份文档哪天挪走,这条就退化成恒绿。
    {
      dropSdk()
      writeFixture('sdk/__doc_fixture__/why-this-rule-exists.md', '# 讲这条规则为什么存在\n')
      const r = runGuards()
      const flagged = /__doc_fixture__/.test(r.output)
      expect(
        '35a 正向对照:sdk/ 下的纯文档目录 → 不当成 SDK(守卫不能惩罚记录)',
        !flagged,
        flagged ? '守卫把一份讲它自己的说明书判成了「缺同步断言的 SDK」' : undefined,
      )
      dropSdk()
    }

    // 35b 反向:有 package.json 却没有 render.ts → 仍然红
    //     没有这条,35a 的「不再误报」与「整条守卫失效」无法区分。
    {
      dropSdk()
      writeFixture(
        'sdk/__sdk_fixture__/package.json',
        JSON.stringify({ name: '@dshwar/sdk-fixture', version: '0.9.0', private: true }, null, 2) +
          '\n',
      )
      const r = runGuards()
      const flagged = /__sdk_fixture__/.test(r.output)
      expect(
        '35b 有 package.json 的新 SDK 缺 render.ts → 守卫变红(收窄没把真判据一起放掉)',
        flagged,
        flagged ? undefined : '守卫放过了一个真的缺同步断言的 SDK —— 收窄判据时把真判据也一起丢了',
      )
      dropSdk()
    }

    if (!existsSync(sdkRoot)) {
      expect('35 前置:sdk/ 目录存在', false, 'sdk/ 不存在 —— 35a/35b 都在空跑')
    }
  }

  // ---------------------------------------------------------------------
  // 31. 硬规则守卫**逐条**负向验证 + 完备性(V0.8.0)
  //
  //     ⚠️ **在此之前,check-guards.mjs 的 22 条守卫里有 5 条一次都没被验过**,
  //     其中三条守的是硬规则本身:
  //
  //       · 凭据取值泄漏   —— 硬规则 5(Admin API 永不返回凭据值)
  //       · ANONYMOUS 越界 —— 硬规则 6(缺失 principal 一律 fail closed)
  //       · 散落的 env 读取 —— PR 自查(配置只经 profile 注入)
  //
  //     它们共享同一套 `grepFiles` 机器。**机器坏了,11/12 会红;
  //     单条守卫的正则写错了,没有任何东西会红** —— 而正则写错的表现
  //     与「仓库很干净」在输出上一模一样。
  //
  //     这与契约冻结检查那次(8/9)是同一形状:**共享机制被验证,
  //     逐项判据没有。** 所以照那次的办法做:一条守卫一条负向验证,
  //     外加一条完备性断言把清单钉死。
  //
  //     ★「密码体系」此前属于**顺带覆盖**:11/12 本意是测豁免机制,夹具里
  //     恰好植了个 `passwordHash`,于是连带证明了那条守卫会红。顺带覆盖最阴 ——
  //     断言通过,但验的不是你以为的那个东西,而且**改一下 11/12 的夹具内容
  //     就静默失效**。现在它在下表里有自己的一条,与 11/12 再无关系。
  // ---------------------------------------------------------------------
  {
    /**
     * 守卫名 → 一份能触发它的夹具。
     *
     * `path` 必须落在该守卫的扫描范围内 —— 范围写错的话夹具不会命中,
     * 而那时本条会报「守卫没红」,看起来像守卫坏了,其实是夹具放错了地方。
     * 所以每条都注明了范围依据。
     *
     * @type {{ guard: string, path: string, body: string, why: string }[]}
     */
    const HARD_RULE_FIXTURES = [
      {
        guard: '密码体系',
        // 范围:packages/**/*.ts + gateway/**/*.ts
        path: 'packages/__guard_fixture5__/src/password.ts',
        body: "export const hash = 'bcrypt'",
        why: '硬规则 4 —— DSHWAR 是身份消费者,不存密码',
      },
      {
        guard: '凭据取值泄漏',
        // 范围:gateway/**/*.ts —— 只有网关会碰 Admin API
        path: 'gateway/__guard_fixture5__/leak.ts',
        body:
          'export const v = (store: { resolve(r: string): { value: string } }) =>\n' +
          '  store.resolve("K").value',
        why: '硬规则 5 —— Admin API 只暴露 describe 语义,永不返回值',
      },
      {
        guard: '散落的 env 读取',
        // 范围:packages/**/*.ts
        path: 'packages/__guard_fixture5__/src/env.ts',
        body: "export const k = process.env['DEEPSEEK_API_KEY']",
        why: 'PR 自查 —— 配置只经 profile 注入,不散落 env 读取',
      },
      {
        guard: 'ANONYMOUS 越界',
        // 范围:packages/*/src/**,且排除 packages/principal/ ——
        // 夹具落在 packages/__guard_fixture5__/src/ 下,两个条件都满足
        path: 'packages/__guard_fixture5__/src/anon.ts',
        body: "export const who = 'ANONYMOUS'",
        why: '硬规则 6 —— 缺失 principal 一律 fail closed,不得回退到匿名',
      },
    ]

    const dropLegal = () => {
      rmSync(p('packages/__legal_fixture__'), { recursive: true, force: true })
      rmSync(p('gateway/__legal_fixture__'), { recursive: true, force: true })
    }
    const dropFixtures = () => {
      rmSync(p('packages/__guard_fixture5__'), { recursive: true, force: true })
      rmSync(p('gateway/__guard_fixture5__'), { recursive: true, force: true })
    }

    // 四条夹具各触发**不同**的守卫,于是一次运行就能逐条判 —— 见 batchedChecks。
    batchedChecks(HARD_RULE_FIXTURES, {
      clean: dropFixtures,
      run: runGuards,
      label: (f) => `31 [${f.guard}] 植入违规 → 守卫变红`,
      write: (f) =>
        writeFixture(
          f.path,
          `// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。\n${f.body}\n`,
        ),
      // ⚠️ 判据必须是「这条守卫**报了违规**」,不是「输出里出现过它的名字」——
      //   check-guards **通过**时也会打印 `通过  <守卫名>`。孤立跑时 !r.ok 恰好
      //   挡住了这个洞;一批四条时,别的夹具让 r.ok 为假,这条就靠一行「通过」
      //   冒充了成功。**批量化把这个洞照了出来。**
      verdict: (f, r) => !r.ok && r.output.includes(`违规  ${f.guard}`),
      explain: (f, r) =>
        r.ok
          ? `守卫放行了违规夹具 —— ${f.why}。这条守卫此前从未被验证过。`
          : `守卫红了,但报的不是「${f.guard}」—— 命中的是别的守卫,本条其实没验到东西。`,
    })
    dropFixtures()

    // ★ 反向对照 —— **哪些合法写法一定不能被判成违规**
    //
    // ⚠️ 上面那张 HARD_RULE_FIXTURES 是照着「漏了什么」列的,
    // 它**结构上不可能包含误报**:每一条都在问「这个违规会不会被抓到」,
    // 没有一条在问「这个合规的写法会不会被冤枉」。
    //
    // 而这四条守卫全是 grep,**误报的代价比漏报更直接**:一条会冤枉合法写法
    // 的守卫,会让人给正确的代码加豁免标记 —— 于是豁免标记开始泛滥,
    // 而豁免标记泛滥之后,真正的违规也会顺手被标掉。
    //
    // 下面每一条都对应一个**真实存在的合法形态**,不是构造出来的边角。
    /** @type {{ label: string, path: string, body: string, why: string }[]} */
    const LEGAL_WRITINGS = [
      {
        label: '31e 带理由的豁免标记 → 放行(豁免机制得真的能用)',
        path: 'packages/__legal_fixture__/src/allowed.ts',
        body:
          '// dshwar-guard-allow: 这份清单的作用正是**拒绝**密码字段,必须写出这个词\n' +
          "export const REJECTED_FIELDS = ['passwordHash']",
        why:
          '11/12 验的是「豁免不是后门」,但没有一条验「豁免真的能用」—— ' +
          '两者缺一,规则要么是后门,要么是死路。@dshwar/subject 里就有这个真实形态。',
      },
      {
        label: '31f 网关只取 describe 语义 → 放行(凭据守卫不能连合法用法一起拦)',
        path: 'gateway/__legal_fixture__/describe.ts',
        body:
          '// 硬规则 5 允许的形态:只暴露 configured / source / writable,不取值\n' +
          'export const ok = (c: { describe(r: string): { configured: boolean } }) =>\n' +
          '  c.describe("K").configured',
        why: '守卫的正则是 resolve(...).value —— 它不能把 describe(...).configured 也算进去',
      },
      {
        label: '31g gateway/ 下读 process.env → 放行(该守卫只管 packages/)',
        path: 'gateway/__legal_fixture__/env.ts',
        body:
          '// 范围就是 packages/ —— 网关是组装层,读环境变量是它的活\n' +
          "export const port = process.env['PORT']",
        why: 'CLAUDE.md 的原文 grep 是 `packages/`;把网关也拦掉等于禁止组装层读配置',
      },
      {
        label: '31h test/ 里构造 ANONYMOUS → 放行(否则等于禁止验证 fail closed)',
        path: 'packages/__legal_fixture__/test/anon.test.ts',
        body:
          '// 测试必须能构造匿名主体,才能断言 fail closed 真的发生了\n' +
          "export const subject = 'ANONYMOUS'",
        why: 'check-guards 那条守卫的注释原文:把测试也拦掉,等于禁止验证这条规则本身',
      },
    ]

    // 四条合法夹具互不冲突,一次跑完;任何一条不符合预期就整批逐条重跑。
    batchedChecks(LEGAL_WRITINGS, {
      clean: dropLegal,
      run: runGuards,
      label: (c) => c.label,
      write: (c) =>
        writeFixture(
          c.path,
          `// 反向对照夹具:由 scripts/verify-guards.mjs 生成,跑完即删。\n${c.body}\n`,
        ),
      verdict: (_c, r) => r.ok,
      explain: (c, r) =>
        `守卫冤枉了一个合法写法 —— ${c.why}\n${r.output
          .split('\n')
          .filter((l) => /违规|失败/.test(l))
          .slice(0, 4)
          .join('\n')}`,
    })
    dropLegal()

    // ★ 完备性:check-guards 报出的每一条守卫,要么在上表里,
    //   要么在下面这份「另有专门验证」的登记里。两边都没有 = 没人看着它。
    //
    //   清单从 check-guards 的**真实输出**现取,不抄一份 ——
    //   抄一份就是给自己留「两边不同步而没人知道」的洞。
    {
      /**
       * 已由别处专门验证的守卫。括号里是验它的那几条。
       *
       * ⚠️ 往这里加名字**不等于**验证过了 —— 加之前先确认那几条真的存在。
       * 这份登记的作用是让完备性断言不重复计数,不是豁免通道。
       */
      const VERIFIED_ELSEWHERE = [
        '深链上游内部实现', // 1a / 1b
        '上游依赖未精确锁版', // 2
        '上游锁定版本全仓一致', // 6:篡改 adapters 的版本假设 → 契约测试变红
        '全部 TS 项目已登记进根 tsconfig references', // 7
        '全部 test/ 已登记进根 tsconfig.test.json references', // 15
        'test/ 下的 .mjs 夹具都被 checkJs 覆盖', // 20
        '全部 scripts/ 已登记进根 tsconfig.scripts.json references', // 18
        '有 TS 源码的包都有 tsconfig.json', // 19
        'principal.current() 调用点全部已登记', // 16 / 16b
        '前端三条约束(路由 / 浏览器专有 API / 统一 SDK 层)', // 24a–24e
        '变异后跑测试走受控通路(拉起 vitest 的地方只有 lib/mutate.mjs)', // 25a / 25b
        '守卫脚本不越权写仓库(check-* 只读,verify-* 走受控通路)', // 23a–23c
        '登记进解决方案的项目都真的检查了文件', // 22a / 22b
        '根 scripts/ 的 .mjs 被 checkJs 覆盖(门禁脚本自己也被检查)', // 17 / 18
        'primaryColor 的 null 没有被兜底掉(未配置 ≠ 配置成某个值)', // 30a–30c
        '每个 SDK 都有「与契约同步」的断言(逐语言,不共用)', // 29a–29c
        'CI job 都做实质检查且已登记(没有恒绿的绿勾)', // 26a–26c
        'CI 只调 check:all 一个入口,没有第二份门禁清单', // 21a–21c
        '前端交互态样式走 CSS 伪类,不用 JS 承载', // 33e / 33f
        '成功回执不在 catch 之外(没有假的成功回执)', // 33g–33i
        '包根的 .ts 都在某份 tsconfig 的 include 里', // 36a / 36b
        'Session 标 ✅ 的交付产物都真的存在(任务书自身的诚实性)', // 34a–34c
      ]

      const accounted = new Set([...HARD_RULE_FIXTURES.map((f) => f.guard), ...VERIFIED_ELSEWHERE])
      const listed = runGuards()
      const names = [...listed.output.matchAll(/^\s*(?:通过|失败)\s{2}(.+?)\s*$/gm)].map(
        (m) => m[1] ?? '',
      )
      const missing = names.filter((n) => !accounted.has(n))

      expect(
        '31 每条 check-guards 守卫都有负向验证(完备性)',
        listed.ok && names.length > 0 && missing.length === 0,
        listed.ok && names.length > 0 && missing.length === 0
          ? undefined
          : !listed.ok || names.length === 0
            ? `取不到守卫清单(基线红了?输出格式变了?)—— 完备性无从判定,不许当成通过:\n${listed.output.slice(0, 300)}`
            : `这些守卫没有任何负向验证:${missing.join(' / ')}\n` +
              '⚠️ 加一条守卫就要加一条负向验证 —— 否则它会像硬规则 5/6 那两条一样,' +
              '在门禁面板上占一个绿勾,而它的正则写错了没有任何东西会红。',
      )
    }
  }

  // ---------------------------------------------------------------------
  // 11/12. 豁免标记本身必须受控
  //
  //      行级豁免(dshwar-guard-allow)是必要的:执行一条规则的代码往往长得像
  //      违反那条规则 —— @dshwar/subject 里那份**拒绝**密码字段的清单就必须
  //      写出 password 这个词。
  //
  //      但豁免机制没有负向测试就是个后门。这两条证明:
  //        11 —— 没标记的违规照样红(豁免不是把整条守卫关掉)
  //        12 —— 空理由不算豁免(理由是给评审看的,不是给脚本看的)
  // ---------------------------------------------------------------------
  {
    writeFixture(
      'packages/__guard_fixture__/src/unmarked.ts',
      ['// 负向测试夹具', "export const leak = 'passwordHash'", ''].join('\n'),
    )
    const unmarked = runGuards()
    expect(
      '11 没有豁免标记的违规照样被拦住',
      !unmarked.ok && /密码体系/.test(unmarked.output),
      unmarked.ok ? '豁免机制把整条守卫关掉了' : undefined,
    )
    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  {
    writeFixture(
      'packages/__guard_fixture__/src/empty-reason.ts',
      [
        '// 负向测试夹具:空理由不算豁免',
        '// dshwar-guard-allow:',
        "export const leak = 'passwordHash'",
        '',
      ].join('\n'),
    )
    const empty = runGuards()
    expect(
      '12 空理由的豁免标记不生效',
      !empty.ok && /密码体系/.test(empty.output),
      empty.ok ? '空理由被当成了有效豁免 —— 那等于无条件后门' : undefined,
    )
    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 13. 开源纯净度(硬规则 9,V0.4.1)
  //
  //     闭源组件混进开源包**不会有任何报错**:构建通过、测试全绿、publish 成功。
  //     发现它的通常是 SignPath 签名申请被拒,或客户法务在合规审查时发现 ——
  //     那时包已经发出去了。所以这条守卫必须真的会拦。
  // ---------------------------------------------------------------------
  {
    writeFixture(
      'packages/__guard_fixture__/package.json',
      JSON.stringify(
        {
          name: '@dshwar/__guard_fixture__',
          version: '0.4.1',
          files: ['dist', 'README.md'],
          dependencies: { '@dshwar/billing-hosted': 'workspace:*' },
        },
        null,
        2,
      ) + '\n',
    )

    const oss = run([p('scripts', 'check-oss-purity.mjs')])
    expect(
      '13 公开包依赖闭源组件被拦住(硬规则 9)',
      !oss.ok && /闭源依赖/.test(oss.output),
      oss.ok ? '开源纯净度检查放行了闭源依赖 —— SignPath 资格会因此丢失' : undefined,
    )

    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 32. 开源纯净度的**另外三种违规**(V0.8.0)
  //
  //     13 号只验了「公开包**依赖**闭源组件」一种。这个脚本实际会产生
  //     **四种**违规,另外三种一次都没被验过 —— 而它们守的是硬规则 9,
  //     同时也是 SignPath Foundation 免费签名的资格条件。
  //
  //     ⚠️ 尤其「源码引用闭源组件」:它 grep 的是 `src/` 下的 TS 文件,
  //     判据是一份**显式清单**(CLOSED_SOURCE)。清单少一项、正则转义写错,
  //     表现都是「仓库很干净」—— 与真的干净在输出上一模一样。
  // ---------------------------------------------------------------------
  {
    const runOss = () => run([p('scripts', 'check-oss-purity.mjs')])
    const basePkg = (/** @type {Record<string, unknown>} */ over) =>
      JSON.stringify(
        { name: '@dshwar/__oss_fixture__', version: '0.8.0', files: ['dist'], ...over },
        null,
        2,
      ) + '\n'

    /** @type {{ label: string, kind: string, write: () => void }[]} */
    const OSS_CASES = [
      {
        label: '32a 源码引用闭源组件 → 开源纯净度检查变红',
        kind: '源码引用闭源组件',
        write: () => {
          writeFixture('packages/__oss_fixture__/package.json', basePkg({}))
          writeFixture(
            'packages/__oss_fixture__/src/index.ts',
            "// 负向测试夹具\nimport type { X } from '@dshwar/billing-hosted'\nexport type Y = X\n",
          )
        },
      },
      {
        label: '32b 缺 files 白名单 → 开源纯净度检查变红',
        kind: '缺少 files 白名单',
        write: () => {
          // 没有 files 字段 = 整个目录进 tarball,含本地实验与临时文件
          writeFixture(
            'packages/__oss_fixture__/package.json',
            JSON.stringify({ name: '@dshwar/__oss_fixture__', version: '0.8.0' }, null, 2) + '\n',
          )
        },
      },
      {
        label: '32c files 含可疑条目 → 开源纯净度检查变红',
        kind: 'files 含可疑条目',
        write: () => {
          writeFixture(
            'packages/__oss_fixture__/package.json',
            basePkg({ files: ['dist', '.env'] }),
          )
        },
      },
    ]

    for (const c of OSS_CASES) {
      rmSync(p('packages/__oss_fixture__'), { recursive: true, force: true })
      c.write()
      const r = runOss()
      expect(
        c.label,
        !r.ok && r.output.includes(`违规  ${c.kind}`),
        !r.ok && r.output.includes(`违规  ${c.kind}`)
          ? undefined
          : r.ok
            ? `开源纯净度检查放行了「${c.kind}」—— 硬规则 9,同时是 SignPath 免费签名的资格条件`
            : `红了,但报的不是「${c.kind}」—— 命中的是别的违规,本条其实没验到东西`,
      )
    }
    rmSync(p('packages/__oss_fixture__'), { recursive: true, force: true })

    // ★ 反向对照 —— **哪些合法引用一定不能被拦**
    //
    // ⚠️ 上面 OSS_CASES 那张表照的是「漏了什么」,结构上不含误报。
    // 而这个脚本的误报代价很具体:它拦的是**发布**,一条误报会让人
    // 要么去改一个本来正确的 package.json,要么给脚本加豁免 ——
    // 而这个脚本目前没有豁免机制,所以只剩前一条路。
    /** @type {{ label: string, files: [string, string][], why: string }[]} */
    const OSS_LEGAL = [
      {
        label: '32d 依赖 @dshwar/billing-stripe → 放行(D4 裁决它开源)',
        files: [
          [
            'packages/__oss_legal__/package.json',
            JSON.stringify(
              {
                name: '@dshwar/__oss_legal__',
                version: '0.8.0',
                files: ['dist'],
                dependencies: { '@dshwar/billing-stripe': 'workspace:*' },
              },
              null,
              2,
            ) + '\n',
          ],
        ],
        why:
          'CLOSED_SOURCE 是**显式清单**而不是 billing-* 模式匹配,正因为 D4 把 ' +
          'billing-stripe 判成了开源。改成模式匹配就会在这里红 —— 那正是这条要拦的。',
      },
      {
        label: '32e 源码 import @dshwar/billing-stripe → 放行',
        files: [
          [
            'packages/__oss_legal__/package.json',
            JSON.stringify(
              { name: '@dshwar/__oss_legal__', version: '0.8.0', files: ['dist'] },
              null,
              2,
            ) + '\n',
          ],
          [
            'packages/__oss_legal__/src/index.ts',
            "// 开源自建者接支付走的就是这条路\nimport type { StripeEvent } from '@dshwar/billing-stripe'\nexport type E = StripeEvent\n",
          ],
        ],
        why: '闭源它等于让自建者收不了钱,直接违背「开源用户拿到可用的完整基座」',
      },
      {
        label: '32f private 包依赖闭源组件 → 放行(它本来就不发布)',
        files: [
          [
            'packages/__oss_legal__/package.json',
            JSON.stringify(
              {
                name: '@dshwar/__oss_legal__',
                version: '0.8.0',
                private: true,
                dependencies: { '@dshwar/billing-hosted': 'workspace:*' },
              },
              null,
              2,
            ) + '\n',
          ],
        ],
        why:
          '判据是「将发布的包」。把 private 包也拦掉等于禁止闭源组件存在于本仓 —— ' +
          '而 open-core 的整个前提就是两者共处一个仓库。',
      },
      {
        label: '32g files 白名单只含构建产物与文档 → 放行',
        files: [
          [
            'packages/__oss_legal__/package.json',
            JSON.stringify(
              {
                name: '@dshwar/__oss_legal__',
                version: '0.8.0',
                files: ['dist', 'README.md', 'LICENSE', 'CHANGELOG.md'],
              },
              null,
              2,
            ) + '\n',
          ],
        ],
        why: 'SUSPICIOUS_FILE_ENTRIES 里有 /private/i —— 别让它把正常条目也吃了',
      },
    ]

    for (const c of OSS_LEGAL) {
      rmSync(p('packages/__oss_legal__'), { recursive: true, force: true })
      for (const [path, body] of c.files) writeFixture(path, body)
      const r = runOss()
      expect(
        c.label,
        r.ok,
        r.ok
          ? undefined
          : `开源纯净度检查拦住了一个合法形态 —— ${c.why}\n${r.output
              .split('\n')
              .filter((l) => /违规/.test(l))
              .slice(0, 3)
              .join('\n')}`,
      )
    }
    rmSync(p('packages/__oss_legal__'), { recursive: true, force: true })

    // ★ 完备性:脚本报出的每一条通过项都要有人验。清单从**真实输出**现取。
    {
      /** 已被 13 号验证的那一维(公开包依赖闭源组件)。 */
      const COVERED_BY_13 = '无公开包依赖私有包'
      // 四种违规按脚本的三条汇总行归并:
      //   源码引用闭源组件 → 「开源构建产物不含闭源组件」
      //   缺少 files 白名单 / files 含可疑条目 → 「全部将发布包都有 files 白名单」
      const covered = new Set([
        COVERED_BY_13,
        '开源构建产物不含闭源组件',
        '全部将发布包都有 files 白名单',
      ])
      const listed = runOss()
      const names = [...listed.output.matchAll(/^\s*通过\s{2}(.+?)\s*$/gm)].map((m) => m[1] ?? '')
      const missing = names.filter((n) => !covered.has(n))
      expect(
        '32 开源纯净度的每一维都有负向验证(完备性)',
        listed.ok && names.length > 0 && missing.length === 0,
        listed.ok && names.length > 0 && missing.length === 0
          ? undefined
          : !listed.ok || names.length === 0
            ? `取不到清单(基线红了?输出格式变了?)—— 不许当成通过:\n${listed.output.slice(0, 300)}`
            : `这些维度没有负向验证:${missing.join(' / ')}`,
      )
    }
  }

  // ---------------------------------------------------------------------
  // 8/9. 契约冻结 —— **逐个分类码各一条,不合并**(V0.8.0 重写)
  //
  //     ⚠️ **这一块此前是四条手写的验证,而分类码有十四个。**
  //     覆盖到的只有 `path.removed` 与 `enum.value.removed`
  //     (八个 breaking 码里的两个),外加两条相容侧的正向对照。
  //     它的绿读起来却是「契约冻结检查已验证」。
  //
  //     实测那时的真实覆盖面:把 `GET /v1/sessions` 的 200 响应体换成
  //     `ErrorResponse` —— 对客户端最大级别的破坏 —— 门禁报「契约未变」、
  //     退出码 0。逐条植入 15 种破坏性变更,**8 种漏报**。
  //
  //     > **新子形状**:一个多维分类器,负向验证只走通其中一维,
  //     > 那条绿会被读成「整个分类器已验证」。
  //     >
  //     > 与「一条探针一个目标」同源而方向相反:那条是**多目标掩盖空跑**,
  //     > 这条是**单维掩盖未覆盖的维度**。
  //
  //     所以改成表驱动:**一个 `ContractChangeCode` 一条**,各自植入一次真实
  //     变更、跑一次真实门禁、断言退出码与输出里的码。
  //     每次调用只要 0.16s,十八条也不到 3 秒 —— 手写四条从来不是成本问题。
  //
  //     ★ 最要紧的是最后那条**完备性断言**:表里少一个码就红。
  //       没有它,这张表会重新退化成「写到哪算哪」——
  //       而那正是它要替换掉的东西。
  // ---------------------------------------------------------------------
  {
    const target = p('packages/api-contract/openapi.json')

    // 显式带上 strip-types:Node 24 默认开,22.19 需要这个 flag,
    // 而 CI 的矩阵两个版本都跑
    const runContract = () =>
      run(['--experimental-strip-types', p('scripts', 'check-contract.mjs'), '--base', 'HEAD'])

    /**
     * 分类码 → 一次能触发它的真实变更。
     *
     * `blocked` 是**期望的门禁反应**,不是「这个码是不是 breaking」——
     * 两者通常一致,但把它写成期望值可以让相容侧的码也进同一张表,
     * 于是「规则不是禁止一切演进」这条正向对照对**每个** additive 码都成立。
     */
    /**
     * @typedef {Record<string, any>} OpenApiDoc
     *   解析后的 openapi.json。这里刻意用 any:变异要触到任意深度的嵌套,
     *   为一张负向验证表描出完整的 OpenAPI 类型,维护成本远超它挡住的错误。
     *   (`no-explicit-any` 的范围是 packages/gateway/adapters 的 .ts,不含本文件。)
     *
     * @type {{ code: string, blocked: boolean, mutate: (doc: OpenApiDoc) => void }[]}
     */
    const CONTRACT_CASES = [
      // ---- 原有的十四个 ----
      {
        code: 'path.removed',
        blocked: true,
        mutate: (d) => delete d.paths['/v1/sessions/{id}/turns'],
      },
      {
        code: 'path.added',
        blocked: false,
        mutate: (d) => {
          d.paths['/v1/zz-probe'] = { get: { responses: { 200: { description: '探针' } } } }
        },
      },
      {
        code: 'operation.removed',
        blocked: true,
        mutate: (d) => delete d.paths['/v1/sessions'].post,
      },
      {
        code: 'operation.added',
        blocked: false,
        mutate: (d) => {
          d.paths['/v1/sessions'].put = { responses: { 200: { description: '探针' } } }
        },
      },
      {
        code: 'schema.removed',
        blocked: true,
        mutate: (d) => delete d.components.schemas.Capacity,
      },
      {
        code: 'schema.added',
        blocked: false,
        mutate: (d) => {
          d.components.schemas.ZzProbe = { type: 'object', properties: {} }
        },
      },
      {
        code: 'property.removed',
        blocked: true,
        mutate: (d) => delete d.components.schemas.Session.properties.id,
      },
      {
        code: 'property.added',
        blocked: false,
        mutate: (d) => {
          d.components.schemas.Session.properties.zzProbe = { type: 'string' }
        },
      },
      {
        code: 'property.required.added',
        blocked: true,
        mutate: (d) => {
          d.components.schemas.Session.properties.zzProbe = { type: 'string' }
          d.components.schemas.Session.required.push('zzProbe')
        },
      },
      {
        code: 'property.required.relaxed',
        blocked: true,
        // 必填改可选:对**响应**是破坏 —— 无条件读它的客户端会拿到 undefined
        mutate: (d) => {
          d.components.schemas.Session.required = d.components.schemas.Session.required.filter(
            (/** @type {string} */ k) => k !== 'id',
          )
        },
      },
      {
        code: 'property.type.changed',
        blocked: true,
        mutate: (d) => {
          d.components.schemas.Session.properties.id.type = 'number'
        },
      },
      {
        code: 'enum.value.removed',
        blocked: true,
        // V0.4.6 红线 3:加值放宽了,删值不能跟着放宽 ——
        // 删值会让下游正在处理的分支变成死代码,而 default 兜不住
        mutate: (d) =>
          d.components.schemas.ErrorResponse.properties.error.properties.code.enum.pop(),
      },
      {
        code: 'enum.value.added',
        blocked: false,
        // V0.4.6 决策 1:前提是契约规定客户端须有 default 分支
        mutate: (d) =>
          d.components.schemas.ErrorResponse.properties.error.properties.code.enum.push('teapot'),
      },
      {
        code: 'parameter.required.added',
        blocked: true,
        mutate: (d) => {
          d.paths['/v1/sessions'].get.parameters = d.paths['/v1/sessions'].get.parameters.map(
            (/** @type {Record<string, unknown>} */ param) => ({ ...param, required: true }),
          )
        },
      },

      // ---- V0.8.0 补的四个。补之前它们对应的破坏性变更全部漏报。----
      {
        code: 'schema.ref.changed',
        blocked: true,
        // ⚠️ 这一条在 `components.schemas` **内部** —— 也就是那个大家默认
        //   「已经覆盖了」的维度。它此前同样漏报。
        mutate: (d) => {
          d.components.schemas.ListSessionsResponse.properties.data.items = {
            $ref: '#/components/schemas/ErrorResponse',
          }
        },
      },
      {
        code: 'schema.union.changed',
        blocked: true,
        // 兜底档:分支变了,但既不是可空包装的增减、也不是判别式分支。
        // 本仓今天没有这种形态 —— 这条负向验证正是为了让那个空档不空转:
        // 一个悄悄什么都不判的兜底分支,与没有这个函数等价。
        mutate: (d) => {
          d.components.schemas.ListSessionsResponse.properties.nextCursor.anyOf = [
            { type: 'integer' },
            { type: 'null' },
          ]
        },
      },
      {
        code: 'schema.nullable.removed',
        blocked: true,
        // 本仓用 `[X, null]` 表达可空(24 个 anyOf 节点全是这个形态)。
        // 去掉 null 分支 = 服务端不再接受 null,一直在传 null 的老客户端立刻被拒。
        mutate: (d) => {
          d.components.schemas.ListSessionsResponse.properties.nextCursor.anyOf = [
            { type: 'string' },
          ]
        },
      },
      {
        code: 'schema.nullable.added',
        blocked: true,
        // 反方向:响应字段变可空 —— 无条件读它的客户端会拿到 null。
        // 与 property.required.relaxed 同一个故事,套同一套保守判法。
        mutate: (d) => {
          d.components.schemas.Session.properties.id = {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          }
        },
      },
      {
        code: 'schema.variant.removed',
        blocked: true,
        // ⚠️ SSE 是这份契约的旗舰面,而 `StreamEvent` 只有 `oneOf` ——
        //   没有 type / enum / properties / items。V0.8.0 之前 diffSchema
        //   走完一遍**一个字段都比不到**:删掉一整个事件类型是 0 处破坏。
        mutate: (d) => {
          d.components.schemas.StreamEvent.oneOf = d.components.schemas.StreamEvent.oneOf.slice(
            0,
            -1,
          )
        },
      },
      {
        code: 'schema.variant.added',
        blocked: false,
        // ★ 相容 —— 与 enum.value.added 同一条依据:common.ts 的契约级要求
        //   「同样的要求适用于 StreamEventType 与其余所有闭集枚举」。
        //
        // ⚠️ 这条负向验证是修一处**误报**补的:diffUnion 第一版把分支集合的
        //   任何变化一律判破坏,于是给 SSE 加事件类型会被拦住 —— 而那正是
        //   V0.4.6 放宽 enum.value.added 时点名要允许的演进。
        //   **两条规则对同一件事给了相反答案,而后来的那条是错的。**
        mutate: (d) => {
          d.components.schemas.StreamEvent.oneOf.push({
            type: 'object',
            properties: { type: { type: 'string', const: 'zz.probe' } },
            required: ['type'],
          })
        },
      },
      {
        code: 'response.removed',
        blocked: true,
        mutate: (d) => delete d.paths['/v1/sessions'].get.responses['200'],
      },
      {
        code: 'response.added',
        blocked: false,
        mutate: (d) => {
          d.paths['/v1/sessions'].get.responses['599'] = { description: '探针' }
        },
      },
      {
        code: 'media.type.removed',
        blocked: true,
        // 「整块 content 消失」不需要单独的码 —— 它等价于每个媒体类型都被删,
        // 由同一条规则逐个报出。这里删单个,是更难被发现的那一种。
        mutate: (d) => {
          delete d.paths['/v1/sessions'].get.responses['200'].content['application/json']
        },
      },
      {
        code: 'media.type.added',
        blocked: false,
        mutate: (d) => {
          d.paths['/v1/sessions'].get.responses['200'].content['text/plain'] = {
            schema: { type: 'string' },
          }
        },
      },
      {
        code: 'parameter.removed',
        blocked: true,
        // ⚠️ 删参数的坏法是**静默的**:一直在传它的客户端不会报错,
        //   那个值只是从此被忽略。分页参数没了 = 每次都取全量。
        mutate: (d) => {
          d.paths['/v1/sessions'].get.parameters = d.paths['/v1/sessions'].get.parameters.slice(1)
        },
      },
      {
        // ★ **advisory 档 —— 这一条验的是「不阻塞」。**
        //
        // `blocked: false` 在这里的含义与别处不同:别处是「这是相容变更」,
        // 这里是「**它有能力染红门禁的话就是个 bug**」。
        //
        // 一个本该不阻塞却阻塞了的 advisory,与一个漏报同样麻烦:
        // Zod 换一次表示就冒出几十条,而那正是第五节要求 48 小时跟上的时刻。
        // 几十条误报会训练人跳过契约冻结检查 —— 而它刚补完十几个维度。
        //
        // 同时断言输出里有这个码:只验退出码 0 的话,一个**什么都不检出**的
        // advisory 也能通过 —— 那是这一档最容易退化成的样子。
        code: 'schema.constraint.tightened',
        blocked: false,
        mutate: (d) => {
          d.components.schemas.Session.properties.id.maxLength = 10
        },
      },
      {
        code: 'operation.security.changed',
        blocked: true,
        // 把一个终端用户端点改成 Admin Key —— 该端点的全部调用方立刻 401
        mutate: (d) => {
          d.paths['/v1/sessions'].get.security = [{ adminApiKey: [] }]
        },
      },
    ]

    withRestoredFiles([target], (restore) => {
      const pristine = readFileSync(target, 'utf8')

      for (const c of CONTRACT_CASES) {
        restore()
        const doc = JSON.parse(readFileSync(target, 'utf8'))
        c.mutate(doc)
        const mutated = JSON.stringify(doc, null, 2) + '\n'

        // ★ 先证明变异真的改到了东西。少了这一条,一个 no-op 的变异会被记成
        //   「门禁漏报」——而那是本脚本自己的 bug,不是被测工具的。
        //   锚点失配必须响亮,不能静默(CLAUDE.md 第三节根因 2 的同一条教训)。
        if (mutated === pristine) {
          expect(
            `8/9 [${c.code}] 负向验证`,
            false,
            `变异没改动 openapi.json —— 锚点失配,本条结论作废(不是门禁漏报)`,
          )
          continue
        }

        writeFileSync(target, mutated, 'utf8')
        const r = runContract()
        const mentions = r.output.includes(c.code)
        const reactedRight = c.blocked ? !r.ok : r.ok

        const passed = reactedRight && mentions
        expect(
          `8/9 [${c.code}] ${c.blocked ? '被拦住' : '被放行'}`,
          passed,
          passed
            ? undefined
            : !reactedRight
              ? c.blocked
                ? `契约冻结检查**放行**了这种破坏性变更 —— 门禁输出的「破坏性 0 处」对它不成立`
                : `契约冻结检查**拦住**了相容变更 —— 规则变成了「禁止一切演进」:\n${r.output.slice(0, 300)}`
              : `门禁反应对了,但输出里没有 ${c.code} —— 分类打到了别的码上,诊断会指错方向`,
        )
      }

      restore()
    })

    // ★ 完备性:每个 ContractChangeCode 都必须在上表里。
    //
    //   这一条是整块的关键。没有它,上面那张表就只是「写到哪算哪」——
    //   而「写到哪算哪」正是它要替换掉的东西:分类码从 14 个长到 18 个的过程中,
    //   负向验证一条都没跟着长,却始终显示为绿。
    //
    //   码表从 TS 源里现取(子进程带 strip-types),不抄一份到这里 ——
    //   抄一份就等于给自己留了「两边不同步而没人知道」的第二个洞。
    {
      const listed = run([
        '--experimental-strip-types',
        '-e',
        `import(${JSON.stringify(
          `file:///${p('packages/api-contract/src/freeze.ts').replace(/\\/g, '/')}`,
        )}).then((m) => console.log(m.CONTRACT_CHANGE_CODES.join('\\n')))`,
      ])
      const all = listed.output
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const covered = new Set(CONTRACT_CASES.map((c) => c.code))
      const missing = all.filter((code) => !covered.has(code))
      const stale = [...covered].filter((code) => !all.includes(code))

      expect(
        '8/9 每个 ContractChangeCode 都有一条负向验证(完备性)',
        listed.ok && all.length > 0 && missing.length === 0 && stale.length === 0,
        listed.ok && all.length > 0 && missing.length === 0 && stale.length === 0
          ? undefined
          : !listed.ok || all.length === 0
            ? `取不到 CONTRACT_CHANGE_CODES —— 完备性无从判定,不许当成通过:\n${listed.output.slice(0, 300)}`
            : missing.length > 0
              ? `这些分类码没有负向验证:${missing.join(', ')}\n` +
                '⚠️ 加一个分类码就要在 CONTRACT_CASES 里加一条 —— 否则它会像 V0.8.0 之前那样,' +
                '悄悄成为「门禁声称覆盖、实际从未验证」的那一部分。'
              : `CONTRACT_CASES 里有已经不存在的码:${stale.join(', ')}(码改名或删除了?)`,
      )
    }
  }

  // ---------------------------------------------------------------------
  // 16. 未登记的 principal.current() 调用点(V0.4.6)
  //
  //     这条守卫兜的是 V0.4.7 那个「靠人记得」的修法。忘记重入作用域的后果
  //     是静默的 —— fs-tenant 会老实往 anonymous/ 里写文件。所以守卫本身
  //     必须真的会红,否则它给的是虚假的安全感。
  // ---------------------------------------------------------------------
  {
    const fixture = writeFixture(
      'packages/__guard_fixture__/src/reads-principal.ts',
      [
        '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。',
        'export function whoAmI(ctx: { principal: { current(): { id: string } } }): string {',
        '  return ctx.principal.current().id',
        '}',
        '',
      ].join('\n'),
    )
    void fixture

    const guards = runGuards()
    expect(
      '16 未登记的 principal.current() 调用点被拦住',
      !guards.ok && /principal\.current\(\) 的登记白名单不同步/.test(guards.output),
      guards.ok
        ? 'check-guards 放行了未登记的 principal 消费方 —— V0.4.7 的修法就没有兜底了'
        : undefined,
    )

    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })

    // 反向:测试文件里调 principal.current() **不该**被拦 ——
    // 断言作用域行为本来就得读它,把测试也拦下会逼人绕过守卫。
    const inTest = writeFixture(
      'packages/__guard_fixture2__/test/reads-principal.test.ts',
      [
        '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。',
        'export const probe = (ctx: { principal: { current(): { id: string } } }) =>',
        '  ctx.principal.current().id',
        '',
      ].join('\n'),
    )
    void inTest

    const guardsInTest = runGuards()
    expect(
      '16b 测试文件里的 principal.current() 被放行(证明规则不是「一律禁止」)',
      !/principal\.current\(\) 的登记白名单不同步/.test(guardsInTest.output),
      /principal\.current\(\) 的登记白名单不同步/.test(guardsInTest.output)
        ? '守卫误伤了测试文件'
        : undefined,
    )

    rmSync(p('packages/__guard_fixture2__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 17. scripts/*.ts 没有对应的 tsconfig.scripts.json(V0.4.6 Session 1)
  // 18. scripts 项目未登记进根解决方案(同上)
  // 19. 有 src/*.ts 却完全没有 tsconfig.json —— 堵 17/18 自己的洞
  // ---------------------------------------------------------------------
  {
    writeFixture(
      'packages/__guard_fixture__/tsconfig.json',
      JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src/**/*.ts'] }, null, 2) +
        '\n',
    )
    writeFixture(
      'packages/__guard_fixture__/scripts/gen.ts',
      '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。\nexport const gen = 1\n',
    )

    const missing = runGuards()
    expect(
      '17 有 scripts/*.ts 却没有 tsconfig.scripts.json 被拦住',
      !missing.ok && /有构建脚本未纳入类型检查/.test(missing.output),
      missing.ok ? 'check-guards 放行了没有脚本 tsconfig 的包' : undefined,
    )

    // 补上 tsconfig.scripts.json 但不登记 → 换一种违规
    writeFixture(
      'packages/__guard_fixture__/tsconfig.scripts.json',
      JSON.stringify({ extends: './tsconfig.json', include: ['scripts/**/*.ts'] }, null, 2) + '\n',
    )

    const unlisted = runGuards()
    expect(
      '18 scripts 项目未登记进根 tsconfig.scripts.json 被拦住',
      !unlisted.ok &&
        /未登记 packages\/__guard_fixture__\/tsconfig\.scripts\.json/.test(unlisted.output),
      unlisted.ok ? 'check-guards 放行了未登记的脚本项目' : undefined,
    )

    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })

    // 19：有 src/*.ts、有 package.json，但完全没有 tsconfig.json。
    //     这正是 examples/minimal-server 漏掉的形态 —— 前两条守卫从
    //     「有 tsconfig 的目录」出发遍历，看不见它。
    writeFixture(
      'packages/__guard_fixture3__/package.json',
      JSON.stringify({ name: '@dshwar/__guard_fixture3__', version: '0.0.0', private: true }) +
        '\n',
    )
    writeFixture(
      'packages/__guard_fixture3__/src/index.ts',
      '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。\nexport const x = 1\n',
    )

    const invisible = runGuards()
    expect(
      '19 有 src/*.ts 却完全没有 tsconfig.json 被拦住(堵 17/18 自己的洞)',
      !invisible.ok && /有包整个在类型检查之外/.test(invisible.output),
      invisible.ok
        ? 'check-guards 看不见一个完全没有 tsconfig 的包 —— examples/minimal-server 就是这样漏了三个版本'
        : undefined,
    )

    rmSync(p('packages/__guard_fixture3__'), { recursive: true, force: true })
  }

  // ---------------------------------------------------------------------
  // 20. .mjs 夹具未被 checkJs 覆盖(V0.4.6 Session 1)
  //
  //     child-agent.mjs 的 finish reason 形状错误就是这样活了一整个版本 ——
  //     同款错误在 7 个 .ts 文件里被一次抓出,而 .mjs 那份只能靠人看见。
  // ---------------------------------------------------------------------
  {
    writeFixture(
      'packages/__guard_fixture4__/tsconfig.json',
      JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src/**/*.ts'] }, null, 2) +
        '\n',
    )
    // 有 .mjs 夹具,但 tsconfig.test.json 没开 checkJs
    writeFixture(
      'packages/__guard_fixture4__/tsconfig.test.json',
      JSON.stringify(
        {
          extends: './tsconfig.json',
          compilerOptions: { noEmit: true },
          include: ['test/**/*.ts'],
        },
        null,
        2,
      ) + '\n',
    )
    writeFixture(
      'packages/__guard_fixture4__/test/fixtures/child.mjs',
      '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。\nexport const x = 1\n',
    )

    const uncovered = runGuards()
    expect(
      '20 .mjs 夹具未被 checkJs 覆盖被拦住',
      !uncovered.ok && /有 \.mjs 夹具在类型检查之外/.test(uncovered.output),
      uncovered.ok
        ? 'check-guards 放行了不受检查的 .mjs 夹具 —— 那正是 finish reason 那个 bug 的藏身处'
        : undefined,
    )

    rmSync(p('packages/__guard_fixture4__'), { recursive: true, force: true })
  }
} finally {
  // 无条件清理,失败路径也不留垃圾
  for (const dir of ['packages/__guard_fixture__', 'adapters/__guard_fixture__']) {
    rmSync(p(dir), { recursive: true, force: true })
  }
  for (const file of created) {
    if (existsSync(file)) rmSync(file, { force: true })
  }
  // ⚠️ 这里曾有一段「清理旧版本留下的 .guardbak 残骸」。删掉了,两个理由:
  //   1. 还原改走 scripts/lib/mutate.mjs 之后,本脚本**不可能再产生**那种文件
  //   2. 为一个不再发生的失败模式留着清理代码,正是会慢慢腐烂的东西
  // 那次事故留下的残骸已经手工清掉了。见 docs/DECISIONS/guards-must-not-write.md。
}

// ---------------------------------------------------------------------
// 24 前端三条约束(V0.5.0,D7)—— 每条一负一正
//
// D7 原话:「加守卫,不是写进注释就算数。⚠️ 每条都要负向验证。」
//
// 正向对照不是凑数:少了它,一条「见到 console-web 就红」的坏守卫
// 也能通过全部三条负向测试 —— 而那会让前端根本没法写。
//
// 24d 是空集守卫的负向验证:删掉 console-web/src 之后,
// 三条约束会退化成扫描空目录 —— 那种「通过」是最危险的绿。
// ---------------------------------------------------------------------
{
  const probe = 'console-web/src/__guard_probe__.tsx'

  /** 植入一段违规源码,跑守卫,清理。 */
  const withProbe = (/** @type {string} */ content) => {
    writeFixture(probe, content)
    const r = runGuards()
    rmSync(p(probe), { force: true })
    return r
  }

  // 24a 约束 1:路由
  {
    const r = withProbe(
      [
        '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。',
        "import { createBrowserRouter } from 'react-router'",
        'export const router = createBrowserRouter([])',
        '',
      ].join('\n'),
    )
    expect(
      '24a 前端用了 history router → 守卫变红(约束 1)',
      !r.ok && /约束1 路由/.test(r.output),
      r.ok ? 'history router 被放行 —— Tauri 里刷新任意路径会 404' : undefined,
    )
  }

  // 24b 约束 2:浏览器专有 API
  {
    const r = withProbe(
      ['// 负向测试夹具。', "export const token = localStorage.getItem('token')", ''].join('\n'),
    )
    expect(
      '24b 前端用了 localStorage → 守卫变红(约束 2)',
      !r.ok && /约束2 浏览器专有 API/.test(r.output),
      r.ok ? 'localStorage 被放行 —— 它在 Tauri 的 WebView 里不跨会话可靠' : undefined,
    )
  }

  // 24c 约束 3:统一 SDK 层
  {
    const r = withProbe(
      ['// 负向测试夹具。', "export const load = () => fetch('/v1/admin/capacity')", ''].join('\n'),
    )
    expect(
      '24c 组件里直接 fetch → 守卫变红(约束 3)',
      !r.ok && /约束3 统一 SDK 层/.test(r.output),
      r.ok ? '散落的 fetch 被放行 —— 它在远端同源能跑,在 Tauri 下全部失败' : undefined,
    )
  }

  // 24d ★ 空集守卫:前端目录没了,三条约束不得静默通过
  {
    // ⚠️ 挪的是**整个包**,不是 src。
    //   V0.9.0 把扫描范围从写死目录改成「按包发现」之后,把 src 挪到同包的
    //   别处**文件仍在包里**,守卫照样扫得到 —— 那时这条负向验证会失败,
    //   而失败的是夹具不是守卫。挪走整个包才对应「前端代码全没了」。
    // ⚠️ 而且要挪走**全部**前端包,不是某一个写死的。
    //   V0.9.0 移植设计 kit 之后前端包从 1 个变成 2 个,只挪 console-web 时
    //   design-system 还在 —— 空集条件本来就不该满足,于是这条负向验证失败,
    //   **失败的是夹具不是守卫**。写死一个包名的夹具,会被「加了第二个包」打偏。
    //
    //   所以按守卫自己的判据(package.json 依赖里有 react)动态找,
    //   找到几个挪几个。加第三个前端包时这条不用再改。
    const frontendDirs = collectFiles(REPO, isPackageJson)
      .filter((f) => {
        try {
          const json = JSON.parse(readFileSync(f, 'utf8'))
          const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) }
          return deps['react'] !== undefined
        } catch {
          return false
        }
      })
      .map((f) => dirname(f))

    // ⚠️ 挪去 node_modules —— 它在 collectFiles 的 SKIP_DIRS 里。
    //   挪到仓库内的**别的名字**是不够的:package.json 还在,扫描照样发现它。
    //   同卷 rename,还原安全。
    /** @type {[string, string][]} */
    const stashes = frontendDirs.map((/** @type {string} */ dir, /** @type {number} */ i) => [
      dir,
      p('node_modules', `__fe_stash_${i}__`),
    ])
    // ⚠️ **必须 finally 还原。** 2026-08-23 实测:一个跑本脚本的子进程
    //   在两次 rename 之间被杀(会话额度耗尽),于是 `console-web/` 整个
    //   从工作区消失、只剩 `node_modules/__fe_stash_0__` ——
    //   而后续 check-guards 报的是「console-web/src 不存在」「登记了不存在的项目」,
    //   **指向症状而不是原因**,诊断花了好几步。
    //
    //   finally 挡得住异常与正常退出,挡不住 SIGKILL ——
    //   所以另有一道开机自愈(见本文件顶部 `reclaimOrphanedStashes`)。
    let r
    try {
      for (const [dir, stash] of stashes) {
        try {
          renameSync(dir, stash)
        } catch (e) {
          // ⚠️ Windows 上 `EBUSY` 几乎总是**文件监听**占着目录 ——
          //   dev server(`pnpm --filter @dshwar/design-system dev`)、编辑器索引、
          //   或者一个没退干净的 `tsc --watch`。
          //   原始报错只说 `EBUSY: resource busy or locked, rename ...`,
          //   读的人没有理由把它和「我开着 vite」联系起来。
          const code = /** @type {NodeJS.ErrnoException} */ (e).code
          if (code === 'EBUSY' || code === 'EPERM') {
            throw new Error(
              `24d 挪不动 ${dir}(${code})—— 多半是有进程在监听这个目录。\n` +
                '  先停掉 dev server / watch 进程再跑:\n' +
                '    pnpm --filter @dshwar/design-system dev  ← 这类\n' +
                '  已挪走的目录由本条的 finally 搬回,工作区不会留残骸。',
              { cause: e },
            )
          }
          throw e
        }
      }
      r = runGuards()
    } finally {
      for (const [dir, stash] of stashes) {
        if (existsSync(stash) && !existsSync(dir)) renameSync(stash, dir)
      }
    }

    // ★ 出口计数:一个前端包都没找到时,上面的循环一次都不跑,
    //   而 runGuards() 照样会因为「找不到任何前端包」而红 —— 那条红说明不了
    //   「挪走它们会红」。所以先确认真的挪走过东西。
    expect(
      '24d 前置:真的找到了前端包(否则本条空跑)',
      frontendDirs.length > 0,
      frontendDirs.length > 0 ? undefined : '一个前端包都没找到 —— 24d 本条作废',
    )
    expect(
      '24d ★ 前端包整个消失 → 守卫变红(而不是空集扫描静默通过)',
      !r.ok && /空集扫描/.test(r.output),
      r.ok ? '前端代码全没了,三条约束却「通过」了 —— 那正是本仓反复强调的最危险的绿' : undefined,
    )
  }

  // 24e 正向对照:合规写法必须被放行
  {
    const r = withProbe(
      [
        '// 负向测试夹具的**正向对照**:合规写法。',
        "import { hrefOf } from './router.ts'",
        "export const link = hrefOf('members')",
        '',
      ].join('\n'),
    )
    expect(
      '24e 正向对照:合规的前端写法被放行(规则不是「见到前端就红」)',
      r.ok,
      r.ok ? undefined : `守卫误伤了合规写法,前端将无法编写:\n${r.output.slice(0, 300)}`,
    )
  }
}

// ---------------------------------------------------------------------
// 23 守卫脚本不得越权写仓库(V0.4.7)
//
// 起因是真实事故:还原 openapi.json 的 copyFileSync 抛了 UNKNOWN(-4094),
// 把对外契约留在篡改状态、留下 .guardbak、且崩在 finally 里一句话不说。
// 详见 docs/DECISIONS/guards-must-not-write.md。
//
// 23a 负向:往 check-*.mjs 里植入一行写调用 → 必须红(第 1 档:纯读)
// 23b 负向:往 verify-*.mjs 里植入落盘备份  → 必须红(第 2 档:只能走受控通路)
// 23c 正向:verify-*.mjs 造一次性夹具仍被放行(第 3 档) ——
//     少了这一条,一条「见写就红」的粗暴守卫也能通过 23a/23b,
//     而那会把 verify-guards 自己变成不可能通过的。
// ---------------------------------------------------------------------
{
  const checkTarget = p('scripts/check-oss-purity.mjs')
  withRestoredFiles([checkTarget], () => {
    const src = readFileSync(checkTarget, 'utf8')
    writeFileSync(checkTarget, `${src}\nwriteFileSync('probe.txt', 'x')\n`, 'utf8')
    const guards = runGuards()
    expect(
      '23a check-*.mjs 里出现写调用 → 守卫变红(第 1 档:检查必须只读)',
      !guards.ok && /越权写仓库/.test(guards.output),
      guards.ok ? '守卫放行了一个会改仓库的 check-* —— 检查与被检查的东西混了' : undefined,
    )
  })

  const verifyTarget = p('scripts/verify-assertions.mjs')
  withRestoredFiles([verifyTarget], () => {
    const src = readFileSync(verifyTarget, 'utf8')
    // dshwar-guard-allow: 本条守卫的负向测试必须写出这串字面量才能植入违规
    writeFileSync(verifyTarget, `${src}\ncopyFileSync('a', 'a.probebak')\n`, 'utf8')
    const guards = runGuards()
    expect(
      '23b verify-*.mjs 自己造落盘备份 → 守卫变红(第 2 档:只能走受控通路)',
      !guards.ok && /越权写仓库/.test(guards.output),
      guards.ok ? '守卫放行了绕过 lib/mutate.mjs 的备份写法 —— 事故会原样重演' : undefined,
    )
  })

  // 23c 基线里 verify-guards.mjs 本来就在造 __guard_fixture__ 目录、
  // 并用 writeFileSync 篡改真文件 —— 而基线是绿的,放行成立。
  const baseline = runGuards()
  expect(
    '23c verify-* 造一次性夹具与经受控通路篡改仍被放行(第 3 档)',
    baseline.ok,
    baseline.ok ? undefined : '守卫误伤了正当的夹具创建 —— 那会让本脚本自己无法通过',
  )
}

// ---------------------------------------------------------------------
// 22 登记进解决方案的项目必须真的检查了文件(V0.4.7)
//
// 起因:`tsconfig.scripts.json` 的 include 是 [],于是根 scripts/ ——
// 也就是**全部门禁脚本所在的地方** —— 从来没被 tsc 看过。
// `tsc -b` 对空项目**安静地成功**,所以这个洞不会以任何方式显形。
//
// 22a 负向:把一个已登记项目的 include 清空 → 必须红
// 22b 正向:根解决方案自己的 include: [] 仍被放行(它是转发器,不是漏检)
//     —— 少了这一条,一条「见空就红」的粗暴守卫也能通过 22a。
// ---------------------------------------------------------------------
{
  const victim = p('packages/principal/tsconfig.json')
  withRestoredFiles([victim], () => {
    const cfg = JSON.parse(readFileSync(victim, 'utf8').replace(/^\s*\/\/.*$/gm, ''))
    cfg.include = []
    writeFileSync(victim, JSON.stringify(cfg, null, 2) + '\n', 'utf8')

    const guards = runGuards()
    expect(
      '22a 已登记项目的 include 被清空 → 守卫变红(tsc 对空项目会安静成功)',
      !guards.ok && /编译零个文件/.test(guards.output),
      guards.ok ? '守卫放行了一个什么都不检查的项目 —— 那种绿与真通过长得一样' : undefined,
    )
  })

  // 22b 基线本身就含三个 include: [] 的根解决方案文件,而上面一跑就绿 ——
  // 说明放行是成立的。这里显式记一条,免得将来有人把守卫改成「见空就红」。
  const baseline = runGuards()
  expect(
    '22b 根解决方案的 include: [] 被放行(它是转发器,不是漏检)',
    baseline.ok,
    baseline.ok ? undefined : '守卫误伤了根解决方案文件 —— 它们本来就该只有 references',
  )
}

// ---------------------------------------------------------------------
// 21 CI 与 check:all 之间不得出现第二份门禁清单(V0.4.7 收口)
//
// ⚠️ **原本要求的负向验证是「故意在 check:all 里加一条 CI 看不到的检查,
// 确认守卫红」。那个场景在新结构下已经不可能发生** —— CI 只调 check:all,
// 新增的检查天然被 CI 跑到,没有「CI 看不到」这回事。
//
// 所以这里做三条,把话说全:
//   21a 正向对照:往 check:all 里加一条 → 守卫**仍绿**
//       (证明失败模式是被消灭了,不是被漏检了 —— 这两者在输出上长得一样)
//   21b 负向:ci.yml 里单列一条门禁     → 守卫**必须红**(枚举长回来)
//   21c 负向:ci.yml 里删掉 check:all   → 守卫**必须红**(入口没了)
//
// 21a 单独存在是必要的:只有 21b/21c 的话,一条「永远报红」的坏守卫
// 也能全部通过。
// ---------------------------------------------------------------------
{
  const pkgPath = p('package.json')
  const ciPath = p('.github/workflows/ci.yml')
  withRestoredFiles([pkgPath, ciPath], () => {
    const pkgSrc = readFileSync(pkgPath, 'utf8')
    const ciSrc = readFileSync(ciPath, 'utf8')

    // 21a 正向对照 —— 加一条新门禁,不碰 ci.yml
    {
      const pkg = JSON.parse(pkgSrc)
      pkg.scripts['check:probe'] = 'node -e "process.exit(0)"'
      pkg.scripts['check:all'] = `${pkg.scripts['check:all']} && pnpm check:probe`
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
      const r = runGuards()
      expect(
        '21a 往 check:all 加一条新检查 → 守卫仍绿(CI 天然跑得到,不需要同步)',
        r.ok,
        r.ok ? undefined : '守卫报红了 —— 说明它在要求 ci.yml 同步,那正是要消灭的东西',
      )
      writeFileSync(pkgPath, pkgSrc, 'utf8')
    }

    // 21b 负向 —— ci.yml 里把一条门禁单列出来
    {
      writeFileSync(
        ciPath,
        ciSrc.replace(
          '      - name: pnpm check:all\n        run: pnpm check:all',
          '      - name: Lint\n        run: pnpm lint\n\n      - name: pnpm check:all\n        run: pnpm check:all',
        ),
        'utf8',
      )
      const r = runGuards()
      expect(
        '21b ci.yml 里单列 `pnpm lint` → 守卫变红(第二份清单长回来了)',
        !r.ok,
        !r.ok ? undefined : '守卫放行了枚举 —— 漂移会顺着这条路慢慢长回来',
      )
      writeFileSync(ciPath, ciSrc, 'utf8')
    }

    // 21c 负向 —— 把入口本身删掉
    {
      writeFileSync(ciPath, ciSrc.replace(/pnpm check:all/g, 'echo skipped'), 'utf8')
      const r = runGuards()
      expect(
        '21c ci.yml 里删掉 `pnpm check:all` → 守卫变红(入口没了)',
        !r.ok,
        !r.ok ? undefined : '删掉门禁入口竟然还是绿的 —— 只查枚举、不查入口等于没查',
      )
      writeFileSync(ciPath, ciSrc, 'utf8')
    }
  })
}

// ---------------------------------------------------------------------
// 25. 变异后跑测试必须走受控通路(V0.6.5 收官审计)
//
//     起因是一次真实误判:离线降级的网关 e2e 在拆掉可达性判定后仍然绿,
//     重建 dist 之后才红。跨包测试消费的是 dist,而 dist 是用**未变异**的
//     源码构建的 —— 于是「没变红」有两种含义(断言弱 / 根本没测到),
//     两者在输出里一模一样。按前者去「加强断言」就是基于误判改代码。
//
//     结构性修法:拉起 vitest 的路径收敛到 lib/mutate.mjs 一处,那一处
//     必定同步 dist。本组负向验证盯着「收敛」这件事本身。
// ---------------------------------------------------------------------
{
  const probePath = p('scripts/verify-assertions.mjs')
  const probeSrc = readFileSync(probePath, 'utf8')

  withRestoredFiles([probePath], () => {
    // 25a 负向 —— 有脚本自己拼 vitest 路径(绕开 dist 同步)
    {
      writeFileSync(
        probePath,
        probeSrc.replace(
          'const p = (...seg) => join(REPO, ...seg)',
          // dshwar-guard-allow: 负向测试必须写出这串字面量才能植入违规
          "const p = (...seg) => join(REPO, ...seg)\nconst SNEAKY = p('node_modules', 'vitest', 'vitest.mjs')\nvoid SNEAKY",
        ),
        'utf8',
      )
      const r = runGuards()
      expect(
        '25a 脚本自己拉起 vitest → 守卫变红(绕开 dist 同步)',
        !r.ok,
        !r.ok ? undefined : '★ 守卫放行了绕开受控通路的 vitest 调用 —— 变异验证的结论会不可信',
      )
    }

    // 25b 正向对照 —— 走受控通路的写法必须被放行
    //     少了这一条,一个「见到 vitest 就红」的实现也能通过 25a,
    //     而那样受控通路自己也用不了。
    {
      writeFileSync(
        probePath,
        probeSrc.replace(
          'const p = (...seg) => join(REPO, ...seg)',
          'const p = (...seg) => join(REPO, ...seg)\nvoid runVitest',
        ),
        'utf8',
      )
      const r = runGuards()
      expect(
        '25b 正向对照:经 lib/mutate.mjs 的调用被放行(规则不是「见到 vitest 就红」)',
        r.ok,
        r.ok ? undefined : '守卫把受控通路自己也拦了 —— 那样没人能跑变异验证',
      )
    }
  })
}

// ---------------------------------------------------------------------
// 26. CI job 必须做实质检查且已登记(2026-08-17)
//
//     起因:`terminal-contract` 这个 job 只 echo 一行就退出,在面板上
//     **永远是绿勾**,而它一次检查都没做过 —— 还指向一个不存在的任务。
//     「一个不检查的 job 比没有 job 更糟:它占一个绿勾。」
// ---------------------------------------------------------------------
{
  const ciPath = p('.github/workflows/ci.yml')
  const ciSrc = readFileSync(ciPath, 'utf8')

  withRestoredFiles([ciPath], () => {
    // 26a 负向 —— 加一个只 echo 的假 job
    {
      writeFileSync(
        ciPath,
        `${ciSrc}\n  fake-hollow:\n    name: 假的恒绿 job\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "nothing to see here"\n`,
        'utf8',
      )
      const r = runGuards()
      expect(
        '26a 加一个只 echo 的 job → 守卫变红(恒绿的绿勾)',
        !r.ok && /恒绿|实质检查/.test(r.output),
        !r.ok ? undefined : '★ 守卫放行了一个只 echo 的 job —— 面板上会多一个永远绿的勾',
      )
    }

    // 26b 负向 —— job 做了实质检查,但没在登记表里
    //     这一条比 26a 强:一个 job 可以跑真命令,却没人验证那条命令会不会红。
    {
      writeFileSync(
        ciPath,
        `${ciSrc}\n  fake-unregistered:\n    name: 未登记的 job\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/check-version.mjs\n`,
        'utf8',
      )
      const r = runGuards()
      expect(
        '26b 加一个未登记但有实质检查的 job → 守卫变红(没人验证它会不会红)',
        !r.ok && /登记/.test(r.output),
        !r.ok ? undefined : '守卫只查了「有没有跑命令」,没查「那条命令有没有人验证」',
      )
    }

    // 26c 正向对照 —— 现有的两个 job 必须被放行。
    //     少了它,一个「见到 job 就红」的实现也能通过 26a/26b。
    {
      writeFileSync(ciPath, ciSrc, 'utf8')
      const r = runGuards()
      expect(
        '26c 正向对照:合规的 job 被放行(规则不是「见到 job 就红」)',
        r.ok,
        r.ok ? undefined : '守卫把现有的合规 job 也拦了',
      )
    }
  })
}

// ---------------------------------------------------------------------
// 27. process-cost 的判定真的会红(2026-08-17)
//
//     它是扫「还有没有第二个恒绿的检查」时找出来的:`--assert` 跑的是真
//     命令,**但没有任何守卫或探针验证过它会红** —— 而它还有一条
//     `limit === undefined` 就退出 0 的路径,在 CI 上等于恒绿。
//
//     用 `--samples 1` 跑(实测约 0.7 s),够验判定逻辑,不拖慢门禁。
// ---------------------------------------------------------------------
{
  const costPath = p('scripts/measure-process-cost.mjs')
  const costSrc = readFileSync(costPath, 'utf8')
  const runCost = (/** @type {string[]} */ extra) =>
    run([costPath, '--assert', '--samples', '1', ...extra])

  withRestoredFiles([costPath], () => {
    // 27a 负向 —— 把阈值压到 0,判定必须红
    {
      writeFileSync(
        costPath,
        costSrc
          .replace(
            /linux: \{ coldStartMs: \d+, rssMb: \d+ \}/,
            'linux: { coldStartMs: 0, rssMb: 0 }',
          )
          .replace(
            /win32: \{ coldStartMs: \d+, rssMb: \d+ \}/,
            'win32: { coldStartMs: 0, rssMb: 0 }',
          ),
        'utf8',
      )
      const r = runCost([])
      expect(
        '27a 阈值压到 0 → 进程代价门禁变红(它真的在判定)',
        !r.ok && /超出阈值/.test(r.output),
        !r.ok ? undefined : '★ 阈值为 0 竟然还通过 —— --assert 没在判定任何东西',
      )
    }

    // 27b 负向 —— 删掉当前平台的阈值条目,带 --require-threshold 必须红
    //     不带它则跳过判定并退出 0(那是开发机上正确的行为),
    //     所以这一条验的是「CI 用的那个参数真的堵住了这个洞」。
    {
      writeFileSync(costPath, costSrc.replace(/^\s*(linux|win32): \{ coldStartMs.*$/gm, ''), 'utf8')
      const withFlag = runCost(['--require-threshold'])
      const without = runCost([])
      expect(
        '27b 删掉平台阈值条目 → 带 --require-threshold 红,不带则跳过(CI 用带的那个)',
        !withFlag.ok && without.ok,
        !withFlag.ok && without.ok
          ? undefined
          : '★ 缺阈值时 CI 会安静退出 0 —— 门禁退化成恒绿而面板照样是绿勾',
      )
    }

    // 27c/27d —— **两维各验一次**(V0.8.0)
    //
    // ⚠️ 27a 把两个阈值一起压到 0,于是冷启动与内存**同时**超标 ——
    // 红是「或」。把 `coldStartMs > limit.coldStartMs` 单独改坏,27a 照样通过。
    //
    // 这与「一条探针一个目标」是同一件事,只是发生在门禁那一侧:
    // **一次同时触发多维的负向验证,证明不了任何单独一维在工作。**
    //
    // 所以下面两条各压一维、把另一维放到不可能超的高度,
    // 并且**断言另一维确实没出现在失败清单里** —— 那句「没出现」才是
    // 「这一维是被单独验的」的证据。
    // ★ 反向对照 —— **真实阈值下,正常波动一定不能红**
    //
    // ⚠️ 27a/27b/27c/27d 全是「压阈值让它红」,照的是「漏了什么」。
    // 一条**阈值定得过紧**的门禁会在每次 CI 上随机红一次,而人对
    // 随机红的反应是重跑,不是修 —— 重跑几次之后,这条门禁就等于没有了。
    //
    // 这一条刻意放在压阈值的四条**之前**跑:它同时是那四条的基线,
    // 基线不绿的话,后面「红了」说明不了任何事情。
    {
      writeFileSync(costPath, costSrc, 'utf8')
      const r = runCost([])
      expect(
        '27e 正向对照:真实阈值下不红(阈值不能定得让正常波动就超标)',
        r.ok,
        r.ok
          ? undefined
          : `本机实测已经超过内置阈值 —— 要么这台机器不适合当基线,要么阈值该重新量:\n${r.output
              .split('\n')
              .filter((l) => /超过阈值/.test(l))
              .join('\n')}`,
      )
    }

    /** @type {{ label: string, tight: 'coldStartMs' | 'rssMb', expect: string, absent: string }[]} */
    const DIMENSIONS = [
      {
        label: '27c 只压冷启动阈值 → 只有冷启动那一维报超标',
        tight: 'coldStartMs',
        expect: '冷启动中位数',
        absent: '常驻内存中位数',
      },
      {
        label: '27d 只压内存阈值 → 只有内存那一维报超标',
        tight: 'rssMb',
        expect: '常驻内存中位数',
        absent: '冷启动中位数',
      },
    ]
    for (const dim of DIMENSIONS) {
      const relaxed = dim.tight === 'coldStartMs' ? 'rssMb: 9_999_999' : 'coldStartMs: 9_999_999'
      const tightened = `${dim.tight}: 0`
      const pair =
        dim.tight === 'coldStartMs' ? `${tightened}, ${relaxed}` : `${relaxed}, ${tightened}`
      writeFileSync(
        costPath,
        costSrc
          .replace(/linux: \{ coldStartMs: \d+, rssMb: \d+ \}/, `linux: { ${pair} }`)
          .replace(/win32: \{ coldStartMs: \d+, rssMb: \d+ \}/, `win32: { ${pair} }`),
        'utf8',
      )
      const r = runCost([])
      expect(
        dim.label,
        !r.ok && r.output.includes(dim.expect) && !r.output.includes(dim.absent),
        !r.ok && r.output.includes(dim.expect) && !r.output.includes(dim.absent)
          ? undefined
          : r.ok
            ? `阈值压到 0 竟然没超标 —— ${dim.tight} 那一维的比较没在判定任何东西`
            : !r.output.includes(dim.expect)
              ? `红了,但失败清单里没有「${dim.expect}」—— 红的是别的原因`
              : `失败清单里同时出现了「${dim.absent}」—— 另一维也被压了,这条又变成「或」了`,
      )
    }
  })
}

// ---------------------------------------------------------------------
// 28. check:docs 自己会红(2026-08-17)
//
//     它是同一轮扫描的第三个发现:`check:docs` 上一轮才进 check:all,
//     而 `md-table.test.mts` 验的是**库**(表格解析),不是
//     「`session-tasks.mjs check` 该红的时候会不会红」。
//
//     **一个刚加进门禁的检查,最容易被默认为「当然有用」。**
// ---------------------------------------------------------------------
{
  const tasksPath = p('SESSION_TASKS.md')
  const tasksSrc = readFileSync(tasksPath, 'utf8')
  const runDocs = () => run([p('scripts', 'session-tasks.mjs'), 'check'])

  withRestoredFiles([tasksPath], () => {
    // 28a 负向 —— 残留一段 Session prompt(校验 3)
    {
      writeFileSync(tasksPath, `读取 CLAUDE.md 与 SESSION_TASKS.md,然后…\n\n${tasksSrc}`, 'utf8')
      const r = runDocs()
      expect(
        '28a 主文件残留 Session prompt → check:docs 变红',
        !r.ok && /残留 Session prompt/.test(r.output),
        !r.ok ? undefined : '★ check:docs 放行了残留的 prompt —— 它没在查它声称查的东西',
      )
    }

    // 28b 负向 —— 已压缩的版本块丢了归档指针(校验 2)
    {
      writeFileSync(
        tasksPath,
        // ⚠️ `replaceAll` 而不是 `replace`(只替换第一处)。
        //
        // 原先是 `replace`,于是这条夹具的成败取决于「文件里**第一个**指针
        // 属于哪个版本块」—— V0.8.0 立项时在前面插了一个开发中的块,
        // 第一处就落到它身上,而开发中的块不受这条校验管,
        // 于是 check:docs 照样绿、这条负向验证失败。
        //
        // **一条依赖文档顺序的夹具,就是一条会被无关改动打偏的夹具。**
        tasksSrc.replaceAll('> 实现细节见 SESSION_TASKS_HISTORY.md', ''),
        'utf8',
      )
      const r = runDocs()
      expect(
        '28b 已压缩的版本块丢了归档指针 → check:docs 变红',
        !r.ok && /指向归档/.test(r.output),
        !r.ok ? undefined : '压缩后没人能找到实现细节,而门禁竟然是绿的',
      )
    }

    // 28d 负向 —— 主文件超过字符上限(校验 1)
    //
    // ⚠️ **这一维此前零负向验证**,而它是第三节整节存在的理由:
    // 超限时 Claude Code 读不全任务书,会基于残缺上下文开发,
    // **且不会主动告知哪部分被截断**。本项目已经因文档膨胀吃过一次亏。
    //
    // 28a/28b 覆盖的是另外两条校验。三条校验、两条负向验证 ——
    // 与契约冻结检查(8/9)、硬规则守卫(31)是同一形状:
    // **多维判定,负向验证只走通其中几维。**
    {
      // 上限 150,000 字符;填到 160,000 稳稳超过,又不至于写出一个巨大的文件。
      // 用中文填充不是随意选的:第三节明写「单位是字符,不是字节」,
      // 中文在 UTF-8 下一个字符占 3 字节 —— 若判定误用了字节数,
      // 这段填充会让它**提前**触发,与「超限才红」区分不开。
      // 所以填充刻意压在 160,000 字符 ≈ 480,000 字节:
      // 按字符判 → 超限(红);按字节判 → 也红,但会在远低于此时就红,
      // 所以下面顺带断言输出里的字符数确实是 16 万量级而不是 48 万。
      const filler = `\n\n<!-- 负向测试填充,由 scripts/verify-guards.mjs 生成 -->\n${'占位文字。'.repeat(32_000)}\n`
      writeFileSync(tasksPath, tasksSrc + filler, 'utf8')
      const r = runDocs()
      const reported = /主文件 ([\d,]+) 字符/.exec(r.output)
      const chars = Number((reported?.[1] ?? '0').replace(/,/g, ''))

      expect(
        '28d 主文件超过字符上限 → check:docs 变红',
        !r.ok && /主文件/.test(r.output) && chars > 150_000 && chars < 300_000,
        !r.ok && /主文件/.test(r.output) && chars > 150_000 && chars < 300_000
          ? undefined
          : r.ok
            ? '★ 主文件超了 15 万字符,check:docs 竟然是绿的 —— 而超限时 Claude Code 读不全任务书,且不会告知截断'
            : chars >= 300_000
              ? `报出的是 ${chars} —— 量的是**字节**不是字符(第三节:中文一字符 3 字节,两者差约 1.6 倍)`
              : `红了,但报的不是字符数超限:\n${r.output.slice(0, 300)}`,
      )
    }

    // 28c 正向对照 —— 原样的文件必须通过
    {
      writeFileSync(tasksPath, tasksSrc, 'utf8')
      const r = runDocs()
      expect(
        '28c 正向对照:合规的文件被放行(规则不是「见到文件就红」)',
        r.ok,
        r.ok ? undefined : 'check:docs 把合规的文件也拦了',
      )
    }
  })
}

// ---------------------------------------------------------------------
// 29. 新增 SDK 必须有「与契约同步」的断言(V0.8.0)
//
//     加第四种语言时漏掉那份断言,不会让任何东西变红:新 SDK 的产物照样
//     生成、照样提交,只是**永远不再校验**。这一组盯的正是那个静默的口子。
// ---------------------------------------------------------------------
{
  // 29a 负向 —— 一个连 render.ts 都没有的 SDK
  {
    writeFixture(
      'sdk/__guard_fixture__/package.json',
      JSON.stringify({ name: '@dshwar/sdk-fixture', version: '0.8.0', private: true }, null, 2) +
        '\n',
    )
    const r = runGuards()
    expect(
      '29a 新 SDK 没有 scripts/render.ts → 守卫变红',
      !r.ok && /render\.ts|同步断言/.test(r.output),
      !r.ok ? undefined : '★ 守卫放行了一个没有共用渲染路径的 SDK',
    )
  }

  // 29b 负向 —— 有 render.ts,但测试**不比对产物**(最像「已经测了」的那种)
  {
    writeFixture(
      'sdk/__guard_fixture__/scripts/render.ts',
      'export function renderFixture(): string {\n  return "fixture"\n}\n',
    )
    writeFixture(
      'sdk/__guard_fixture__/test/smoke.test.ts',
      [
        "import { describe, expect, it } from 'vitest'",
        "import { renderFixture } from '../scripts/render.ts'",
        '',
        // 调了渲染函数,但没有与已提交的产物比对 —— 证明不了产物是最新的
        "describe('假的', () => {",
        "  it('渲染出点东西', () => {",
        '    expect(renderFixture().length).toBeGreaterThan(0)',
        '  })',
        '})',
        '',
      ].join('\n'),
    )
    const r = runGuards()
    expect(
      '29b 有 render.ts 但测试不比对产物 → 守卫变红(它证明不了产物是最新的)',
      !r.ok && /同步断言/.test(r.output),
      !r.ok ? undefined : '★ 守卫把「调了渲染函数」当成了「校验了同步」—— 两者不是一回事',
    )
    rmSync(p('sdk/__guard_fixture__'), { recursive: true, force: true })
  }

  // 29c 正向对照 —— 三个真实 SDK 必须被放行
  {
    const r = runGuards()
    expect(
      '29c 正向对照:三个真实 SDK 被放行(规则不是「见到 sdk 目录就红」)',
      r.ok,
      r.ok ? undefined : '守卫把合规的 SDK 也拦了',
    )
  }
}

// ---------------------------------------------------------------------
// 30. primaryColor 的 null 不许被兜底掉(V0.8.0)
//
//     V0.8.0 把 primaryColor 从 string(哨兵默认 #2F6FEB)改成 string | null。
//     而一行 `?? '#2F6FEB'` 就能把这次改动**完全抵消** —— 类型上仍分开,
//     行为上又合并,**且没有任何东西会变红**。这一组盯的正是那个口子。
// ---------------------------------------------------------------------
{
  // 30a 负向 —— 用 ?? 兜一个颜色字面量
  {
    writeFixture(
      'packages/__guard_fixture__/src/theme.ts',
      [
        '// 负向测试夹具:由 scripts/verify-guards.mjs 生成,跑完即删。',
        "import type { TenantBranding } from '@dshwar/console-contract'",
        'export function seedOf(branding: TenantBranding): string {',
        // 这一行正是守卫要拦的:把「未配置」重新合并成「某个默认色」
        "  return branding.primaryColor ?? '#2F6FEB'",
        '}',
        '',
      ].join('\n'),
    )
    const r = runGuards()
    expect(
      '30a 调用点用 ?? 兜一个默认色 → 守卫变红(两种状态又被合并)',
      !r.ok && /兜底|primaryColor/.test(r.output),
      !r.ok ? undefined : '★ 守卫放行了兜底 —— 类型层刚分开的两种状态在调用点又合并了',
    )
  }

  // 30b 负向 —— 换成 || 与建议色常量,同样要拦
  //     少了这一条,一个只认 `?? '#'` 的实现也能通过 30a。
  {
    writeFixture(
      'packages/__guard_fixture__/src/theme.ts',
      [
        '// 负向测试夹具。',
        "import { SUGGESTED_PRIMARY_COLOR, type TenantBranding } from '@dshwar/console-contract'",
        'export function seedOf(branding: TenantBranding): string {',
        '  return branding.primaryColor || SUGGESTED_PRIMARY_COLOR',
        '}',
        '',
      ].join('\n'),
    )
    const r = runGuards()
    expect(
      '30b 换成 || 与建议色常量 → 同样变红(判据不是只认一种写法)',
      !r.ok && /兜底|primaryColor/.test(r.output),
      !r.ok ? undefined : '守卫只认 `?? "#"` 一种写法 —— 换个写法就绕过去了',
    )
    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  // 30c 正向对照 —— **正确**的写法必须被放行
  //     少了它,一个「见到 primaryColor 就红」的实现也能通过前两条,
  //     而那样任何人都没法读这个字段。
  {
    writeFixture(
      'packages/__guard_fixture__/src/theme.ts',
      [
        '// 负向测试夹具:这是**正确**的写法,必须放行。',
        "import type { TenantBranding } from '@dshwar/console-contract'",
        '// 判空收敛在派生入口一处,不在调用点兜底',
        'export function seedOf(branding: TenantBranding): string | null {',
        '  return branding.primaryColor',
        '}',
        '',
      ].join('\n'),
    )
    const r = runGuards()
    expect(
      '30c 正向对照:原样传递 null 的写法被放行(规则不是「见到 primaryColor 就红」)',
      r.ok,
      r.ok ? undefined : '守卫把正确的写法也拦了 —— 那样没人能读这个字段',
    )
    rmSync(p('packages/__guard_fixture__'), { recursive: true, force: true })
  }

  // 30d ★ 范围:**根级**目录里的兜底同样要红(V0.9.0 Session 2)
  //
  //     30a–30c 的夹具都在 `packages/` 下。而守卫的扫描范围曾是一张手写清单
  //     `['packages','gateway','console-web','sdk']` —— 根级的新前端包
  //     (Session 2 的 `workbench-web/`)整个逃出去,里面写兜底**不会红**,
  //     而三条既有验证**全绿**:它们的夹具恰好都在清单覆盖的位置。
  //
  //     ⇒ 这一条把「范围」本身变成被验证的对象:夹具摆在**清单之外**的位置。
  {
    const rootFixture = p('__root_guard_fixture__')
    rmSync(rootFixture, { recursive: true, force: true })
    writeFixture(
      '__root_guard_fixture__/src/theme.ts',
      [
        '// 负向测试夹具:位置在**仓库根级**,不在 packages/ 之下。',
        "import type { TenantBranding } from '@dshwar/console-contract'",
        'export function seedOf(branding: TenantBranding): string {',
        "  return branding.primaryColor ?? '#2F6FEB'",
        '}',
        '',
      ].join('\n'),
    )
    const r = runGuards()
    const hit = /__root_guard_fixture__/.test(r.output)
    expect(
      '30d ★ 根级目录里的兜底也变红(扫描范围不是一张手写目录清单)',
      hit,
      hit
        ? undefined
        : '守卫看不见根级目录 —— 新建的前端包会整个逃出扫描,而这里三条既有验证照样全绿',
    )
    rmSync(rootFixture, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------
// 收尾:确认清理干净,守卫回到基线
// ---------------------------------------------------------------------
{
  const guards = runGuards()
  const version = runVersion()
  expect(
    '10 夹具已清理干净,守卫回到基线',
    guards.ok && version.ok,
    guards.ok && version.ok ? undefined : '清理后守卫仍然失败,仓库可能残留夹具',
  )
}

const failed = results.filter((r) => !r.passed)
console.log(
  `\n共 ${results.length} 条,通过 ${results.length - failed.length},失败 ${failed.length}`,
)

if (failed.length > 0) {
  console.log('\n有守卫没拦住它该拦的东西。这比守卫报错更严重 —— 它意味着纪律是假的。')
  for (const f of failed) console.log(`  ${f.name}`)
  process.exit(1)
}
console.log('全部守卫都真的会拦。')
