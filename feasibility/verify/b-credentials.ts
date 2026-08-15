/**
 * 验证 B —— 凭据不跨操作缓存
 *
 * 上游 dsh-credentials 的 TSDoc 明文承诺:
 *   "Resolution is per call: consumers re-resolve at each operation and must not
 *    cache across operations — that per-operation read is what makes a changed
 *    credential reach the next operation without a restart."
 * 本 Session 要验的是**行为**是否兑现这句话,而不是复述它。
 *
 * 同时顺带确认 CLAUDE.md 硬规则 5、6 在上游契约上能否原样落地:
 *   规则 5 —— describe 只暴露 configured / source / writable,永不返回值
 *   规则 6 —— 缺失 principal 一律 fail closed,不回退共享 key
 */
import { Context, Service } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { check, checkEqual, checkRejects, groupHeader } from './harness.ts'

const G = '验证 B · 凭据不跨操作缓存'

interface TestPrincipal {
  id: string
  tenantId: string
}

/**
 * 最小可用的 per-principal 凭据实现 —— 这是 @dshwar/credentials-multiuser 的
 * 原型,但只为验证机制,不做持久化、不做遮蔽以外的任何治理。
 *
 * 注意:实例状态刻意用普通属性而非 `#private` 字段。原因见 B6 —— cordis 通过
 * Proxy 包装服务以重绑 this.ctx,`#private` 在 Proxy 上会抛 TypeError。
 */
class PerPrincipalCredentials extends CredentialProvider {
  /** principalId → (ref → value)。运营方持有的凭据按 principal 分账。 */
  store = new Map<string, Map<string, string>>()
  /** 被网关短时效 token 遮蔽的 ref:只读,set/unset 必须拒绝。 */
  shadowed = new Map<string, string>()
  /** 解析计数,用于证明每次操作都真的重新读了一遍,而不是命中缓存。 */
  resolveCalls = 0

  constructor(ctx: Context) {
    super(ctx)
  }

  /** 现场读取访问方作用域上的 principal —— 不缓存,不记忆上一次是谁。 */
  currentPrincipal(): TestPrincipal | undefined {
    return this.ctx.get('principal') as TestPrincipal | undefined
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolveCalls += 1

    const shadow = this.shadowed.get(ref)
    if (shadow !== undefined && shadow !== '') {
      return { value: shadow, source: 'gateway-scoped-token' }
    }

    const principal = this.currentPrincipal()
    // 硬规则 6:匿名解析不到任何凭据,不回退默认值 / 共享 key / 环境变量。
    if (!principal) return undefined

    const value = this.store.get(principal.id)?.get(ref)
    // 上游 seam 规则:空值等同缺失。
    if (value === undefined || value === '') return undefined
    return { value, source: `per-principal:${principal.id}` }
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const shadow = this.shadowed.get(ref)
    if (shadow !== undefined && shadow !== '') {
      return { configured: true, source: 'gateway-scoped-token', writable: false }
    }
    const principal = this.currentPrincipal()
    if (!principal) return { configured: false, writable: false }
    const value = this.store.get(principal.id)?.get(ref)
    if (value === undefined || value === '') return { configured: false, writable: true }
    return { configured: true, source: `per-principal:${principal.id}`, writable: true }
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    if (this.shadowed.has(ref)) {
      throw new Error(`ref ${ref} is shadowed by a read-only gateway token; refusing to write`)
    }
    if (value === '') throw new Error('empty value; use unset()')
    const principal = this.currentPrincipal()
    if (!principal) throw new Error('no principal in scope; refusing to write (fail closed)')

    let bucket = this.store.get(principal.id)
    if (!bucket) {
      bucket = new Map()
      this.store.set(principal.id, bucket)
    }
    bucket.set(ref, value)
    this.notifyUpdated(ref)
  }

  async unset(ref: CredentialRef): Promise<void> {
    if (this.shadowed.has(ref)) {
      throw new Error(`ref ${ref} is shadowed by a read-only gateway token; refusing to write`)
    }
    const principal = this.currentPrincipal()
    if (!principal) throw new Error('no principal in scope; refusing to write (fail closed)')
    this.store.get(principal.id)?.delete(ref)
    this.notifyUpdated(ref)
  }
}

/** 模拟 @dshwar/principal 的 withPrincipal:isolate 出会话作用域并绑定 principal。 */
function withPrincipal(ctx: Context, principal: TestPrincipal): Context {
  const scoped = ctx.isolate('principal')
  scoped.provide('principal', principal)
  return scoped
}

export async function runB(): Promise<void> {
  groupHeader(`${G}(止损点)`)

  const REF = credentialRef('DEEPSEEK_API_KEY')

  const root = new Context()
  await root.plugin(PerPrincipalCredentials)

  const provider = root.get('credentials') as PerPrincipalCredentials
  provider.store.set('alice', new Map([[REF, 'sk-alice-0001']]))
  provider.store.set('bob', new Map([[REF, 'sk-bob-0002']]))

  const alice: TestPrincipal = { id: 'alice', tenantId: 't1' }
  const bob: TestPrincipal = { id: 'bob', tenantId: 't2' }

  const aliceCtx = withPrincipal(root, alice)
  const bobCtx = withPrincipal(root, bob)

  // ---------- B1 两 principal 同一 ref 解析到各自的值 ----------
  const rA = await (aliceCtx.get('credentials') as PerPrincipalCredentials).resolve(REF)
  const rB = await (bobCtx.get('credentials') as PerPrincipalCredentials).resolve(REF)
  checkEqual(G, 'B1a alice 解析到自己的 key', rA?.value, 'sk-alice-0001')
  checkEqual(G, 'B1b bob 解析到自己的 key', rB?.value, 'sk-bob-0002')
  check(
    G,
    'B1c 同一 ref 在同一运行时解析出不同值',
    rA?.value !== rB?.value,
    '零消费方改动,零插件重启',
  )

  // ---------- B2 先后解析:第二次立即返回第二个 principal 的值 ----------
  // 顺序执行而非并发,专门证明「不跨操作缓存」——若有缓存,第二次会返回第一次的值。
  const seq1 = await (
    withPrincipal(root, alice).get('credentials') as PerPrincipalCredentials
  ).resolve(REF)
  const seq2 = await (
    withPrincipal(root, bob).get('credentials') as PerPrincipalCredentials
  ).resolve(REF)
  const seq3 = await (
    withPrincipal(root, alice).get('credentials') as PerPrincipalCredentials
  ).resolve(REF)
  checkEqual(G, 'B2a 顺序解析第 1 次(alice)', seq1?.value, 'sk-alice-0001')
  checkEqual(G, 'B2b 顺序解析第 2 次(bob)立即换值', seq2?.value, 'sk-bob-0002')
  checkEqual(G, 'B2c 顺序解析第 3 次(alice)换回', seq3?.value, 'sk-alice-0001')

  // ---------- B3 换绑后下一次操作即生效,无需重启插件 ----------
  const before = await (aliceCtx.get('credentials') as PerPrincipalCredentials).resolve(REF)
  provider.store.get('alice')!.set(REF, 'sk-alice-ROTATED')
  const after = await (aliceCtx.get('credentials') as PerPrincipalCredentials).resolve(REF)
  checkEqual(G, 'B3a 换绑前', before?.value, 'sk-alice-0001')
  checkEqual(G, 'B3b 换绑后「下一次操作」即生效,未重启任何插件', after?.value, 'sk-alice-ROTATED')

  // ---------- B4 匿名 principal fail closed(硬规则 6) ----------
  const anonRoot = new Context()
  await anonRoot.plugin(PerPrincipalCredentials)
  const anonProvider = anonRoot.get('credentials') as PerPrincipalCredentials
  anonProvider.store.set('alice', new Map([[REF, 'sk-alice-0001']]))
  const anonResolved = await (anonRoot.get('credentials') as PerPrincipalCredentials).resolve(REF)
  checkEqual(
    G,
    'B4a 无 principal 时 resolve 返回 undefined,不回退共享 key',
    anonResolved,
    undefined,
  )
  const anonInfo = await (anonRoot.get('credentials') as PerPrincipalCredentials).describe(REF)
  checkEqual(G, 'B4b 无 principal 时 describe 报 unconfigured', anonInfo.configured, false)
  await checkRejects(G, 'B4c 无 principal 时 set 被拒绝', () =>
    (anonRoot.get('credentials') as PerPrincipalCredentials).set(REF, 'sk-should-not-land'),
  )

  // ---------- B5 describe 永不返回值(硬规则 5) ----------
  const info = await (aliceCtx.get('credentials') as PerPrincipalCredentials).describe(REF)
  const infoKeys = Object.keys(info).sort()
  check(
    G,
    'B5a describe 只暴露 configured / source / writable',
    infoKeys.every((k) => ['configured', 'source', 'writable'].includes(k)),
    `实际字段: ${infoKeys.join(', ')}`,
  )
  check(
    G,
    'B5b describe 的返回体不含任何 key 值',
    !JSON.stringify(info).includes('sk-alice'),
    `describe = ${JSON.stringify(info)}`,
  )

  // ---------- B6 遮蔽机制:网关短时效 token 落点 ----------
  const gwRoot = new Context()
  await gwRoot.plugin(PerPrincipalCredentials)
  const gwProvider = gwRoot.get('credentials') as PerPrincipalCredentials
  gwProvider.store.set('alice', new Map([[REF, 'sk-alice-own']]))
  gwProvider.shadowed.set(REF, 'sk-gateway-shortlived')

  const gwCtx = withPrincipal(gwRoot, alice)
  const gwResolved = await (gwCtx.get('credentials') as PerPrincipalCredentials).resolve(REF)
  checkEqual(G, 'B6a 被遮蔽的 ref:resolve 返回网关值', gwResolved?.value, 'sk-gateway-shortlived')
  const gwInfo = await (gwCtx.get('credentials') as PerPrincipalCredentials).describe(REF)
  checkEqual(G, 'B6b 被遮蔽的 ref:describe 报 writable=false', gwInfo.writable, false)
  await checkRejects(G, 'B6c 被遮蔽的 ref:set 抛错', () =>
    (gwCtx.get('credentials') as PerPrincipalCredentials).set(REF, 'sk-user-attempt'),
  )
  await checkRejects(G, 'B6d 被遮蔽的 ref:unset 抛错', () =>
    (gwCtx.get('credentials') as PerPrincipalCredentials).unset(REF),
  )

  // ---------- B7 notifyUpdated 事件确实发出 ----------
  const evRoot = new Context()
  await evRoot.plugin(PerPrincipalCredentials)
  let notified: string | undefined
  evRoot.on('credentials/updated', (ref: CredentialRef) => {
    notified = ref
  })
  const evCtx = withPrincipal(evRoot, alice)
  await (evCtx.get('credentials') as PerPrincipalCredentials).set(REF, 'sk-alice-new')
  checkEqual(G, 'B7 set 后 credentials/updated 事件发出', notified, REF)

  // ---------- B8 上游 seam 规则:空值等同缺失 ----------
  const emptyRoot = new Context()
  await emptyRoot.plugin(PerPrincipalCredentials)
  const emptyProvider = emptyRoot.get('credentials') as PerPrincipalCredentials
  emptyProvider.store.set('alice', new Map([[REF, '']]))
  const emptyCtx = withPrincipal(emptyRoot, alice)
  const emptyResolved = await (emptyCtx.get('credentials') as PerPrincipalCredentials).resolve(REF)
  checkEqual(G, 'B8a 空值 resolve 视为缺失', emptyResolved, undefined)
  const emptyInfo = await (emptyCtx.get('credentials') as PerPrincipalCredentials).describe(REF)
  checkEqual(G, 'B8b 空值 describe 报 unconfigured', emptyInfo.configured, false)

  // ---------- B9 credentialRef 的字符白名单 ----------
  check(
    G,
    'B9 credentialRef 拒绝非 POSIX 标识符(路径注入面收窄)',
    (() => {
      try {
        credentialRef('../../etc/passwd')
        return false
      } catch {
        return true
      }
    })(),
    '上游已在 ref 层做白名单校验',
  )
}

/**
 * B10 —— 单独一组:`#private` 字段在 traced service 上是否可用。
 * 这是 Session 2/4 写实现时的地雷:cordis 用 Proxy 包装服务以重绑 this.ctx,
 * 而 ECMAScript private field 在 Proxy 上访问会抛 TypeError。
 * 先在这里炸一次,好过 Session 4 花半天排查。
 */
export async function runB10(): Promise<void> {
  const G10 = '验证 B10 · Service 中 #private 字段的可用性'
  groupHeader(`${G10}(实现约束探查,非止损点)`)

  class PrivateFieldService extends Service {
    #secret = 'only-reachable-on-the-real-instance'
    /** 对照组:TypeScript 的 private 只是编译期修饰,运行时是普通属性。 */
    private tsPrivate = 'reachable-through-the-proxy'
    constructor(ctx: Context) {
      super(ctx, 'privateFieldProbe')
    }
    readPrivate(): string {
      return this.#secret
    }
    readTsPrivate(): string {
      return this.tsPrivate
    }
  }

  const root = new Context()
  await root.plugin(PrivateFieldService)

  const scoped = root.isolate('principal')
  scoped.provide('principal', { id: 'alice', tenantId: 't1' })

  let viaRootOk = false
  let viaRootDetail = ''
  try {
    ;(root.get('privateFieldProbe') as PrivateFieldService).readPrivate()
    viaRootOk = true
  } catch (error) {
    viaRootDetail = (error as Error).message.slice(0, 140)
  }
  check(G10, 'B10a 从根作用域访问服务时可读 #private 字段', viaRootOk, viaRootDetail)

  let viaScopedOk = false
  let viaScopedDetail = ''
  try {
    ;(scoped.get('privateFieldProbe') as PrivateFieldService).readPrivate()
    viaScopedOk = true
  } catch (error) {
    viaScopedDetail = (error as Error).message.slice(0, 140)
  }
  check(
    G10,
    'B10b 从 isolate 子作用域访问服务时可读 #private 字段',
    viaScopedOk,
    viaScopedDetail || '可读 —— DSHWAR 包内可自由使用 #private',
  )

  // 对照组:确认「改用普通属性」这条绕行方案确实成立,好让 Session 2 有明确写法
  let tsPrivateOk = false
  let tsPrivateDetail = ''
  try {
    const v = (scoped.get('privateFieldProbe') as PrivateFieldService).readTsPrivate()
    tsPrivateOk = v === 'reachable-through-the-proxy'
    tsPrivateDetail = `读到 "${v}"`
  } catch (error) {
    tsPrivateDetail = (error as Error).message.slice(0, 140)
  }
  check(
    G10,
    'B10c 对照:TypeScript private(运行时普通属性)可穿透 Proxy',
    tsPrivateOk,
    tsPrivateDetail,
  )
}
