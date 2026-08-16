/**
 * 隔离级别 —— **部署决策,不是 API 概念**(V0.4.5 红线 2)。
 *
 * ## 分派只在这一个文件里
 *
 * 三档隔离唯一的差别是「一个 agent 句柄从哪来」。把这件事收进一个工厂,
 * `/v1` 的全部路由、SSE、计量、配额、审计就都不需要知道隔离级别的存在 ——
 * 客户端更不需要。散在路由里写 `if (level === 'process')` 会让每加一档就要
 * 重新审一遍所有端点,而漏掉的那个端点就是隔离的缺口。
 *
 * ## 默认是逻辑隔离(红线 1)
 *
 * 进程隔离要**显式开**。默认改行为会让现有部署在升级后突然多出一堆进程,
 * 而它们的运维完全没有预期。
 *
 * @module @dshwar/gateway/isolation
 */
import type { Principal } from '@dshwar/principal'
import { AtCapacityError, type Supervisor, type SupervisorEvent } from '@dshwar/supervisor'
import { ApiError } from './errors.ts'
import { createRemoteAgent, remoteUserMessage } from './sessions/remote.ts'
import type { AgentFactoryFn, UserMessageFactory } from './sessions/routes.ts'
import type { AgentHandleLike, GatewaySessionStore } from './sessions/store.ts'

/**
 * 隔离三档。
 *
 * | 档 | 越界成本 | 适用 |
 * | --- | --- | --- |
 * | `logical` | 一段提示词 | **仅限互相信任的用户** |
 * | `process` | 一个进程逃逸漏洞 | 跨信任边界 |
 * | `container` | 一个内核提权漏洞 | 面向公众的多租户 SaaS |
 */
export const ISOLATION_LEVELS = ['logical', 'process', 'container'] as const
export type IsolationLevel = (typeof ISOLATION_LEVELS)[number]

/** 红线 1:默认逻辑隔离。 */
export const DEFAULT_ISOLATION_LEVEL: IsolationLevel = 'logical'

/**
 * 逻辑档承载多主体时抛出 —— **配置层的第一道闸门**(V0.4.7)。
 *
 * ## 为什么这是永久设计而不是临时闸门
 *
 * 逻辑档下 principal 到不了 agent 执行层,而这不是「实现起来重」,
 * 是当前上游 API 下**做不到**:四条路全部走不通(根上 provide 会把所有人
 * 绑成一个人;per-agent provide 第一个成功第二个报错;fiber 链回溯被 inject
 * 拦住;给每个 agent 装一份服务实例被 cordis 拒绝)。
 * 详见 `docs/DECISIONS/principal-scope-binding.md` 与
 * `ARCHITECTURE.md` §2.4 的四条路对照表。
 *
 * 后果不是「隔离强度不够」,是**根本没有隔离**:alice 与 bob 的 agent 往同一个
 * `anonymous/anonymous/default/` 写,同名文件互相覆盖。**同事之间文件被覆盖
 * 也是 bug** —— 所以「仅限互相信任的用户」这条边界在这里不适用。
 *
 * ## 错误信息必须给出路
 *
 * 一个没有出路的门禁,最后拦住的只有守规矩的人 —— 其余人直接把它注释掉。
 * 所以这里把替代方案与它的代价一起说清楚。
 */
export class LogicalIsolationMultiUserError extends Error {
  override readonly name = 'LogicalIsolationMultiUserError'
  readonly userCount: number

  constructor(detail: string, userCount: number) {
    super(
      [
        `逻辑隔离档不支持多主体(检测到:${detail})。`,
        '',
        '原因:逻辑档下 principal 到不了 agent 执行层 —— 多个用户的 agent 会往',
        '同一个 {root}/anonymous/anonymous/default/ 目录写文件,同名文件互相覆盖,',
        '且没有任何报错。这是当前上游 API 下的架构限制,不是待办事项。',
        '',
        '出路:改用进程隔离。',
        '  { "isolation": { "level": "process", "maxProcesses": 64 } }',
        '',
        '代价:每个活跃主体约 58 MB 常驻、首次请求约 115 ms 冷启动。',
        '  50 人团队 ≈ 2.9 GB。maxProcesses 必须按机器内存设。',
        '  详见 docs/DEPLOYMENT.md §2.5。',
        '',
        '单用户部署不受影响:匿名或单 token 的逻辑档没有这个问题,',
        'profiles/single-user.yml 照常可用。',
      ].join('\n'),
    )
    this.userCount = userCount
  }
}

/**
 * 配置层闸门:逻辑档 + 任何多用户身份组合 → 拒绝启动。
 *
 * **启动时就能确定性判断**,不必等到第二个用户真的来 —— 这是它相对
 * 运行时兜底的价值:部署方在起服务的那一刻就知道配置不对,而不是上线三天后
 * 从一份被覆盖的文件里发现。
 *
 * @param level 隔离级别
 * @param identity 身份配置的形状(只看数量与是否接了 IdP,不看内容)
 * @throws {LogicalIsolationMultiUserError} 逻辑档 + 多用户
 */
export function assertSinglePrincipalCapable(
  level: IsolationLevel,
  identity: {
    /** 静态令牌条数。> 1 即多用户。 */
    readonly staticTokenCount?: number
    /** 是否接了 OIDC —— 接了就意味着任意多用户。 */
    readonly hasOidc?: boolean
    /** 是否接了 JWT 验签 —— 同上。 */
    readonly hasJwt?: boolean
    /** 是否接了 SCIM 供给 —— 供给系统会推进来任意多用户。 */
    readonly hasScim?: boolean
  },
): void {
  if (level !== 'logical') return

  const reasons: string[] = []
  const tokens = identity.staticTokenCount ?? 0
  if (tokens > 1) reasons.push(`auth-static 配了 ${tokens} 个令牌`)
  if (identity.hasOidc === true) reasons.push('接了 auth-oidc')
  if (identity.hasJwt === true) reasons.push('接了 auth-jwt')
  if (identity.hasScim === true) reasons.push('接了 SCIM 供给')

  if (reasons.length > 0) {
    throw new LogicalIsolationMultiUserError(reasons.join('、'), tokens)
  }
}

/** 把配置里的字符串收窄成隔离级别。认不出就抛 —— 不猜。 */
export function parseIsolationLevel(value: string | undefined): IsolationLevel {
  if (value === undefined) return DEFAULT_ISOLATION_LEVEL
  if ((ISOLATION_LEVELS as readonly string[]).includes(value)) return value as IsolationLevel
  throw new Error(
    `未知的隔离级别 ${JSON.stringify(value)};可选:${ISOLATION_LEVELS.join(' / ')}`,
  )
}

/** 进程内驱动的运行时。就是 `assembleRuntime()` 的产物。 */
export interface InProcessRuntime {
  readonly createAgent: (input: {
    sessionId: string
    model: string | undefined
    provider: string | undefined
  }) => Promise<AgentHandleLike>
  readonly userMessage: (text: string) => unknown
}

export interface IsolationConfig {
  readonly level: IsolationLevel
  /** 逻辑档用它;进程档下父进程**不装** harness,所以可以缺席。 */
  readonly inProcess?: InProcessRuntime
  /** 进程档必需。 */
  readonly supervisor?: Supervisor
  /**
   * 进程档必需 —— 崩溃时要能找到会话把失败告诉客户端(R5)。
   *
   * 用会话簿而不是回调,是因为一个进程上可能挂着同一 principal 的**多个**会话,
   * 而崩溃是进程级事件:必须能从「哪个进程死了」反查到「哪些会话完了」。
   */
  readonly store?: GatewaySessionStore
  /** 建会话时等子进程回执的超时。 */
  readonly createTimeoutMs?: number
}

/** 路由需要的两个工厂。三档隔离的差异到此为止。 */
export interface IsolatedRuntime {
  readonly createAgent: AgentFactoryFn
  readonly userMessage: UserMessageFactory
}

/**
 * 按隔离级别装出 `createAgent` / `userMessage`。
 *
 * @throws {Error} 配置与级别不匹配时**立刻**抛,不留到第一个请求 ——
 *   一个「起得来但一用就炸」的网关比起不来更糟。
 */
export function createIsolatedRuntime(config: IsolationConfig): IsolatedRuntime {
  if (config.level === 'container') {
    // 红线 4:容器档只留配置位。容器编排是部署方的 Kubernetes / Nomad 的事,
    // 在这里自造一套只会和它们打架。要接容器,自定义一个 ProcessLauncher 喂给
    // Supervisor 即可 —— 池逻辑(复用、上限、回收)与创建方式正交。
    throw new Error(
      '隔离级别 container 在 V0.4.5 只是配置位,未实现。' +
        '请用 process 档,并把 Supervisor 的 ProcessLauncher 换成你的容器编排。',
    )
  }

  if (config.level === 'logical') {
    if (config.inProcess === undefined) {
      throw new Error('逻辑隔离需要一个进程内运行时(assembleRuntime 的产物)')
    }
    const runtime = config.inProcess

    /**
     * 运行时兜底:逻辑档下出现第二个不同的主体 → **拒绝该会话**(V0.4.7)。
     *
     * 配置层(`assertSinglePrincipalCapable`)是主闸门,启动时就能确定性判断。
     * 这一层是**防御深度**:配置看起来是单用户,但实际来了第二个人 ——
     * 比如 `auth-static` 只配一个令牌却被多人共用。
     *
     * ⚠️ **绝不杀进程。** 逻辑档下杀进程 = 第二个用户能干掉第一个用户的运行时,
     * 那是个白送的 DoS 向量。**拒绝会话,不拒绝服务。**
     */
    let seen: Principal | undefined
    return {
      // `async` 不是装饰:`AgentFactoryFn` 声明返回 Promise,同步抛会让
      // 用 `.catch()` 的调用方接不到 —— 接口说什么,就得真是什么。
      createAgent: async (input) => {
        if (seen === undefined) {
          seen = input.principal
        } else if (seen.id !== input.principal.id) {
          throw new ApiError(
            'forbidden',
            `逻辑隔离档只支持单主体:本进程已绑定 ${seen.id},拒绝 ${input.principal.id} 的会话。` +
              '多用户请改用 isolation: process(代价约 58 MB/主体),见 docs/DEPLOYMENT.md §2.5。',
          )
        }
        return runtime.createAgent({
          sessionId: input.sessionId,
          model: input.model,
          provider: input.provider,
        })
      },
      userMessage: (text) => runtime.userMessage(text),
    }
  }

  const supervisor = config.supervisor
  const store = config.store
  if (supervisor === undefined || store === undefined) {
    throw new Error('进程隔离需要 supervisor 与 store —— 崩溃时要能找到会话通知客户端')
  }

  return {
    createAgent: async (input) => {
      let lease
      try {
        lease = supervisor.acquire(input.principal)
      } catch (e) {
        // 判定与执行分离(与 policy 同款):supervisor 只抛类型化错误,
        // 状态码在这里定。
        //
        // V0.4.5 这里曾是 `rate_limited`(429)—— 那是被「契约零变更」逼出来的
        // 折中,语义是错的:「你请求太多」与「这台机器满了」是两回事,前者会让
        // 客户端以为该限制自己,也会让运维照着 429 曲线去调客户端限额,
        // 而根因是容量不足。V0.4.6 补了 `unavailable`,折中撤销。
        if (e instanceof AtCapacityError) {
          throw new ApiError('unavailable', '隔离进程池已满,请稍后重试')
        }
        throw e
      }

      return createRemoteAgent(
        lease,
        {
          sessionId: input.sessionId,
          model: input.model,
          provider: input.provider,
          ...(config.createTimeoutMs === undefined
            ? {}
            : { createTimeoutMs: config.createTimeoutMs }),
        },
        () => {
          // R5:进程没了 → 会话标记失败 → SSE 发 error 后收流。
          // 找不到会话说明它已经被释放了,那是正常的。
          const session = store.get(input.sessionId, input.principal)
          if (session !== undefined) {
            store.fail(session, {
              code: 'runtime_unavailable',
              message: '承载该会话的隔离进程已退出',
            })
          }
        },
      )
    },
    // 跨进程不构造上游的 UserMessage —— 真正驱动的是子进程,由它构造。
    userMessage: remoteUserMessage,
  }
}

/**
 * 把进程池事件接进审计(R7)。
 *
 * **不另起一套。** spawn / 回收 / 崩溃 / 拒绝都是治理事件,和 Admin 调用、
 * SCIM 供给走同一条审计管道 —— 两套审计意味着排查一次事故要看两个地方。
 *
 * @param record 审计落库函数,形状取 `@dshwar/audit` 的结构性子集
 */
export function auditSupervisorEvents(
  record: (entry: {
    at: string
    actor: string
    tenantId: string
    action: string
    target: string
    after: unknown
    requestId: string
  }) => void,
): (event: SupervisorEvent) => void {
  return (event) => {
    record({
      at: new Date().toISOString(),
      actor: 'supervisor',
      tenantId: event.tenantId,
      // `supervisor.spawn` / `.reclaim` / `.crash` / `.rejected`
      action: `supervisor.${event.kind}`,
      target: event.principalId,
      after: { ...event },
      // 进程事件不是由某个 HTTP 请求直接触发的(回收与崩溃尤其如此),
      // 所以没有真实的 requestId。留空字符串而不是编一个 ——
      // 编出来的 id 在日志里查不到任何对应请求,比空更误导。
      requestId: '',
    })
  }
}
