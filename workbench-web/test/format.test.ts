/**
 * 格式化层的测试。
 *
 * ## 为什么测的是这一层,而不是「界面显示对不对」
 *
 * 本仓刻意不引 jsdom + testing-library(与 `console-web/test` 同一表态)。
 * 于是「界面对不对」被拆成两半:
 *
 * | 问题 | 谁验 |
 * | --- | --- |
 * | **数据变成什么样** | 本文件 —— 纯函数,可断言,失败可复现 |
 * | **长什么样** | `packages/design-system/test/*.html` 在真实浏览器里实测 |
 *
 * 这里的断言重点不是「正常输入能用」,而是**几种会被合并掉的区分**:
 * `0` 与「取不到」、本地时区与直接切串、`.gitignore` 与「扩展名叫 gitignore」。
 * 三者的共同点是**错了看起来完全正常**。
 */
import { describe, expect, it } from 'vitest'
import { baseNameOf, extensionOf, humanBytes, shortTime, thousands } from '../src/format.ts'

describe('humanBytes · 0 与「取不到」必须分得开', () => {
  it('★ 真的 0 字节显示 0 B,取不到显示 —— 两者不能合并', () => {
    // 合并的后果:用户看到 `0 B` 会以为文件是空的,而实际可能只是没读到。
    // 与「未配置 vs 配置成某个值」是同一族错误。
    expect(humanBytes(0)).toBe('0 B')
    expect(humanBytes(null)).toBe('—')
    expect(humanBytes(undefined)).toBe('—')
    expect(humanBytes(Number.NaN)).toBe('—')
    expect(humanBytes(-1)).toBe('—')
  })

  it('按 1024 进位,一位小数', () => {
    expect(humanBytes(1)).toBe('1 B')
    expect(humanBytes(1023)).toBe('1023 B')
    expect(humanBytes(1024)).toBe('1.0 KB')
    expect(humanBytes(18 * 1024)).toBe('18.0 KB')
    expect(humanBytes(Math.round(2.4 * 1024 * 1024))).toBe('2.4 MB')
  })

  it('大到 TB 就不再往上进 —— 没有 PB 档,超了也不该显示 NaN', () => {
    const pb = 1024 ** 5
    const out = humanBytes(pb)
    expect(out).toMatch(/TB$/)
    expect(out).not.toContain('NaN')
    expect(out).not.toContain('undefined')
  })
})

describe('shortTime · 按本地时区,不切字符串', () => {
  it('★ 直接切 ISO 串会在跨时区时差出几个小时,而那种错看起来完全正常', () => {
    const iso = '2026-08-18T09:14:00.000Z'
    // 期望值由同一个 Date 推出来 —— 写死一个时刻会让这条测试
    // 在别的时区的机器上无故变红,而那与「代码错了」在输出上一样。
    const d = new Date(iso)
    const two = (n: number): string => String(n).padStart(2, '0')
    const want = `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
    expect(shortTime(iso)).toBe(want)

    // ⚠️ 反向对照:天真的切串法在 UTC 之外的时区会与上面不同。
    //   这条不断言「切串是错的」(在 UTC 机器上它恰好对),
    //   只断言**本实现走的是 Date**:改成切串的话上面那条会在非 UTC 机器上红。
    expect(shortTime(iso)).toHaveLength(11)
  })

  it('解析不了的一律 ——,不抛错也不显示 Invalid Date', () => {
    expect(shortTime('')).toBe('—')
    expect(shortTime(null)).toBe('—')
    expect(shortTime(undefined)).toBe('—')
    expect(shortTime('不是时间')).toBe('—')
  })
})

describe('thousands · 不用 toLocaleString', () => {
  it('★ toLocaleString 随环境 locale 变 —— 同一份数据在开发机与 CI 上不一样', () => {
    expect(thousands(48201)).toBe('48,201')
    expect(thousands(1284905)).toBe('1,284,905')
    expect(thousands(999)).toBe('999')
    expect(thousands(0)).toBe('0')
  })

  it('取不到显示 ——', () => {
    expect(thousands(null)).toBe('—')
    expect(thousands(undefined)).toBe('—')
    expect(thousands(Number.NaN)).toBe('—')
  })
})

describe('extensionOf · 隐藏文件不是「扩展名叫 gitignore」', () => {
  it('★ 点在下标 0 的是无扩展名的隐藏文件', () => {
    expect(extensionOf('.gitignore')).toBe('file')
    expect(extensionOf('src/.env')).toBe('file')
  })

  it('常规扩展名,小写', () => {
    expect(extensionOf('report.XLSX')).toBe('xlsx')
    expect(extensionOf('a/b/c.md')).toBe('md')
    expect(extensionOf('a\\b\\c.csv')).toBe('csv')
  })

  it('没有点的一律 file', () => {
    expect(extensionOf('README')).toBe('file')
    expect(extensionOf('dir/subdir')).toBe('file')
  })

  it('多个点取最后一段', () => {
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })
})

describe('baseNameOf · 两种分隔符都要认', () => {
  it('POSIX 与 Windows 分隔符', () => {
    expect(baseNameOf('a/b/c.md')).toBe('c.md')
    expect(baseNameOf('a\\b\\c.md')).toBe('c.md')
    expect(baseNameOf('c.md')).toBe('c.md')
  })
})
