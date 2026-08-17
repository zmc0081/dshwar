/**
 * llm-local 测试 —— 测**治理层**的事:注册、显示名、清单、边界防守、探测。
 *
 * 模型调用本身(流式/重试/工具)是上游引擎的事,这里一行都不测 ——
 * 测了反而把本包与上游内部行为耦死,那正是「复用而非重写」要避免的。
 *
 * 两层:
 * - 假 OpenAI 兼容端点(进程内 http server,127.0.0.1 随机口)—— **恒跑**
 * - 真 Ollama(默认 11434)—— D6:探测到才跑,探不到显式 skip
 */
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCAL_BASE_URL,
  LocalLlm,
  LocalLlmConfigError,
  assertLocalBaseUrl,
  detectLocalEndpoint,
} from '../src/index.ts'

/** 起一个最小 OpenAI 兼容端点:GET /v1/models 返回 200。 */
function fakeEndpoint(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen3:8b', object: 'model' }] }))
        return
      }
      res.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` })
    })
  })
}

let fake: { server: Server; baseUrl: string }

beforeAll(async () => {
  fake = await fakeEndpoint()
})

afterAll(() => {
  fake.server.close()
})

async function pluginHarness(over: Partial<Parameters<typeof assertLocalBaseUrl> & object> = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalLlm, {
    baseUrl: fake.baseUrl,
    models: [{ id: 'qwen3:8b', name: 'Qwen3 8B', contextWindow: 32_768 }],
    ...over,
  })
  return ctx
}

describe('注册(治理事项 1:归属)', () => {
  it('★ 注册为独立 provider,显示名不是「DeepSeek」', async () => {
    const ctx = await pluginHarness()

    const providers = ctx.llm.listProviders()
    const local = providers.find((p) => p.id === 'local')
    expect(local).toBeDefined()
    // 显示名覆写:用户在控制台必须看得出「这是本地模型」——
    // 复用上游适配器不等于借用上游的牌子
    expect(local!.name).toBe('Local (OpenAI-compatible)')
    expect(local!.name).not.toContain('DeepSeek')
  })

  it('模型清单来自声明(治理事项 3),原样可查', async () => {
    const ctx = await pluginHarness()

    const models = (await ctx.llm.listModels('local')) as { id: string; name: string }[]
    expect(models.map((m) => m.id)).toEqual(['qwen3:8b'])
    expect(models[0]!.name).toBe('Qwen3 8B')
  })

  it('provider 名可配 —— 计量与准入策略按它区分本地与云端', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalLlm, {
      baseUrl: fake.baseUrl,
      provider: 'ollama',
      models: [{ id: 'qwen3:8b' }],
    })
    expect(ctx.llm.listProviders().some((p) => p.id === 'ollama')).toBe(true)
  })
})

describe('边界防守(keyless 论证的物质基础)', () => {
  it('★ 公网 baseUrl 拒绝启动,错误信息带出路', () => {
    expect(() => assertLocalBaseUrl('https://api.openai.com/v1')).toThrow(LocalLlmConfigError)
    expect(() => assertLocalBaseUrl('https://api.openai.com/v1')).toThrow(/公网|credentials/)
  })

  it('loopback 与私网放行', () => {
    for (const ok of [
      'http://127.0.0.1:11434/v1',
      'http://localhost:8080/v1',
      'http://192.168.1.10:11434/v1',
      'http://10.0.0.5:8080/v1',
      'http://172.16.0.2:11434/v1',
      'http://ollama.internal:11434/v1',
    ]) {
      expect(() => assertLocalBaseUrl(ok), ok).not.toThrow()
    }
  })

  it('172.x 只认 172.16-31(RFC1918),172.32 是公网', () => {
    expect(() => assertLocalBaseUrl('http://172.32.0.1/v1')).toThrow(LocalLlmConfigError)
  })

  it('插件装配时也过这道 —— 不是只有直接调函数才防', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await expect(
      ctx.plugin(LocalLlm, { baseUrl: 'https://evil.example/v1', models: [{ id: 'x' }] }),
    ).rejects.toThrow(LocalLlmConfigError)
  })

  it('空模型清单拒绝启动 —— 配置错误炸给部署的人,不炸给最终用户', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LocalLlm, { baseUrl: fake.baseUrl, models: [] })).rejects.toThrow(
      /models 为空/,
    )
  })
})

describe('探测(服务离线判定,不服务清单)', () => {
  it('活的端点 → true', async () => {
    expect(await detectLocalEndpoint(fake.baseUrl)).toBe(true)
  })

  it('死端口 → false,不抛', async () => {
    expect(await detectLocalEndpoint('http://127.0.0.1:9/v1', 500)).toBe(false)
  })
})

// D6:CI 无 Ollama → 未检测到即 skip,不硬编码排除。
// 探测打 HTTP 不调 CLI(实测 CLI 报未运行时 HTTP 端点活着)。
const ollamaUp = await detectLocalEndpoint(DEFAULT_LOCAL_BASE_URL)

describe.skipIf(!ollamaUp)('真实 Ollama(未探测到 11434 时跳过)', () => {
  it('OpenAI 兼容 /v1/models 真的可解析', async () => {
    const res = await fetch(`${DEFAULT_LOCAL_BASE_URL}/models`)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { data?: { id: string }[] }
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('LocalLlm 指向真实 Ollama 可装配', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalLlm, {
      models: [{ id: 'whatever-model' }], // 清单是声明,不校验端点装没装 —— 那是部署方的责任
    })
    expect(ctx.llm.listProviders().some((p) => p.id === 'local')).toBe(true)
  })
})
