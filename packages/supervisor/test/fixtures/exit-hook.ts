/**
 * 退出钩子的被测方 —— **不用真子进程**。
 *
 * 为什么不用真子进程:本机(以及 CI 的容器)把测试进程放在一个会连坐清理的
 * 作用域里(Windows Job Object / Linux cgroup),无人认领的子进程**也**会随
 * 父进程消失。于是「子进程没了」这个观测无法区分「守卫起作用」与
 * 「沙箱替我收了尸」—— 那样的断言在生产环境失效时不会变红,毫无价值。
 *
 * 所以这里直接验机制:登记一个假子进程,退出,看 `kill` 有没有被调到。
 * 平台无关,且守卫一旦被摘掉就立刻变红。
 *
 * 用法:`node --experimental-strip-types exit-hook.ts [--no-track]`
 */
import { writeSync } from 'node:fs'
import { trackChild, type ChildProcessLike } from '../../src/launcher.ts'

const fake: ChildProcessLike = {
  pid: 4242,
  send() {},
  kill(signal) {
    // exit 回调里只能同步写 —— process.stdout.write 在此时不保证落地
    writeSync(1, `KILLED:${signal}\n`)
  },
  on() {},
}

if (!process.argv.includes('--no-track')) trackChild(fake)

process.exit(0)
