import { describe, expect, it } from 'vitest'
import {
  assertUpstreamVersion,
  EXPECTED_UPSTREAM_VERSION,
  GUARDED_PACKAGES,
  inspectUpstreamVersions,
} from '../src/index.ts'

describe('上游版本守卫(硬规则 3)', () => {
  it('当前安装的上游版本与适配层锁定版本一致', () => {
    expect(() => assertUpstreamVersion()).not.toThrow()
  })

  it('每个受守卫的包都解析得到,且版本正确', () => {
    const report = inspectUpstreamVersions()
    expect(report.expected).toBe(EXPECTED_UPSTREAM_VERSION)

    for (const pkg of report.packages) {
      expect(pkg.actual, `${pkg.name} 解析不到`).toBeDefined()
      expect(pkg.matches, `${pkg.name} 实际为 ${pkg.actual}`).toBe(true)
    }
  })

  it('守卫覆盖了全部上游接触面', () => {
    // 这条断言的作用是「加包时逼人回来看一眼」：
    // 新增一个上游依赖却忘了纳入守卫，跟版时它会静默地不被检查
    expect([...GUARDED_PACKAGES].sort()).toEqual([
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-fs',
      '@deepseek-ai/dsh-storage',
    ])
  })

  it('锁定版本与目录名一致', () => {
    // adapters/dsh-0.1.0 ←→ 0.1.0-rc.6
    expect(EXPECTED_UPSTREAM_VERSION.startsWith('0.1.0')).toBe(true)
  })
})
