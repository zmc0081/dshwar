#!/usr/bin/env node
/**
 * 跑桌面壳的 Rust 测试 —— **没有 cargo 时吵着跳过,而不是安静通过**。
 *
 * ## 它面对的那个两难
 *
 * | 选择 | 后果 |
 * | --- | --- |
 * | 进 `check:all` | CI 里没有 Rust,整条门禁红 —— 而那不是代码的问题 |
 * | 不进 `check:all` | **没人跑它**,而钥匙串是这一版唯一碰长效凭据的代码 |
 *
 * 两个都不行。取的办法是**进门禁,但按环境分岔**:
 *
 * - 有 cargo → 真跑。失败就是失败,红。
 * - 没有 cargo → **跳过,并把这件事印成一段刺眼的说明**。
 *
 * ## 🚨 「跳过」这条路径是本仓最警惕的那一族
 *
 * 一条永远绿的检查与没有检查等价,但更危险:它让人以为有覆盖。
 * 所以跳过时**不能只印一行小字** —— 它要说清:
 *
 * 1. 跳过的是**什么**(15 条断言,其中一条真的读写系统钥匙串);
 * 2. **谁**在别的地方跑过它(今天的答案是:只有开发机,CI 没有 Rust);
 * 3. 这个缺口**怎么补**(给 CI 加 Rust,而不是删掉断言)。
 *
 * ⚠️ 与 V0.8.0 那次同形:Kotlin / Swift 客户端因为「本机与 CI 都没有工具链」
 * 被移出了版本范围 —— 而不是交付两份编译不了、没人盯着的代码。
 * 这里工具链**在开发机上有**,所以代码可以交付;缺的只是 CI 那一半。
 *
 * @module scripts/test-shell
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(REPO, 'src-tauri', 'Cargo.toml')

if (!existsSync(MANIFEST)) {
  console.log('  跳过  桌面壳:src-tauri/Cargo.toml 不存在')
  process.exit(0)
}

// ⚠️ 用 `spawnSync` 探而不是 `execFileSync` —— 后者在找不到命令时抛,
//    而「找不到 cargo」是本脚本要**处理**的正常情况,不是异常。
const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: true })
const hasCargo = probe.status === 0

if (!hasCargo) {
  console.log('')
  console.log('  ⚠️  跳过  桌面壳的 Rust 测试 —— 这台机器上没有 cargo')
  console.log('')
  console.log('     跳过的是什么:src-tauri 的 15 条断言,其中一条**真的读写系统钥匙串**。')
  console.log('     那一条是唯一能证明钥匙串真在工作的东西 —— 另外几条都是纯字符串断言,')
  console.log('     它们全绿而钥匙串一次都没被碰过,与「工作正常」在输出上一模一样。')
  console.log('')
  console.log('     谁在别处跑过它:**只有开发机**。CI 里没有 Rust(实测,.github/workflows 里')
  console.log('     一个 rust / cargo / tauri 字样都没有)。')
  console.log('')
  console.log('     怎么补:给 CI 加 Rust 工具链 —— 而不是删掉那条断言。')
  console.log('     ⚠️ 无头环境里没有 Secret Service,那一条会红;正解是起一个 keyring 后端,')
  console.log('        不是加 #[ignore] 把它藏起来。藏起来之后就再也没人验过了。')
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
  console.log('🚨 桌面壳的 Rust 测试失败。')
  console.log('   ⚠️ 若失败的是 `round_trip_through_the_real_keychain`,先核对一件事:')
  console.log('      `keyring` 3 在**一个 store feature 都没开**时回落到 mock 后端 ——')
  console.log('      set_password() 报成功而 get_password() 什么都没有,')
  console.log('      那是一条标准的假成功回执。见 src-tauri/Cargo.toml 的注释。')
  process.exit(1)
}
