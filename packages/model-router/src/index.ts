/**
 * `@dshwar/model-router` —— 模型准入与预算降级。
 *
 * ## 一句话边界:裁决,不路由
 *
 * 本包只在 `createAgent` 的**入口**回答一个问题:「这个 principal 此刻允许用
 * 哪个模型」。裁决完交回上游 —— 真正的模型调用、重试、流式全是 `dsh-llm` 的事。
 * 名字里有 router,但它不碰任何请求(上游做能力,DSHWAR 做治理)。
 *
 * ## 准入是 opt-in 的治理
 *
 * 没配策略的租户**默认放行**。准入解决的是「试用用户不许调最贵的模型」这类
 * 商业问题,不是安全问题 —— 默认封锁会让每个新租户都先撞一次 403,
 * 然后运维学会「上来先配个全通策略」,治理从此变成仪式。
 *
 * ## 降级是显式配置,且必须可见(红线 3)
 *
 * 只有策略里写了 `fallbackModel`、且预算用到阈值,才会降级;降级发生时
 * 结果带 `downgraded: true`,网关据此设响应头并落审计 ——
 * **用户有权知道自己被换了模型**。静默换模型省下的每一分钱,
 * 都会在第一次「为什么答案变笨了」的工单里加倍还回去。
 *
 * @module @dshwar/model-router
 */

/** 与契约 `Policy` 对齐的租户策略。 */
export interface ModelPolicy {
  readonly id: string
  readonly tenantId: string
  /** 允许的 `provider/model` 组合;**空数组 = 全部允许**(契约语义)。 */
  readonly allowedModels: readonly string[]
  /** 超预算后的降级目标(`provider/model`);null = 直接拒绝(走 policy 的 429)。 */
  readonly fallbackModel: string | null
  readonly updatedAt: string
}

/** 策略存储。写入口留给控制平面(V0.5.0),本版本只读。 */
export interface PolicyStore {
  byTenant(tenantId: string): Promise<ModelPolicy | undefined>
  list(tenantId: string): Promise<ModelPolicy[]>
}

/** 内存实现。 */
export class InMemoryPolicyStore implements PolicyStore {
  private readonly policies: ModelPolicy[]

  constructor(policies: readonly ModelPolicy[] = []) {
    this.policies = [...policies]
  }

  async byTenant(tenantId: string): Promise<ModelPolicy | undefined> {
    return this.policies.find((p) => p.tenantId === tenantId)
  }

  async list(tenantId: string): Promise<ModelPolicy[]> {
    return this.policies.filter((p) => p.tenantId === tenantId)
  }
}

/** 预算水位:0..1 之间的已用比例;无上限或读不到时 undefined。 */
export type BudgetLevel = number | undefined

export interface ResolveInput {
  readonly tenantId: string
  /** 请求的 `provider/model`。 */
  readonly requested: string
  /** 当前预算水位。由部署方从 policy 包的 quota 数据算出。 */
  readonly budgetUsedRatio?: BudgetLevel
}

export type ModelDecision =
  | {
      readonly kind: 'allow'
      readonly model: string
      /** 发生了预算降级。网关据此设 `x-dshwar-model-downgraded` 并落审计。 */
      readonly downgraded: boolean
    }
  | { readonly kind: 'deny'; readonly reason: 'model_not_allowed' }

/** 预算降级的触发阈值。0.8 = 预算用到八成即换降级目标。 */
export const DEFAULT_DOWNGRADE_THRESHOLD = 0.8

export interface ModelRouterOptions {
  readonly policies: PolicyStore
  /** 降级阈值,默认 {@link DEFAULT_DOWNGRADE_THRESHOLD}。 */
  readonly downgradeThreshold?: number
}

/**
 * 裁决入口。
 *
 * 顺序有意义:**先准入,后降级**。请求清单外的模型时,即使预算充足也是拒绝 ——
 * 准入答的是「许不许用」,降级答的是「用哪个」,前者优先。
 * 降级目标本身也要过准入:把 fallback 配成清单外的模型是配置错误,
 * 裁决时报拒绝而不是放行一个清单外的模型。
 */
export class ModelRouter {
  private readonly options: ModelRouterOptions

  constructor(options: ModelRouterOptions) {
    this.options = options
  }

  async resolve(input: ResolveInput): Promise<ModelDecision> {
    const policy = await this.options.policies.byTenant(input.tenantId)

    // 没配策略 = 不治理,原样放行(opt-in)
    if (policy === undefined) {
      return { kind: 'allow', model: input.requested, downgraded: false }
    }

    const allowed = (model: string) =>
      policy.allowedModels.length === 0 || policy.allowedModels.includes(model)

    // ---- ① 准入 ----
    if (!allowed(input.requested)) {
      return { kind: 'deny', reason: 'model_not_allowed' }
    }

    // ---- ② 预算降级(显式配置才有)----
    const threshold = this.options.downgradeThreshold ?? DEFAULT_DOWNGRADE_THRESHOLD
    const shouldDowngrade =
      policy.fallbackModel !== null &&
      input.budgetUsedRatio !== undefined &&
      input.budgetUsedRatio >= threshold &&
      // 已经在用降级目标就不再"降"——否则响应头会永远挂着 downgraded
      input.requested !== policy.fallbackModel

    if (shouldDowngrade) {
      // 降级目标也要过准入:fallback 配成清单外的模型是配置错误
      if (!allowed(policy.fallbackModel!)) {
        return { kind: 'deny', reason: 'model_not_allowed' }
      }
      return { kind: 'allow', model: policy.fallbackModel!, downgraded: true }
    }

    return { kind: 'allow', model: input.requested, downgraded: false }
  }
}
