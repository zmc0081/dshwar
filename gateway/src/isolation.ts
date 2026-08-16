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
    return {
      createAgent: (input) =>
        runtime.createAgent({
          sessionId: input.sessionId,
          model: input.model,
          provider: input.provider,
        }),
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
        // ⚠️ **用 `rate_limited`(429)是被红线 2 逼出来的折中,不是最贴切的语义。**
        // 贴切的是 503 —— 「你请求太多」与「这台机器满了」是两回事,前者会让
        // 客户端以为该限制自己。但契约的 `ErrorCode` 是闭集,加一个新码会被
        // `check:contract` 判为破坏性变更(`enum.value.added`),而红线 2 要求
        // `/v1` 零变更。闭集里唯一语义为「退避后重试」的就是 `rate_limited`,
        // 客户端与负载均衡器对它的处置(退避 + `Retry-After`)恰好是对的。
        //
        // 契约下次开口时(V0.5.0 控制平面)应补一个 `unavailable`。
        if (e instanceof AtCapacityError) {
          throw new ApiError('rate_limited', '隔离进程池已满,请稍后重试')
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
    tenantId: string
    actor: string
    action: string
    target: string
    detail: Record<string, unknown>
  }) => void,
): (event: SupervisorEvent) => void {
  return (event) => {
    record({
      tenantId: event.tenantId,
      actor: 'supervisor',
      // `supervisor.spawn` / `.reclaim` / `.crash` / `.rejected`
      action: `supervisor.${event.kind}`,
      target: event.principalId,
      detail: { ...event },
    })
  }
}
