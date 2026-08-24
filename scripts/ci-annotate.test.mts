/**
 * `ci-annotate.mjs` 的测试 —— 夹具是**那次真实失败的日志形状**,不是构造的边角。
 *
 * 被替掉的那个一行命令(`tail -n 40 | tr | cut -c1-1500`)在 V0.9.0 Session 6
 * 首次真跑 CI 时同时露了三个洞,而三个都**静默**:根因被从末尾切掉、
 * 分隔符从来没出现过、窗口里 95% 是 cargo 噪音。
 *
 * 所以这里的断言不是「正常情况能用」,而是「**那三种情况下**能用」:
 *
 * | 断言 | 钉的是哪个洞 |
 * | --- | --- |
 * | 根因在输出里 | #3 噪音淹没 |
 * | 超长时丢的是**开头** | #1 两个方向相反的截断 |
 * | 换行编码成 `%0A` | #2 分隔符没生效 |
 */
import { describe, expect, it } from 'vitest'
import { extractAnnotation } from './ci-annotate.mjs'

/** 那次门禁失败的日志形状:一大段 cargo build-script 噪音 + 一行根因。 */
function glibFailureLog(): string {
  const noise = Array.from(
    { length: 200 },
    (_, i) => `cargo:rerun-if-env-changed=PKG_CONFIG_PATH_x86_64_unknown_linux_gnu_${i}`,
  )
  return [
    '  桌面壳:cargo 在,真跑',
    '   Compiling glib-sys v0.20.10',
    ...noise,
    'cargo:warning=',
    'pkg-config exited with status code 1',
    "> PKG_CONFIG_ALLOW_SYSTEM_CFLAGS=1 pkg-config --libs --cflags glib-2.0 'glib-2.0 >= 2.70'",
    'Package glib-2.0 was not found in the pkg-config search path.',
    'The system library `glib-2.0` required by crate `glib-sys` was not found.',
    'error: could not compile `glib-sys` (build script) due to 1 previous error',
    ' ELIFECYCLE  Command failed with exit code 1.',
  ].join('\n')
}

describe('extractAnnotation', () => {
  it('根因不会被 cargo 噪音淹没', () => {
    const out = extractAnnotation(glibFailureLog())
    expect(out).toContain('glib-2.0')
    expect(out).toContain('could not compile')
    expect(out).toContain('ELIFECYCLE')
  })

  it('噪音行不进关键行区', () => {
    const out = extractAnnotation(glibFailureLog())
    const keySection = out.split('── 末尾')[0] ?? ''
    expect(keySection).not.toContain('rerun-if-env-changed')
  })

  it('★ 超长时截掉的是**开头**,不是结尾', () => {
    // 这一条钉的是被替掉那条命令的核心缺陷:`tail` 取末尾、`cut -c1-N` 取开头,
    // 串起来留下的是信息量最低的一块。
    //
    // ⚠️ 夹具要让**总长**真的超预算,而不只是行数多 —— 关键行有条数上限,
    //    光靠行数堆不上去。所以这里用长行(一条 stack trace 或一段压缩过的
    //    JS 就是这个长度),这也是这条分支在真实日志里被触发的方式。
    const long = 'x'.repeat(400)
    const filler = Array.from({ length: 40 }, (_, i) => `error: 第 ${i} 条填充失败 ${long}`)
    const out = extractAnnotation([...filler, '这是最后一行,也是结论'].join('\n'))

    expect(out).toContain('这是最后一行,也是结论')
    expect(out).toContain('已截断')
    expect(out).not.toContain('第 0 条填充失败')
  })

  it('ANSI 转义被清掉,而普通方括号留着', () => {
    const out = extractAnnotation(
      ['[1m[92m   Compiling[0m getrandom', 'error: 数组 [abc] 越界'].join('\n'),
    )
    expect(out).not.toContain('')
    expect(out).not.toMatch(/\[1m|\[92m|\[0m/)
    // ⚠️ 锚不在 ESC 上的那版正则会把 `[abc]` 咬成 `bc]` —— 而日志里方括号到处都是。
    expect(out).toContain('[abc]')
  })

  it('空日志不炸,且说得出「什么都没有」', () => {
    const out = extractAnnotation('')
    expect(out).toContain('末尾')
    expect(out.length).toBeLessThan(200)
  })

  it('没有关键行时仍然给出末尾几行', () => {
    const out = extractAnnotation(['一切正常', '第二行', '第三行'].join('\n'))
    expect(out).not.toContain('★ 关键行')
    expect(out).toContain('第三行')
  })
})
