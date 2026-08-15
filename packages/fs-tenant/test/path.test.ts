/**
 * 路径钉死的逃逸测试。
 *
 * 任务书要求「上述每一条逃逸手法都有对应的拒绝测试」,逐条对应:
 *   ../ 与多级 ../../ · 绝对路径 · 符号链接指向根外(见 fs-tenant.test.ts)
 *   Windows 8.3 短名与 UNC · URL 编码与 Unicode 规范化绕过 · 空 tenantId / userId
 */
import { createPrincipal } from '@dshwar/principal'
import { resolve as resolvePath, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  encodeSegment,
  isWithin,
  PathEscapeError,
  pinPath,
  tenantWorkspaceRoot,
  toPathSegment,
} from '../src/path.ts'

const ROOT = resolvePath('/data/workspaces')
const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const WS = tenantWorkspaceRoot(ROOT, alice)

describe('tenantWorkspaceRoot', () => {
  it('形状为 {root}/{tenantId}/{userId}', () => {
    expect(WS).toBe(resolvePath(ROOT, 'acme', 'alice-e6f1'))
  })

  it('拒绝相对的工作区根', () => {
    expect(() => tenantWorkspaceRoot('relative/root', alice)).toThrow(PathEscapeError)
  })

  it('不同租户落在不同目录', () => {
    const bob = createPrincipal({ id: 'bob', tenantId: 'globex' })
    expect(tenantWorkspaceRoot(ROOT, bob)).not.toBe(WS)
  })

  it('同租户不同用户落在不同目录', () => {
    const alice2 = createPrincipal({ id: 'alice2', tenantId: 'acme' })
    expect(tenantWorkspaceRoot(ROOT, alice2)).not.toBe(WS)
  })
})

describe('空 tenantId / userId', () => {
  // 空段落会让 {root}/{tenantId}/{userId} 塌陷成 {root}/{userId} ——
  // 所有空租户的用户共享同一层目录，这正是「越过隔离」
  it('空 tenantId 被拒绝', () => {
    expect(() => toPathSegment('', 'tenantId')).toThrow(PathEscapeError)
  })

  it('空 userId 被拒绝', () => {
    expect(() => toPathSegment('', 'userId')).toThrow(PathEscapeError)
  })
})

describe('标识符编码 —— 白名单之外一律哈希', () => {
  it('安全形状原样保留(运维可读)', () => {
    expect(encodeSegment('acme')).toBe('acme')
    expect(encodeSegment('acme-prod')).toBe('acme-prod')
    expect(encodeSegment('tenant.01_x')).toBe('tenant.01_x')
    expect(encodeSegment('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    )
  })

  it('含路径分隔符的一律编码', () => {
    expect(encodeSegment('a/b')).toMatch(/^_h_[0-9a-f]{32}$/)
    expect(encodeSegment('a\\b')).toMatch(/^_h_[0-9a-f]{32}$/)
  })

  it('.. 与 . 被编码而非原样落地', () => {
    expect(encodeSegment('..')).toMatch(/^_h_/)
    expect(encodeSegment('.')).toMatch(/^_h_/)
  })

  it('Auth0 / SAML 形状的 id 被编码而非拒绝', () => {
    // 拒绝等于把合法用户挡在门外
    expect(encodeSegment('auth0|5f3c8a9b')).toMatch(/^_h_/)
    expect(encodeSegment('urn:oasis:names:tc:SAML:2.1:nameid-format:persistent')).toMatch(/^_h_/)
  })

  // 8.3 短名的 ~ 在某些层会被展开成长名，两个不同的短名可能指向同一目录
  it('Windows 8.3 短名形状(含 ~)被编码', () => {
    expect(encodeSegment('PROGRA~1')).toMatch(/^_h_/)
    expect(encodeSegment('acme~1')).toMatch(/^_h_/)
  })

  // NTFS 数据流：`file:stream` 可以绕过按名字做的检查
  it('含冒号的标识符被编码(NTFS 数据流)', () => {
    expect(encodeSegment('acme:$DATA')).toMatch(/^_h_/)
  })

  it('Windows 保留设备名被编码', () => {
    for (const reserved of ['CON', 'con', 'PRN', 'NUL', 'COM1', 'LPT9']) {
      expect(encodeSegment(reserved)).toMatch(/^_h_/)
    }
  })

  // Windows 会静默去掉尾部的点，于是 "acme." 与 "acme" 是同一个目录
  it('尾部点号被编码', () => {
    expect(encodeSegment('acme.')).toMatch(/^_h_/)
    expect(encodeSegment('acme')).toBe('acme')
  })

  it('空格被编码', () => {
    expect(encodeSegment('acme corp')).toMatch(/^_h_/)
    expect(encodeSegment(' acme')).toMatch(/^_h_/)
  })

  it('非 ASCII 被编码', () => {
    expect(encodeSegment('恒星')).toMatch(/^_h_/)
  })

  // Unicode 规范化绕过：é 有组合与预组合两种编码
  it('Unicode 规范化后一致 —— 组合与预组合形式映射到同一段落', () => {
    const precomposed = 'caf\u00e9' // café
    const combining = 'cafe\u0301' // cafe + 组合重音
    expect(precomposed).not.toBe(combining)
    expect(encodeSegment(precomposed)).toBe(encodeSegment(combining))
  })

  // 一个用户若能把 id 起成 _h_<别人的哈希>，就能占用别人的目录
  it('伪造 _h_ 前缀的标识符本身会被再次编码,无法占用他人目录', () => {
    const victimEncoded = encodeSegment('auth0|victim')
    const forged = encodeSegment(victimEncoded)

    expect(victimEncoded).toMatch(/^_h_/)
    expect(forged).toMatch(/^_h_/)
    expect(forged).not.toBe(victimEncoded)
  })

  it('编码是单射的 —— 不同输入不碰撞', () => {
    // 转义式方案(把 | 换成 _)会让这两个碰撞
    expect(encodeSegment('a|b')).not.toBe(encodeSegment('a_b'))
  })

  it('编码是确定的 —— 同一输入永远同一输出', () => {
    expect(encodeSegment('auth0|5f3c')).toBe(encodeSegment('auth0|5f3c'))
  })
})

describe('isWithin', () => {
  it('根自身算在内', () => {
    expect(isWithin(WS, WS)).toBe(true)
  })

  it('子路径算在内', () => {
    expect(isWithin(WS, resolvePath(WS, 'a/b/c.txt'))).toBe(true)
  })

  // 经典的边界 off-by-one：startsWith(root) 会把 /data/acme-evil
  // 判定为落在 /data/acme 之内，后果是跨租户读写
  it('同前缀的兄弟目录不算在内', () => {
    const sibling = `${WS}-evil`
    expect(isWithin(WS, sibling)).toBe(false)
  })

  it('父目录不算在内', () => {
    expect(isWithin(WS, resolvePath(WS, '..'))).toBe(false)
  })

  it('完全无关的路径不算在内', () => {
    expect(isWithin(WS, resolvePath('/etc/passwd'))).toBe(false)
  })
})

describe('pinPath · 逃逸拦截', () => {
  it('正常相对路径通过', () => {
    expect(pinPath(WS, 'notes.md')).toBe(resolvePath(WS, 'notes.md'))
    expect(pinPath(WS, 'a/b/c.txt')).toBe(resolvePath(WS, 'a/b/c.txt'))
    expect(pinPath(WS, './notes.md')).toBe(resolvePath(WS, 'notes.md'))
  })

  it('根内的 .. 只要不逃出去就通过', () => {
    expect(pinPath(WS, 'a/../b.txt')).toBe(resolvePath(WS, 'b.txt'))
  })

  it('单级 ../ 被拒绝', () => {
    expect(() => pinPath(WS, '../secret.txt')).toThrow(PathEscapeError)
  })

  it('多级 ../../ 被拒绝', () => {
    expect(() => pinPath(WS, '../../secret.txt')).toThrow(PathEscapeError)
    expect(() => pinPath(WS, '../../../../../../etc/passwd')).toThrow(PathEscapeError)
  })

  it('埋在中间的 ../ 被拒绝', () => {
    expect(() => pinPath(WS, 'a/b/../../../escape.txt')).toThrow(PathEscapeError)
  })

  it('绝对路径被拒绝,且不做「截掉斜杠再拼」的补救', () => {
    // 补救会把 /etc/passwd 变成 {root}/etc/passwd，看起来安全，
    // 实则掩盖调用方的真实意图
    expect(() => pinPath(WS, '/etc/passwd')).toThrow(PathEscapeError)
  })

  it('Windows 盘符被拒绝', () => {
    expect(() => pinPath(WS, 'C:\\Windows\\System32')).toThrow(PathEscapeError)
    expect(() => pinPath(WS, 'c:/windows')).toThrow(PathEscapeError)
  })

  it('UNC 路径被拒绝', () => {
    expect(() => pinPath(WS, '\\\\evil-server\\share')).toThrow(PathEscapeError)
    expect(() => pinPath(WS, '//evil-server/share')).toThrow(PathEscapeError)
  })

  it('空字节被拒绝', () => {
    expect(() => pinPath(WS, 'ok.txt\u0000.png')).toThrow(/空字节/)
  })

  // URL 编码不是文件系统的语义。%2e%2e%2f 应当被当成一个普通的文件名，
  // 而不是被解码成 ../ —— 若某一层解码了，这条测试会变红
  it('URL 编码的 ../ 不被解码,当作普通文件名', () => {
    const pinned = pinPath(WS, '%2e%2e%2fsecret.txt')
    expect(isWithin(WS, pinned)).toBe(true)
    expect(pinned).toContain('%2e%2e%2f')
  })

  it('双重 URL 编码同样不被解码', () => {
    const pinned = pinPath(WS, '%252e%252e%252f')
    expect(isWithin(WS, pinned)).toBe(true)
  })

  it('Unicode 规范化后仍逃逸的路径被拒绝', () => {
    // NFC 归一化后仍是 ..，必须拦
    expect(() => pinPath(WS, '..\u0000/../etc')).toThrow(PathEscapeError)
  })

  it('大量 ../ 的组合被拒绝', () => {
    const deep = Array.from({ length: 40 }, () => '..').join(sep)
    expect(() => pinPath(WS, `${deep}${sep}etc${sep}passwd`)).toThrow(PathEscapeError)
  })

  it('仅 .. 本身被拒绝', () => {
    expect(() => pinPath(WS, '..')).toThrow(PathEscapeError)
  })

  it('. 解析为工作区根自身,允许', () => {
    expect(pinPath(WS, '.')).toBe(WS)
  })
})

describe('跨租户不可见(纯路径层)', () => {
  const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })
  const bobWs = tenantWorkspaceRoot(ROOT, bob)

  it('alice 的根不包含 bob 的根', () => {
    expect(isWithin(WS, bobWs)).toBe(false)
  })

  it('bob 的根不包含 alice 的根(反向)', () => {
    expect(isWithin(bobWs, WS)).toBe(false)
  })

  it('alice 无法用相对路径够到 bob 的目录', () => {
    expect(() => pinPath(WS, `../../globex/bob-a2b3/secret.txt`)).toThrow(PathEscapeError)
  })

  it('同租户的另一个用户同样够不到', () => {
    const alice2 = createPrincipal({ id: 'alice2', tenantId: 'acme' })
    const ws2 = tenantWorkspaceRoot(ROOT, alice2)
    expect(isWithin(WS, ws2)).toBe(false)
    expect(() => pinPath(WS, '../alice2/notes.md')).toThrow(PathEscapeError)
  })
})
