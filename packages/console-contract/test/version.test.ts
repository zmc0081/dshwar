/**
 * 契约版本必须与包版本一致。
 *
 * 为什么值得一条测试:`CONSOLE_CONTRACT_VERSION` 是**手写的字符串**,
 * 而包版本由 changesets 提升。两者天然会分叉 —— 而分叉的后果是控制台
 * 校验服务端版本时拿到一个过期的数,**校验通过但实际不兼容**。
 *
 * `check-version` 管不到它:那条守卫比的是 package.json / CLAUDE.md /
 * README / openapi.json,不知道源码里还有一个手写的版本号。
 * 所以这里补一条,而不是指望下一个人记得同步。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONSOLE_CONTRACT_VERSION } from '../src/index.ts'

describe('console 契约版本', () => {
  it('与 package.json 的 version 一致', () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
    expect(CONSOLE_CONTRACT_VERSION, 'src/version.ts 是手写的,changesets 不会替你改它').toBe(
      pkg.version,
    )
  })
})
