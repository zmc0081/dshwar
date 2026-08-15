/**
 * 验证 C —— 并发无串号
 *
 * 这是四项里最容易「假绿」的一项:顺序执行永远不串号,必须制造真实交错。
 * 做法:在 resolve 内部插入随机 await,强制 Promise 在 principal 读取前后被挂起,
 * 再并发拉起两组 principal 各 100 次。若作用域是靠某种「当前 principal」全局态
 * 实现的,这里必然串号。
 *
 * 本项失败 → 与验证 A 同级止损:架构改为进程级隔离优先。
 */
import { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { check, checkEqual, groupHeader } from './harness.ts'

const G = '验证 C · 并发无串号'

interface TestPrincipal {
  id: string
  tenantId: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 故意在读取 principal 前后各挂起一次,最大化交错窗口。 */
class InterleavingCredentials extends CredentialProvider {
  store = new Map<string, string>()

  constructor(ctx: Context) {
    super(ctx)
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    // 挂起点 1:读 principal 之前
    await sleep(Math.random() * 3)
    const principal = this.ctx.get('principal') as TestPrincipal | undefined
    // 挂起点 2:读到 principal 之后、取值之前 —— 若存在共享可变态,这里必被覆盖
    await sleep(Math.random() * 3)
    if (!principal) return undefined
    const value = this.store.get(principal.id)
    if (value === undefined || value === '') return undefined
    // 挂起点 3:返回之前
    await sleep(Math.random() * 3)
    return { value, source: `per-principal:${principal.id}` }
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const principal = this.ctx.get('principal') as TestPrincipal | undefined
    if (!principal) return { configured: false, writable: false }
    return {
      configured: this.store.has(principal.id),
      source: `per-principal:${principal.id}`,
      writable: true,
    }
  }

  async set(): Promise<void> {
    throw new Error('not used in concurrency probe')
  }

  async unset(): Promise<void> {
    throw new Error('not used in concurrency probe')
  }
}

function withPrincipal(ctx: Context, principal: TestPrincipal): Context {
  const scoped = ctx.isolate('principal')
  scoped.provide('principal', principal)
  return scoped
}

export async function runC(): Promise<void> {
  groupHeader(`${G}(止损点)`)

  const REF = credentialRef('DEEPSEEK_API_KEY')
  const ROUNDS = 100

  const root = new Context()
  await root.plugin(InterleavingCredentials)
  const provider = root.get('credentials') as InterleavingCredentials
  provider.store.set('alice', 'sk-alice-0001')
  provider.store.set('bob', 'sk-bob-0002')

  const alice: TestPrincipal = { id: 'alice', tenantId: 't1' }
  const bob: TestPrincipal = { id: 'bob', tenantId: 't2' }

  // ---------- C1 两 principal 各 100 次,全部并发 ----------
  const aliceCtx = withPrincipal(root, alice)
  const bobCtx = withPrincipal(root, bob)

  const jobs: Promise<{ who: string; value: string | undefined }>[] = []
  for (let i = 0; i < ROUNDS; i += 1) {
    jobs.push(
      (aliceCtx.get('credentials') as InterleavingCredentials)
        .resolve(REF)
        .then((r) => ({ who: 'alice', value: r?.value })),
    )
    jobs.push(
      (bobCtx.get('credentials') as InterleavingCredentials)
        .resolve(REF)
        .then((r) => ({ who: 'bob', value: r?.value })),
    )
  }
  const settled = await Promise.all(jobs)

  const crossTalk = settled.filter(
    (r) =>
      (r.who === 'alice' && r.value !== 'sk-alice-0001') ||
      (r.who === 'bob' && r.value !== 'sk-bob-0002'),
  )
  checkEqual(G, `C1a 共 ${ROUNDS * 2} 次并发解析全部完成`, settled.length, ROUNDS * 2)
  check(
    G,
    `C1b 无一次串号(${ROUNDS} × alice + ${ROUNDS} × bob,含三处随机挂起)`,
    crossTalk.length === 0,
    crossTalk.length === 0
      ? '0 次串号'
      : `串号 ${crossTalk.length} 次,样本: ${JSON.stringify(crossTalk.slice(0, 3))}`,
  )

  // ---------- C2 每次 resolve 都新建会话作用域(更接近真实请求模型) ----------
  // 真实网关是「一请求一 withPrincipal」,而非复用长命 context。分别验证。
  const freshJobs: Promise<{ who: string; value: string | undefined }>[] = []
  for (let i = 0; i < ROUNDS; i += 1) {
    const who: TestPrincipal = i % 2 === 0 ? alice : bob
    const expected = who.id === 'alice' ? 'sk-alice-0001' : 'sk-bob-0002'
    freshJobs.push(
      (async () => {
        const scoped = withPrincipal(root, who)
        const r = await (scoped.get('credentials') as InterleavingCredentials).resolve(REF)
        return { who: who.id, value: r?.value === expected ? r?.value : `MISMATCH:${r?.value}` }
      })(),
    )
  }
  const freshSettled = await Promise.all(freshJobs)
  const freshCrossTalk = freshSettled.filter((r) => String(r.value).startsWith('MISMATCH'))
  check(
    G,
    `C2 每请求新建作用域 ${ROUNDS} 次并发,无串号`,
    freshCrossTalk.length === 0,
    freshCrossTalk.length === 0 ? '0 次串号' : `串号 ${freshCrossTalk.length} 次`,
  )

  // ---------- C3 三租户交叉,验证不是「两个刚好错开」 ----------
  provider.store.set('carol', 'sk-carol-0003')
  const three: TestPrincipal[] = [alice, bob, { id: 'carol', tenantId: 't3' }]
  const expectedBy: Record<string, string> = {
    alice: 'sk-alice-0001',
    bob: 'sk-bob-0002',
    carol: 'sk-carol-0003',
  }
  const triJobs: Promise<boolean>[] = []
  for (let i = 0; i < ROUNDS; i += 1) {
    const who = three[i % 3]!
    triJobs.push(
      (async () => {
        const scoped = withPrincipal(root, who)
        const r = await (scoped.get('credentials') as InterleavingCredentials).resolve(REF)
        return r?.value === expectedBy[who.id]
      })(),
    )
  }
  const triResults = await Promise.all(triJobs)
  const triBad = triResults.filter((ok) => !ok).length
  check(
    G,
    `C3 三 principal 交叉并发 ${ROUNDS} 次,无串号`,
    triBad === 0,
    triBad === 0 ? '0 次串号' : `串号 ${triBad} 次`,
  )

  // ---------- C4 匿名与具名混跑,匿名不得借到别人的 key ----------
  const mixedJobs: Promise<string>[] = []
  for (let i = 0; i < ROUNDS; i += 1) {
    if (i % 2 === 0) {
      mixedJobs.push(
        (async () => {
          const scoped = withPrincipal(root, alice)
          const r = await (scoped.get('credentials') as InterleavingCredentials).resolve(REF)
          return r?.value === 'sk-alice-0001' ? 'ok' : `named-bad:${r?.value}`
        })(),
      )
    } else {
      mixedJobs.push(
        (async () => {
          // 匿名:直接用 root,作用域里没有 principal
          const r = await (root.get('credentials') as InterleavingCredentials).resolve(REF)
          return r === undefined ? 'ok' : `anon-leaked:${r.value}`
        })(),
      )
    }
  }
  const mixedResults = await Promise.all(mixedJobs)
  const leaked = mixedResults.filter((r) => r !== 'ok')
  check(
    G,
    `C4 匿名与具名 ${ROUNDS} 次混合并发,匿名始终解析不到凭据`,
    leaked.length === 0,
    leaked.length === 0
      ? '0 次泄漏'
      : `泄漏 ${leaked.length} 次,样本: ${leaked.slice(0, 3).join(', ')}`,
  )
}
