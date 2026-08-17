/** 默认 provider 名。计量与准入策略里用它区分本地与云端。 */
export const DEFAULT_LOCAL_PROVIDER = 'local'

/** Ollama 的 OpenAI 兼容端点默认地址。llama.cpp server 是 `http://127.0.0.1:8080/v1`。 */
export const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1'

/**
 * 探测本地端点是否活着(打 OpenAI 兼容的 `GET /v1/models`)。
 *
 * ⚠️ **打 HTTP,不调 CLI** —— 实测 `ollama --version` 报「未运行」的同时
 * HTTP 端点活着(CLI 与服务是两回事,见决策文档 §证据链 4)。
 *
 * 服务的是**离线判定与测试的跳过判断**,不是模型清单(那是配置)。
 */
export async function detectLocalEndpoint(
  baseUrl: string = DEFAULT_LOCAL_BASE_URL,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}
