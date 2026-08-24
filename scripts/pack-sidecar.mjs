#!/usr/bin/env node
/**
 * 把网关打成桌面壳的 **sidecar** —— Node 运行时 + 生产依赖树 + 原生模块。
 *
 * ## 产物两块,分开放是因为它们的**命名规则不同**
 *
 * | 产物 | 去哪 | 命名 |
 * | --- | --- | --- |
 * | Node 运行时 | `src-tauri/binaries/` | `dshwar-gateway-<target-triple>[.exe]` |
 * | 网关 + node_modules | `src-tauri/sidecar/` | 原样 |
 *
 * Tauri 的 `externalBin` 按 **target triple** 找文件(`x86_64-pc-windows-msvc`),
 * 因为一个安装包只装得下一个平台的二进制;而 `resources` 是原样拷贝。
 *
 * ⚠️ **外部二进制就是 Node 本体**,网关的 JS 走 `resources`。
 * 另一条路是 Node SEA(把 JS 塞进 node 的副本)—— 它并不能省掉这一步:
 * **原生模块塞不进 SEA**,koffi 的 `.node` 照样要单独随包走。
 * 于是 SEA 只换来一个「看起来像自研程序」的文件名,代价是多一个 postject 依赖。
 *
 * ## 🚨 原生模块:koffi,不是任务书里写的那三个
 *
 * 路线图写的是 `node-pty` / `sharp` / `@vscode/ripgrep`。**实测三个都不在依赖树里**
 * (`node-pty` 随 `dsh-subprocess-local`,而那个包在 `DELIBERATELY_OMITTED` 里 ——
 * 上游 `ProcessInspector` 的 win32 直接抛)。
 *
 * 真正要跟着走的是 **koffi**:`dsh-fs-local` 与 `dsh-session-persistence-jsonl`
 * 的运行时依赖,也就是网关的必经之路。它按**平台专属 npm 包**分发
 * (`@koromix/koffi-win32-x64` 等),所以不需要从源码编译 —— 但**需要确认
 * 装进去的是当前平台那一份**,而 `pnpm deploy` 只会带上当前平台的。
 *
 * ⇒ 于是本脚本在最后**断言 `.node` 真的在**:少了它,网关会在第一次
 * 读文件时抛一句与打包无关的错,而安装包已经发出去了。
 *
 * ## ⚠️ 跨平台打包做不到「一台机器出全部产物」
 *
 * `pnpm deploy` 装的是**本机平台**的可选依赖,Node 运行时也是本机的那一份。
 * 要出三平台的包,就要在三平台各跑一次(CI 的 matrix)。
 * 这不是本脚本的缺陷,是原生模块的性质。
 *
 * 跑法:`node scripts/pack-sidecar.mjs`
 *
 * @module scripts/pack-sidecar
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIDECAR_DIR = join(REPO, 'src-tauri', 'sidecar')
const BIN_DIR = join(REPO, 'src-tauri', 'binaries')

/**
 * 当前平台的 Rust target triple。
 *
 * ⚠️ **从 `rustc -vV` 现取,不自己拼**。拼的话要维护一张
 * 「node 的 platform/arch → rust triple」映射表,而那张表与 Tauri 找文件时
 * 用的那一份是两个事实源 —— 分家的表现是「打包成功,装上去说找不到 sidecar」。
 */
function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  const line = out.split(/\r?\n/).find((l) => l.startsWith('host: '))
  if (line === undefined) {
    throw new Error(`rustc -vV 里没有 host 行 —— 输出格式变了?\n${out}`)
  }
  return line.slice('host: '.length).trim()
}

/**
 * 目录大小(字节)。打包产物的体积要说出来,不然没人知道它涨了。
 * @param {string} dir
 * @returns {number}
 */
function sizeOf(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    total += entry.isDirectory() ? sizeOf(p) : statSync(p).size
  }
  return total
}

/**
 * 递归找第一个 `.node` —— 原生模块真的跟着走了吗。
 * @param {string} dir
 * @returns {string | undefined}
 */
function findNative(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findNative(p)
      if (found !== undefined) return found
    } else if (entry.name.endsWith('.node')) return p
  }
  return undefined
}

const triple = hostTriple()
console.log(`DSHWAR · 打包 sidecar`)
console.log(`  target triple : ${triple}`)
console.log(`  Node 运行时   : ${process.version}  (${process.execPath})`)

// ---- 1. 生产依赖树 ----
//
// ⚠️ 用 `pnpm deploy --prod` 而不是自己拷 node_modules:workspace 里全是符号链接,
//   拷出来的树在别的机器上指向不存在的路径。deploy 会把它铺平成真实目录。
//
//   这一步也是「运行时依赖不许躺在 devDependencies 里」那条守卫的由来:
//   --prod 只装 dependencies,漏声明的包在这里就消失了。
rmSync(SIDECAR_DIR, { recursive: true, force: true })
console.log(`\n  [1/3] pnpm deploy --prod → ${SIDECAR_DIR}`)
// 🚨 **这一步之后不要再跑需要 devDependencies 的命令** —— 即使下面已经把
//    状态文件还原了,顺序仍然是第二道保险:还原是一次写文件,而写文件会失败。
//    `pack-desktop.mjs` 因此把前端产物排在这一步**之前**。
//
// ⚠️ 怎么把 pnpm 跑起来:优先 `npm_execpath`(pnpm 的 .mjs 入口,用 node 直接跑)。
//    Windows 上 `pnpm` 是 `.cmd`,而 **Node 24 起 spawnSync 拒绝直接拉起 .cmd**
//    (EINVAL,安全变更);开 shell 能绕过去,但那样参数变成拼接,
//    一个带空格的路径就被拆成两个 —— 而这个仓库的路径里有中文目录名。
const execpath = process.env['npm_execpath']
const viaNode = execpath !== undefined && execpath.endsWith('.mjs')

// 🚨 **`pnpm deploy` 会把它自己的设置写进根 workspace 的状态文件。**
//
//    实测(pnpm 11.12):`deploy --prod --config.node-linker=hoisted` 之后,
//    根目录的 `node_modules/.pnpm-workspace-state-v1.json` 里变成
//      { dev: false, production: true, nodeLinker: "hoisted" }
//    而根 `node_modules` **本身一个字节都没动**(deploy 写的是别的目录)。
//
//    于是下一次跑任何 `pnpm <script>` 时,pnpm 比对「上次装的设置」与
//    「这次要的设置」发现不一致,自动补一次 `install --production` ——
//    那会**删掉根 node_modules 里的 devDependencies**。
//    本机没有 TTY 时它拒绝执行并报错;而 **CI 上 `CI=true`,它不问,直接删**。
//
//    ⇒ 记录是错的,而 node_modules 是对的。所以这里把**记录**存下来、
//    跑完原样写回去 —— 不是绕过 pnpm,是把它被 deploy 覆盖掉的那一行还原。
const STATE_FILE = join(REPO, 'node_modules', '.pnpm-workspace-state-v1.json')
const stateBefore = existsSync(STATE_FILE) ? readFileSync(STATE_FILE) : undefined
// 🚨 `--config.node-linker=hoisted`:铺成**扁平**的 node_modules,不是 pnpm 默认的
//    符号链接布局。理由是 Windows 的 MAX_PATH(260 字符)——
//
//    实测:默认布局下 NSIS 打包在这条路径上失败(os error 2):
//      sidecar\node_modules\.pnpm\node_modules\@dshwar\gateway\node_modules\
//      @dshwar\auth-jwt\node_modules\@dshwar\subject\node_modules\
//      @dshwar\storage-scoped\node_modules\@dshwar\fs-tenant\node_modules\
//      @deepseek-ai\cordis\lib\index.js
//
//    ⚠️ 这条失败**只在打包时出现**:`node` 自己走符号链接读得到,
//    而 NSIS 是按真实路径逐个文件打包的。于是「跑得起来」证明不了「打得出包」。
const deployArgs = [
  'deploy',
  '--filter',
  '@dshwar/gateway',
  '--prod',
  '--config.node-linker=hoisted',
  SIDECAR_DIR,
  '--legacy',
]
try {
  execFileSync(
    viaNode ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    viaNode ? [execpath, ...deployArgs] : deployArgs,
    { cwd: REPO, stdio: 'inherit', shell: !viaNode && process.platform === 'win32' },
  )
} finally {
  // ⚠️ `finally` 而不是成功之后才还原:deploy 失败时那份记录**同样已经**被覆盖了,
  //    而那时下一条命令照样会去删 devDependencies —— 失败路径反而更危险,
  //    因为人这时正忙着看错误信息。
  if (stateBefore !== undefined) writeFileSync(STATE_FILE, stateBefore)
}

// ---- 2. Node 运行时 ----
//
// ⚠️ 拷的是**跑本脚本的那个 Node**。CI 上由 `actions/setup-node` 钉死版本,
//   于是「打包用的运行时」与「CI 声明的版本」是同一个,不需要第二处配置。
mkdirSync(BIN_DIR, { recursive: true })
const ext = process.platform === 'win32' ? '.exe' : ''
const target = join(BIN_DIR, `dshwar-gateway-${triple}${ext}`)
copyFileSync(process.execPath, target)
console.log(`\n  [2/3] Node 运行时 → ${target}`)

// ---- 3. 原生模块必须在 ----
//
// 🚨 少了它,网关会在**第一次读文件时**抛一句与打包无关的错,
//    而那时安装包已经发出去了。这里宁可打包失败。
console.log(`\n  [3/3] 原生模块检查`)
const native = findNative(join(SIDECAR_DIR, 'node_modules'))
if (native === undefined) {
  console.log('')
  console.log('🚨 生产依赖树里一个 .node 都没有。')
  console.log('   网关经 dsh-fs-local / dsh-session-persistence-jsonl 依赖 koffi,')
  console.log('   而 koffi 是**平台专属 npm 包**(@koromix/koffi-<platform>-<arch>)。')
  console.log('   一个都没装到,通常意味着 pnpm 把可选依赖跳过了 ——')
  console.log('   查 .npmrc 的 optional / 平台过滤设置,不要靠「装上去再看」。')
  process.exit(1)
}
console.log(`        ✓ ${native.slice(REPO.length + 1)}`)

const mb = (sizeOf(SIDECAR_DIR) + statSync(target).size) / 1024 / 1024
console.log(`\n完成。sidecar 合计 ${mb.toFixed(1)} MB(含 Node 运行时)`)
console.log('接着跑:cargo tauri build')
