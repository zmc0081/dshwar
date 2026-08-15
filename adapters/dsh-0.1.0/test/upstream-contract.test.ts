/**
 * 上游契约测试 —— 把 DSHWAR 依赖的每一条上游语义变成断言。
 *
 * **目标:上游改接口或改语义,`pnpm test:contract` 立刻跑红,且红点直指本目录。**
 *
 * 这些断言看起来像在测别人的代码,但它们测的其实是**我们的假设**。
 * 每一条都对应 `packages/**` 里的一个实现决定 —— 假设失效时,
 * 我们需要在改产品代码之前就知道。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { FileSystem } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { UNIT_NAME_RE } from '@deepseek-ai/dsh-storage'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('cordis · 作用域与服务(Session 0 验证 A 的常驻版)', () => {
  // packages/principal 的 withPrincipal 完全建立在这条之上
  it('isolate 派生的兄弟作用域互不可见', () => {
    const root = new Context()
    const a = root.isolate('probe')
    const b = root.isolate('probe')
    a.provide('probe', 'A')
    b.provide('probe', 'B')

    expect(a.get('probe')).toBe('A')
    expect(b.get('probe')).toBe('B')
    expect(root.get('probe')).toBeUndefined()
  })

  it('相同 label 的两次 isolate 合并作用域', () => {
    const root = new Context()
    const label = Symbol('shared')
    const a = root.isolate('probe', label)
    const b = root.isolate('probe', label)
    a.provide('probe', 'shared-value')

    expect(b.get('probe')).toBe('shared-value')
  })

  // ★ 这条是 PrincipalService 单实例设计的全部依据
  it('父作用域注册的 Service,方法内 this.ctx 重绑到访问方', async () => {
    class Probe extends Service {
      constructor(ctx: Context) {
        super(ctx, 'contractProbe')
      }
      read(): unknown {
        return this.ctx.get('probe')
      }
    }
    const root = new Context()
    await root.plugin(Probe)

    const a = root.isolate('probe')
    a.provide('probe', 'A')
    const b = root.isolate('probe')
    b.provide('probe', 'B')

    expect((a.get('contractProbe') as Probe).read()).toBe('A')
    expect((b.get('contractProbe') as Probe).read()).toBe('B')
    expect(a.get('contractProbe')).not.toBe(b.get('contractProbe'))
  })

  it('provide 的 disposer 解除绑定', async () => {
    const root = new Context()
    const scoped = root.isolate('probe')
    const dispose = scoped.provide('probe', 'v')
    expect(scoped.get('probe')).toBe('v')
    await dispose()
    expect(scoped.get('probe')).toBeUndefined()
  })

  // ⚠️ 这条**故意断言一个失败**。cordis 用 Proxy 包装服务以重绑 this.ctx，
  // 于是 #private 在 wrapper 上必抛 TypeError。
  // 若上游哪天改了包装方式，这条会变红 —— 那是好消息，意味着可以放宽
  // eslint 的 no-restricted-syntax 规则。见 docs/FEASIBILITY-REPORT.md §4.1。
  it('Service 子类的 #private 字段仍然无法访问(约束仍成立)', async () => {
    class PrivateProbe extends Service {
      /*
       * 本测试的全部目的就是构造这个被禁止的写法,以确认「禁止它」的理由
       * (cordis 的 Proxy 让 #private 抛 TypeError)仍然成立。
       * 拦掉这里等于禁止验证这条规则本身。
       */
      // eslint-disable-next-line no-restricted-syntax
      #secret = 'unreachable'
      constructor(ctx: Context) {
        super(ctx, 'privateProbe')
      }
      read(): string {
        return this.#secret
      }
    }
    const root = new Context()
    await root.plugin(PrivateProbe)

    expect(() => (root.get('privateProbe') as PrivateProbe).read()).toThrow(TypeError)
  })
})

describe('dsh-credentials · 四方法与 seam 语义', () => {
  it('CredentialProvider 是抽象类,注册为 ctx.credentials', async () => {
    class Probe extends CredentialProvider {
      async resolve(): Promise<ResolvedCredential | undefined> {
        return { value: 'v', source: 'probe' }
      }
      async describe(): Promise<CredentialInfo> {
        return { configured: true, source: 'probe', writable: false }
      }
      async set(): Promise<void> {}
      async unset(): Promise<void> {}
    }
    const ctx = new Context()
    await ctx.plugin(Probe)
    expect(ctx.credentials).toBeInstanceOf(Probe)
  })

  // 硬规则 5 依赖这个形状 —— 多一个字段就可能泄漏值
  it('CredentialInfo 恰好只有 configured / source / writable', async () => {
    class Probe extends CredentialProvider {
      async resolve(): Promise<ResolvedCredential | undefined> {
        return undefined
      }
      async describe(): Promise<CredentialInfo> {
        return { configured: true, source: 's', writable: true }
      }
      async set(): Promise<void> {}
      async unset(): Promise<void> {}
    }
    const ctx = new Context()
    await ctx.plugin(Probe)
    const info = await ctx.credentials.describe(credentialRef('X'))
    expect(Object.keys(info).sort()).toEqual(['configured', 'source', 'writable'])
  })

  it('credentialRef 只接受 POSIX 标识符形状', () => {
    expect(() => credentialRef('DEEPSEEK_API_KEY')).not.toThrow()
    expect(() => credentialRef('_private')).not.toThrow()
    expect(() => credentialRef('../etc/passwd')).toThrow()
    expect(() => credentialRef('has-dash')).toThrow()
    expect(() => credentialRef('1LEADING_DIGIT')).toThrow()
    expect(() => credentialRef('')).toThrow()
  })

  it('notifyUpdated 发出 credentials/updated 事件', async () => {
    class Probe extends CredentialProvider {
      async resolve(): Promise<ResolvedCredential | undefined> {
        return undefined
      }
      async describe(): Promise<CredentialInfo> {
        return { configured: false, writable: true }
      }
      async set(ref: CredentialRef): Promise<void> {
        this.notifyUpdated(ref)
      }
      async unset(): Promise<void> {}
    }
    const ctx = new Context()
    await ctx.plugin(Probe)

    const seen: string[] = []
    ctx.on('credentials/updated', (ref: CredentialRef) => {
      seen.push(ref)
    })
    await ctx.credentials.set(credentialRef('X'), 'v')

    expect(seen).toEqual(['X'])
  })
})

describe('dsh-fs · 路径语义', () => {
  let root: string
  let ctx: Context

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dshwar-contract-'))
    ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  })

  it('FileSystem 抽象类注册为 ctx.fs', () => {
    expect(ctx.fs).toBeInstanceOf(FileSystem)
  })

  // ★ fs-tenant 的 realpath 复查完全依赖这一条
  it('resolve 会 realpath —— 符号链接被解引用到真实路径', async () => {
    const { symlink } = await import('node:fs/promises')
    await writeFile(join(root, 'real.txt'), 'content')
    try {
      await symlink(join(root, 'real.txt'), join(root, 'link.txt'))
    } catch {
      // Windows 非管理员建不了 symlink —— 这条在 Linux CI 上才真正被验证
      console.warn('[contract] 本机无法创建符号链接,跳过 realpath 断言')
      return
    }

    const target = await ctx.fs.resolve('link.txt')
    expect(ctx.fs.processPath(target)).toBe(join(root, 'real.txt'))
  })

  // ★ fs-tenant 的 processPath 复查依赖这一条
  it('processPath 返回绝对路径', async () => {
    await writeFile(join(root, 'a.txt'), 'x')
    const target = await ctx.fs.resolve('a.txt')
    const path = ctx.fs.processPath(target)
    expect(path).toBe(join(root, 'a.txt'))
  })

  // ★ 这是 fs-tenant 存在的理由：上游自己不做 containment
  it('cwd 不是 containment 边界 —— 上游会放行 ../ 逃逸', async () => {
    await writeFile(join(root, 'inside.txt'), 'x')
    const escaped = await ctx.fs.resolve('..')
    // 上游解析成功且落在 root 之外，正因如此 DSHWAR 需要一个 stricter backend
    expect(ctx.fs.processPath(escaped)).not.toBe(root)
    expect(root.startsWith(ctx.fs.processPath(escaped))).toBe(true)
  })

  it('写入后读回内容一致', async () => {
    const target = await ctx.fs.resolve('rw.txt')
    await ctx.fs.writeText(target, 'hello')
    expect(await ctx.fs.readText(target)).toBe('hello')
  })

  it('stat 返回元数据,不含内容', async () => {
    const target = await ctx.fs.resolve('s.txt')
    await ctx.fs.writeText(target, 'secret-content')
    const info = await ctx.fs.stat(target)
    expect(info).toBeDefined()
    expect(JSON.stringify(info)).not.toContain('secret-content')
  })

  it('不存在的 target stat 返回 undefined', async () => {
    const target = await ctx.fs.resolve('missing.txt')
    expect(await ctx.fs.stat(target)).toBeUndefined()
  })

  it('裸后端的 sandboxMode 为 undefined(不做约束)', () => {
    expect(ctx.fs.sandboxMode).toBeUndefined()
  })
})

describe('dsh-storage · 键语义', () => {
  // ★ storage-scoped 的长度前缀方案完全依赖这一条：
  //    记录键不参与路径拼接，所以任意字符串都能安全地当键
  it('UNIT_NAME_RE 只约束 unit / table 名,不约束记录键', () => {
    expect(UNIT_NAME_RE.test('sessions')).toBe(true)
    expect(UNIT_NAME_RE.test('records')).toBe(true)
    expect(UNIT_NAME_RE.test('../escape')).toBe(false)
    expect(UNIT_NAME_RE.test('has space')).toBe(false)
  })

  it('UNIT_NAME_RE 是一个正则,可被适配层直接复用', () => {
    expect(UNIT_NAME_RE).toBeInstanceOf(RegExp)
  })
})
