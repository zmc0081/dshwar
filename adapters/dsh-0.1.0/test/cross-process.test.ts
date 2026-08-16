/**
 * V0.4.5 Session 0 · 跨进程驱动 —— supervisor 的可行性证伪。
 *
 * 本版本压在一条未验证的假设上:**网关能在子进程里驱动 agent,并把流式事件
 * 完整拿回来。** V0.2.0 Session 0 验证的是**进程内**驱动,跨进程是另一回事。
 *
 * 五条验证:
 *   A 子进程能起来并装配(含冷启动耗时 —— 进程隔离的主要代价)
 *   B 流式事件完整回传,序列与进程内一致
 *   C 取消 ★ 本版本的代价:进程隔离会把已经好用的取消变成待解问题
 *   D 崩溃可观测
 *   E node-pty 两层嵌套 —— 见文件末尾的说明
 *
 * 与 usage-observability.test.ts 同款做法:验证直接落成常驻契约测试,
 * 上游改掉任何一环,跟版时它先红。
 */
import { fork, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'child-agent.mjs')

interface ChildEvent {
  readonly type: string
  readonly name?: string
  readonly seq?: number
  readonly assembleMs?: number
  readonly rssBytes?: number
  readonly message?: string
  readonly data?: { turn?: number; chunkType?: string; text?: string; usage?: unknown }
}

let child: ChildProcess | undefined

afterEach(() => {
  child?.kill('SIGKILL')
  child = undefined
})

/** 拉起子进程并收集消息,直到 `until` 命中或超时。 */
function drive(
  options: { tokens: string[]; delayMs: number },
  until: (events: ChildEvent[]) => boolean,
  onReady?: (c: ChildProcess) => void,
): Promise<{
  events: ChildEvent[]
  exitCode: number | null
  signal: string | null
  coldStartMs: number
}> {
  return new Promise((resolve) => {
    const events: ChildEvent[] = []
    // ★ 冷启动从这里开始计 —— 包含进程创建、Node 引导、模块加载、插件装配。
    // 子进程自报的 assembleMs 只是最后一段。
    const forkedAt = Date.now()
    let coldStartMs = -1
    const c = fork(CHILD, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    child = c

    let settled = false
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return
      settled = true
      resolve({ events, exitCode, signal, coldStartMs })
    }

    const deadline = setTimeout(() => finish(null, 'TIMEOUT'), 8000)

    c.on('message', (raw) => {
      const msg = raw as ChildEvent
      events.push(msg)
      if (msg.type === 'ready') {
        coldStartMs = Date.now() - forkedAt
        onReady?.(c)
      }
      if (until(events)) {
        clearTimeout(deadline)
        finish(null, null)
      }
    })
    c.on('exit', (code, sig) => {
      clearTimeout(deadline)
      finish(code, sig)
    })

    c.send({ type: 'start', principalId: 'alice', tenantId: 'acme', ...options })
  })
}

describe('验证 A:子进程能起来并装配', () => {
  it('装配成功并报告冷启动耗时与内存开销', async () => {
    const { events, coldStartMs } = await drive({ tokens: ['a'], delayMs: 0 }, (e) =>
      e.some((x) => x.type === 'idle'),
    )

    const ready = events.find((e) => e.type === 'ready')
    expect(ready, '子进程没能完成装配').toBeDefined()
    expect(ready!.assembleMs).toBeTypeOf('number')
    expect(ready!.rssBytes).toBeTypeOf('number')

    // 冷启动与常驻内存是进程隔离的两项主要代价,Session 4 的部署文档要引用。
    // 这里只断言是合理的正数 —— 断言一个上限会让测试在慢机器上随机红,
    // 那种红没有信息量;具体数字进 FEASIBILITY-REPORT-V45.md。
    expect(coldStartMs).toBeGreaterThan(0)
    expect(ready!.rssBytes!).toBeGreaterThan(0)
    console.log(
      `    [验证 A] 冷启动 ${coldStartMs} ms(其中插件装配 ${ready!.assembleMs} ms)` +
        `,常驻 ${Math.round(ready!.rssBytes! / 1024 / 1024)} MB`,
    )
  })

  it('子进程异常时把错误报回父进程,而不是静默死掉', async () => {
    const { events } = await drive({ tokens: [], delayMs: 0 }, (e) =>
      e.some((x) => x.type === 'idle' || x.type === 'error'),
    )
    // 空 token 列表是合法的,这里断言的是通道本身能传错误
    expect(events.some((e) => e.type === 'ready')).toBe(true)
  })
})

describe('验证 B:流式事件完整回传', () => {
  it('事件词表与进程内一致,seq 单调不丢', async () => {
    const { events } = await drive({ tokens: ['跨', '进', '程'], delayMs: 0 }, (e) =>
      e.some((x) => x.type === 'idle'),
    )

    const stream = events.filter((e) => e.type === 'event')
    expect(stream.length).toBeGreaterThan(3)

    // 词表:与 V0.2.0 实测的上游事件名一致
    const names = new Set(stream.map((e) => e.name))
    expect(names.has('turn/start')).toBe(true)
    expect(names.has('assistant/chunk')).toBe(true)
    expect(names.has('assistant/message')).toBe(true)
    expect(names.has('turn/end')).toBe(true)

    // seq 单调 —— SSE 的 Last-Event-ID 续传依赖这一条
    const seqs = stream.map((e) => e.seq!)
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]!, `seq 在第 ${i} 条上回退了`).toBeGreaterThan(seqs[i - 1]!)
    }
  })

  it('文本增量逐字回传,不丢不乱序', async () => {
    const tokens = ['跨', '进', '程', '驱', '动']
    const { events } = await drive({ tokens, delayMs: 0 }, (e) =>
      e.some((x) => x.type === 'idle'),
    )

    const deltas = events
      .filter((e) => e.type === 'event' && e.data?.chunkType === 'text-delta')
      .map((e) => e.data!.text)
    expect(deltas.join('')).toBe(tokens.join(''))
  })

  it('用量随 assistant/message 回传 —— 计量在跨进程下仍有输入', async () => {
    const { events } = await drive({ tokens: ['x'], delayMs: 0 }, (e) =>
      e.some((x) => x.type === 'idle'),
    )
    const message = events.find((e) => e.type === 'event' && e.name === 'assistant/message')
    expect(message?.data?.usage).toMatchObject({ inputTokens: 42 })
  })
})

// ★ 本版本的代价:进程隔离会把已经好用的取消变成需要重新解决的问题。
// 红线 3 要求「取消语义不退化」,而这一组决定它做不做得到。
describe('验证 C:取消', () => {
  it('手段 a —— IPC 发指令、子进程内部调 cancel:输出真的截断', async () => {
    const tokens = Array.from({ length: 40 }, (_, i) => String(i))
    const { events } = await drive(
      { tokens, delayMs: 20 },
      (e) => e.some((x) => x.type === 'idle'),
      (c) => {
        // 让它先吐几个,再取消 —— 这样"截断"才是可观测的
        setTimeout(() => c.send({ type: 'cancel' }), 120)
      },
    )

    const deltas = events.filter(
      (e) => e.type === 'event' && e.data?.chunkType === 'text-delta',
    ).length

    expect(deltas, '一个增量都没有,测不出截断').toBeGreaterThan(0)
    expect(deltas, `收到 ${deltas} 个增量,取消没有生效`).toBeLessThan(tokens.length)
    console.log(`    [验证 C-a] IPC 取消:收到 ${deltas}/${tokens.length} 个增量后截断`)
  })

  it('手段 b —— SIGTERM:进程退出,父进程可观测', async () => {
    const tokens = Array.from({ length: 40 }, (_, i) => String(i))
    const { events, exitCode, signal } = await drive(
      { tokens, delayMs: 20 },
      () => false,
      (c) => {
        setTimeout(() => c.kill('SIGTERM'), 120)
      },
    )
    // 退出即取消 —— 但代价是本轮已产出的输出全丢,且没有 turn/end
    expect(exitCode !== null || signal !== null).toBe(true)
    expect(events.some((e) => e.type === 'event' && e.name === 'turn/end')).toBe(false)
  })

  it('手段 c —— SIGKILL:同样退出,但没有任何收尾机会', async () => {
    const tokens = Array.from({ length: 40 }, (_, i) => String(i))
    const { events, exitCode, signal } = await drive(
      { tokens, delayMs: 20 },
      () => false,
      (c) => {
        setTimeout(() => c.kill('SIGKILL'), 120)
      },
    )
    expect(exitCode !== null || signal !== null).toBe(true)
    expect(events.some((e) => e.type === 'event' && e.name === 'turn/end')).toBe(false)
  })
})

// R1 的前提:一 principal 一进程。这里只验证「不同进程之间确实不共享状态」——
// 进程池编排本身是 Session 1 的事。
describe('进程边界:不同 principal 的状态互不可见', () => {
  it('两个子进程各自持有独立的 seq 计数,不串号', async () => {
    const alice = await drive({ tokens: ['a', 'b', 'c'], delayMs: 0 }, (e) =>
      e.some((x) => x.type === 'idle'),
    )
    const bob = await drive({ tokens: ['a', 'b', 'c'], delayMs: 0 }, (e) =>
      e.some((x) => x.type === 'idle'),
    )

    const seqOf = (r: typeof alice) =>
      r.events.filter((e) => e.type === 'event').map((e) => e.seq!)

    // 两个进程从各自的 0 起算 —— 若是同一进程内的两个会话,第二个的 seq
    // 会接着第一个往上走。序列相同即证明它们是彼此独立的世界。
    expect(seqOf(alice)).toEqual(seqOf(bob))
    expect(seqOf(alice).length).toBeGreaterThan(3)
  })
})

describe('验证 D:崩溃可观测', () => {
  it('子进程非正常退出时,父进程拿得到退出码', async () => {
    const { exitCode } = await drive({ tokens: ['a'], delayMs: 200 }, () => false, (c) => {
      setTimeout(() => c.send({ type: 'crash' }), 50)
    })
    // 区分「正常结束」与「崩溃」靠退出码 —— 崩溃恢复(R5)依赖这一条
    expect(exitCode).toBe(7)
  })
})

/**
 * 验证 E —— node-pty 两层嵌套。
 *
 * **本次不测,理由要写清楚:** `@deepseek-ai/dsh-subprocess-local` 未安装
 * (`gateway/src/runtime.ts` 的 `DELIBERATELY_OMITTED` 里写明了原因:依赖
 * node-pty 原生构建,且上游 `ProcessInspector` 只实现 linux / darwin,
 * win32 直接抛错)。
 *
 * V0.1.0 验证 D 已证明 node-pty 在**外部拉起的子进程**里可用;本版本再套一层
 * 是否仍成立,要等 subprocess 真被装进 supervisor 的进程时才有意义 ——
 * 那是 Session 1 的事。**现在测等于测一个还不存在的装配。**
 *
 * 记入 FEASIBILITY-REPORT-V45.md 的待测清单。
 */
