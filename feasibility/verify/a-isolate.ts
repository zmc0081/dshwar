/**
 * 验证 A —— ctx.isolate 作用域传播
 *
 * ARCHITECTURE.md §2.2 押注:`ctx.isolate(name, label?)` 返回拥有独立服务槽位的
 * 子上下文,相同 label 的调用合并作用域。本项不通过 → 逻辑隔离不成立,
 * 架构必须改为进程级隔离优先(SESSION_TASKS.md Session 0 止损路径)。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { check, checkEqual, groupHeader } from './harness.ts'

const G = '验证 A · ctx.isolate 作用域传播'

interface TestPrincipal {
  id: string
  tenantId: string
}

export async function runA(): Promise<void> {
  groupHeader(`${G}(止损点)`)

  // ---------- A1 兄弟作用域互不可见 ----------
  const root = new Context()
  const alice = root.isolate('principal')
  const bob = root.isolate('principal')

  alice.provide('principal', { id: 'alice', tenantId: 't1' } satisfies TestPrincipal)
  bob.provide('principal', { id: 'bob', tenantId: 't2' } satisfies TestPrincipal)

  checkEqual(G, 'A1a 子作用域 alice 读到自己的 principal', alice.get('principal'), {
    id: 'alice',
    tenantId: 't1',
  })
  checkEqual(G, 'A1b 子作用域 bob 读到自己的 principal', bob.get('principal'), {
    id: 'bob',
    tenantId: 't2',
  })
  check(
    G,
    'A1c 兄弟作用域互不可见',
    (alice.get('principal') as TestPrincipal).id !== (bob.get('principal') as TestPrincipal).id,
    'alice 读不到 bob 的 principal,反之亦然',
  )

  // ---------- A2 父作用域不受子作用域影响 ----------
  checkEqual(G, 'A2 父作用域仍为空,未被子作用域污染', root.get('principal'), undefined)

  // ---------- A3 相同 label 合并作用域 ----------
  const shared = Symbol('tenant-t9')
  const s1 = root.isolate('principal', shared)
  const s2 = root.isolate('principal', shared)
  s1.provide('principal', { id: 'carol', tenantId: 't9' } satisfies TestPrincipal)
  checkEqual(G, 'A3 相同 label 的两次 isolate 合并作用域', s2.get('principal'), {
    id: 'carol',
    tenantId: 't9',
  })

  // ---------- A4 嵌套 isolate:孙作用域覆盖子作用域 ----------
  const nested = alice.isolate('principal')
  nested.provide('principal', { id: 'alice-subagent', tenantId: 't1' } satisfies TestPrincipal)
  checkEqual(G, 'A4a 孙作用域读到自己的 principal', nested.get('principal'), {
    id: 'alice-subagent',
    tenantId: 't1',
  })
  checkEqual(G, 'A4b 嵌套后父作用域 alice 不受影响', alice.get('principal'), {
    id: 'alice',
    tenantId: 't1',
  })

  // ---------- A5 作用域随 fiber 释放而自动解绑 ----------
  // withPrincipal 返回的 context 是「服务端交给一个会话的东西」,
  // 会话结束必须自动解绑,否则 principal 泄漏到下一个会话。
  const disposeRoot = new Context()
  const scoped = disposeRoot.isolate('principal')
  const dispose = scoped.provide('principal', {
    id: 'ephemeral',
    tenantId: 't3',
  } satisfies TestPrincipal)
  checkEqual(
    G,
    'A5a 解绑前可读到 principal',
    (scoped.get('principal') as TestPrincipal | undefined)?.id,
    'ephemeral',
  )
  await dispose()
  checkEqual(G, 'A5b 解绑后 principal 消失(会话结束不泄漏)', scoped.get('principal'), undefined)

  // ---------- A6 服务在父作用域注册时,this.ctx 重绑到访问方 ----------
  // 这是「单实例 + 消费方零改动」能否成立的关键:credentials 只注册一次,
  // 却要按访问它的作用域解析出不同的 principal。
  class PrincipalReader extends Service {
    constructor(ctx: Context) {
      super(ctx, 'principalReader')
    }
    read(): TestPrincipal | undefined {
      return this.ctx.get('principal') as TestPrincipal | undefined
    }
  }

  const root2 = new Context()
  await root2.plugin(PrincipalReader)

  const a2 = root2.isolate('principal')
  a2.provide('principal', { id: 'alice', tenantId: 't1' } satisfies TestPrincipal)
  const b2 = root2.isolate('principal')
  b2.provide('principal', { id: 'bob', tenantId: 't2' } satisfies TestPrincipal)

  const readerA = a2.get('principalReader') as PrincipalReader
  const readerB = b2.get('principalReader') as PrincipalReader

  checkEqual(G, 'A6a 父作用域注册的服务,从 alice 访问时读到 alice', readerA.read()?.id, 'alice')
  checkEqual(G, 'A6b 同一服务从 bob 访问时读到 bob', readerB.read()?.id, 'bob')
  check(
    G,
    'A6c 每个访问方拿到各自的 traced wrapper',
    readerA !== readerB,
    'alice 与 bob 取到的服务引用不是同一个对象(this.ctx 已重绑)',
  )
  checkEqual(
    G,
    'A6d 根作用域访问同一服务读到空 principal',
    (root2.get('principalReader') as PrincipalReader).read(),
    undefined,
  )
}
