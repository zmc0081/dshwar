/**
 * **作业队列(V0.5.5 Session 3)**。
 *
 * ## 验收:进程重启后未完成的作业能被重新拾起
 *
 * 不是「不会崩」,是**崩了之后不会永久卡住**。
 * 一个 `running` 的作业,它的执行器进程被回收之后,如果没人管它,
 * 它会永远停在 `running` —— 用户看到的是一个转了三天的圈。
 *
 * 而进程隔离档下**进程被回收是正常路径**(空闲回收),
 * 所以这不是罕见事故,是每天都在发生的事。
 */
import { createPrincipal } from '@dshwar/principal'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryJobStore } from '../src/jobs/store.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })

let store: InMemoryJobStore
beforeEach(() => {
  store = new InMemoryJobStore()
})

describe('作业生命周期', () => {
  it('建出来是 queued,认领后 running,结束后落终态', async () => {
    const job = await store.create(alice, { workspaceId: 'w1', kind: 'export' })
    expect(job.status).toBe('queued')
    expect(job.claimedBy).toBeNull()
    expect(job.finishedAt).toBeNull()

    const claimed = await store.claim('exec-1')
    expect(claimed?.status).toBe('running')
    expect(claimed?.claimedBy).toBe('exec-1')

    const done = await store.finish(job.id, { status: 'succeeded' })
    expect(done?.status).toBe('succeeded')
    expect(done?.finishedAt).not.toBeNull()
  })

  it('先进先出', async () => {
    const first = await store.create(alice, { workspaceId: 'w', kind: 'a' })
    await new Promise((r) => setTimeout(r, 2))
    await store.create(alice, { workspaceId: 'w', kind: 'b' })

    expect((await store.claim('e1'))?.id).toBe(first.id)
  })

  it('★ 终态不可再变 —— 后到的失败回调不得覆盖已成功的作业', async () => {
    // 这是分布式系统里很常见的一类错乱:执行器超时重试,
    // 第一次的成功与第二次的失败先后到达。覆盖的话账就错了。
    const job = await store.create(alice, { workspaceId: 'w', kind: 'a' })
    await store.claim('e1')
    await store.finish(job.id, { status: 'succeeded' })

    const late = await store.finish(job.id, { status: 'failed', error: '迟到的失败' })
    expect(late?.status).toBe('succeeded')
    expect(late?.error).toBeNull()
  })

  it('没有可认领的作业时返回 undefined,而不是抛错', async () => {
    expect(await store.claim('e1')).toBeUndefined()
  })
})

describe('★ 跨重启恢复', () => {
  it('★ 执行器不在了 → running 作业不会永久卡住', async () => {
    const job = await store.create(alice, { workspaceId: 'w', kind: 'a' })
    await store.claim('exec-dead')

    // 网关重启,现在活着的执行器里没有 exec-dead
    const recovered = await store.recover(['exec-new'], 'requeue')

    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.id).toBe(job.id)
    expect(recovered[0]!.status).toBe('queued')
    // ★ claimedBy 必须清掉 —— 否则下一轮恢复会以为它还被认领着,
    //   而那个执行器永远不会回来,作业于是在两个状态间打转
    expect(recovered[0]!.claimedBy).toBeNull()

    // 放回队列之后真的能被重新认领
    expect((await store.claim('exec-new'))?.id).toBe(job.id)
  })

  it('interrupt 模式:标成 interrupted 并说清是进程没了', async () => {
    const job = await store.create(alice, { workspaceId: 'w', kind: 'a' })
    await store.claim('exec-dead')

    const recovered = await store.recover([], 'interrupt')
    expect(recovered[0]!.status).toBe('interrupted')
    // ★ 用户据此判断该直接重试,而不是去查自己的输入
    expect(recovered[0]!.error).toContain('执行器已不存在')
    expect(recovered[0]!.finishedAt).not.toBeNull()
    void job
  })

  it('★ 执行器还活着的作业不受影响 —— 恢复不能误伤正在跑的', async () => {
    const alive = await store.create(alice, { workspaceId: 'w', kind: 'alive' })
    await store.claim('exec-1')

    const recovered = await store.recover(['exec-1'], 'requeue')
    expect(recovered).toHaveLength(0)
    expect((await store.get(alice, alive.id))?.status).toBe('running')
  })

  it('已经结束的作业不参与恢复', async () => {
    const job = await store.create(alice, { workspaceId: 'w', kind: 'a' })
    await store.claim('exec-dead')
    await store.finish(job.id, { status: 'succeeded' })

    expect(await store.recover([], 'interrupt')).toHaveLength(0)
  })

  it('恢复是幂等的 —— 连跑两次不会把作业弄成奇怪的状态', async () => {
    await store.create(alice, { workspaceId: 'w', kind: 'a' })
    await store.claim('exec-dead')

    const first = await store.recover([], 'requeue')
    const second = await store.recover([], 'requeue')
    expect(first).toHaveLength(1)
    // 第一次已经放回 queued,第二次没有 running 的可捡
    expect(second).toHaveLength(0)
  })
})

describe('归属:跨主体一律取不到', () => {
  it('bob 取不到 alice 的作业', async () => {
    const job = await store.create(alice, { workspaceId: 'w', kind: 'a' })
    expect(await store.get(bob, job.id)).toBeUndefined()
    expect(await store.get(alice, job.id)).toBeDefined()
  })

  it('列表只含自己的', async () => {
    await store.create(alice, { workspaceId: 'w', kind: 'a' })
    await store.create(bob, { workspaceId: 'w', kind: 'b' })
    expect(await store.list(bob)).toHaveLength(1)
  })

  it('★ claim 不带 principal —— 它是执行器的动作,不是用户的', async () => {
    // 这是刻意的:执行器要能捡起**任何人**的作业,否则一个执行器
    // 只能服务一个用户,进程池就没有意义了。
    // 归属保护在**读**那一侧(get / list),不在 claim。
    await store.create(alice, { workspaceId: 'w', kind: 'a' })
    const claimed = await store.claim('exec-1')
    expect(claimed?.subjectId).toBe(alice.id)
  })
})
