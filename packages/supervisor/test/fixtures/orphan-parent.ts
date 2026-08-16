/**
 * 「父进程退出时子进程不残留」的被测方。
 *
 * 起两个子进程,把它们的 pid 打到 stdout,然后**直接退出** —— 不调 dispose()。
 * 不调是刻意的:调了当然干净,而残留恰恰发生在**没来得及**收尾的时候
 * (崩溃、被 kill、未捕获异常)。测试要覆盖的是那种情况。
 *
 * 用 `node --experimental-strip-types` 直接跑源码 —— `tsconfig.base.json`
 * 就是按这个用法配的(相对导入写 `.ts` 后缀)。
 */
import { createPrincipal } from '@dshwar/principal'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { forkLauncher } from '../../src/launcher.ts'
import { Supervisor } from '../../src/supervisor.ts'

const child = join(dirname(fileURLToPath(import.meta.url)), 'echo-child.mjs')

const supervisor = new Supervisor({
  launcher: forkLauncher(child),
  profile: 'gateway',
  maxProcesses: 8,
  idleTimeoutMs: 600_000,
})

const pids = [
  supervisor.acquire(createPrincipal({ id: 'u-one', tenantId: 'acme' })).pid,
  supervisor.acquire(createPrincipal({ id: 'u-two', tenantId: 'acme' })).pid,
]

process.stdout.write(`${JSON.stringify(pids)}\n`)

// 给子进程一点时间真正起来,然后不收尾直接退出
setTimeout(() => process.exit(0), 300)
