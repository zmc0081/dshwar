/**
 * 最小子进程 —— 只做协议这一层,不装 harness。
 *
 * 这里要验的是 launcher 与进程池,不是 agent 驱动(那是 Session 2)。
 * 装 harness 会把每条断言的耗时从 ~20 ms 抬到 ~115 ms,却测不到任何新东西。
 *
 * 启动参数:`--principal <id> --tenant <id> --profile <name>`
 *
 * ⚠️ 本文件受 `checkJs` 检查(见 `../../tsconfig.test.json`)。
 * JS 的推断比 TS 弱,所以跨 IPC 边界的入参需要 JSDoc 补一个形状 ——
 * 那正是「不受检查的夹具会静默走形」这个问题的成本,很便宜。
 */
import { spawn } from 'node:child_process'

/** @typedef {{ leaseId: string, kind: 'work' | 'cancel' | 'ping', payload?: unknown }} ParentMessage */

const args = process.argv.slice(2)
/** @param {string} name */
const argOf = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const identity = {
  principalId: argOf('principal'),
  tenantId: argOf('tenant'),
  profile: argOf('profile'),
}

process.on('message', (/** @type {ParentMessage} */ msg) => {
  if (msg?.kind === 'ping') {
    process.send?.({ leaseId: msg.leaseId, kind: 'pong' })
    return
  }
  if (msg?.kind === 'work' && msg.payload !== '#nest') {
    // 把身份原样回传 —— 父进程据此断言「子进程只认那一个 principal」
    process.send?.({
      leaseId: msg.leaseId,
      kind: 'event',
      payload: { echo: msg.payload, identity },
    })
    return
  }
  if (msg?.kind === 'cancel') {
    process.send?.({ leaseId: msg.leaseId, kind: 'event', payload: { cancelled: true } })
  }
})

/**
 * 两层嵌套:supervisor 的子进程自己再拉起一个进程。
 *
 * agent 的 shell 工具正是这么干的 —— 若 supervisor 的子进程拉不起孙进程,
 * 进程隔离下 agent 就没有执行能力,这一版等于白做。
 */
process.on('message', (/** @type {ParentMessage} */ msg) => {
  if (msg?.kind !== 'work' || msg.payload !== '#nest') return
  const grand = spawn(process.execPath, ['-e', 'process.stdout.write("grandchild-ok")'])
  let out = ''
  grand.stdout?.on('data', (/** @type {unknown} */ d) => (out += String(d)))
  grand.on('exit', (/** @type {number | null} */ code) => {
    process.send?.({
      leaseId: msg.leaseId,
      kind: 'event',
      payload: { nested: out, exitCode: code },
    })
  })
})

// 不主动退出 —— 等父进程回收。SIGTERM 的默认处置就是退出。
setInterval(() => {}, 1 << 30)
