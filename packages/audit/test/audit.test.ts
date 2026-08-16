/**
 * 仅追加审计。两个实现跑同一套断言(与 subject 包同款纪律)。
 */
import { describe, expect, it } from 'vitest'
import {
  AUDIT_TABLE,
  InMemoryAuditStore,
  KvAuditStore,
  type AuditInput,
  type AuditStore,
  type KvUnitLike,
} from '../src/index.ts'

function fakeUnit(): KvUnitLike & { tables: Record<string, Record<string, unknown>> } {
  const tables: Record<string, Record<string, unknown>> = { [AUDIT_TABLE]: {} }
  return {
    tables,
    loadAll: async () => JSON.parse(JSON.stringify({ tables, global: null })) as never,
    putRecord: async (table, key, value) => {
      ;(tables[table] ??= {})[key] = value
    },
  }
}

const entry = (over: Partial<AuditInput> = {}): AuditInput => ({
  at: new Date().toISOString(),
  actor: 'acme 运维',
  tenantId: 'acme',
  action: 'admin.getSubject',
  target: 'subject-1',
  before: null,
  after: null,
  requestId: 'req-1',
  ...over,
})

for (const [label, make] of [
  ['InMemoryAuditStore', () => new InMemoryAuditStore()],
  ['KvAuditStore', () => new KvAuditStore(fakeUnit())],
] as const) {
  describe(`${label}`, () => {
    it('append 后 query 可见,顺序与追加序一致', async () => {
      const store: AuditStore = make()
      await store.append(entry({ action: 'first' }))
      await store.append(entry({ action: 'second' }))
      await store.append(entry({ action: 'third' }))

      const { data } = await store.query({ tenantId: 'acme' })
      expect(data.map((r) => r.action)).toEqual(['first', 'second', 'third'])
    })

    it('id 由 store 生成且单调 —— 可指定的 id 就是可伪造的顺序', async () => {
      const store = make()
      const a = await store.append(entry())
      const b = await store.append(entry())
      expect(a.id < b.id).toBe(true)
    })

    it('跨租户查询拿不到别家的记录', async () => {
      const store = make()
      await store.append(entry({ tenantId: 'acme', action: 'acme-op' }))
      await store.append(entry({ tenantId: 'globex', action: 'globex-op' }))

      const acme = await store.query({ tenantId: 'acme' })
      expect(acme.data.map((r) => r.action)).toEqual(['acme-op'])
    })

    it('按 action 与 target 过滤', async () => {
      const store = make()
      await store.append(entry({ action: 'a', target: 't1' }))
      await store.append(entry({ action: 'b', target: 't1' }))
      await store.append(entry({ action: 'a', target: 't2' }))

      expect((await store.query({ tenantId: 'acme', action: 'a' })).data).toHaveLength(2)
      expect((await store.query({ tenantId: 'acme', target: 't1' })).data).toHaveLength(2)
      expect(
        (await store.query({ tenantId: 'acme', action: 'a', target: 't2' })).data,
      ).toHaveLength(1)
    })

    it('游标分页稳定', async () => {
      const store = make()
      for (let i = 0; i < 5; i += 1) await store.append(entry({ action: `op-${i}` }))

      const page1 = await store.query({ tenantId: 'acme', limit: 2 })
      expect(page1.data).toHaveLength(2)
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await store.query({ tenantId: 'acme', limit: 2, cursor: page1.nextCursor! })
      expect(page2.data.map((r) => r.action)).toEqual(['op-2', 'op-3'])
    })

    // 红线 4:仅追加是接口层的事实
    it('接口上不存在任何修改入口', () => {
      const store = make()
      for (const forbidden of ['update', 'delete', 'remove', 'truncate', 'clear', 'set']) {
        expect(
          (store as unknown as Record<string, unknown>)[forbidden],
          `AuditStore 上出现了 ${forbidden}`,
        ).toBeUndefined()
      }
    })
  })
}

describe('KvAuditStore 特有', () => {
  it('KvUnitLike 连 deleteRecord 都不声明 —— 仅追加延伸到存储接口', async () => {
    const unit = fakeUnit()
    const store = new KvAuditStore(unit)
    await store.append(entry())
    // 结构断言:本包声明的存储接口形状里没有删除
    const declared: (keyof KvUnitLike)[] = ['loadAll', 'putRecord']
    expect(declared).not.toContain('deleteRecord')
  })

  it('重启后从已有记录续号,分页不断裂', async () => {
    const unit = fakeUnit()
    const first = new KvAuditStore(unit)
    await first.append(entry({ action: 'before-restart' }))

    // 同一个 unit 重建 store,模拟进程重启
    const second = new KvAuditStore(unit)
    const appended = await second.append(entry({ action: 'after-restart' }))

    expect(appended.id > 'a-000000000001').toBe(true)
    const { data } = await second.query({ tenantId: 'acme' })
    expect(data.map((r) => r.action)).toEqual(['before-restart', 'after-restart'])
  })
})
