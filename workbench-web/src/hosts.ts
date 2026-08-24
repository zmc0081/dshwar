/**
 * 三宿主接线 —— 把「差别只有 baseURL」从一句验收话变成**一条会红的断言**。
 *
 * ## 这个文件存在的理由
 *
 * V0.9.0 Session 5 的验收原话是「同一份前端产物在三个宿主下跑通,
 * **差别只有 baseURL**」。那句话本身不可执行:它描述的是一个**不变式**,
 * 而不变式若没有落点,只会在某次「给 Tauri 加个开关」的提交里悄悄失效 ——
 * 三个宿主分家的过程没有任何一步是显眼的,每一步都只是「这里特殊一点」。
 *
 * ⇒ 于是这里把宿主差异收成一个函数:{@link hostConfig} 返回的**全部字段**中,
 * 只有 `baseUrl` 允许因宿主而异。`test/hosts.test.ts` 逐字段比对三份结果,
 * 键集与值都要一致 —— 多一个 Tauri 专有开关,那条断言当场红。
 *
 * ## 「假设它已经坏了,我会从哪里看出来?」
 *
 * `scripts/verify-assertions.mjs` 探针 23:往 Tauri 那一支塞一个别的宿主
 * 没有的 scope,确认三宿主同构断言真的变红。没有那条探针,这里的断言
 * 与「三个对象碰巧长得一样」在输出上没有区别。
 *
 * ## ⚠️ 为什么 `SecretStore` **不在** {@link HostConfig} 里
 *
 * 它按定义就三家不同(Web 拒绝、另两家由宿主注入),塞进配置里会让
 * 「除 baseUrl 外逐字段相同」立刻需要第二条豁免。而豁免列表是这类断言
 * 退化的标准路径:第一条豁免有充分理由,第二条照着第一条写,第三条就没人看了。
 *
 * ⇒ 端口实现另开 {@link hostSecrets},配置那条断言**零豁免**。
 * 判据是「它是数据还是接线」:数据进 `hostConfig`,接线进 `hostSecrets`。
 *
 * @module @dshwar/workbench-web/hosts
 */
import { WEB_SECRETS_REFUSE, type SecretStore } from '@dshwar/auth-pkce'

/**
 * 三个宿主。
 *
 * ⚠️ **写成 `as const` 数组再派生类型,不是反过来。** TS 的联合类型在运行时
 * 不存在,而测试需要**遍历**它才能证明每个成员都被接上了 ——
 * 拿类型当唯一来源的话,那条遍历只能靠人抄一份清单,
 * 而抄的那份与真实成员不同步时没有任何东西会红。
 */
export const HOST_KINDS = ['remote-web', 'local-sidecar', 'tauri'] as const

/** 前端产物运行在哪个宿主里。 */
export type HostKind = (typeof HOST_KINDS)[number]

/**
 * 宿主在启动时交给前端的东西。
 *
 * 两个字段都是可选的,因为**各宿主需要的不是同一个** ——
 * 缺了哪个由 {@link hostConfig} / {@link hostSecrets} 各自 fail closed,
 * 不在类型层做成三个互斥的形状:那会让调用方为了满足类型而先做一次
 * `switch`,而那正是本文件要收掉的东西。
 */
export type HostRuntime = {
  /**
   * 网关监听的回环端口。**只有 Tauri 需要。**
   *
   * 另两个宿主的前端由网关同一个服务提供,走相对路径即可 ——
   * 它们**不需要知道端口**,于是端口换了也不用改前端。
   */
  readonly gatewayPort?: number
  /**
   * 宿主提供的系统钥匙串。sidecar 与 Tauri 必须给,远端 Web **必须不给**。
   *
   * Tauri 的那一份在 Rust 侧(本 Session 另一半交付)—— 系统钥匙串
   * 没有浏览器 API,只能由壳提供。
   */
  readonly secrets?: SecretStore
}

/**
 * 一个宿主的全部**配置**(纯数据,不含任何端口实现)。
 *
 * ⚠️ 新增字段前先问一句:**三个宿主的值会一样吗?**
 * 会一样 → 加在这里,{@link HOST_INVARIANT} 给唯一的值。
 * 不会一样 → 它不是配置,是接线,照 {@link hostSecrets} 的样子另开一个函数,
 * 并在那里写明「为什么这一项必须三家不同」。
 *
 * 把一个三家不同的东西塞进这里,唯一的后果是有人来给同构断言开豁免。
 *
 * ## ⚠️ 今天只有 `baseUrl` 有消费方 —— 别的五项是**声明**,不是开关
 *
 * `bootstrap.tsx` 读的是 `baseUrl`。其余五项各自都是对的,但**不是因为
 * 有人读了这份配置才对的**:`router.ts` 自己就是 hash 路由,SDK 自己就走 SSE。
 *
 * ⇒ 改它们不会改变任何行为。写在这里是免得下一个人以为改了就生效 ——
 * 一个从未被使用的配置项与一个正确的配置项,在运行时一模一样。
 * 它们今天的作用是一条**防分家的棘轮**:谁给某个宿主开小灶,同构断言当场红。
 */
export type HostConfig = {
  /**
   * ★ **唯一允许因宿主而异的字段。**
   *
   * 同源宿主是 {@link SAME_ORIGIN_BASE_URL};Tauri 是回环网关的 origin。
   */
  readonly baseUrl: string
  /**
   * 路由模式。三家同为 hash —— history router 在 Tauri 里直接跑不起来,
   * 这是 D7 约束 1,`check-guards.mjs` 的前端三条约束在源码层盯着它。
   */
  readonly routerMode: 'hash'
  /** 流式传输。三家同为 SSE —— 不给 Tauri 换成原生 IPC 通道,那会让 SSE 只在两家被测。 */
  readonly streamTransport: 'sse'
  /**
   * 外部链接怎么打开。三家同为系统浏览器。
   *
   * ⚠️ 不是「桌面端可以用嵌入式 WebView」:RFC 8252 §8.12 —— 嵌入式 WebView 里
   * 宿主应用能读到用户输入的密码,那把硬规则 4 从架构约束降级成自觉。
   */
  readonly externalLinks: 'system-browser'
  /** 品牌从哪来。三家同为运行期注入 —— 安装包永远中性,一个二进制服务所有租户。 */
  readonly brandingSource: 'runtime'
  /**
   * 授权时申请的 scope。
   *
   * ⚠️ 三家必须一致。给某个宿主多要一个 scope,等于让**同一个 client_id**
   * 在不同宿主下拿到不同权限的 token —— 而审计里看到的是同一个客户端。
   */
  readonly authScopes: readonly string[]
}

/**
 * 同源宿主的 baseUrl。
 *
 * ⚠️ **是 `'/'` 而不是空串。** 空串同样能拼出正确的相对路径,但它与
 * 「宿主忘了注入配置」长得一模一样 —— `main.tsx` 的 `readConfig` 正是把
 * 空 baseUrl 判成缺失。一个既表示「同源」又表示「没配」的值,
 * 会让 fail closed 那条路永远走不到。
 *
 * SDK 会把结尾的 `/` 去掉,于是最终请求是 `/v1/...`,同源。
 */
export const SAME_ORIGIN_BASE_URL = '/'

/**
 * 三个宿主**共有**的那部分配置。
 *
 * ⚠️ 今天 {@link hostConfig} 的 `switch` 里只算 `baseUrl`,别的字段全部来自这里 ——
 * 所以「除 baseUrl 外逐字段相同」在**今天**是构造上成立的。
 * 那条断言不是在验今天,是在**卡住明天**:要给某个宿主加一个开关,
 * 唯一的写法是在 `hostConfig` 里插一段按 `kind` 分叉的代码,而那一刻断言就红。
 */
const HOST_INVARIANT: Omit<HostConfig, 'baseUrl'> = {
  routerMode: 'hash',
  streamTransport: 'sse',
  externalLinks: 'system-browser',
  brandingSource: 'runtime',
  authScopes: ['openid', 'profile', 'dshwar.workbench'],
}

/**
 * 穷尽性哨兵。
 *
 * {@link HOST_KINDS} 加一个成员而 `switch` 没接上时,`kind` 不再是 `never`,
 * **这里编译不过** —— `pnpm typecheck` 红。它是一条编译期断言,
 * 不依赖任何一条测试跑到这一行。
 */
function unreachableHost(kind: never): never {
  throw new Error(
    `未接线的宿主:${String(kind)} —— HostKind 加了成员,却没在 hostConfig / hostSecrets 里给分支`,
  )
}

/**
 * Tauri 的 baseUrl。
 *
 * ## 🚨 这个值**推断不出来** —— 那是真跨源,不是配置麻烦
 *
 * Tauri 里前端的 origin 是 `tauri://localhost`,而网关在
 * `http://127.0.0.1:<port>`。协议与端口都不同,浏览器判定为跨源。
 * 另两个宿主的前端由网关同一个服务提供,相对路径天然同源 ——
 * **只有这一家不是**。
 *
 * ⚠️ **解法在 Tauri 侧的 HTTP 允许清单,不是给网关加 CORS。**
 * 给网关加 CORS 会给**远端部署**开一个它根本不需要的口子:
 * 远端 Web 从来是同源的,那些响应头只服务于一个桌面壳,
 * 却对所有部署生效。收益归一家,风险归所有人。
 * 位置与归属早在 `vite.config.ts` 的代理注释里记过一次,这里是它的执行落点。
 *
 * ⚠️ 缺端口时**抛**,不猜同源。猜的后果是失败推迟到第一次请求,
 * 而那时的症状是一句与 CORS 无关的网络错误 ——
 * 与「网关没起来」无法区分(实测过,见 `vite.config.ts`)。
 *
 * @throws 端口缺失或不合法时
 */
function tauriBaseUrl(gatewayPort: number | undefined): string {
  if (gatewayPort === undefined) {
    throw new Error(
      'Tauri 宿主必须显式注入网关端口 —— 这个值推断不出来。\n' +
        '前端的 origin 是 tauri://localhost,网关在 http://127.0.0.1:<port>,\n' +
        '协议与端口都不同,那是**真跨源**。解法在 Tauri 侧的 HTTP 允许清单,\n' +
        '不是给网关加 CORS —— 那会给远端部署开一个它不需要的口子。\n' +
        '⇒ 这里宁可拒绝启动,也不猜一个同源的默认值。',
    )
  }
  // ⚠️ 0 要单独挡住:壳侧「端口还没分配」的初值就是它,而 `http://127.0.0.1:0`
  //   是一个语法完全合法、语义完全错误的地址 —— 拼得出来,连不上。
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
    throw new Error(
      `网关端口不合法:${String(gatewayPort)}。\n` +
        '合法区间是 1–65535 的整数;0 通常意味着壳侧还没拿到实际监听端口 ——\n' +
        '那时该等,不该拿 0 拼出一个连不上的地址。',
    )
  }
  return `http://127.0.0.1:${String(gatewayPort)}`
}

/**
 * 取某个宿主的配置。
 *
 * ★ **三份返回值除 `baseUrl` 外必须逐字段相同** —— 那是本 Session 的验收,
 * 落点在 `test/hosts.test.ts`,负向验证在 `verify-assertions.mjs` 探针 23。
 *
 * @throws Tauri 且缺 `gatewayPort` 时 —— 见 {@link tauriBaseUrl}
 */
export function hostConfig(kind: HostKind, runtime: HostRuntime): HostConfig {
  switch (kind) {
    // 这两家的前端由网关同一个服务提供,相对路径天然同源,
    // 连端口都不需要知道 —— 端口换了也不用改前端。
    case 'remote-web':
    case 'local-sidecar':
      return { ...HOST_INVARIANT, baseUrl: SAME_ORIGIN_BASE_URL }
    case 'tauri':
      return { ...HOST_INVARIANT, baseUrl: tauriBaseUrl(runtime.gatewayPort) }
    default:
      return unreachableHost(kind)
  }
}

/**
 * 取某个宿主的 {@link SecretStore}。
 *
 * ## 三家为什么必须不同
 *
 * | 宿主 | 存放处 | 由谁给 |
 * | --- | --- | --- |
 * | 远端 Web | **没有** | {@link WEB_SECRETS_REFUSE} —— 一律拒绝 |
 * | 本地 sidecar | 系统钥匙串 | 宿主注入 |
 * | Tauri | 系统钥匙串 | 宿主注入(Rust 侧) |
 *
 * 浏览器里没有钥匙串,而 localStorage / cookie 对任何同源脚本可读 ——
 * 一次 XSS 就能带走 refresh token,而它的价值恰恰在于长期有效。
 * 远端 Web 的正确行为是**根本不拿 refresh token**,只拿短效 access token。
 *
 * ## ⚠️ 远端 Web 传了 `secrets` 也要拒
 *
 * 「Web 宿主不存长效凭据」是架构约束,不是默认值。允许调用方传一个进来覆盖它,
 * 等于把约束降级成一句注释 —— 而注释拦不住下一个人。
 * 这里**抛**,因为那种调用只可能来自「让三个宿主长得一样」的好意重构。
 *
 * @throws 远端 Web 却传了 `secrets`,或另两家没传时
 */
export function hostSecrets(kind: HostKind, runtime: HostRuntime): SecretStore {
  switch (kind) {
    case 'remote-web':
      if (runtime.secrets !== undefined) {
        // ⚠️ 这句话点名了浏览器存储那几个 API,而约束 2 的守卫扫的正是它们 ——
        //   两者文本一模一样、语义相反(一处是在用,这一处是在讲为什么不能用)。
        //   守卫因此有一条「说明性字符串不算违规」的判据(`scan.mjs` 的
        //   `withoutStringProse`,负向验证 41a–d),而**这一行就是它的活夹具**:
        //   判据要是退化了,check-guards 会当场报到这里。
        //   ⚠️ 判据窄到「带空格或中文的字符串才算说明」—— `window['localStorage']`
        //   这种下标写法不带空格,照旧红。
        throw new Error(
          '远端 Web 宿主不接受注入的 SecretStore —— 浏览器里没有安全存放长效凭据的地方:\n' +
            'localStorage / sessionStorage / cookie 对任何一段同源脚本都可读,\n' +
            '一次 XSS 就能带走 refresh token,而它的价值恰恰在于长期有效。\n' +
            '完整理由在唯一权威处:@dshwar/auth-pkce 的 RefreshTokenNotStorable。\n' +
            '这是架构约束,不是一个可覆盖的默认值 —— 远端 Web 只拿短效 access token。',
        )
      }
      return WEB_SECRETS_REFUSE
    case 'local-sidecar':
    case 'tauri':
      if (runtime.secrets === undefined) {
        throw new Error(
          `${kind} 宿主必须注入 SecretStore —— 系统钥匙串没有浏览器 API,只能由壳提供。\n` +
            '这里不回落到 WEB_SECRETS_REFUSE:那会让「桌面端记得登录」静默失效,\n' +
            '而用户看到的症状是「每次启动都要重新登录」—— 那看起来像 bug,不像没接线。',
        )
      }
      return runtime.secrets
    default:
      return unreachableHost(kind)
  }
}
