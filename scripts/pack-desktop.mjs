#!/usr/bin/env node
/**
 * 桌面安装包的**唯一编排入口**:前端产物 → sidecar → `cargo tauri build`。
 *
 * ## 顺序是硬的,三步都显式写在这里
 *
 * `tauri.conf.json` 支持 `beforeBuildCommand`,把前端构建挂在 Tauri 上。
 * 这里刻意不用它:三步显式排在一处,每一步的失败都说得出是哪一步,
 * 而挂在配置里的那一条在失败时只会说「beforeBuildCommand 失败」。
 *
 * ⚠️ **这个决定当初是按一个错误的解释做的,而修法碰巧是对的。**
 * 当时的解释是「`cargo tauri build` 设了 `NODE_ENV=production`,
 * 于是那条命令里的 pnpm 去装生产依赖」——两个真事实拼在一起,严丝合缝。
 * 挪出来之后**同样的失败又出现了一次**,而这次根本没有 Tauri 参与。
 *
 * 真正的原因在 `pnpm deploy` 覆盖了根 workspace 的状态文件,
 * 详见 `scripts/pack-sidecar.mjs` 里那一段与
 * `docs/DECISIONS/unverified-plausible-causation.md` 的例 4。
 *
 * 🚨 记在这里是因为**那个错误解释掩盖了真正的风险**:CI 上 `CI=true`,
 * pnpm 不会停下来问,会直接把 devDependencies 删掉 ——
 * 按错误解释修完,风险原封不动地留着,而且看起来已经解决了。
 *
 * ## 三步各自在解决什么
 *
 * | 步 | 做什么 | 不做会怎样 |
 * | --- | --- | --- |
 * | 1 | 前端 `tsc -b && vite build` | `tauri-build` 的 codegen 找不到 `frontendDist`,**编译期**就失败 |
 * | 2 | `pack-sidecar` | `externalBin` 找不到 `dshwar-gateway-<triple>`,同样编译期失败 |
 * | 3 | `cargo tauri build` | —— |
 *
 * 两处失败都在**编译期**而不是运行期,这是 Tauri 的一个好设计:
 * 配置里承诺的东西不在,就编不出来,而不是装上去之后才发现。
 *
 * ## ⚠️ 签名不在这里
 *
 * Windows 走 SignPath Foundation(开源免费,**需先有 release**),
 * macOS 走 Apple Developer($99/年)。两者都要外部资源与账号,
 * 而打包链路先得跑通 —— 签名是它之后的事(V0.9.0 Session 6 的边界)。
 *
 * 跑法:`pnpm pack:desktop`
 *
 * @module scripts/pack-desktop
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 怎么把 pnpm 跑起来 —— **优先走 `npm_execpath`**。
 *
 * ⚠️ Windows 上 `pnpm` 是一个 `.cmd`,而 **Node 24 起 `spawnSync` 拒绝直接拉起
 * `.cmd` / `.bat`**(EINVAL,那是一个安全变更)。开 `shell: true` 能绕过去,
 * 代价是参数变成拼接 —— 一个带空格的路径就被拆成两个参数。
 *
 * `npm_execpath` 在「由 pnpm 拉起的脚本」里指向 pnpm 的 `.mjs` 入口,
 * 用 `node` 直接跑它:没有 shell,没有 `.cmd`,参数照旧是数组。
 *
 * 兜底(有人直接 `node scripts/pack-desktop.mjs`)才回到 `.cmd` + shell。
 *
 * @param {string[]} args 传给 pnpm 的参数
 * @returns {{cmd: string, args: string[], shell: boolean}}
 */
function pnpmCommand(args) {
  const execpath = process.env['npm_execpath']
  if (execpath !== undefined && execpath.endsWith('.mjs')) {
    return { cmd: process.execPath, args: [execpath, ...args], shell: false }
  }
  return process.platform === 'win32'
    ? { cmd: 'pnpm.cmd', args, shell: true }
    : { cmd: 'pnpm', args, shell: false }
}

/** @param {string} label @param {string} cmd @param {string[]} args @param {boolean} [shell] */
function step(label, cmd, args, shell = false) {
  console.log(`\n━━ ${label}`)
  console.log(`   ${cmd} ${args.join(' ')}`)
  try {
    execFileSync(cmd, args, { cwd: REPO, stdio: 'inherit', shell })
  } catch (e) {
    console.log(`\n🚨 这一步失败了:${label}`)
    console.log('   后面的步骤没有跑 —— 打包链路是有顺序的,半成品比失败更难查。')
    throw e
  }
}

{
  const { cmd, args, shell } = pnpmCommand(['--filter', '@dshwar/workbench-web', 'build'])
  step('1/3 前端产物', cmd, args, shell)
}

const dist = join(REPO, 'workbench-web', 'dist', 'index.html')
if (!existsSync(dist)) {
  // ⚠️ 显式核对产物,而不是「命令退出码是 0 就算成功」——
  //   一个只跑了 `tsc -b` 的 build 脚本同样会退出 0,而 dist 根本不存在。
  console.log(`\n🚨 前端构建报告成功,但 ${dist} 不在。`)
  console.log('   查 workbench-web 的 build 脚本里有没有 `vite build`:')
  console.log('   只有 `tsc -b` 的话,它检查类型但不产出任何静态资源。')
  process.exit(1)
}

step('2/3 sidecar(Node 运行时 + 生产依赖树 + 原生模块)', process.execPath, [
  join(REPO, 'scripts', 'pack-sidecar.mjs'),
])

step('3/3 cargo tauri build', 'cargo', ['tauri', 'build'])

// ---- 产物清单 ----
//
// 打包脚本最后要说清**装出来的是什么、在哪** —— 否则下一个人要去 target/
// 里翻,而那个目录里还躺着一堆中间产物。
const bundleDir = join(REPO, 'src-tauri', 'target', 'release', 'bundle')
if (existsSync(bundleDir)) {
  console.log('\n━━ 产物')
  for (const kind of readdirSync(bundleDir)) {
    for (const file of readdirSync(join(bundleDir, kind))) {
      const p = join(bundleDir, kind, file)
      if (statSync(p).isDirectory()) continue
      console.log(
        `   ${(statSync(p).size / 1024 / 1024).toFixed(1).padStart(7)} MB  ${kind}/${file}`,
      )
    }
  }
  console.log('\n⚠️ 这些包**没有签名**。Windows 上装的时候会有 SmartScreen 警告,')
  console.log('   macOS 上会被 Gatekeeper 拦下 —— 签名是 Session 6 之后的事,')
  console.log('   它要外部资源(SignPath Foundation 需先有 release / Apple $99 年费)。')
}
