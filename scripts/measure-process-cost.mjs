#!/usr/bin/env node
/**
 * 进程隔离的两项代价 —— 冷启动与常驻内存的常驻测量。
 *
 * ## 为什么要有这个脚本
 *
 * V0.4.5 Session 0 在 Windows 开发机上手工量过一次:**约 115 ms / 58 MB**。
 * 那两个数字随后被三处引用:
 *
 * 1. `README.md` 的规模对照表(5 / 20 / 50 / 200 人各要多少内存)
 * 2. `gateway.config.example.json` 与 profiles 里 `maxProcesses` 的默认值
 * 3. `docs/DEPLOYMENT.md` 的容量规划一节
 *
 * 采用者照着它们配置服务器。**一次让内存翻倍的改动会让这三处同时变成谎话**,
 * 而谁都不会注意到 —— 内存不会让测试变红。所以它必须是一道门禁,不是一次测量。
 *
 * ## 口径必须与 V0.4.5 那次可比
 *
 * 否则 Linux 与 Windows 的差异分不清是**平台差异**还是**测法差异**。
 * 三条对齐:
 *
 * - **五次采样,全部保留、全部报告。** 不丢弃第一次 —— V0.4.5 那次也没丢,
 *   而第一次通常最慢(冷缓存)。丢掉它会让数字变好看,但那是另一个口径了。
 * - **冷启动由父进程侧墙钟测量**(`fork()` → 收到 `ready`)。
 *   ⚠️ 这是 V0.4.5 踩过的坑:子进程内的 `Date.now() - t0`(`t0` 取模块体顶部)
 *   量出来只有 10 ms,**差十倍** —— 因为 ESM 的 import 在模块体执行之前就求值完了,
 *   那个数不含进程创建、Node 引导与模块加载。
 * - **同一个子进程夹具**(`adapters/dsh-0.1.0/test/fixtures/child-agent.mjs`),
 *   装配 `GATEWAY_PLUGINS` 的全部 11 个插件。少装几个量出来的数字偏乐观。
 *
 * ## 判据取中位数,不取均值
 *
 * GitHub 的共享 runner 是吵的:偶尔一次调度抖动能让单次采样翻倍。
 * 均值会被那一次拖走,中位数不会。**这道门禁要抓的是「改动让代价翻倍」,
 * 不是「今天这台机器忙」** —— 后者的红没有信息量,而没有信息量的红
 * 会训练人去忽略它,那比没有门禁更糟。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/measure-process-cost.mjs                    # 只测量,不判定
 * node scripts/measure-process-cost.mjs --assert           # 用内置阈值判定
 * node scripts/measure-process-cost.mjs --samples 9        # 改采样次数
 * ```
 *
 * 阈值的定法见 `docs/DECISIONS/process-cost-thresholds.md`。
 */
import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHILD = join(REPO, 'adapters', 'dsh-0.1.0', 'test', 'fixtures', 'child-agent.mjs')
const GATEWAY_FIXTURE = join(REPO, 'scripts', 'fixtures', 'gateway-baseline.mjs')

// ★ 每进程开销的**唯一来源**。这里 import 而不是再抄一个 63:
// 推导 maxProcesses 的是它,校验实测有没有漂移的也是它 ——
// 两处若各写各的,门禁绿着而默认值已经错了,谁都不会发现。
const { RSS_PER_PROCESS_MB } = await import('@dshwar/supervisor')

// ---------------------------------------------------------------------------
// 阈值
//
// ⚠️ **这些是回归探测器,不是性能规格。** 它们不说「DSHWAR 保证 X ms」,
// 只说「比实测基线慢/胖到这个程度,一定是有人改坏了什么」。
// 依据与倍数的选法写在 docs/DECISIONS/process-cost-thresholds.md,
// 改这里的数字之前请先读那份文档 —— 放宽阈值是这道门禁唯一的失效方式。
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  // 实测中位数 × 系数(冷启动 2.5 吸收 runner 噪声,RSS 1.5 —— 内存是稳的)。
  // linux:  86 ms / 63 MB —— GitHub ubuntu-latest, Node 22, 2026-08-16
  // win32: 127 ms / 55 MB —— Windows 11 Pro 26200, Node 24, 同日
  linux: { coldStartMs: 215, rssMb: 95 },
  win32: { coldStartMs: 318, rssMb: 83 },
  // darwin 刻意没有条目 —— 没有实测基线,拿别的平台的数去卡红了也说明不了问题。
  // 脚本在缺条目时跳过判定,而不是回退到某个默认值。
}

const argv = process.argv.slice(2)
const shouldAssert = argv.includes('--assert')
const samples = Number(argv[argv.indexOf('--samples') + 1]) || 5

/** 拉起一次子进程,量到它报 `ready` 为止,然后杀掉。 */
function measureOnce() {
  return new Promise((resolveSample, rejectSample) => {
    // ★ 计时从这里开始 —— 含进程创建、Node 引导、模块加载、插件装配。
    const forkedAt = Date.now()
    const child = fork(CHILD, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })

    const deadline = setTimeout(() => {
      child.kill('SIGKILL')
      rejectSample(new Error('子进程 15 秒内没有报 ready'))
    }, 15_000)

    child.on('message', (raw) => {
      const msg = /** @type {{type: string, assembleMs?: number, rssBytes?: number}} */ (raw)
      if (msg.type !== 'ready') return
      clearTimeout(deadline)
      const coldStartMs = Date.now() - forkedAt
      child.kill('SIGKILL')
      resolveSample({
        coldStartMs,
        assembleMs: msg.assembleMs ?? -1,
        rssMb: Math.round((msg.rssBytes ?? 0) / 1024 / 1024),
      })
    })

    child.on('error', (error) => {
      clearTimeout(deadline)
      rejectSample(error)
    })
    child.on('exit', (code, signal) => {
      // 只有还没量到 ready 就退出才算失败;量到之后是我们自己杀的。
      clearTimeout(deadline)
      if (signal !== 'SIGKILL') rejectSample(new Error(`子进程提前退出:code=${code}`))
    })

    child.send({ type: 'start', principalId: 'perf', tenantId: 'perf', tokens: ['x'], delayMs: 0 })
  })
}

/**
 * 量一次网关自身的空载常驻。拿不到时返回 -1(不算失败,理由见调用处)。
 *
 * 只量一次而不是五次:内存这个量很稳(子进程两次 CI 采样波动 ±1.6%),
 * 而它不进门禁判定 —— 它服务的是文档里的**口径说明**,精度要求低一档。
 */
function measureGatewayBaseline() {
  if (!existsSync(GATEWAY_FIXTURE)) return Promise.resolve(-1)
  return new Promise((resolveOne) => {
    const child = fork(GATEWAY_FIXTURE, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const deadline = setTimeout(() => {
      child.kill('SIGKILL')
      resolveOne(-1)
    }, 30_000)
    child.on('message', (raw) => {
      const msg = /** @type {{type: string, rssBytes?: number}} */ (raw)
      if (msg.type !== 'ready') return
      clearTimeout(deadline)
      child.kill('SIGKILL')
      resolveOne(Math.round((msg.rssBytes ?? 0) / 1024 / 1024))
    })
    child.on('error', () => {
      clearTimeout(deadline)
      resolveOne(-1)
    })
    child.on('exit', (_code, signal) => {
      if (signal === 'SIGKILL') return
      clearTimeout(deadline)
      resolveOne(-1)
    })
  })
}

/** 中位数。偶数个取中间两个的均值。 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

if (!existsSync(CHILD)) {
  console.error(`找不到子进程夹具:${CHILD}`)
  process.exit(1)
}

const platform = process.platform
console.log('DSHWAR · 进程隔离代价测量\n')
console.log(`平台      ${platform} · Node ${process.version}`)
console.log(`采样      ${samples} 次(全部保留,不丢弃预热)\n`)

const results = []
for (let i = 0; i < samples; i += 1) {
  // 串行,不并行 —— 并行采样会互相争 CPU,量出来的是争抢而不是成本。
  results.push(await measureOnce())
}

console.log('| 次  | 冷启动(父进程墙钟) | 插件装配(子进程自报) | 常驻 RSS |')
console.log('| --- | ------------------ | -------------------- | -------- |')
results.forEach((r, i) => {
  console.log(
    `| ${String(i + 1).padEnd(3)} | ${String(`${r.coldStartMs} ms`).padEnd(18)} | ` +
      `${String(`${r.assembleMs} ms`).padEnd(20)} | ${String(`${r.rssMb} MB`).padEnd(8)} |`,
  )
})

const coldStartMs = median(results.map((r) => r.coldStartMs))
const rssMb = median(results.map((r) => r.rssMb))
const assembleMs = median(results.map((r) => r.assembleMs))

console.log('')
console.log(`中位数    冷启动 ${coldStartMs} ms(其中插件装配 ${assembleMs} ms),常驻 ${rssMb} MB`)

// ---------------------------------------------------------------------------
// 网关自身的常驻 —— 容量规划的**口径**问题
//
// 上面那个 RSS 只含子进程。README 的规模对照表(50 人 ≈ 3.2 GB)也只是
// 子进程的总和 —— 网关自己不在里面,OS 更不在。照着 3.2 GB 去配一台 4 GB
// 的机器会撞穿,而那正是容量表最该防住的事。
//
// 量出这一块,`MEMORY_BUDGET_FRACTION = 0.6` 的那 40% 留白才有据可查。
// ---------------------------------------------------------------------------
const gatewayRssMb = await measureGatewayBaseline()
if (gatewayRssMb > 0) {
  console.log(`网关自身  ${gatewayRssMb} MB(空载基线,不含任何子进程)`)
  console.log(
    `口径      「N 人 × ${RSS_PER_PROCESS_MB} MB」**只算子进程** —— ` +
      `实际还要加网关 ${gatewayRssMb} MB 与操作系统`,
  )
} else {
  // 拿不到不算失败:这个数服务于文档口径,不是门禁判据。
  // 但要说出来 —— 静默跳过会让人以为它量过了。
  console.log('网关自身  未测到(需先 pnpm build;不影响下面的门禁判定)')
}

// GitHub Actions 的**注解**。摘要页(下面那段)要点进 run 才看得到,而注解
// 直接挂在提交与 PR 上 —— 数字要有人看才有价值,埋在日志里的数字等于没量。
//
// 顺带一个实际好处:注解走 `check-runs/{id}/annotations`,那个端点对公开仓库
// **免认证可读**,而 job 日志需要 admin 权限。于是这两个数在仓库外也拿得到。
if (process.env['GITHUB_ACTIONS'] === 'true') {
  console.log(
    `::notice title=进程隔离代价::冷启动 ${coldStartMs} ms · 子进程常驻 ${rssMb} MB · ` +
      `网关自身 ${gatewayRssMb > 0 ? `${gatewayRssMb} MB` : '未测'} · ` +
      `插件装配 ${assembleMs} ms(${platform} · Node ${process.version} · ${samples} 次采样中位数)`,
  )
}

// GitHub Actions 的摘要页 —— 让数字不用翻日志就看得到,趋势也才有人看。
if (process.env['GITHUB_STEP_SUMMARY'] !== undefined) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(
    process.env['GITHUB_STEP_SUMMARY'],
    `### 进程隔离代价(${platform} · Node ${process.version})\n\n` +
      `**冷启动 ${coldStartMs} ms · 常驻 ${rssMb} MB**(${samples} 次采样的中位数)\n\n` +
      `| 次 | 冷启动 | 插件装配 | RSS |\n| --- | --- | --- | --- |\n` +
      results
        .map((r, i) => `| ${i + 1} | ${r.coldStartMs} ms | ${r.assembleMs} ms | ${r.rssMb} MB |`)
        .join('\n') +
      '\n',
  )
}

if (!shouldAssert) {
  console.log('\n(未带 --assert,只测量不判定)')
  process.exit(0)
}

const limit = THRESHOLDS[platform]
if (limit === undefined) {
  // 没有基线的平台上不判定 —— 拿别的平台的阈值去卡,红了也说明不了问题。
  console.log(`\n平台 ${platform} 没有基线阈值,跳过判定。`)
  process.exit(0)
}

console.log(`\n阈值      冷启动 ≤ ${limit.coldStartMs} ms · 常驻 ≤ ${limit.rssMb} MB`)
const failures = []
if (coldStartMs > limit.coldStartMs) {
  failures.push(`冷启动中位数 ${coldStartMs} ms 超过阈值 ${limit.coldStartMs} ms`)
}
if (rssMb > limit.rssMb) {
  failures.push(`常驻内存中位数 ${rssMb} MB 超过阈值 ${limit.rssMb} MB`)
}

if (failures.length > 0) {
  console.log('\n❌ 进程隔离的代价超出阈值:')
  for (const f of failures) console.log(`  ${f}`)
  console.log('\n这三处文档由这两个数推出,现在它们可能已经是错的:')
  console.log('  - README.md 的规模对照表(5 / 20 / 50 / 200 人)')
  console.log('  - gateway.config.example.json 与 profiles 的 maxProcesses 默认值')
  console.log('  - docs/DEPLOYMENT.md 的容量规划')
  console.log('\n先查清楚是什么改动导致的。**放宽阈值是最后手段,不是第一反应** ——')
  console.log('阈值放宽一次,这道门禁就再也抓不到下一次翻倍。')
  process.exit(1)
}

console.log('\n✅ 在阈值内。')
