#!/usr/bin/env node
/**
 * 跑桌面壳的 Rust 测试 —— **本机入口**。跳过的每一条路径都要说清「谁在别处跑」。
 *
 * ## 三条路径
 *
 * | 环境 | 做什么 | 谁跑那些断言 |
 * | --- | --- | --- |
 * | 本机有 cargo | **真跑**。失败就是失败,红 | 自己 |
 * | 本机没有 cargo | 跳过,并把这件事印成一段刺眼的说明 | 只有 CI 的 `desktop-shell` job |
 * | **CI 上** | 跳过 —— 但先**核对**确实有人跑 | `desktop-shell` job(装了系统依赖 + keyring 后端) |
 *
 * ## 🚨 「跳过」这条路径是本仓最警惕的那一族
 *
 * 一条永远绿的检查与没有检查等价,但更危险:它让人以为有覆盖。
 * 所以跳过时不能只印一行小字 —— 它要说清跳过的是**什么**、**谁**在别处跑、
 * 这个缺口**怎么补**。
 *
 * ⚠️ 而「谁在别处跑」这句话本身会过期。所以 CI 那一档**不是无条件跳过**:
 * 它从 `ci.yml` 里现取,确认那个 job 真的还在调 `cargo test`。
 * 取不到就**红**,不是跳过 —— 那时候真的没人跑了。
 *
 * ## ⚠️ 为什么 CI 上要跳过:「CI 里没有 Rust」是个**错的**前提
 *
 * 本文件的上一版写着「CI 里没有 Rust(实测,.github/workflows 里一个
 * rust / cargo / tauri 字样都没有)」。括号里那句是真的,而它推出来的结论是假的:
 *
 * > **`ubuntu-latest` 镜像自带 Cargo**(实测 1.97.1,见 runner-images 的
 * > `Ubuntu2404-Readme.md`)—— workflow 里没写,不代表机器上没有。
 *
 * 后果是 V0.9.0 Session 6 首次真跑 CI 时,门禁 job 里的 `test:shell`
 * **走了「真跑」那一档**,于是 `cargo test` 去编 Tauri 的 bin 目标,
 * 撞上门禁 job 没装的 WebKitGTK:
 *
 * ```
 * The system library `glib-2.0` required by crate `glib-sys` was not found.
 * ```
 * 门禁 Node 22 / Node 24 两条**一模一样地红**,而它与被改的代码毫无关系。
 *
 * ⇒ CI 上不跑:那里有一个**专门**的 job,装了系统依赖、起了 keyring 后端。
 * 让门禁 job 也去编一遍 Tauri,既慢又要求它承担桌面壳的环境编排 ——
 * 而它的职责是 TS monorepo。
 *
 * @module scripts/test-shell
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(REPO, 'src-tauri', 'Cargo.toml')
const CI_WORKFLOW = join(REPO, '.github', 'workflows', 'ci.yml')

/** CI 上那个真跑 Rust 断言的调用长什么样 —— 判据现取,不在这里另抄一份命令。 */
const DELEGATED_CALL = /cargo\s+test\s+--manifest-path/

/**
 * ci.yml 里有没有**真的执行** `cargo test`。
 *
 * ⚠️ 必须跳过注释行。ci.yml 里恰好有一段注释在**讲**这件事
 * (「这里直接调 cargo test,而不是 pnpm test:shell」)——
 * 让说明能满足判据,等于这条核对永远为真:job 被删光了它照样放行。
 *
 * 这是「守卫不能惩罚记录」的镜像面:那条讲的是说明**不该被判成违规**,
 * 这条讲的是说明**不该被算成合规**。同一个根子 —— 判据要分得清
 * 「在做」与「在讲」。
 */
function ciReallyRunsCargoTest(/** @type {string} */ workflow) {
  return workflow
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .some((line) => DELEGATED_CALL.test(line))
}

if (!existsSync(MANIFEST)) {
  console.log('  跳过  桌面壳:src-tauri/Cargo.toml 不存在')
  process.exit(0)
}

// ── CI:交给 desktop-shell job,但先确认那个 job 还在 ──────────────────
if (process.env['CI'] === 'true' || process.env['CI'] === '1') {
  const workflow = existsSync(CI_WORKFLOW) ? readFileSync(CI_WORKFLOW, 'utf8') : ''
  if (!ciReallyRunsCargoTest(workflow)) {
    console.log('')
    console.log('🚨 桌面壳的 Rust 断言在 CI 上**没有人跑**。')
    console.log('')
    console.log('   本脚本在 CI 上跳过,前提是 ci.yml 里的 desktop-shell job 会真跑 ——')
    console.log('   而现在 ci.yml 里找不到 `cargo test --manifest-path`。')
    console.log('   那个前提没了,这个跳过就成了一条谎话。')
    console.log('')
    console.log('   要么把那个 job 加回去,要么删掉本分支让门禁自己跑(它需要 WebKitGTK)。')
    console.log('')
    process.exit(1)
  }
  console.log('  跳过  桌面壳:CI 上由 desktop-shell job 跑(已核对它还在调 cargo test)')
  console.log('        那个 job 装了 WebKitGTK 并起了 keyring 后端 —— 门禁 job 两样都没有。')
  process.exit(0)
}

// ── 本机 ───────────────────────────────────────────────────────────────
// ⚠️ 用 `spawnSync` 探而不是 `execFileSync` —— 后者在找不到命令时抛,
//    而「找不到 cargo」是本脚本要**处理**的正常情况,不是异常。
const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: true })

if (probe.status !== 0) {
  console.log('')
  console.log('  ⚠️  跳过  桌面壳的 Rust 测试 —— 这台机器上没有 cargo')
  console.log('')
  console.log('     跳过的是什么:src-tauri 的断言,其中一条**真的读写系统钥匙串**。')
  console.log('     那一条是唯一能证明钥匙串真在工作的东西 —— 另外几条都是纯字符串断言,')
  console.log('     它们全绿而钥匙串一次都没被碰过,与「工作正常」在输出上一模一样。')
  console.log('')
  console.log('     谁在别处跑过它:CI 的 **desktop-shell** job(ubuntu + windows),')
  console.log('     它装了 WebKitGTK、起了 keyring 后端,并且真的打一次包。')
  console.log('')
  console.log('     想在本机也跑:装 Rust(https://rustup.rs),Linux 上还要')
  console.log('     libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf。')
  console.log('')
  process.exit(0)
}

console.log('  桌面壳:cargo 在,真跑')
try {
  execFileSync('cargo', ['test', '--manifest-path', MANIFEST], {
    cwd: REPO,
    stdio: 'inherit',
    shell: true,
  })
} catch {
  console.log('')
  console.log('🚨 桌面壳的 Rust 测试失败。两种最常见的原因,先分清是哪一种:')
  console.log('')
  console.log('   1. **编都没编过**,报的是 pkg-config / glib-2.0 / webkit2gtk 找不到 ——')
  console.log('      那是**系统依赖**没装,不是代码问题。Linux 上:')
  console.log('      sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \\')
  console.log('        librsvg2-dev patchelf')
  console.log('')
  console.log('   2. 失败的是 `round_trip_through_the_real_keychain` —— 先核对一件事:')
  console.log('      `keyring` 3 在**一个 store feature 都没开**时回落到 mock 后端,')
  console.log('      set_password() 报成功而 get_password() 什么都没有,')
  console.log('      那是一条标准的假成功回执。见 src-tauri/Cargo.toml 的注释。')
  console.log('')
  process.exit(1)
}
