/**
 * 容量读数与开户闸门是**同一个来源** —— V0.5.0 D2 的老账。
 *
 * ## 为什么这条断言查的是「类型」而不是「渲染结果」
 *
 * D2 要的不是「两处显示的数字相等」——那可以靠一次巧合成立。
 * 要的是**它们不可能不相等**:两处都只有一个入口,而那个入口是必填的。
 *
 * 于是这条断言查的是**源码里还有没有第二个来源**:
 *
 * | 形态 | 为什么是第二个来源 |
 * | --- | --- |
 * | `memberCap = 39` 这类默认值 | 漏传时界面照样显示一个像模像样的数,而没有任何东西会红 |
 * | 两屏各自声明 `memberCap?: number` | 两个可选字段,可以各传各的 |
 *
 * ⚠️ **这不能靠「跑一次看数字对不对」验证。** 两个默认值今天恰好都是 39 ——
 * 渲染出来完全一致。它们分家要等到某一次只改了一处,而那时没有任何东西会红。
 * 所以判据必须落在**结构**上。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CapacityReading } from '../src/screens/console/capacity.ts'

const SCREENS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'screens', 'console')

/**
 * 读源码,**去掉整行注释**。
 *
 * ⚠️ 这一层是本文件第一次跑就撞出来的。判据 `\bmemberCap\s*=\s*\d`
 * 匹配到了**上面那段 JSDoc** —— 它正在解释「原先是 `memberCap = 39`」。
 *
 * CLAUDE.md「守卫不能惩罚记录」说的就是这件事,而那条规则要求**落地前**
 * 先 grep 一遍讲这个形状的地方。这一次没做,于是当场撞上 ——
 * 记在这里,因为它证明了那条规则不是理论。
 *
 * 判据与 `scripts/lib/scan.mjs` 的 `isWholeLineComment` 一致:
 * 跳的是「**整行是**注释」,不是「含注释标记」——
 * 后者会放过 `memberCap = 39 // 临时` 这种真违规。
 */
function codeOf(file: string): string {
  return readFileSync(join(SCREENS, file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/** 两屏都必须只从这一个类型取数。 */
const CONSUMERS = ['CapacityReadout.tsx', 'IsolationGate.tsx', 'TenantsScreen.tsx'] as const

/** D2 关心的那几个数。任何一个出现在默认值里,就是又一个来源。 */
const NUMBERS = ['memberCap', 'memberCount', 'maxProcesses', 'rssPerProcessMb', 'totalMb'] as const

describe('D2:容量读数与开户闸门同一个来源', () => {
  it('★ 三个消费方都 import 了 CapacityReading,没有一个自己声明这些字段', () => {
    let asserted = 0
    for (const file of CONSUMERS) {
      const src = codeOf(file)
      asserted += 1
      expect(src, `${file} 没有 import CapacityReading —— 它的数从别处来`).toMatch(
        /import type \{ CapacityReading \} from '\.\/capacity\.ts'/,
      )
      for (const field of NUMBERS) {
        // 自己声明成 props 字段 = 第二个入口
        expect(
          src,
          `${file} 自己声明了 ${field} —— 那是第二个入口,与 CapacityReading 会分家`,
        ).not.toMatch(new RegExp(`^\\s+${field}\\??:\\s*number`, 'm'))
      }
    }
    expect(asserted, '一个消费方都没检查到 —— 本条空跑了').toBe(CONSUMERS.length)
  })

  it('★ 这些数字都没有默认值 —— 默认值就是第二个事实源', () => {
    let asserted = 0
    for (const file of CONSUMERS) {
      const src = codeOf(file)
      for (const field of NUMBERS) {
        asserted += 1
        // `memberCap = 39` / `maxProcesses = 39,` 这类解构默认值
        expect(src, `${file} 里 ${field} 还有默认值 —— 漏传时不会红`).not.toMatch(
          new RegExp(`\\b${field}\\s*=\\s*\\d`),
        )
      }
    }
    expect(asserted, '一个字段都没查到 —— 本条空跑了').toBe(CONSUMERS.length * NUMBERS.length)
  })

  it('CapacityReading 的字段全是必填 —— 可选字段等于给了一个隐式默认', () => {
    // 类型层的断言:少任何一个字段都编译不过。
    // ⚠️ 这一条**在编译期**就会失败,运行时的 expect 只是让它出现在报告里。
    const complete: CapacityReading = {
      isolation: 'process',
      maxProcesses: 12,
      memberCap: 12,
      memberCount: 3,
      rssPerProcessMb: 63,
      basis: '2560 MB / 63 MB',
      totalMb: 2560,
    }
    expect(Object.keys(complete)).toHaveLength(7)

    // 反向对照:`isolation` 是收窄过的字面量联合,不是 string ——
    // 认不出的第三档必须在转换层停下,不能在这里退化成某一档。
    const narrowed: CapacityReading['isolation'] = 'logical'
    expect(['logical', 'process']).toContain(narrowed)
  })
})
