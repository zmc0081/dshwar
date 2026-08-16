/**
 * 测试用的 worker 入口 —— 产品的 `runWorker`,加一个确定性假模型。
 *
 * **刻意不复制装配逻辑**:装配全部来自 `gateway/src/worker.ts` → `assembleRuntime()`,
 * 这里只补上 provider。若这里另起一套装配,「跨进程与进程内一致」这个对照就
 * 变成了在比较两份测试代码,而不是在比较两条产品路径。
 *
 * 由 `node --experimental-strip-types` 拉起(`tsconfig.base.json` 就是按这个用法配的)。
 */
import { runWorker } from '../../src/worker.ts'
import { FakeLlmAdapter } from '../harness.ts'

// 启动参数里带 --tokens 与 --delay,供取消测试控制节奏
const argv = process.argv.slice(2)
const at = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const tokens = (at('tokens') ?? '你好,世界').split('|')
const delayMs = Number(at('delay') ?? '0')

runWorker(process, {
  onReady: (runtime) => {
    const ctx = runtime.ctx as unknown as {
      llm: { registerAdapter(names: string[], adapter: unknown): void }
    }
    ctx.llm.registerAdapter(['fake'], new FakeLlmAdapter({ tokens, delayMs }))
  },
})
