/**
 * 临时篡改文件、跑检查、**保证还原** —— 给 `verify-guards` 与 `verify-assertions` 用。
 *
 * ## 为什么要有这个模块(一次真实事故)
 *
 * 这两个脚本的做法本来是「`copyFileSync` 备份到 `x.guardbak` → 篡改 →
 * `finally` 里 `copyFileSync` 复制回去」。2026-08-16 在 Windows 上,
 * **还原那一步的 `copyFileSync` 抛了 `UNKNOWN (errno -4094)`**,于是:
 *
 * - `packages/api-contract/openapi.json` 被留在**篡改状态**(少了一段契约)
 * - `openapi.json.guardbak` 留在工作区里
 * - 而脚本崩在 `finally` 内部,没有任何一句话说明仓库已经被改坏了
 *
 * 这比它要防的漂移严重得多:**一个用来保证纪律的脚本,把仓库改坏了还不说。**
 *
 * ## 三处针对性的改动
 *
 * 1. **原文留在内存里,不落盘。** 没有 `.guardbak` 文件,也就没有「备份自己
 *    读不回来」这种失败模式,更不会在工作区留下残骸。
 * 2. **还原是 `writeFileSync` 而不是 `copyFileSync`,并且重试。**
 *    Windows 上这类 `UNKNOWN` 多半是杀软或索引器短暂占着文件 —— 退避重试几次
 *    就过去了。
 * 3. **还原真失败时,把话说满。** 打印出被改坏的文件与**可直接执行的恢复命令**,
 *    并让进程以非零码退出。静默地留下一个坏仓库是最不能接受的结局。
 *
 * ⚠️ 用 Buffer 而不是字符串:这里读写的可能是任意文件,按 utf8 往返会破坏
 * 非文本内容,也会悄悄改掉行尾。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs')
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc')

/**
 * 同步退避 —— 这些脚本整体是同步的,不值得为几毫秒改成异步。
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 尽最大努力把内容写回去。成功返回 true;重试用尽仍失败返回 false。
 *
 * 不在这里抛异常:调用方通常已经在 `finally` 里,再抛会盖掉真正的失败原因 ——
 * 而那正是这次事故里最难查的一点。
 *
 * @param {string} path
 * @param {Buffer} original
 * @param {number} [attempts]
 * @returns {boolean}
 */
function restoreOne(path, original, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      writeFileSync(path, original)
      return true
    } catch {
      if (i < attempts - 1) sleepSync(20 * 2 ** i)
    }
  }
  return false
}

/**
 * 快照一组文件、执行 `body`(期间可以随意改它们)、**无论如何还原**。
 *
 * 这是本模块的底座。适用于「同一个文件要被连续篡改好几次」的场景 ——
 * 契约冻结那组就是:删端点、删枚举值、加枚举值、加可选字段,四次连着来,
 * 每次之间都要回到原样。以前是每次 `copyFileSync(backup, target)`,
 * 现在原文一直在内存里,中间的还原也不再有失败的机会。
 *
 * @template T
 * @param {string[]} paths 要保护的绝对路径
 * @param {(restore: () => void) => T} body
 *   `restore()` 把所有文件恢复到快照状态,可在 `body` 内多次调用。
 * @returns {T}
 */
export function withRestoredFiles(paths, body) {
  const saved = paths.map((path) => ({ path, original: readFileSync(path) }))
  const restore = () => {
    for (const { path, original } of saved) writeFileSync(path, original)
  }
  try {
    return body(restore)
  } finally {
    finalRestore(saved)
  }
}

/**
 * 篡改一组文件、执行 `body`、无论如何还原。
 *
 * @template T
 * @param {{path: string, mutate: (original: string) => string}[]} edits
 *   每项:绝对路径 + 篡改函数(拿到 utf8 文本,返回新文本)。
 *   篡改函数返回原样时视为「锚点没匹配上」,由调用方判断那算不算失败。
 * @param {() => T} body 在篡改生效期间执行的检查
 * @returns {T}
 */
export function withMutatedFiles(edits, body) {
  /** @type {{path: string, original: Buffer}[]} */
  const saved = []
  try {
    for (const { path, mutate } of edits) {
      const original = readFileSync(path)
      saved.push({ path, original })
      writeFileSync(path, mutate(original.toString('utf8')), 'utf8')
    }
    return body()
  } finally {
    finalRestore(saved)
  }
}

/**
 * 跑一组 Vitest 目标,只关心红还是绿。
 *
 * ⚠️ **拉起 vitest 的路径只有这一条。** `verify-*.mjs` 不得自己拼
 * `vitest.mjs` 的路径 —— 由 `check-guards.mjs` 的「变异后跑测试必须同步 dist」
 * 守卫拦住。理由见 {@link runTestsUnderMutation}。
 *
 * @param {readonly string[]} targets 空数组 = 跑全量
 * @returns {{ red: boolean, unchanged: boolean, output?: string }}
 */
export function runVitest(targets = []) {
  try {
    execFileSync(process.execPath, [VITEST, 'run', ...targets], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { red: false, unchanged: false }
  } catch (error) {
    const e = /** @type {{stdout?: unknown, stderr?: unknown}} */ (error)
    return { red: true, unchanged: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/**
 * 把工作区的当前源码同步进各包的 `dist/`。
 *
 * 变异生效后必须调它,**否则跨包的消费方读到的还是旧 dist**(见
 * {@link runTestsUnderMutation} 的说明)。构建失败**不抛** —— 类型层探针
 * 故意制造编译错误,那种失败是信号不是故障;但要把结果返回给调用方,
 * 免得「没构建成功」被当成「构建过了」。
 *
 * @returns {boolean} 构建是否成功
 */
export function syncDist() {
  try {
    execFileSync(process.execPath, [TSC, '-b'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * ★ **在变异生效期间跑测试** —— 变异验证的唯一正确通路。
 *
 * ## 为什么这件事必须由工具做,而不是由人记得
 *
 * 各包的 `package.json` 把 `main` 指向 `./dist/index.js`,而 Vitest 没有
 * 把 `@dshwar/*` 指回 `src` 的 alias。于是:
 *
 * | 测试怎么 import | 变异改 src 后 |
 * | --- | --- |
 * | `../src/index.ts`(同包) | ✅ 立刻看得到 |
 * | `@dshwar/<pkg>`(跨包) | ❌ **读的是 dist,看不到** |
 *
 * 而 `check:all` 里 `typecheck`(`tsc -b`)跑在探针**之前** —— dist 是用
 * **未变异**的源码构建的。所以「改坏了跨包的东西,测试还是绿」有两种含义,
 * 而它们在输出里长得一模一样:
 *
 * 1. 断言弱(真问题)
 * 2. **根本没测到改动**(工具问题)
 *
 * 2026-08-17 实测撞到过一次:离线降级的网关 e2e 在拆掉可达性判定后仍然绿,
 * 重新构建 llm-local 之后才红。若当时按第 1 种含义去「加强断言」,
 * 就会基于误判改掉一条本来是对的断言。
 *
 * ## 还原之后也要重建
 *
 * 否则变异过的 dist 会留给下一条探针和开发者的下一次 `pnpm test` ——
 * 一个用来保证纪律的脚本把仓库改坏了还不说,正是本模块存在的理由。
 *
 * @param {{path: string, mutate: (original: string) => string}[]} edits
 * @param {readonly string[]} targets Vitest 目标
 * @returns {{ red: boolean, unchanged: boolean, output?: string, built: boolean }}
 */
export function runTestsUnderMutation(edits, targets) {
  try {
    return withMutatedFiles(edits, () => {
      const built = syncDist()
      return { ...runVitest(targets), built }
    })
  } finally {
    // 还原之后重建:不把变异的 dist 留给任何人
    syncDist()
  }
}

/**
 * 收尾还原 —— 失败时把话说满,并让进程非零退出。
 * @param {{path: string, original: Buffer}[]} saved
 */
function finalRestore(saved) {
  // 倒序还原:与写入顺序相反,和资源释放的惯例一致。
  const broken = []
  for (const { path, original } of [...saved].reverse()) {
    if (!restoreOne(path, original)) broken.push(path)
  }
  if (broken.length === 0) return

  console.error('')
  console.error('🚨 还原失败 —— 工作区里有文件被留在**篡改状态**:')
  for (const b of broken) console.error(`     ${b}`)
  console.error('')
  console.error('   立即执行以恢复(这些文件的改动全部来自本脚本,丢弃是安全的):')
  console.error(`     git checkout -- ${broken.join(' ')}`)
  console.error('')
  // 非零退出。安静地结束,等于把一个坏仓库交给下一个人。
  process.exitCode = 1
}
