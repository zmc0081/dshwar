import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderSchema } from '../scripts/render.ts'
import type { DshwarErrorCode } from '../src/index.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const generated = join(packageRoot, 'src', 'generated', 'schema.d.ts')
const contract = join(packageRoot, '..', '..', 'packages', 'api-contract', 'openapi.json')

describe('SDK 类型与契约同步', () => {
  // 契约改了但 SDK 没重新生成，调用方拿到的就是过期类型 ——
  // 而 TypeScript 会愉快地编译通过，直到运行时才炸
  it('重新生成的结果与提交的一致', async () => {
    const committed = readFileSync(generated, 'utf8')

    // 复用生成脚本自己的渲染函数，而不是另写一遍：
    // 两条代码路径的输出哪怕只差一个换行，这个校验就会永远红或永远绿
    const document = JSON.parse(readFileSync(contract, 'utf8')) as Record<string, unknown>
    const regenerated = await renderSchema(document)

    expect(
      committed.trim(),
      '契约已变更但 SDK 未重新生成 —— 跑 pnpm --filter @dshwar/sdk generate',
    ).toBe(regenerated.trim())
  })

  // 上面那条测试只在「生成器行为稳定」时才有意义。这条确认它真的会红：
  // 契约动一个字段而 SDK 未重生成，渲染结果必须与提交的不同
  it('契约变了而未重新生成时会被发现', async () => {
    const committed = readFileSync(generated, 'utf8')
    const document = JSON.parse(readFileSync(contract, 'utf8')) as Record<string, unknown>

    const schemas = (document['components'] as { schemas: Record<string, unknown> }).schemas
    schemas['Session'] = {
      ...(schemas['Session'] as Record<string, unknown>),
      properties: {
        ...(schemas['Session'] as { properties: Record<string, unknown> }).properties,
        stowawayField: { type: 'string' },
      },
    }

    expect(await renderSchema(document)).not.toBe(committed)
  })

  it('生成文件带「请勿手改」的标记', () => {
    expect(readFileSync(generated, 'utf8')).toContain('auto-generated')
  })
})

describe('错误码闭集映射为可穷举的联合类型', () => {
  // 这正是契约把错误码定成 z.enum 而不是 z.string() 换来的东西
  it('每个契约错误码都在 SDK 的联合类型里', () => {
    // 类型层断言：漏掉任何一个分支，这个函数就编译不过
    const describeCode = (code: DshwarErrorCode): string => {
      switch (code) {
        case 'unauthorized':
          return '凭证无效'
        case 'forbidden':
          return '无权访问'
        case 'not_found':
          return '不存在'
        case 'invalid_request':
          return '请求不合法'
        case 'conflict':
          return '状态冲突'
        case 'rate_limited':
          return '触发限流'
        case 'not_implemented':
          return '尚未实现'
        case 'internal':
          return '服务端错误'
        default: {
          // 契约新增错误码时，这里会因为 never 断言失败而编译不过 ——
          // 这就是"加错误码是破坏性变更"在类型层的体现
          const exhaustive: never = code
          return exhaustive
        }
      }
    }

    expect(describeCode('unauthorized')).toBe('凭证无效')
    expect(describeCode('not_implemented')).toBe('尚未实现')
  })
})

describe('生成的类型覆盖全部契约端点', () => {
  it('运行时与 Admin 端点都在', () => {
    const text = readFileSync(generated, 'utf8')
    for (const path of [
      '/v1/sessions',
      '/v1/sessions/{id}',
      '/v1/sessions/{id}/turns',
      '/v1/sessions/{id}/stream',
      '/v1/admin/subjects/{id}/credentials',
      '/v1/admin/usage',
    ]) {
      expect(text, `生成的类型缺少 ${path}`).toContain(`"${path}"`)
    }
  })

  it('CredentialDescriptor 里没有任何可放值的字段', () => {
    const text = readFileSync(generated, 'utf8')
    const start = text.indexOf('CredentialDescriptor:')
    expect(start).toBeGreaterThan(-1)
    const block = text.slice(start, start + 900).toLowerCase()

    for (const forbidden of ['value:', 'secret:', 'plaintext:', 'lastfour']) {
      expect(block, `生成的类型里出现了 ${forbidden}`).not.toContain(forbidden)
    }
  })
})
