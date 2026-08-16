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
 *
 * 退出码:全绿 0,任一守卫没拦住 1。
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const p = (...seg) => join(REPO, ...seg)

const ESLINT_BIN = p('node_modules', 'eslint', 'bin', 'eslint.js')

/** 跑一条命令,只关心它是成功还是失败。 */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output: stdout }
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }
  }
}

const runEslint = (target) => run([ESLINT_BIN, target, '--max-warnings', '0'])
const runGuards = () => run([p('scripts', 'check-guards.mjs')])
const runVersion = () => run([p('scripts', 'check-version.mjs')])

/** 记录被本脚本创建的路径,finally 里无条件清理。 */
const created = []
function writeFixture(relPath, content) {
  const full = p(relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
  created.push(full)
  return full
}

const results = []
function expect(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`  ${passed ? '通过' : '失败'}  ${name}`)
  if (detail) console.log(`        ${detail}`)
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
    const backup = `${target}.guardbak`
    copyFileSync(target, backup)
    try {
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
    } finally {
      copyFileSync(backup, target)
      unlinkSync(backup)
    }
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
      const backup = `${target}.guardbak`
      copyFileSync(target, backup)
      try {
        const original = readFileSync(target, 'utf8')
        const tampered = original.replace(
          /export const EXPECTED_UPSTREAM_VERSION = '[^']+'/,
          "export const EXPECTED_UPSTREAM_VERSION = '9.9.9-tampered'",
        )
        if (tampered === original) {
          expect('6 篡改 adapters 假设后契约测试变红', false, '未能改动 EXPECTED_UPSTREAM_VERSION')
        } else {
          writeFileSync(target, tampered, 'utf8')
          const contract = run([
            p('node_modules', 'vitest', 'vitest.mjs'),
            'run',
            '--dir',
            'adapters',
          ])
          expect(
            '6 篡改 adapters 内的上游版本假设,契约测试立刻变红',
            !contract.ok,
            contract.ok ? '契约测试放行了错误的上游版本假设 —— 它没在测上游' : undefined,
          )
        }
      } finally {
        copyFileSync(backup, target)
        unlinkSync(backup)
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
  // 8/9. 契约冻结(Session 6 验收)
  //
  //     单测已经验过 diffContract 的判定,但那只证明**分类器**对。这里验的是
  //     **整条门禁**:改真实的 openapi.json,跑真实的脚本,看退出码。
  //     两个方向都要:破坏性必须红,加可选字段必须绿 ——
  //     只会说红的规则等于禁止一切演进。
  //
  //     基线用 HEAD:工作区被篡改而 HEAD 未变,正好是「本次 PR 改了契约」。
  // ---------------------------------------------------------------------
  {
    const target = p('packages/api-contract/openapi.json')
    const backup = `${target}.guardbak`
    copyFileSync(target, backup)

    // 显式带上 strip-types:Node 24 默认开,22.19 需要这个 flag,
    // 而 CI 的矩阵两个版本都跑
    const runContract = () =>
      run(['--experimental-strip-types', p('scripts', 'check-contract.mjs'), '--base', 'HEAD'])

    try {
      // 8. 破坏性:删掉一个已发布的端点
      const doc = JSON.parse(readFileSync(target, 'utf8'))
      delete doc.paths['/v1/sessions/{id}/turns']
      writeFileSync(target, JSON.stringify(doc, null, 2) + '\n', 'utf8')

      const breaking = runContract()
      expect(
        '8 破坏性契约变更被契约冻结检查拦住',
        !breaking.ok && /path\.removed/.test(breaking.output),
        breaking.ok ? '契约冻结检查放行了删端点 —— 已接入的客户端会直接拿到 404' : undefined,
      )

      // 9. 相容:加一个可选字段
      copyFileSync(backup, target)
      const additive = JSON.parse(readFileSync(target, 'utf8'))
      additive.components.schemas.Session.properties.label = { type: 'string' }
      writeFileSync(target, JSON.stringify(additive, null, 2) + '\n', 'utf8')

      const relaxed = runContract()
      expect(
        '9 加一个可选字段被放行(证明规则不是「禁止一切演进」)',
        relaxed.ok && /property\.added/.test(relaxed.output),
        relaxed.ok ? undefined : `契约冻结检查误伤了相容变更:\n${relaxed.output.slice(0, 400)}`,
      )
    } finally {
      copyFileSync(backup, target)
      unlinkSync(backup)
    }
  }
} finally {
  // 无条件清理,失败路径也不留垃圾
  for (const dir of ['packages/__guard_fixture__', 'adapters/__guard_fixture__']) {
    rmSync(p(dir), { recursive: true, force: true })
  }
  for (const file of created) {
    if (existsSync(file)) rmSync(file, { force: true })
  }
  const bak = p('README.md.guardbak')
  if (existsSync(bak)) {
    copyFileSync(bak, p('README.md'))
    unlinkSync(bak)
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
