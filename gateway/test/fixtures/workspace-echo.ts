/**
 * 冒烟用的最小 provider —— **把它解析到的工作区根当成输出吐出来**。
 *
 * 这样一来,「principal 有没有抵达 agent 执行层」这件事就能从**客户端那一侧**
 * 断言:HTTP → 网关 →(supervisor → 子进程 →)适配器 → fs-tenant → SSE。
 * 中间任何一环把 principal 弄丢,SSE 里的正文就会变成 `anonymous/anonymous`。
 *
 * 与 `principal-reach.test.ts` 不重复:那一个证明**服务层**拿得到 principal,
 * 这一个证明**真实请求路径**穿过网关之后确实拿到了。
 */
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { tenantWorkspaceRoot } from '@dshwar/fs-tenant'
import { ANONYMOUS, PRINCIPAL_BINDING, type Principal } from '@dshwar/principal'

/** 只声明本夹具用得到的那一点点 ctx 面。 */
export interface BindingSource {
  get(name: string): unknown
}

/**
 * 一个不需要任何 API key 的 provider。
 *
 * 它读**自己所在运行时的 principal 绑定**,算出工作区根,原样吐出来。
 * 进程档下那个绑定由 `assembleRuntime({ principal })` 钉在根上;
 * 逻辑单用户档下没有绑定,于是解析成 `ANONYMOUS` —— 两者都是正确形态,
 * 冒烟分别断言。
 */
export class WorkspaceEchoAdapter extends LlmAdapter {
  private readonly ctx: BindingSource
  private readonly root: string

  constructor(ctx: BindingSource, root: string) {
    super()
    this.ctx = ctx
    this.root = root
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 用 `get()` 而不是 `ctx.principal.current()`:后者要求访问方声明 inject,
    // 而适配器拿到的是构造时捕获的 ctx。语义相同 —— `current()` 内部读的
    // 就是这个槽位,兜底也是 ANONYMOUS。
    const bound = (this.ctx.get(PRINCIPAL_BINDING) as Principal | undefined) ?? ANONYMOUS
    const landing = tenantWorkspaceRoot(this.root, bound)
    // 只回相对部分 —— 绝对路径带临时目录名,断言起来噪音大
    const text = landing.slice(this.root.length).replace(/\\/g, '/')

    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
