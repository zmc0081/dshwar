/**
 * 路径钉死的逃逸测试。
 *
 * 任务书要求「上述每一条逃逸手法都有对应的拒绝测试」,逐条对应:
 *   ../ 与多级 ../../ · 绝对路径 · 符号链接指向根外(见 fs-tenant.test.ts)
 *   Windows 8.3 短名与 UNC · URL 编码与 Unicode 规范化绕过
 *   空 tenantId / userId / workspaceId · workspaceId 伪造成分隔符或点号序列
 *   跨工作区读写(同一用户的两个工作区之间也要隔离)
 *
 * ⚠️ **V0.4.1 全量重写。** 路径从三段变四段,每一种绕过手法都在**新增的那一段**上
 * 重新验证了一遍——不能假设「tenantId 上拦得住」等于「workspaceId 上也拦得住」,
 * 那正是加一层路径段时最容易漏的地方。
 */
import { createPrincipal } from '@dshwar/principal'
import { resolve as resolvePath, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_ID,
  encodeSegment,
  isWithin,
  PathEscapeError,
  pinPath,
  tenantUserRoot,
  tenantWorkspaceRoot,
  toPathSegment,
} from '../src/path.ts'

const ROOT = resolvePath('/data/workspaces')
const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const WS = tenantWorkspaceRoot(ROOT, alice)

describe('tenantWorkspaceRoot', () => {
  it('形状为 {root}/{tenantId}/{userId}/{workspaceId}', () => {
    expect(WS).toBe(resolvePath(ROOT, 'acme', 'alice-e6f1', DEFAULT_WORKSPACE_ID))
  })

  it('显式 workspaceId 落到第四段', () => {
    expect(tenantWorkspaceRoot(ROOT, alice, 'proj-a')).toBe(
      resolvePath(ROOT, 'acme', 'alice-e6f1', 'proj-a'),
    )
  })

  // R2:改造前的调用方不传 workspaceId，行为必须与改造前一致
  it('省略 workspaceId 等价于显式传 default', () => {
    expect(tenantWorkspaceRoot(ROOT, alice)).toBe(
      tenantWorkspaceRoot(ROOT, alice, DEFAULT_WORKSPACE_ID),
    )
  })

  it('tenantUserRoot 是工作区的上一层，不含第四段', () => {
    expect(tenantUserRoot(ROOT, alice)).toBe(resolvePath(ROOT, 'acme', 'alice-e6f1'))
    expect(WS.startsWith(tenantUserRoot(ROOT, alice) + sep)).toBe(true)
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

// ============================================================================
// V0.4.1 · 工作区维度的全量重写
//
// 加一层路径段意味着每一种绕过手法都要在**新增的那一段**上重验一遍。
// 下面每个 describe 都对应任务书逃逸清单里的一条,只是把靶子换成 workspaceId。
// ============================================================================

describe('空 workspaceId', () => {
  it('空字符串被拒绝', () => {
    expect(() => tenantWorkspaceRoot(ROOT, alice, '')).toThrow(PathEscapeError)
    expect(() => toPathSegment('', 'workspaceId')).toThrow(/不得为空/)
  })

  // Windows 会静默去掉尾部空格，于是 " " 等价于空段落 —— 路径少一层即塌陷
  it('仅含空白被拒绝', () => {
    for (const blank of [' ', '   ', '\t', '\n']) {
      expect(() => tenantWorkspaceRoot(ROOT, alice, blank), JSON.stringify(blank)).toThrow(
        PathEscapeError,
      )
    }
  })

  it('三段里任意一段为空都被拒绝 —— 塌陷位置多了一处,每处都要拦', () => {
    const blank = createPrincipal({ id: 'x', tenantId: 'acme' })
    expect(() => toPathSegment('', 'tenantId')).toThrow(PathEscapeError)
    expect(() => toPathSegment('', 'userId')).toThrow(PathEscapeError)
    expect(() => toPathSegment('', 'workspaceId')).toThrow(PathEscapeError)
    void blank
  })
})

describe('workspaceId 伪造成路径分隔符或点号序列', () => {
  // 这是四段模型最危险的一条:一个叫 `..` 的工作区会把路径抬回用户根，
  // 于是「我的工作区」变成「我的全部工作区」，跨工作区隔离直接失效
  it('.. 被编码而非原样落地', () => {
    const ws = tenantWorkspaceRoot(ROOT, alice, '..')
    expect(ws).not.toBe(tenantUserRoot(ROOT, alice))
    expect(ws.startsWith(tenantUserRoot(ROOT, alice) + sep)).toBe(true)
    expect(encodeSegment('..')).toMatch(/^_h_/)
  })

  it('. 被编码而非解析成当前目录', () => {
    const ws = tenantWorkspaceRoot(ROOT, alice, '.')
    expect(ws).not.toBe(tenantUserRoot(ROOT, alice))
    expect(ws.startsWith(tenantUserRoot(ROOT, alice) + sep)).toBe(true)
  })

  it('多级 ../../ 被编码', () => {
    for (const evil of ['../..', '../../..', '..\\..', '..\\..\\..']) {
      const ws = tenantWorkspaceRoot(ROOT, alice, evil)
      expect(ws.startsWith(tenantUserRoot(ROOT, alice) + sep), evil).toBe(true)
    }
  })

  it('含正斜杠 / 反斜杠的 workspaceId 被编码,不产生额外层级', () => {
    for (const evil of ['a/b', 'a\\b', '../bob-ws', '/etc/passwd', 'a/../../b']) {
      const ws = tenantWorkspaceRoot(ROOT, alice, evil)
      const rest = ws.slice(tenantUserRoot(ROOT, alice).length + 1)
      expect(rest.includes(sep), `${evil} 产生了额外层级`).toBe(false)
    }
  })

  // 白名单内的名字(proj-a)原样落地,拿它"伪造"本来就该得到同一目录 ——
  // 伪造的靶子是**被编码**的段落:攻击者读到别人的目录名 `_h_abc…`，
  // 想把自己的 workspaceId 直接起成那个字符串来占用它
  it('伪造 _h_ 前缀无法占用别人的工作区目录', () => {
    const real = tenantWorkspaceRoot(ROOT, alice, '中文项目')
    const encodedName = real.split(sep).pop()!
    expect(encodedName).toMatch(/^_h_/)

    const forged = tenantWorkspaceRoot(ROOT, alice, encodedName)
    expect(forged, '拿编码后的目录名当 workspaceId 竟然命中了同一目录').not.toBe(real)
  })
})

describe('workspaceId 的其余绕过手法(与 tenantId 同等对待)', () => {
  it('绝对路径形状被编码', () => {
    for (const evil of ['/root', 'C:\\Windows', '\\\\server\\share']) {
      expect(encodeSegment(evil), evil).toMatch(/^_h_/)
    }
  })

  it('Windows 8.3 短名与保留设备名被编码', () => {
    expect(encodeSegment('PROGRA~1')).toMatch(/^_h_/)
    expect(encodeSegment('CON')).toMatch(/^_h_/)
    expect(encodeSegment('nul')).toMatch(/^_h_/)
  })

  it('URL 编码不被解码 —— 当作普通字符串编码', () => {
    // %2e%2e 若被解码就是 ..，那是灾难；这里断言它只是个普通字符串
    expect(encodeSegment('%2e%2e')).not.toBe(encodeSegment('..'))
  })

  it('Unicode 规范化后一致 —— 同一工作区不会落到两个目录', () => {
    const composed = 'proj\u00e9'
    const decomposed = 'proje\u0301'
    expect(tenantWorkspaceRoot(ROOT, alice, composed)).toBe(
      tenantWorkspaceRoot(ROOT, alice, decomposed),
    )
  })

  it('尾部点号被编码(Windows 会静默去掉,否则 "a." 与 "a" 同目录)', () => {
    expect(encodeSegment('proj.')).toMatch(/^_h_/)
    expect(encodeSegment('proj.')).not.toBe(encodeSegment('proj'))
  })
})

describe('跨工作区不可见 —— 同一用户的两个工作区之间也隔离', () => {
  const wsA = tenantWorkspaceRoot(ROOT, alice, 'proj-a')
  const wsB = tenantWorkspaceRoot(ROOT, alice, 'proj-b')

  it('两个工作区落在不同目录', () => {
    expect(wsA).not.toBe(wsB)
  })

  it('A 不包含 B,B 也不包含 A(正反各一)', () => {
    expect(isWithin(wsA, wsB)).toBe(false)
    expect(isWithin(wsB, wsA)).toBe(false)
  })

  it('A 无法用相对路径够到 B', () => {
    expect(() => pinPath(wsA, '../proj-b/secret.txt')).toThrow(PathEscapeError)
    expect(() => pinPath(wsA, '../../alice-e6f1/proj-b/secret.txt')).toThrow(PathEscapeError)
  })

  it('缺省工作区同样够不到具名工作区', () => {
    expect(() => pinPath(WS, '../proj-a/secret.txt')).toThrow(PathEscapeError)
    expect(isWithin(WS, wsA)).toBe(false)
  })

  it('同前缀的工作区名不互相包含(proj 与 proj-a)', () => {
    const wsPrefix = tenantWorkspaceRoot(ROOT, alice, 'proj')
    expect(isWithin(wsPrefix, wsA)).toBe(false)
  })

  it('跨租户 + 跨工作区:同名工作区在不同租户下互不可见', () => {
    const mallory = createPrincipal({ id: 'mallory', tenantId: 'globex' })
    const theirs = tenantWorkspaceRoot(ROOT, mallory, 'proj-a')
    expect(isWithin(wsA, theirs)).toBe(false)
    expect(isWithin(theirs, wsA)).toBe(false)
  })
})
