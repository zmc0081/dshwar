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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { withRestoredFiles } from './lib/mutate.mjs'

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
      withRestoredFiles([target], () => {
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
      })
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

    // 显式带上 strip-types:Node 24 默认开,22.19 需要这个 flag,
    // 而 CI 的矩阵两个版本都跑
    const runContract = () =>
      run(['--experimental-strip-types', p('scripts', 'check-contract.mjs'), '--base', 'HEAD'])

    withRestoredFiles([target], (restore) => {
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

      // 9b. 枚举**删值**仍是破坏性变更(V0.4.6 红线 3)
      //     这一条与 9c 成对:加值放宽了,删值不能跟着放宽 ——
      //     删值会让下游正在处理的分支变成死代码,而 default 兜不住。
      restore()
      const shrunk = JSON.parse(readFileSync(target, 'utf8'))
      shrunk.components.schemas.ErrorResponse.properties.error.properties.code.enum.pop()
      writeFileSync(target, JSON.stringify(shrunk, null, 2) + '\n', 'utf8')

      const removed = runContract()
      expect(
        '9b 枚举删值仍被拦住(V0.4.6 只放宽了加值)',
        !removed.ok && /enum.value.removed/.test(removed.output),
        removed.ok ? '契约冻结检查放行了删枚举值 —— 下游的分支会变成死代码' : undefined,
      )

      // 9c. 枚举**加值**被放行(V0.4.6 决策 1)
      restore()
      const grown = JSON.parse(readFileSync(target, 'utf8'))
      grown.components.schemas.ErrorResponse.properties.error.properties.code.enum.push('teapot')
      writeFileSync(target, JSON.stringify(grown, null, 2) + '\n', 'utf8')

      const added = runContract()
      expect(
        '9c 枚举加值被放行(前提:契约规定客户端须有 default 分支)',
        added.ok && /enum.value.added/.test(added.output),
        added.ok
          ? undefined
          : `契约冻结检查仍在拦枚举加值:
${added.output.slice(0, 400)}`,
      )

      // 9. 相容:加一个可选字段
      restore()
      const additive = JSON.parse(readFileSync(target, 'utf8'))
      additive.components.schemas.Session.properties.label = { type: 'string' }
      writeFileSync(target, JSON.stringify(additive, null, 2) + '\n', 'utf8')

      const relaxed = runContract()
      expect(
        '9 加一个可选字段被放行(证明规则不是「禁止一切演进」)',
        relaxed.ok && /property\.added/.test(relaxed.output),
        relaxed.ok ? undefined : `契约冻结检查误伤了相容变更:\n${relaxed.output.slice(0, 400)}`,
      )
    })
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
    const src = p('console-web', 'src')
    const stash = p('console-web', '__stash__')
    renameSync(src, stash)
    const r = runGuards()
    renameSync(stash, src)
    expect(
      '24d ★ console-web/src 整个消失 → 守卫变红(而不是空集扫描静默通过)',
      !r.ok && /空集扫描|没有任何源码/.test(r.output),
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
