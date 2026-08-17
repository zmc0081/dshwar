/**
 * `@dshwar/llm-local` —— 本地模型 provider(Ollama / llama.cpp)。
 *
 * ## 治理层,不造引擎(决策文档:`llm-local-reuses-upstream-adapter.md`)
 *
 * 本包**不实现任何模型调用代码**:它构造一个指向本地 OpenAI 兼容端点的
 * 上游 `DeepSeekAdapter` 实例(公开导出,非深链),注册为独立 provider。
 * 流式、重试、消息格式、工具调用全是上游的 —— 本包只做三件治理的事:
 *
 * 1. **provider 注册**(归属):本地推理在计量里是独立的 provider 名
 * 2. **keyless 凭据策略**(裁决):本地端点不鉴权,没有凭据可保护 ——
 *    硬规则 6 的对象不存在,见 {@link assertLocalBaseUrl} 的边界防守
 * 3. **模型清单声明**(配置):部署方声明装了哪些模型,不静默探测
 *
 * ## 为什么模型清单是配置而不是探测
 *
 * 探测到什么用什么,意味着「模型没装」要等到**首个请求**才炸 ——
 * 而那个请求可能来自一个不知道 Ollama 是什么的最终用户。
 * 清单声明让配置错误炸在部署时,炸给知道怎么修的人。
 * (探测留给 {@link detectLocalEndpoint},它服务的是**离线判定**,不是清单。)
 *
 * @module @dshwar/llm-local
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import {
  DeepSeekAdapter,
  resolveAdapterOptions,
  type DeepSeekAdapterOptions,
} from '@deepseek-ai/dsh-llm-deepseek'

/** 一个本地模型的声明。`id` 是端点认识的模型名(如 `qwen3:8b`)。 */
export interface LocalModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
}

export interface LocalLlmConfig {
  /**
   * OpenAI 兼容端点。默认 Ollama:`http://127.0.0.1:11434/v1`;
   * llama.cpp server 是 `http://127.0.0.1:8080/v1`。
   * **必须是 loopback 或私有地址** —— 见 {@link assertLocalBaseUrl}。
   */
  readonly baseUrl?: string
  /** 注册的 provider 名。默认 `local`。计量与准入策略里用它。 */
  readonly provider?: string
  /** 控制台里的显示名。默认 `Local (OpenAI-compatible)`。 */
  readonly displayName?: string
  /** 部署方声明的模型清单。**空清单拒绝启动** —— 没有模型的 provider 只会制造困惑。 */
  readonly models: readonly LocalModel[]
}

import { DEFAULT_LOCAL_BASE_URL } from './detect.ts'

export { DEFAULT_LOCAL_BASE_URL, detectLocalEndpoint } from './detect.ts'
export const DEFAULT_LOCAL_PROVIDER = 'local'

/**
 * keyless 占位符。它不打开任何东西 —— 泄漏它的损失是零,
 * 这正是「keyless 不违反硬规则 6」论证的物质基础。
 */
export const LOCAL_KEYLESS_PLACEHOLDER = 'dshwar-local-keyless'

/** 配置错误 —— 启动期抛,信息里带修法。 */
export class LocalLlmConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalLlmConfigError'
  }
}

/**
 * baseUrl 只接受 loopback / 私有地址。
 *
 * ## 这是 keyless 论证的边界防守
 *
 * keyless 成立的前提是「端点没有要保护的凭据」。把 baseUrl 指向公网的
 * OpenAI 兼容服务,keyless 就变成了**共享匿名访问** —— 每个 principal
 * 都在用同一个(不存在的)身份打一个可能计费的远程服务。
 * 所以指向公网直接拒绝启动,并把正确的路指出来。
 */
export function assertLocalBaseUrl(baseUrl: string): void {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new LocalLlmConfigError(`llm-local: baseUrl 不是合法 URL:${baseUrl}`)
  }
  const host = url.hostname
  const isLoopback =
    host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')
  const isPrivate =
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  if (!isLoopback && !isPrivate) {
    throw new LocalLlmConfigError(
      `llm-local: baseUrl 指向公网地址(${host}),拒绝启动。` +
        `本包是 keyless 的 —— 指向公网等于共享匿名访问一个可能计费的服务。` +
        `远程 OpenAI 兼容端点请走上游 dsh-llm-deepseek 的 baseURL 配置,` +
        `凭据经 credentials 服务按 principal 解析。`,
    )
  }
}

/**
 * cordis 插件:把本地端点注册为独立 provider。
 *
 * 类形式而非上游那种 `{ name, apply }` 模块形式 —— 与本仓其它插件一致,
 * `ctx.plugin(LocalLlm, config)` 即用。
 */
export class LocalLlm {
  static readonly inject = ['llm']

  constructor(ctx: Context, config: LocalLlmConfig) {
    const baseUrl = config.baseUrl ?? DEFAULT_LOCAL_BASE_URL
    assertLocalBaseUrl(baseUrl)
    if (config.models.length === 0) {
      throw new LocalLlmConfigError(
        'llm-local: models 为空。部署方必须声明本地端点装了哪些模型 —— ' +
          '空清单的 provider 只会让「模型没装」在首个请求才炸。',
      )
    }

    const provider = config.provider ?? DEFAULT_LOCAL_PROVIDER
    const displayName = config.displayName ?? 'Local (OpenAI-compatible)'

    // 上游的选项解析器:models / baseURL 进正规形状,重试策略拿默认值。
    // 环境参数省略 —— 本包不读任何环境变量(CLAUDE.md:配置只经 profile 注入)。
    const resolved = resolveAdapterOptions({
      baseURL: baseUrl,
      models: config.models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
      })),
    })

    /**
     * 覆写显示名的最小子类 —— 不覆写任何行为方法。
     * 不覆写的话 `listProviders()` 会把本地 provider 显示成「DeepSeek」,
     * 控制台上的用户没法知道自己选的是本地模型(而这正是他们最关心的事)。
     */
    class LocalAdapter extends DeepSeekAdapter {
      override providerInfo(p: string): LlmProviderInfo {
        return { ...super.providerInfo(p), name: displayName }
      }
    }

    const adapter = new LocalAdapter({
      options: () => resolved,
      // keyless:本地端点不鉴权,没有凭据可保护(硬规则 6 的对象不存在)。
      // 论证与边界防守见 assertLocalBaseUrl 与决策文档。
      resolveApiKey: async () => LOCAL_KEYLESS_PLACEHOLDER,
      // 归因头的用户标识。本地端点不消费它,给稳定值即可。
      // 品牌类型来自上游未导出的内部包,经 ReturnType 借形 —— 不是绕类型,
      // 是拒绝为一个字符串再拉一个上游依赖。
      resolveUserId: () => 'dshwar-local' as ReturnType<DeepSeekAdapterOptions['resolveUserId']>,
    })

    ctx.llm.registerAdapter([provider], adapter)
  }
}

export { OfflineFallback } from './offline.ts'
export type { OfflineDecision, OfflineFallbackOptions } from './offline.ts'
