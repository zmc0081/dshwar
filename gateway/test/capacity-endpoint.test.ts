/**
 * **容量端点(V0.5.0,D2 后半)** —— 控制台首页那三个数。
 *
 * ## 验收的核心不是「端点返回 200」
 *
 * 是**它与开户闸门用的是同一个数**。这两处若各算各的,失败形态很具体:
 * 界面显示「上限 64」,管理员照着加人,加到第 40 个被拒 ——
 * 而他会相信界面,先怀疑是 bug,再怀疑产品。
 *
 * 所以这里的断言不是「返回了某个数」,而是**逐字段等于
 * `memberCapacityOf()` / `deriveMaxProcesses()`**。
 */
import { deriveMaxProcesses, RSS_PER_PROCESS_MB } from '@dshwar/supervisor'
import { describe, expect, it } from 'vitest'
import { createGateway, InMemoryAdminKeyResolver, registerAdminRoutes } from '../src/index.ts'
import { memberCapacityOf } from '../src/member-capacity.ts'

const GB = 1024 * 1024 * 1024
const ADMIN = { 'x-dshwar-admin-key': 'k' }

function app(options: {
  level: 'logical' | 'process'
  totalMemoryBytes?: number
  configuredMax?: number
  memberCount?: number
  omitCapacity?: boolean
}) {
  const cap = () =>
    memberCapacityOf({
      level: options.level,
      totalMemoryBytes: options.totalMemoryBytes ?? 8 * GB,
      ...(options.configuredMax === undefined ? {} : { configuredMax: options.configuredMax }),
    })

  return createGateway({
    // 这个端点不碰运行时 —— 传一个最小对象就够,不必装配整套插件。
    ctx: {} as never,
    adminKeys: new InMemoryAdminKeyResolver([{ key: 'k', tenantId: 'acme', label: 'a' }]),
    adminRoutes: registerAdminRoutes({
      ctx: {} as never,
      subjects: { verify: async () => undefined } as never,
      audit: { record: () => undefined } as never,
      credentialRefs: [],
      ...(options.omitCapacity === true ? {} : { capacity: cap }),
      memberCount: async () => options.memberCount ?? 0,
    }),
  })
}

describe('GET /v1/admin/capacity', () => {
  it('★ 进程档:返回值与 deriveMaxProcesses 逐字段一致,不是另算一遍', async () => {
    const res = await app({ level: 'process', totalMemoryBytes: 4 * GB }).request(
      '/v1/admin/capacity',
      { headers: ADMIN },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    const derived = deriveMaxProcesses(4 * GB)
    expect(body['isolationLevel']).toBe('process')
    expect(body['maxProcesses']).toBe(derived.value)
    expect(body['memberCap']).toBe(derived.value)
    expect(body['basis']).toBe(derived.basis)
    expect(body['rssPerProcessMb']).toBe(RSS_PER_PROCESS_MB)
  })

  it('★ 逻辑档:maxProcesses 是 null 而不是 0,memberCap 是 1', async () => {
    const res = await app({ level: 'logical' }).request('/v1/admin/capacity', { headers: ADMIN })
    const body = (await res.json()) as Record<string, unknown>

    // null 逼着前端去想「这一档该显示什么」;0 会被直接渲染成「上限 0」,
    // 而那是错的 —— 逻辑档能跑,只是只能跑一个人。
    expect(body['maxProcesses']).toBeNull()
    expect(body['maxProcesses']).not.toBe(0)
    expect(body['memberCap']).toBe(1)
    expect(body['basis']).toContain('架构限制')
  })

  it('memberCount 按调用方的租户数,不是全局', async () => {
    const res = await app({ level: 'process', memberCount: 3 }).request('/v1/admin/capacity', {
      headers: ADMIN,
    })
    const body = (await res.json()) as Record<string, unknown>
    // Admin Key 按租户签发,一把钥匙不得横跨租户(CLAUDE.md 第七节)
    expect(body['memberCount']).toBe(3)
  })

  it('没配 capacity 时回落 501 —— 与 subjectStore / auditStore 同款语义', async () => {
    const res = await app({ level: 'process', omitCapacity: true }).request('/v1/admin/capacity', {
      headers: ADMIN,
    })
    // 501 而不是 404:404 会让第三方以为路径写错了,从而去猜别的路径
    expect(res.status).toBe(501)
  })

  it('无 Admin Key 拒绝 —— 容量是部署信息,不该匿名可见', async () => {
    const res = await app({ level: 'process' }).request('/v1/admin/capacity')
    expect(res.status).toBe(401)
  })

  it('显式配置 maxProcesses 时,basis 说明推导会得到什么', async () => {
    const res = await app({ level: 'process', configuredMax: 5 }).request('/v1/admin/capacity', {
      headers: ADMIN,
    })
    const body = (await res.json()) as Record<string, unknown>
    expect(body['memberCap']).toBe(5)
    // 让管理员看得见「你配的」与「本来该是多少」的差 —— 那是他判断
    // 配置对不对的唯一依据
    expect(body['basis']).toContain('显式配置')
    expect(body['basis']).toContain('按内存推导会得到')
  })
})
