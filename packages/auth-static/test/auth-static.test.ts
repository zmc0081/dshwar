import { Context } from '@deepseek-ai/cordis'
import { AuthError } from '@dshwar/auth'
import { ANONYMOUS, isAnonymousPrincipal } from '@dshwar/principal'
import { describe, expect, it } from 'vitest'
import { StaticAuth, type StaticAuthEntry } from '../src/index.ts'

const ENTRIES: StaticAuthEntry[] = [
  { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] },
  { token: 'dev-bob', id: 'bob-a2b3', tenantId: 'globex', roles: ['admin'] },
]

async function authContext(entries: readonly StaticAuthEntry[] = ENTRIES): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(StaticAuth, { entries, quiet: true })
  return ctx
}

/**
 * 取出一次必然失败的 `verify` 的拒绝原因。
 *
 * 不用 `promise.catch(e => e as AuthError)`:那个表达式的类型是
 * `Principal | AuthError`,读 `.message` 会被类型检查拦下。更要紧的是,
 * 万一 `verify` 没拒绝,`.catch` 会把成功的主体原样递下去,后面的断言
 * 便在一个 `Principal` 上找 `message`,失败信息完全指错方向。
 */
async function rejectionOf(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise
  } catch (e: unknown) {
    return e as AuthError
  }
  throw new Error('verify 本应拒绝,却成功返回了主体')
}

describe('StaticAuth · 验证', () => {
  it('注册为 ctx.auth', async () => {
    const ctx = await authContext()
    expect(ctx.auth).toBeInstanceOf(StaticAuth)
  })

  it('已声明的 token 换出对应的主体', async () => {
    const ctx = await authContext()
    const alice = await ctx.auth.verify('dev-alice')

    expect(alice.id).toBe('alice-e6f1')
    expect(alice.tenantId).toBe('acme')
    expect(alice.roles).toEqual(['member'])
  })

  it('不同 token 换出不同主体', async () => {
    const ctx = await authContext()
    const alice = await ctx.auth.verify('dev-alice')
    const bob = await ctx.auth.verify('dev-bob')

    expect(alice.id).not.toBe(bob.id)
    expect(alice.tenantId).not.toBe(bob.tenantId)
  })

  it('返回的主体是冻结的', async () => {
    const ctx = await authContext()
    const alice = await ctx.auth.verify('dev-alice')
    expect(Object.isFrozen(alice)).toBe(true)
  })

  it('未知 token 抛 AuthError', async () => {
    const ctx = await authContext()
    await expect(ctx.auth.verify('nope')).rejects.toThrow(AuthError)
  })

  it('空 token 抛 AuthError', async () => {
    const ctx = await authContext()
    await expect(ctx.auth.verify('')).rejects.toThrow(AuthError)
  })

  it('验证成功的主体不是匿名', async () => {
    const ctx = await authContext()
    const alice = await ctx.auth.verify('dev-alice')
    expect(isAnonymousPrincipal(alice)).toBe(false)
  })
})

describe('AuthError · 不泄漏失败原因', () => {
  // 认证接口是预言机。区分「token 不存在」与其它原因,等于给攻击者一支探针:
  // 先枚举出哪些 token 真实存在,再针对性攻击。
  it('对不同的失败输入,错误消息完全一致', async () => {
    const ctx = await authContext()

    const messages: string[] = []
    for (const bad of ['', 'nope', 'dev-alic', 'DEV-ALICE', 'dev-alice ', '../../etc/passwd']) {
      await ctx.auth.verify(bad).catch((error: unknown) => {
        messages.push((error as Error).message)
      })
    }

    expect(messages).toHaveLength(6)
    expect(new Set(messages).size).toBe(1)
  })

  it('错误对象上没有 code / reason / cause 之类的分支依据', async () => {
    const ctx = await authContext()
    const error = await rejectionOf(ctx.auth.verify('nope'))

    expect(error).toBeInstanceOf(AuthError)
    expect(Object.keys(error)).not.toContain('code')
    expect(Object.keys(error)).not.toContain('reason')
    expect((error as unknown as { code?: unknown }).code).toBeUndefined()
    expect((error as unknown as { reason?: unknown }).reason).toBeUndefined()
    expect(error.cause).toBeUndefined()
  })

  it('错误消息不含被验证的 token —— 否则日志会变成 token 的明文副本', async () => {
    const ctx = await authContext()
    const secret = 'super-secret-token-value'
    const error = await rejectionOf(ctx.auth.verify(secret))

    expect(error.message).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it('错误消息不透露已配置的任何 token', async () => {
    const ctx = await authContext()
    const error = await rejectionOf(ctx.auth.verify('nope'))

    for (const entry of ENTRIES) {
      expect(error.message).not.toContain(entry.token)
    }
  })
})

describe('StaticAuth · 配置校验', () => {
  it('重复 token 在构造时拒绝,而不是静默覆盖', async () => {
    const ctx = new Context()
    await expect(
      ctx.plugin(StaticAuth, {
        entries: [
          { token: 'same', id: 'alice', tenantId: 'acme' },
          { token: 'same', id: 'bob', tenantId: 'globex' },
        ],
        quiet: true,
      }),
    ).rejects.toThrow(/重复声明/)
  })

  it('空 token 在构造时拒绝', async () => {
    const ctx = new Context()
    await expect(
      ctx.plugin(StaticAuth, {
        entries: [{ token: '', id: 'alice', tenantId: 'acme' }],
        quiet: true,
      }),
    ).rejects.toThrow(/不得为空/)
  })

  // 配置里写错的东西要在启动时炸,不要在半年后炸
  it('邮箱形状的 id 在构造时被 createPrincipal 拒绝', async () => {
    const ctx = new Context()
    await expect(
      ctx.plugin(StaticAuth, {
        entries: [{ token: 'dev', id: 'alice@corp.com', tenantId: 'acme' }],
        quiet: true,
      }),
    ).rejects.toThrow(/邮箱/)
  })

  it('带路径分隔符的 tenantId 在构造时被拒绝', async () => {
    const ctx = new Context()
    await expect(
      ctx.plugin(StaticAuth, {
        entries: [{ token: 'dev', id: 'alice', tenantId: '../other' }],
        quiet: true,
      }),
    ).rejects.toThrow()
  })

  // 症状会是「登录成功但什么都读不到」—— 下游 fail closed 了,
  // 但错误现场离根因隔了十万八千里
  it('映射到匿名主体在构造时被拒绝', async () => {
    const ctx = new Context()
    await expect(
      ctx.plugin(StaticAuth, {
        entries: [{ token: 'dev', id: ANONYMOUS.id, tenantId: ANONYMOUS.tenantId }],
        quiet: true,
      }),
    ).rejects.toThrow(/匿名/)
  })

  it('entries 为空时可正常构造,但任何 token 都验不过', async () => {
    const ctx = await authContext([])
    await expect(ctx.auth.verify('anything')).rejects.toThrow(AuthError)
  })
})

describe('StaticAuth · 部署警告', () => {
  // 这行警告是本包唯一的安全网。quiet 只该出现在测试里。
  it('默认构造会输出禁止部署的警告', async () => {
    const ctx = new Context()
    const warnings: string[] = []
    const original = ctx.logger.warn.bind(ctx.logger)
    ctx.logger.warn = ((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
      return original(...(args as Parameters<typeof original>))
    }) as typeof ctx.logger.warn

    await ctx.plugin(StaticAuth, { entries: ENTRIES })

    expect(warnings.join('\n')).toMatch(/禁止部署/)
  })

  it('quiet: true 时不输出警告', async () => {
    const ctx = new Context()
    const warnings: string[] = []
    ctx.logger.warn = ((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    }) as typeof ctx.logger.warn

    await ctx.plugin(StaticAuth, { entries: ENTRIES, quiet: true })

    expect(warnings.filter((w) => w.includes('禁止部署'))).toEqual([])
  })
})
