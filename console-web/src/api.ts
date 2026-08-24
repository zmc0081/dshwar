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

/**
 * 一次**完整取回**的结果 —— 不是「一页」。
 *
 * ## 🚨 它修的是什么
 *
 * V0.9.0 Session 3 的第一版把每个列表方法都写成 `(await client.x()).data` ——
 * 把 `nextCursor` 与 `requestId` 在那一行就丢了。三个后果:
 *
 * | 丢了什么 | 后果 |
 * | --- | --- |
 * | `nextCursor` | 成员超过一页时**分母偏小** |
 * | `nextCursor` | 角色选项漏掉后面那些页里才出现的角色 |
 * | `requestId` | 工单里没有可查的调用标识 |
 *
 * 第一条最要紧:验收① 刚刚证明「1 / 64 位成员」的**分母**来自服务端,
 * 而**分子**若只数了第一页,那个刚被验证过的读数就被上游的分页悄悄污染了。
 * 一个被验证过的数字比一个没人验过的更危险 —— 它有背书。
 *
 * ## ⚠️ `complete: false` 必须被呈现出来
 *
 * 自动翻页要有安全上限,否则一个几万人的租户会把界面挂死。
 * 但**一个不报出来的上限,就是原来那个 bug 换了个位置** ——
 * 照样是「界面显示的数比真实的少,而没有任何提示」。
 *
 * 所以上限撞到时 `complete` 为 `false`,而调用方**必须**据此改口:
 * 不能再说「共 N 人」,只能说「至少 N 人」。
 *
 * ## ⚠️ `requestIds` 是**复数**
 *
 * 翻了三页就是三次调用、三个 id。只留一个等于让工单少两条线索;
 * 而少的那两条恰恰是「后面几页出了什么问题」的入口。
 */
export interface Page<T> {
  readonly data: readonly T[]
  /** 每一页各一个,按取回顺序。空数组 = 一次都没调成功(不该发生)。 */
  readonly requestIds: readonly string[]
  /** 游标是否走完。`false` = 撞上了 {@link MAX_PAGES},**后面还有数据**。 */
  readonly complete: boolean
}

/**
 * 自动翻页的安全上限。
 *
 * 100 页 × 默认 50 条 = 5000 条。超过这个量的租户,运营后台本来也不该
 * 一次拉完 —— 那时要的是服务端筛选,不是更大的上限。
 *
 * ⚠️ 撞上它**不是错误**,是「这一屏不适合展示这么多」。所以它走
 * {@link Page.complete} 而不是抛异常:抛出来会让整屏白掉,
 * 而实际上前 5000 条是好的、可用的。
 */
export const MAX_PAGES = 100

/** 运营后台需要的那部分 API。刻意收窄 —— 组件拿不到它不该用的东西。 */
export interface ConsoleApi {
  capacity(): Promise<ConsoleCapacity>
  /** ⚠️ 返回 {@link Page} 而不是裸数组 —— 见 Page 的注释,分母被截断过一次。 */
  listSubjects(): Promise<Page<Subject>>
  getQuota(subjectId: string): Promise<Quota>
  updateQuota(subjectId: string, tokenLimit: number | null): Promise<Quota>
  usage(): Promise<Page<UsageRecord>>
  policies(): Promise<Page<Policy>>
  audit(): Promise<Page<AuditEntry>>
}

/**
 * 顺着 `nextCursor` 取完,收齐每一页的 `requestId`。
 *
 * @param fetchPage 取一页。`cursor` 为 `undefined` 表示取第一页。
 *
 * ⚠️ **出口计数式的循环**:`pages` 数到上限就停,并把 `complete` 置为 false。
 * 少了这一层,一个坏掉的服务端(每页都回同一个 cursor)会让这里死循环。
 */
async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<{
    data: T[]
    nextCursor: string | null
    requestId: string
  }>,
): Promise<Page<T>> {
  /** @type {T[]} */
  const data: T[] = []
  const requestIds: string[] = []
  let cursor: string | undefined
  let pages = 0

  for (;;) {
    const page = await fetchPage(cursor)
    data.push(...page.data)
    requestIds.push(page.requestId)
    pages += 1
    if (page.nextCursor === null) return { data, requestIds, complete: true }
    if (pages >= MAX_PAGES) return { data, requestIds, complete: false }
    cursor = page.nextCursor
  }
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
    // ⚠️ 四个列表方法**一律走 collectPages**。写成 `(await client.x()).data`
    //   是 Session 3 第一版的写法 —— 那一行同时丢掉 nextCursor 与 requestId,
    //   而丢掉的后果只在「数据超过一页」时才显形,开发环境里永远碰不到。
    listSubjects: () =>
      collectPages((cursor) => client.listSubjects(cursor === undefined ? {} : { cursor })),
    getQuota: async (subjectId) => (await client.getQuota(subjectId)).quota,
    updateQuota: async (subjectId, tokenLimit) =>
      (await client.updateQuota(subjectId, { tokenLimit })).quota,
    usage: () => collectPages((cursor) => client.usage(cursor === undefined ? {} : { cursor })),
    policies: () =>
      collectPages((cursor) => client.policies(cursor === undefined ? {} : { cursor })),
    audit: () => collectPages((cursor) => client.audit(cursor === undefined ? {} : { cursor })),
  }
}
