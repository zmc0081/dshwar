/**
 * `maxProcesses` 的推导 —— V0.4.7 把固定值 64 换成按内存推导。
 *
 * ## 为什么这几条值得测
 *
 * 这个函数的输出**直接决定部署方的机器会不会 OOM**,而它错了不会有任何
 * 别的东西变红:进程池只是少建或多建几个进程,功能全部正常,直到某天
 * 内存吃穿、OOM killer 随机挑一个进程杀掉(可能是网关自己)。
 *
 * 所以三类边界都要钉住:小机器(会不会算出 0)、大机器(会不会失控)、
 * 以及那个决定一切的常量有没有被人顺手改掉。
 */
import { describe, expect, it } from 'vitest'
import {
  deriveMaxProcesses,
  GATEWAY_BASELINE_RSS_MB,
  MAX_PROCESSES_CEILING,
  MEMORY_BUDGET_FRACTION,
  RSS_PER_PROCESS_MB,
} from '../src/cost.ts'

const GB = 1024 * 1024 * 1024

describe('maxProcesses 按内存推导', () => {
  it('8 GB 机器:推导值恰好落在旧的固定值上 —— 旧默认不是处处都错', () => {
    // 8192 × 0.6 ÷ 63 = 78,被上限截到 64。
    // 记这一条是为了说清**旧默认错在哪**:它不是数值选错了,
    // 是它对所有机器给同一个数。8 GB 上它恰好合适,而那正是它看起来
    // 一直没问题的原因 —— 开发机通常不小。问题出在小机器上,见下一条。
    const r = deriveMaxProcesses(8 * GB)
    expect(r.value).toBe(MAX_PROCESSES_CEILING)
    expect(r.cappedByCeiling).toBe(true)
  })

  it('★ 4 GB 机器:旧的固定值 64 会吃穿,推导值不会', () => {
    const r = deriveMaxProcesses(4 * GB)

    // 4096 × 0.6 ÷ 63 = 39
    expect(r.value).toBe(39)
    expect(r.value).toBeLessThan(MAX_PROCESSES_CEILING)

    // ★ 旧默认值的失败形态**不是**「子进程装不下」——64 × 63 = 4032 MB,
    // 在 4096 MB 里刚好塞得下。它的失败是**塞下之后什么都不剩**:
    // 余量 64 MB,连网关自身(实测 78 MB)都放不下,操作系统更没算。
    //
    // 这正是固定值最难发现的地方:算术上「够」,实际一起就 OOM。
    const oldLeftoverMb = 4096 - 64 * RSS_PER_PROCESS_MB
    expect(
      oldLeftoverMb,
      `余量 ${oldLeftoverMb} MB,网关自己要 ${GATEWAY_BASELINE_RSS_MB} MB`,
    ).toBeLessThan(GATEWAY_BASELINE_RSS_MB)

    // 推导值留下的余量要够养活网关与 OS
    const derivedNeedsMb = r.value * RSS_PER_PROCESS_MB
    expect(4096 - derivedNeedsMb).toBeGreaterThan(1024)
  })

  it('内存极小的机器抬到 1,并标记出来 —— 而不是返回 0', () => {
    // 进程池为 0 谁也服务不了,那种「配置成功但一个请求都处理不了」
    // 比启动失败更难排查。
    const r = deriveMaxProcesses(64 * 1024 * 1024)
    expect(r.value).toBe(1)
    expect(r.raisedToFloor).toBe(true)
    expect(r.basis).toContain('跑不动进程隔离')
  })

  it('大内存机器被上限截断,并说明内存不是瓶颈', () => {
    const r = deriveMaxProcesses(256 * GB)
    expect(r.value).toBe(MAX_PROCESSES_CEILING)
    expect(r.cappedByCeiling).toBe(true)
    expect(r.basis).toContain('显式配置')
  })

  it('推导单调不减 —— 内存更大不该算出更少的进程', () => {
    let previous = 0
    for (const gb of [1, 2, 4, 8, 16, 32, 64]) {
      const { value } = deriveMaxProcesses(gb * GB)
      expect(value, `${gb} GB 上算出的值比更小的机器还少`).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('basis 里带得出推导过程,而不只是结果', () => {
    // 一个说不出理由的默认值,部署方只能选择盲信或盲改。
    const { basis } = deriveMaxProcesses(4 * GB)
    expect(basis).toContain('4096')
    expect(basis).toContain(String(MEMORY_BUDGET_FRACTION))
    expect(basis).toContain(String(RSS_PER_PROCESS_MB))
  })

  it('🔒 每进程开销就是 CI 性能门禁的那个实测值', () => {
    // 这一条不是在测函数,是在钉常量:它同时被 maxProcesses 推导与
    // scripts/measure-process-cost.mjs 的阈值基准使用。
    // 有人顺手改了这里而没重测,门禁会继续绿着,默认值却已经错了。
    expect(
      RSS_PER_PROCESS_MB,
      '改这个值请先跑 node scripts/measure-process-cost.mjs,并同步 docs/DECISIONS/process-cost-thresholds.md',
    ).toBe(63)
  })
})
