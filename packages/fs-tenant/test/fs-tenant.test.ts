/**
 * 对着**真实的上游 `fs-local`** 跑的隔离测试。
 *
 * 符号链接逃逸对着 mock 测没有意义 —— 它的整个威胁模型就是「字面层完全合法,
 * 而内核解析到别处」。必须有真实文件系统。
 */
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import {
  ANONYMOUS,
  createPrincipal,
  PRINCIPAL_BINDING,
  PrincipalService,
  runWithPrincipal,
} from '@dshwar/principal'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PathEscapeError, TenantFileSystem, tenantWorkspaceRoot } from '../src/index.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })

let root: string
let outsideDir: string
let ctx: Context

/** 判断本机能否创建符号链接。Windows 非管理员 / 未开开发者模式时不能。 */
async function canSymlink(base: string): Promise<boolean> {
  const target = join(base, '.symlink-probe-target')
  const link = join(base, '.symlink-probe-link')
  try {
    await writeFile(target, 'probe')
    await symlink(target, link)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'dshwar-fs-'))
  root = join(tmp, 'workspaces')
  outsideDir = join(tmp, 'outside')
  await mkdir(root, { recursive: true })
  await mkdir(outsideDir, { recursive: true })
  await writeFile(join(outsideDir, 'secret.txt'), 'TOP SECRET')

  // 每个主体的工作区目录要真实存在,fs-local 才能 realpath
  for (const p of [alice, bob]) {
    await mkdir(tenantWorkspaceRoot(root, p), { recursive: true })
  }

  ctx = new Context()
  await ctx.plugin(PrincipalService)
  // ★ V0.6.0:装配阶段**显式** provide ANONYMOUS —— 与 assembleRuntime 同款。
  // 不 provide 的话 current() 会抛 PrincipalUnboundError,而那正是本版本要的:
  // 「没人表过态」与「合法的单用户」不再是同一个值。
  ctx.provide(PRINCIPAL_BINDING, ANONYMOUS)

  // inner 放进被 isolate 的 'fs' 槽位 —— 否则两个 FileSystem 抢同一个服务名
  const innerCtx = ctx.isolate('fs')
  await innerCtx.plugin(LocalFileSystem, { cwd: root })
  const inner = innerCtx.fs as FileSystem

  await ctx.plugin(TenantFileSystem, { inner, root })
})

afterEach(async () => {
  await rm(resolvePath(root, '..'), { recursive: true, force: true }).catch(() => undefined)
})

describe('基本读写 —— 钉在自己的工作区内', () => {
  it('注册为 ctx.fs', () => {
    expect(ctx.fs).toBeInstanceOf(TenantFileSystem)
  })

  it('写入并读回', async () => {
    const content = await runWithPrincipal(ctx, alice, async (c) => {
      const target = await c.fs.resolve('notes.md')
      await c.fs.writeText(target, 'hello from alice')
      return c.fs.readText(target)
    })
    expect(content).toBe('hello from alice')
  })

  it('相对路径落在自己的工作区根内', async () => {
    const actual = await runWithPrincipal(ctx, alice, async (c) => {
      const target = await c.fs.resolve('notes.md')
      return c.fs.processPath(target)
    })
    expect(actual.startsWith(tenantWorkspaceRoot(root, alice))).toBe(true)
  })

  it('子目录可用', async () => {
    const content = await runWithPrincipal(ctx, alice, async (c) => {
      await mkdir(join(tenantWorkspaceRoot(root, alice), 'sub'), { recursive: true })
      const target = await c.fs.resolve('sub/deep.txt')
      await c.fs.writeText(target, 'deep')
      return c.fs.readText(target)
    })
    expect(content).toBe('deep')
  })
})

describe('两租户互相不可见(正向与反向)', () => {
  it('alice 与 bob 的同名文件互不干扰', async () => {
    await runWithPrincipal(ctx, alice, async (c) => {
      const t = await c.fs.resolve('shared-name.txt')
      await c.fs.writeText(t, 'alice content')
    })
    await runWithPrincipal(ctx, bob, async (c) => {
      const t = await c.fs.resolve('shared-name.txt')
      await c.fs.writeText(t, 'bob content')
    })

    const aliceContent = await runWithPrincipal(ctx, alice, async (c) =>
      c.fs.readText(await c.fs.resolve('shared-name.txt')),
    )
    const bobContent = await runWithPrincipal(ctx, bob, async (c) =>
      c.fs.readText(await c.fs.resolve('shared-name.txt')),
    )

    expect(aliceContent).toBe('alice content')
    expect(bobContent).toBe('bob content')
  })

  it('alice 无法用 ../ 够到 bob 的工作区(正向)', async () => {
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.fs.resolve(`../../globex/${bob.id}/shared-name.txt`)),
    ).rejects.toThrow(PathEscapeError)
  })

  it('bob 无法用 ../ 够到 alice 的工作区(反向)', async () => {
    await expect(
      runWithPrincipal(ctx, bob, (c) => c.fs.resolve(`../../acme/${alice.id}/shared-name.txt`)),
    ).rejects.toThrow(PathEscapeError)
  })

  it('alice 拿到的 target 交给 bob 的作用域使用会被拒绝', async () => {
    // 跨作用域传递 target 是一种真实的攻击面：一个插件在 alice 的会话里
    // 解析出 target，缓存起来，在 bob 的会话里用
    const aliceTarget = await runWithPrincipal(ctx, alice, async (c) => {
      const t = await c.fs.resolve('leak.txt')
      await c.fs.writeText(t, 'alice private')
      return t
    })

    await expect(runWithPrincipal(ctx, bob, (c) => c.fs.readText(aliceTarget))).rejects.toThrow(
      PathEscapeError,
    )
  })

  it('跨作用域的写入同样被拒绝', async () => {
    const aliceTarget = await runWithPrincipal(ctx, alice, async (c) => {
      const t = await c.fs.resolve('victim.txt')
      await c.fs.writeText(t, 'original')
      return t
    })

    await expect(
      runWithPrincipal(ctx, bob, (c) => c.fs.writeText(aliceTarget, 'tampered')),
    ).rejects.toThrow(PathEscapeError)

    const still = await runWithPrincipal(ctx, alice, (c) => c.fs.readText(aliceTarget))
    expect(still).toBe('original')
  })
})

describe('逃逸拦截 —— 对着真实文件系统', () => {
  it('../ 被拒绝', async () => {
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.fs.resolve('../secret.txt')),
    ).rejects.toThrow(PathEscapeError)
  })

  it('多级 ../../ 被拒绝', async () => {
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.fs.resolve('../../../outside/secret.txt')),
    ).rejects.toThrow(PathEscapeError)
  })

  it('绝对路径被拒绝', async () => {
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.fs.resolve(join(outsideDir, 'secret.txt'))),
    ).rejects.toThrow(PathEscapeError)
  })

  it('调用方自带的 cwd 也被钉死', async () => {
    // 允许调用方自带 cwd 而不校验，等于把整道防线拱手让人
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.fs.resolve('secret.txt', { cwd: '../../..' })),
    ).rejects.toThrow(PathEscapeError)
  })

  it('绝对路径的 cwd 被拒绝', async () => {
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.fs.resolve('secret.txt', { cwd: outsideDir })),
    ).rejects.toThrow(PathEscapeError)
  })
})

describe('符号链接逃逸 —— realpath 层兜底', () => {
  it('指向根外的符号链接被拒绝', async () => {
    const ws = tenantWorkspaceRoot(root, alice)
    if (!(await canSymlink(ws))) {
      // Windows 非管理员且未开开发者模式时建不了符号链接。
      // 不静默跳过 —— 让它在日志里可见，否则会误以为这条防线被验证过了。
      console.warn(
        '[fs-tenant] 本机无法创建符号链接，跳过 symlink 逃逸测试（需 Linux 或 Windows 开发者模式）',
      )
      return
    }

    await symlink(join(outsideDir, 'secret.txt'), join(ws, 'escape-link'))

    // 字面层完全合法：'escape-link' 里没有 ../，不是绝对路径。
    // 只有 realpath 之后的复查能拦住它。
    await expect(runWithPrincipal(ctx, alice, (c) => c.fs.resolve('escape-link'))).rejects.toThrow(
      PathEscapeError,
    )
  })

  it('指向根内的符号链接正常工作', async () => {
    const ws = tenantWorkspaceRoot(root, alice)
    if (!(await canSymlink(ws))) return

    await writeFile(join(ws, 'real.txt'), 'inside content')
    await symlink(join(ws, 'real.txt'), join(ws, 'inside-link'))

    const content = await runWithPrincipal(ctx, alice, async (c) =>
      c.fs.readText(await c.fs.resolve('inside-link')),
    )
    expect(content).toBe('inside content')
  })

  it('指向另一租户工作区的符号链接被拒绝', async () => {
    const aliceWs = tenantWorkspaceRoot(root, alice)
    const bobWs = tenantWorkspaceRoot(root, bob)
    if (!(await canSymlink(aliceWs))) return

    await writeFile(join(bobWs, 'bob-secret.txt'), 'bob private')
    await symlink(join(bobWs, 'bob-secret.txt'), join(aliceWs, 'peek-at-bob'))

    await expect(runWithPrincipal(ctx, alice, (c) => c.fs.resolve('peek-at-bob'))).rejects.toThrow(
      PathEscapeError,
    )
  })
})

describe('匿名主体', () => {
  // 匿名不是「没有工作区」，而是「落在一个不属于任何真实租户的工作区」。
  // 它的 tenantId 是 'anonymous'，与真租户永不重名。
  it('匿名落在 anonymous/anonymous 目录,不与任何真租户重叠', async () => {
    const anonWs = tenantWorkspaceRoot(root, ctx.principal.current())
    expect(anonWs).toContain('anonymous')
    expect(anonWs).not.toBe(tenantWorkspaceRoot(root, alice))
  })

  it('匿名读不到 alice 的文件', async () => {
    await runWithPrincipal(ctx, alice, async (c) => {
      const t = await c.fs.resolve('alice-only.txt')
      await c.fs.writeText(t, 'private')
    })

    await expect(ctx.fs.resolve(`../../acme/${alice.id}/alice-only.txt`)).rejects.toThrow(
      PathEscapeError,
    )
  })
})

describe('单用户对照 —— 只加隔离,不改语义', () => {
  // 硬规则 8：单用户场景下行为必须与原生 fs-local 一致。
  // 完整的双 profile 对照在 Session 7（R9），这里先证明读写语义没变。
  it('写入内容与直读文件一致', async () => {
    const written = 'line1\nline2\n'
    const actualPath = await runWithPrincipal(ctx, alice, async (c) => {
      const t = await c.fs.resolve('parity.txt')
      await c.fs.writeText(t, written)
      return c.fs.processPath(t)
    })

    const { readFile } = await import('node:fs/promises')
    expect(await readFile(actualPath, 'utf8')).toBe(written)
  })

  it('listDir 返回目录内容', async () => {
    const names = await runWithPrincipal(ctx, alice, async (c) => {
      await c.fs.writeText(await c.fs.resolve('a.txt'), 'a')
      await c.fs.writeText(await c.fs.resolve('b.txt'), 'b')
      const dir = await c.fs.resolve('.')
      const entries = await c.fs.listDir(dir)
      return entries.map((e) => e.name).sort()
    })
    expect(names).toContain('a.txt')
    expect(names).toContain('b.txt')
  })

  it('stat 返回元数据而非内容', async () => {
    const info = await runWithPrincipal(ctx, alice, async (c) => {
      const t = await c.fs.resolve('stat-me.txt')
      await c.fs.writeText(t, 'content')
      return c.fs.stat(t)
    })
    expect(info).toBeDefined()
    expect(JSON.stringify(info)).not.toContain('content')
  })

  it('sandboxMode 原样透传内层,不谎报能力', async () => {
    const innerCtx = ctx.isolate('fs')
    await innerCtx.plugin(LocalFileSystem, { cwd: root })
    expect(ctx.fs.sandboxMode).toBe((innerCtx.fs as FileSystem).sandboxMode)
  })
})

// ============================================================================
// V0.4.1 · 跨工作区隔离 —— 对着真实文件系统
//
// path.test.ts 验的是纯路径层。这里验的是**同一个用户**换工作区之后,
// 真实读写与符号链接是否也隔离 —— 纯路径测试看不到 symlink。
// ============================================================================
describe('跨工作区隔离(同一用户的两个工作区)', () => {
  /** 用给定的 workspaceOf 起一个 TenantFileSystem;工作区目录真实建出来。 */
  async function ctxForWorkspace(workspaceId: string): Promise<Context> {
    const ws = tenantWorkspaceRoot(root, alice, workspaceId)
    await mkdir(ws, { recursive: true })

    const c = new Context()
    await c.plugin(PrincipalService)
    const innerCtx = c.isolate('fs')
    await innerCtx.plugin(LocalFileSystem, { cwd: root })
    await c.plugin(TenantFileSystem, {
      inner: innerCtx.fs as FileSystem,
      root,
      workspaceOf: () => workspaceId,
    })
    return c
  }

  it('在 proj-a 写的文件,在 proj-b 里读不到', async () => {
    const a = await ctxForWorkspace('proj-a')
    const b = await ctxForWorkspace('proj-b')

    await runWithPrincipal(a, alice, async (c) => {
      const t = await c.fs.resolve('notes.md')
      await c.fs.writeText(t, 'proj-a only')
    })

    // 同名路径在另一个工作区里是另一个文件 —— 不该读到 proj-a 的内容
    await expect(
      runWithPrincipal(b, alice, async (c) => {
        const t = await c.fs.resolve('notes.md')
        return c.fs.readText(t)
      }),
    ).rejects.toThrow()
  })

  it('两个工作区的同名文件互不覆盖', async () => {
    const a = await ctxForWorkspace('proj-a')
    const b = await ctxForWorkspace('proj-b')

    for (const [c, text] of [
      [a, 'from-a'],
      [b, 'from-b'],
    ] as const) {
      await runWithPrincipal(c, alice, async (scoped) => {
        const t = await scoped.fs.resolve('shared-name.txt')
        await scoped.fs.writeText(t, text)
      })
    }

    const readA = await runWithPrincipal(a, alice, async (c) => {
      const t = await c.fs.resolve('shared-name.txt')
      return c.fs.readText(t)
    })
    expect(readA).toBe('from-a')
  })

  it('用 ../ 够另一个工作区被拒绝', async () => {
    const a = await ctxForWorkspace('proj-a')
    await mkdir(tenantWorkspaceRoot(root, alice, 'proj-b'), { recursive: true })

    await expect(
      runWithPrincipal(a, alice, (c) => c.fs.resolve('../proj-b/notes.md')),
    ).rejects.toThrow(PathEscapeError)
  })

  it('指向另一个工作区的符号链接被拒绝 —— realpath 层兜底', async () => {
    const wsA = tenantWorkspaceRoot(root, alice, 'proj-a')
    const wsB = tenantWorkspaceRoot(root, alice, 'proj-b')
    await mkdir(wsA, { recursive: true })
    await mkdir(wsB, { recursive: true })
    if (!(await canSymlink(wsA))) return

    await writeFile(join(wsB, 'b-secret.txt'), 'proj-b private')
    await symlink(join(wsB, 'b-secret.txt'), join(wsA, 'peek-at-b'))

    const a = await ctxForWorkspace('proj-a')
    await expect(runWithPrincipal(a, alice, (c) => c.fs.resolve('peek-at-b'))).rejects.toThrow(
      PathEscapeError,
    )
  })

  it('workspaceOf 返回 undefined 时落到 default,与不传 workspaceOf 一致', async () => {
    const c = new Context()
    await c.plugin(PrincipalService)
    const innerCtx = c.isolate('fs')
    await innerCtx.plugin(LocalFileSystem, { cwd: root })
    await c.plugin(TenantFileSystem, {
      inner: innerCtx.fs as FileSystem,
      root,
      workspaceOf: () => undefined,
    })

    const path = await runWithPrincipal(c, alice, async (scoped) => {
      const t = await scoped.fs.resolve('probe.txt')
      return scoped.fs.processPath(t)
    })
    expect(path.startsWith(tenantWorkspaceRoot(root, alice) + sep)).toBe(true)
  })

  it('工作区非法时拒绝,且不回落到 default —— 缺省不是旁路', async () => {
    const c = new Context()
    await c.plugin(PrincipalService)
    const innerCtx = c.isolate('fs')
    await innerCtx.plugin(LocalFileSystem, { cwd: root })
    await c.plugin(TenantFileSystem, {
      inner: innerCtx.fs as FileSystem,
      root,
      workspaceOf: () => '   ',
    })

    await expect(
      runWithPrincipal(c, alice, (scoped) => scoped.fs.resolve('x.txt')),
    ).rejects.toThrow(PathEscapeError)
  })
})
