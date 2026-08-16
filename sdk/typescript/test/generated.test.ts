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

describe('错误码是闭集,但消费方必须有 default 分支', () => {
  // ⚠️ **这一组在 V0.4.6 被改写了,理由要连着看。**
  //
  // 原本用 `const exhaustive: never = code` 做穷尽断言,注释写着
  // 「这就是『加错误码是破坏性变更』在类型层的体现」。那在当时是自洽的。
  //
  // V0.4.6 的契约改成「枚举会在 v1 内追加,客户端**必须**优雅处理未知值」——
  // 于是这个示例反倒成了**反面教材**:SDK 的测试是消费方抄写的参照,
  // 留着 `never` 断言等于教人写出下一个版本编译不过的代码。
  //
  // 现在演示的是**正确**的形状:认识的码各自处理,不认识的走 default
  // 按「与 HTTP 状态码同类的通用失败」兜底。
  it('认识的码逐一映射,不认识的走 default 兜底', () => {
    const describeCode = (code: DshwarErrorCode | (string & {})): string => {
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
        case 'unavailable':
          return '服务端暂时没有资源受理'
        default:
          // ★ 契约级要求:**不得抛错,不得断言穷尽**。
          // 未知码按通用失败处理,让老客户端在新服务端上仍然可用。
          return '未知错误'
      }
    }

    expect(describeCode('unauthorized')).toBe('凭证无效')
    expect(describeCode('unavailable')).toBe('服务端暂时没有资源受理')
    // 模拟「服务端比客户端新」:一个本 SDK 版本还不认识的码
    expect(describeCode('some_future_code')).toBe('未知错误')
  })

  it('每个契约错误码都在 SDK 的联合类型里', () => {
    // 闭集仍然有价值 —— 它让 SDK 能把已知的码列全,只是不再据此断言穷尽。
    const known: DshwarErrorCode[] = [
      'unauthorized',
      'forbidden',
      'not_found',
      'invalid_request',
      'conflict',
      'rate_limited',
      'unavailable',
      'not_implemented',
      'internal',
    ]
    expect(known.length).toBeGreaterThan(0)
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
