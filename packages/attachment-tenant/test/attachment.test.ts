/**
 * **附件的租户隔离(V0.5.5 Session 4)**。
 *
 * ## 验收:路径与工作区一样按租户钉死,越界一律拒绝
 *
 * 这里的越界不是假想 —— `attachmentId` 若来自用户输入或从旧数据迁移而来,
 * 一个 `../..` 就能写到别的租户目录下。所以三段全部经 `toPathSegment`,
 * 最后再来一道**不依赖编码正确**的 `isWithin` 断言。
 */
import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PathEscapeError } from '@dshwar/fs-tenant'
import { createPrincipal } from '@dshwar/principal'
import { beforeEach, describe, expect, it } from 'vitest'
import { attachmentPath, FsAttachmentStore } from '../src/index.ts'

const alice = createPrincipal({ id: 'alice-e6f1', tenantId: 'acme' })
const bob = createPrincipal({ id: 'bob-a2b3', tenantId: 'globex' })
const carol = createPrincipal({ id: 'carol-77aa', tenantId: 'acme' })

const NODE_FS = { mkdir, writeFile, readFile, rm } as never

let root: string
let store: FsAttachmentStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'att-'))
  store = new FsAttachmentStore(root, NODE_FS)
})

const body = (text: string) => new TextEncoder().encode(text)

describe('★ 路径按租户钉死', () => {
  it('四段路径:root/tenant/user/attachmentId', () => {
    const path = attachmentPath(root, alice, 'a123')
    expect(path).toContain(join('acme', 'alice-e6f1', 'a123'))
  })

  it('★ attachmentId 里的 ../ 逃不出根', () => {
    // 编码会把它变成安全的段;若哪天编码被改坏,最后那道 isWithin 会炸。
    const path = attachmentPath(root, alice, '../../etc')
    expect(path).toContain(join('acme', 'alice-e6f1'))
    expect(path).not.toContain('etc/passwd')
    expect(path.startsWith(root)).toBe(true)
  })

  it('★ 带分隔符的 principal 在**更前面**就被拒了 —— 纵深防御', () => {
    // 本条原本想验「路径层挡住带 ../ 的 userId」,结果发现**构造不出这样的
    // principal** —— `createPrincipal` 先拒了它。
    //
    // 这不是测试写错了白改一场:它证明了两层防御是**独立**的。
    // 路径层那道 `isWithin` 断言因此不是冗余 —— 它防的是
    // 「principal 层哪天被绕过或放宽」,而不是防今天的输入。
    expect(() => createPrincipal({ id: '../root', tenantId: 'acme' })).toThrow()
    expect(() => createPrincipal({ id: 'ok', tenantId: '../etc' })).toThrow()
  })

  it('相对路径的根被拒 —— 不是所有调用方都会传绝对路径', () => {
    expect(() => attachmentPath('relative/root', alice, 'a1')).toThrow(PathEscapeError)
  })

  it('两个租户的同名附件 id 落在不同目录', () => {
    expect(attachmentPath(root, alice, 'same')).not.toBe(attachmentPath(root, bob, 'same'))
  })

  it('★ 同租户的两个人也分开 —— 隔离沿 userId 展开,不止 tenantId', () => {
    expect(attachmentPath(root, alice, 'same')).not.toBe(attachmentPath(root, carol, 'same'))
  })
})

describe('存取与归属', () => {
  it('存进去读出来', async () => {
    const att = await store.put(alice, {
      filename: 'report.pdf',
      contentType: 'application/pdf',
      body: body('hello'),
    })
    expect(att.size).toBe(5)
    expect(att.sessionId).toBeNull()

    const read = await store.read(alice, att.id)
    expect(new TextDecoder().decode(read!)).toBe('hello')
  })

  it('★ 跨主体取不到,读不到,删不掉', async () => {
    const att = await store.put(alice, {
      filename: 'x',
      contentType: 'text/plain',
      body: body('s'),
    })

    expect(await store.get(bob, att.id)).toBeUndefined()
    expect(await store.read(bob, att.id)).toBeUndefined()
    expect(await store.remove(bob, att.id)).toBe(false)
    // 副作用没发生 —— 只看返回值的话,「先删再判归属」也返回 false
    expect(await store.get(alice, att.id)).toBeDefined()
  })

  it('★ 同租户的另一个人也取不到', async () => {
    const att = await store.put(alice, {
      filename: 'x',
      contentType: 'text/plain',
      body: body('s'),
    })
    expect(await store.get(carol, att.id)).toBeUndefined()
  })

  it('列表只含自己的', async () => {
    await store.put(alice, { filename: 'a', contentType: 't', body: body('1') })
    await store.put(carol, { filename: 'c', contentType: 't', body: body('2') })
    const list = await store.list(carol)
    expect(list).toHaveLength(1)
    expect(list[0]!.filename).toBe('c')
  })
})

describe('★ 会话回收不得误删租户级附件', () => {
  it('只回收挂在该会话上的', async () => {
    const s1 = await store.put(alice, {
      filename: 's1',
      contentType: 't',
      sessionId: 'sess-1',
      body: body('a'),
    })
    const s2 = await store.put(alice, {
      filename: 's2',
      contentType: 't',
      sessionId: 'sess-2',
      body: body('b'),
    })
    const tenantLevel = await store.put(alice, {
      filename: 'keep',
      contentType: 't',
      body: body('c'),
    })

    const removed = await store.reclaimSession(alice, 'sess-1')
    expect(removed).toBe(1)

    expect(await store.get(alice, s1.id)).toBeUndefined()
    // ★ 另一个会话的不受影响
    expect(await store.get(alice, s2.id)).toBeDefined()
    // ★★ 租户级(sessionId === null)的**绝不能**被卷进来 ——
    //    宽松匹配会把它一起删掉,那是一次静默的数据丢失
    expect(await store.get(alice, tenantLevel.id)).toBeDefined()
  })

  it('回收一个不存在的会话返回 0,不报错', async () => {
    expect(await store.reclaimSession(alice, 'nope')).toBe(0)
  })

  it('按 sessionId 过滤列表', async () => {
    await store.put(alice, { filename: 'a', contentType: 't', sessionId: 's', body: body('1') })
    await store.put(alice, { filename: 'b', contentType: 't', body: body('2') })

    expect(await store.list(alice, { sessionId: 's' })).toHaveLength(1)
    expect(await store.list(alice, { sessionId: null })).toHaveLength(1)
  })
})
