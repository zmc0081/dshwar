/**
 * 测试用的 worker 入口 —— 产品的 `runWorker`,加一个确定性假模型。
 *
 * **刻意不复制装配逻辑**:装配全部来自 `gateway/src/worker.ts` → `assembleRuntime()`,
 * 这里只补上 provider。若这里另起一套装配,「跨进程与进程内一致」这个对照就
 * 变成了在比较两份测试代码,而不是在比较两条产品路径。
 *
 * 由 `node --experimental-strip-types` 拉起(`tsconfig.base.json` 就是按这个用法配的)。
 */
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { runWorker } from '../../src/worker.ts'
import { WorkspaceEchoAdapter } from './workspace-echo.ts'
import { FakeLlmAdapter } from '../harness.ts'

/** 一开口就炸 —— 用来验证 agent/error 能不能穿过进程边界。 */
class ExplodingAdapter extends LlmAdapter {
  // eslint-disable-next-line require-yield
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('模型炸了')
  }
}

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
    ctx.llm.registerAdapter(['boom'], new ExplodingAdapter())
    // 冒烟用:把解析到的工作区根吐回客户端。子进程的根 ctx 上有
    // assembleRuntime({ principal }) 钉下的绑定 —— 这条链路正是要证的东西。
    const workspaceRoot = at('workspace-root')
    if (workspaceRoot !== undefined) {
      ctx.llm.registerAdapter(
        ['echo-workspace'],
        new WorkspaceEchoAdapter(ctx as unknown as { get(n: string): unknown }, workspaceRoot),
      )
    }
  },
})
