/**
 * **唯一的请求出口** —— D7 约束 3 的落点。
 *
 * ## 规则
 *
 * 整个 `console-web` 里**只有这个文件**可以碰网络。组件不 `fetch`,
 * 不 `axios`,不 `XMLHttpRequest` —— 它们从这里拿一个客户端。
 *
 * ## 为什么这条约束值得一道守卫
 *
 * 因为 V0.7.0 要把同一份前端代码跑在三个宿主里(远端 Web / 本地 sidecar /
 * Tauri),**唯一的差别就是 baseURL**。散落的 `fetch('/v1/...')` 在远端
 * 能跑通(同源),在 Tauri 里全部失败(`tauri://localhost` 下没有那个源)——
 * 而那时代码已经写了几十个组件,改起来是重构。
 *
 * ⚠️ **现在写零成本。** 这就是 D7 说「事后补是重构」的具体含义。
 *
 * ## baseURL 从哪来
 *
 * 从 {@link createConsoleApi} 的参数注入,**不从 `window.location` 推断**。
 * 推断在远端能work、在 Tauri 里会指到 `tauri://localhost/v1/...`。
 * 注入之后,三个宿主各自传自己的值,前端代码一行不用改。
 *
 * ## ⚠️ 运营后台用 **Admin API Key**,不是运行时 Bearer
 *
 * 与 `workbench-web/src/api.ts` 的差别就在这里。两者**绝不能同时送** ——
 * 网关的 `runtimeAuth` 在看 bearer 之前先判 admin 头存不存在,存在就直接 401。
 * 那不是 bug:一个既是管理员又是终端用户的请求,身份是歧义的。
 *
 * Admin Key **按租户签发**,一把钥匙不得横跨租户(CLAUDE.md 第七节)。
 *
 * @module @dshwar/console-web/api
 */
import type { ConsoleCapacity } from '@dshwar/console-contract'
import { DshwarAdminClient, DshwarApiError, type components } from '@dshwar/sdk'

type Schemas = components['schemas']

export type Subject = Schemas['Subject']
export type Quota = Schemas['Quota']
export type UsageRecord = Schemas['UsageRecord']
export type Policy = Schemas['Policy']
export type AuditEntry = Schemas['AuditEntry']

/**
 * 一个端点**在契约里有、在这一版没实现**时的样子。
 *
 * 与工作台那份同形,理由也一样:**没实现 ≠ 失败**。
 * 失败该让人重试,而没实现重试一万次也一样;混在一起的后果是
 * 用户对着一个红色失败态反复点刷新。
 */
export interface NotImplemented {
  readonly kind: 'not-implemented'
  readonly plannedVersion: string | null
  readonly requestId: string | null
}

export type MaybeImplemented<T> = { readonly kind: 'ok'; readonly value: T } | NotImplemented

/** 运营后台需要的那部分 API。刻意收窄 —— 组件拿不到它不该用的东西。 */
export interface ConsoleApi {
  capacity(): Promise<ConsoleCapacity>
  listSubjects(): Promise<Subject[]>
  getQuota(subjectId: string): Promise<Quota>
  updateQuota(subjectId: string, tokenLimit: number | null): Promise<Quota>
  usage(): Promise<UsageRecord[]>
  policies(): Promise<Policy[]>
  audit(): Promise<AuditEntry[]>
}

/**
 * 把「501」从异常里挑出来,变成一个值。
 *
 * ⚠️ 只认 **501**。把 5xx 一律当「没实现」是错的:500 是网关炸了,
 * 503 是暂时不可用,两者都该重试,而 501 重试一万次也一样。
 */
export async function asMaybeImplemented<T>(run: () => Promise<T>): Promise<MaybeImplemented<T>> {
  try {
    return { kind: 'ok', value: await run() }
  } catch (error) {
    if (error instanceof DshwarApiError && error.status === 501) {
      return {
        kind: 'not-implemented',
        plannedVersion: error.plannedVersion ?? null,
        requestId: error.requestId ?? null,
      }
    }
    throw error
  }
}

/**
 * 建一个控制台 API 客户端。
 *
 * @param options.baseUrl **必须显式传**。没有默认值是刻意的:
 *   一个「默认同源」的默认值会让 Tauri 里的失败推迟到运行时才显形,
 *   而那时错误信息是一句无关的网络错误。
 * @param options.fetch 自定义 fetch。测试用 —— 也让这一层能被单测覆盖,
 *   而不是只能靠端到端。
 */
export function createConsoleApi(options: {
  baseUrl: string
  adminKey: string
  fetch?: typeof globalThis.fetch
}): ConsoleApi {
  const client = new DshwarAdminClient({
    baseUrl: options.baseUrl,
    adminKey: options.adminKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })

  return {
    capacity: async () => {
      const raw = await client.capacity()
      // 显式投影到契约类型,而不是直接透传 —— 与 console-contract 里
      // 「声明投影而不是复制模型」是同一条纪律:SDK 的返回形状将来若加字段,
      // 不该自动流进前端的类型。
      return {
        isolationLevel: raw.isolationLevel,
        maxProcesses: raw.maxProcesses,
        memberCap: raw.memberCap,
        memberCount: raw.memberCount,
        rssPerProcessMb: raw.rssPerProcessMb,
        basis: raw.basis,
      }
    },
    listSubjects: async () => (await client.listSubjects()).data,
    getQuota: async (subjectId) => (await client.getQuota(subjectId)).quota,
    updateQuota: async (subjectId, tokenLimit) =>
      (await client.updateQuota(subjectId, { tokenLimit })).quota,
    usage: async () => (await client.usage()).data,
    policies: async () => (await client.policies()).data,
    audit: async () => (await client.audit()).data,
  }
}
