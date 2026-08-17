import { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  ANONYMOUS,
  createPrincipal,
  PRINCIPAL_BINDING,
  PrincipalService,
  runWithPrincipal,
} from '@dshwar/principal'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryPrincipalCredentialStore,
  MultiuserCredentials,
  type ShadowResolver,
} from '../src/index.ts'

const REF: CredentialRef = credentialRef('DEEPSEEK_API_KEY')
const OTHER_REF: CredentialRef = credentialRef('OPENAI_API_KEY')

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })

let store: InMemoryPrincipalCredentialStore

async function ctxWith(shadow?: ShadowResolver): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  // ★ V0.6.0:装配阶段**显式** provide ANONYMOUS —— 与 assembleRuntime 同款。
  // 不 provide 的话 current() 会抛 PrincipalUnboundError,而那正是本版本要的:
  // 「没人表过态」与「合法的单用户」不再是同一个值。
  ctx.provide(PRINCIPAL_BINDING, ANONYMOUS)
  await ctx.plugin(MultiuserCredentials, {
    store,
    ...(shadow === undefined ? {} : { shadow }),
  })
  return ctx
}

beforeEach(async () => {
  store = new InMemoryPrincipalCredentialStore()
  await store.put(alice, REF, 'sk-alice-0001')
  await store.put(bob, REF, 'sk-bob-0002')
})

describe('per-principal 解析 —— 论点的直接证明', () => {
  it('注册为 ctx.credentials', async () => {
    const ctx = await ctxWith()
    expect(ctx.credentials).toBeInstanceOf(MultiuserCredentials)
  })

  // 同一个运行时、同一个 ref、零消费方改动、零插件重启
  it('两个 principal 解析同一 ref 得到各自的值', async () => {
    const ctx = await ctxWith()

    const a = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))
    const b = await runWithPrincipal(ctx, bob, (c) => c.credentials.resolve(REF))

    expect(a?.value).toBe('sk-alice-0001')
    expect(b?.value).toBe('sk-bob-0002')
  })

  it('source 标注到具体 principal', async () => {
    const ctx = await ctxWith()
    const a = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))
    expect(a?.source).toBe(`principal:${alice.id}`)
  })

  // 复现 Session 0 验证 B:顺序执行才能证明「不跨操作缓存」——
  // 若有缓存,第二次会返回第一次的值
  it('顺序解析 alice→bob→alice,每次立即换值', async () => {
    const ctx = await ctxWith()

    const first = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))
    const second = await runWithPrincipal(ctx, bob, (c) => c.credentials.resolve(REF))
    const third = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))

    expect(first?.value).toBe('sk-alice-0001')
    expect(second?.value).toBe('sk-bob-0002')
    expect(third?.value).toBe('sk-alice-0001')
  })

  it('换绑后下一次 resolve 立即生效,无需重启插件', async () => {
    const ctx = await ctxWith()

    const before = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))
    await store.put(alice, REF, 'sk-alice-ROTATED')
    const after = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))

    expect(before?.value).toBe('sk-alice-0001')
    expect(after?.value).toBe('sk-alice-ROTATED')
  })

  it('未配置的 ref 返回 undefined', async () => {
    const ctx = await ctxWith()
    const r = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(OTHER_REF))
    expect(r).toBeUndefined()
  })

  it('并发解析 100 组 principal 无串号', async () => {
    const ctx = await ctxWith()
    const principals = Array.from({ length: 100 }, (_, i) =>
      createPrincipal({ id: `user-${i}`, tenantId: `t-${i % 5}` }),
    )
    await Promise.all(principals.map((p, i) => store.put(p, REF, `sk-${i}`)))

    const results = await Promise.all(
      principals.map((p, i) =>
        runWithPrincipal(ctx, p, async (c) => {
          await new Promise((r) => setTimeout(r, Math.random() * 3))
          const resolved = await c.credentials.resolve(REF)
          return resolved?.value === `sk-${i}`
        }),
      ),
    )

    expect(results.filter((ok) => !ok)).toEqual([])
  })
})

describe('fail closed(硬规则 6)', () => {
  // 若匿名能拿到运营方的 key,事故的表现形式是「一切正常」，
  // 直到月底看到账单
  it('匿名 resolve 返回 undefined,不回退共享 key', async () => {
    const ctx = await ctxWith()
    expect(await ctx.credentials.resolve(REF)).toBeUndefined()
  })

  it('匿名 describe 报 unconfigured 且不可写', async () => {
    const ctx = await ctxWith()
    const info = await ctx.credentials.describe(REF)
    expect(info.configured).toBe(false)
    expect(info.writable).toBe(false)
  })

  it('匿名 set 被拒绝', async () => {
    const ctx = await ctxWith()
    await expect(ctx.credentials.set(REF, 'sk-nope')).rejects.toThrow(/fail closed/)
  })

  it('匿名 unset 被拒绝', async () => {
    const ctx = await ctxWith()
    await expect(ctx.credentials.unset(REF)).rejects.toThrow(/fail closed/)
  })

  it('匿名写入被拒绝后,存储里不留痕迹', async () => {
    const ctx = await ctxWith()
    await ctx.credentials.set(REF, 'sk-nope').catch(() => undefined)
    expect(await store.get(alice, REF)).toBe('sk-alice-0001')
  })
})

describe('describe 永不返回值(硬规则 5)', () => {
  it('返回体只有 configured / source / writable', async () => {
    const ctx = await ctxWith()
    const info = await runWithPrincipal(ctx, alice, (c) => c.credentials.describe(REF))

    expect(Object.keys(info).sort()).toEqual(['configured', 'source', 'writable'])
  })

  it('序列化后不含任何 key 值', async () => {
    const ctx = await ctxWith()
    const info = await runWithPrincipal(ctx, alice, (c) => c.credentials.describe(REF))

    expect(JSON.stringify(info)).not.toContain('sk-alice')
  })

  it('已配置时 configured=true 且 writable=true', async () => {
    const ctx = await ctxWith()
    const info = await runWithPrincipal(ctx, alice, (c) => c.credentials.describe(REF))

    expect(info.configured).toBe(true)
    expect(info.writable).toBe(true)
  })

  it('未配置时 configured=false 但仍可写', async () => {
    const ctx = await ctxWith()
    const info = await runWithPrincipal(ctx, alice, (c) => c.credentials.describe(OTHER_REF))

    expect(info.configured).toBe(false)
    expect(info.writable).toBe(true)
  })
})

describe('空值等同缺失(上游 seam 规则)', () => {
  it('空值 resolve 视为缺失', async () => {
    await store.put(alice, REF, '')
    const ctx = await ctxWith()
    const r = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))
    expect(r).toBeUndefined()
  })

  it('空值 describe 报 unconfigured', async () => {
    await store.put(alice, REF, '')
    const ctx = await ctxWith()
    const info = await runWithPrincipal(ctx, alice, (c) => c.credentials.describe(REF))
    expect(info.configured).toBe(false)
  })

  it('set 空值被拒绝,提示改用 unset', async () => {
    const ctx = await ctxWith()
    await expect(runWithPrincipal(ctx, alice, (c) => c.credentials.set(REF, ''))).rejects.toThrow(
      /unset/,
    )
  })
})

describe('shadow 遮蔽 —— 用户永不持有 provider key', () => {
  const gatewayShadow: ShadowResolver = (principal, ref) =>
    ref === REF ? { value: `gw-token-for-${principal.id}` } : undefined

  it('被遮蔽的 ref:resolve 返回网关值而非用户自己的值', async () => {
    const ctx = await ctxWith(gatewayShadow)
    const r = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))

    expect(r?.value).toBe(`gw-token-for-${alice.id}`)
    expect(r?.source).toBe('gateway-scoped-token')
  })

  it('遮蔽按 principal 换发,不同用户拿到不同 token', async () => {
    const ctx = await ctxWith(gatewayShadow)
    const a = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))
    const b = await runWithPrincipal(ctx, bob, (c) => c.credentials.resolve(REF))

    expect(a?.value).not.toBe(b?.value)
  })

  it('被遮蔽的 ref:describe 报 writable=false', async () => {
    const ctx = await ctxWith(gatewayShadow)
    const info = await runWithPrincipal(ctx, alice, (c) => c.credentials.describe(REF))

    expect(info.configured).toBe(true)
    expect(info.writable).toBe(false)
    expect(info.source).toBe('gateway-scoped-token')
  })

  // 若允许写入，写会看起来成功而 resolve 仍返回遮蔽值 ——
  // 用户会反复保存、反复"失败"，却看不到任何错误
  it('被遮蔽的 ref:set 抛错', async () => {
    const ctx = await ctxWith(gatewayShadow)
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.credentials.set(REF, 'sk-user-attempt')),
    ).rejects.toThrow(/遮蔽/)
  })

  it('被遮蔽的 ref:unset 抛错', async () => {
    const ctx = await ctxWith(gatewayShadow)
    await expect(runWithPrincipal(ctx, alice, (c) => c.credentials.unset(REF))).rejects.toThrow(
      /遮蔽/,
    )
  })

  it('未被遮蔽的 ref 不受影响,照常读写', async () => {
    const ctx = await ctxWith(gatewayShadow)
    await runWithPrincipal(ctx, alice, (c) => c.credentials.set(OTHER_REF, 'sk-alice-openai'))
    const r = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(OTHER_REF))

    expect(r?.value).toBe('sk-alice-openai')
  })

  // 一个配错的空 token 若能生效，会把用户自己的 key 遮蔽掉，
  // 症状是「我明明配了 key 却解析不到」
  it('遮蔽值为空时视为不遮蔽,回落到用户自己的凭据', async () => {
    const ctx = await ctxWith(() => ({ value: '' }))
    const r = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))

    expect(r?.value).toBe('sk-alice-0001')
  })

  it('遮蔽解析器可返回自定义 source', async () => {
    const ctx = await ctxWith(() => ({ value: 'v', source: 'vault-lease' }))
    const info = await runWithPrincipal(ctx, alice, (c) => c.credentials.describe(REF))

    expect(info.source).toBe('vault-lease')
    expect(info.writable).toBe(false)
  })
})

describe('notifyUpdated —— 变更即刻生效', () => {
  it('set 后发出 credentials/updated', async () => {
    const ctx = await ctxWith()
    const seen: string[] = []
    ctx.on('credentials/updated', (ref: CredentialRef) => {
      seen.push(ref)
    })

    await runWithPrincipal(ctx, alice, (c) => c.credentials.set(REF, 'sk-new'))
    expect(seen).toEqual([REF])
  })

  it('unset 后发出 credentials/updated', async () => {
    const ctx = await ctxWith()
    const seen: string[] = []
    ctx.on('credentials/updated', (ref: CredentialRef) => {
      seen.push(ref)
    })

    await runWithPrincipal(ctx, alice, (c) => c.credentials.unset(REF))
    expect(seen).toEqual([REF])
  })

  it('被拒绝的写入不发事件', async () => {
    const ctx = await ctxWith()
    const seen: string[] = []
    ctx.on('credentials/updated', (ref: CredentialRef) => {
      seen.push(ref)
    })

    await ctx.credentials.set(REF, 'sk-nope').catch(() => undefined)
    expect(seen).toEqual([])
  })
})

describe('写入的隔离性', () => {
  it('alice 写入不影响 bob', async () => {
    const ctx = await ctxWith()
    await runWithPrincipal(ctx, alice, (c) => c.credentials.set(REF, 'sk-alice-new'))

    const b = await runWithPrincipal(ctx, bob, (c) => c.credentials.resolve(REF))
    expect(b?.value).toBe('sk-bob-0002')
  })

  it('alice 删除不影响 bob', async () => {
    const ctx = await ctxWith()
    await runWithPrincipal(ctx, alice, (c) => c.credentials.unset(REF))

    const a = await runWithPrincipal(ctx, alice, (c) => c.credentials.resolve(REF))
    const b = await runWithPrincipal(ctx, bob, (c) => c.credentials.resolve(REF))

    expect(a).toBeUndefined()
    expect(b?.value).toBe('sk-bob-0002')
  })

  it('删除不存在的凭据是 no-op,不抛错', async () => {
    const ctx = await ctxWith()
    await expect(
      runWithPrincipal(ctx, alice, (c) => c.credentials.unset(OTHER_REF)),
    ).resolves.toBeUndefined()
  })
})
