/**
 * 工作区执行策略 —— **预授权,不是运行时审批弹窗**(V0.5.5 Session 2)。
 *
 * ## 为什么不做运行时弹窗
 *
 * 两条理由,第二条比第一条更根本:
 *
 * 1. **做不到。** 上游 SDK 协议的 server→client 请求是死能力。
 * 2. **即使做得到也不该做。** 一个每次动作都要点「允许」的界面,
 *    用户三次之后就会无脑点允许 —— 那时审批只剩下摩擦,没有保护。
 *    这不是猜测,是所有做过权限弹窗的系统的共同结局。
 *
 * 取而代之:**事先**在工作区设置里说清允许什么,**拒绝进审计**。
 *
 * ## 默认必须是最紧的
 *
 * 空数组一律解释成「全部禁止」,不是「全部允许」。
 * 这是 CLAUDE.md 硬规则 6 的同款判断:**认不出或没配就拒**。
 *
 * ⚠️ 反过来的默认(空 = 放行)在实现上更省事,但它的失败形态是
 * **一个忘了配策略的工作区拥有全部权限** —— 而「忘了配」恰恰是最常见的状态。
 *
 * @module @dshwar/gateway/workspaces/policy
 */

/** 一个工作区的执行策略。字段与契约的 `WorkspacePolicy` 对齐。 */
export interface WorkspacePolicy {
  readonly workspaceId: string
  /** 允许的工具名。**空数组 = 全部禁止**。 */
  readonly allowedTools: readonly string[]
  /** 允许写入的路径前缀,相对工作区根。**空数组 = 只读**。 */
  readonly writablePaths: readonly string[]
  /** 允许访问的网络主机。**空数组 = 断网**。 */
  readonly allowedHosts: readonly string[]
  /** 允许执行 shell。**默认 false** —— 最危险的一个,默认必须是关的。 */
  readonly allowShell: boolean
  readonly updatedAt: string
}

/** 一次策略判定的结果。 */
export type PolicyDecision =
  { readonly kind: 'allow' } | { readonly kind: 'deny'; readonly reason: string }

/** 新工作区的默认策略 —— 全部关死。 */
export function defaultPolicy(workspaceId: string): WorkspacePolicy {
  return {
    workspaceId,
    allowedTools: [],
    writablePaths: [],
    allowedHosts: [],
    allowShell: false,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 判定一次工具调用。
 *
 * ⚠️ **不做前缀匹配、不做通配符。** 工具名是闭集,精确匹配即可。
 * 引入通配符意味着 `fs*` 会同时放行 `fs.read` 与 `fs.deleteAll` ——
 * 而配置的人多半只想到前者。
 */
export function checkTool(policy: WorkspacePolicy, tool: string): PolicyDecision {
  if (policy.allowedTools.includes(tool)) return { kind: 'allow' }
  return {
    kind: 'deny',
    reason:
      policy.allowedTools.length === 0
        ? `工作区未配置任何允许的工具(默认全部禁止),拒绝 ${tool}`
        : `工具 ${tool} 不在允许清单里`,
  }
}

/**
 * 判定一次写入。
 *
 * ⚠️ **路径前缀匹配必须按「段」对齐。** 朴素的 `startsWith` 会让
 * `writablePaths: ['out']` 放行 `output-secret.txt` —— 那是个真实的越界。
 */
export function checkWrite(policy: WorkspacePolicy, path: string): PolicyDecision {
  const normalized = path.replace(/^\/+/, '')
  for (const prefix of policy.writablePaths) {
    const clean = prefix.replace(/^\/+|\/+$/g, '')
    if (normalized === clean || normalized.startsWith(`${clean}/`)) return { kind: 'allow' }
  }
  return {
    kind: 'deny',
    reason:
      policy.writablePaths.length === 0
        ? `工作区未配置可写路径(默认只读),拒绝写入 ${path}`
        : `${path} 不在可写路径下`,
  }
}

/**
 * 判定一次网络访问。
 *
 * ⚠️ **主机匹配也要按段对齐**,理由同上:`allowedHosts: ['example.com']`
 * 不该放行 `evil-example.com`,但**应该**放行 `api.example.com` ——
 * 后者是子域,前者是另一个域,朴素的 `endsWith` 分不清。
 */
export function checkHost(policy: WorkspacePolicy, host: string): PolicyDecision {
  const target = host.toLowerCase()
  for (const allowed of policy.allowedHosts) {
    const clean = allowed.toLowerCase()
    if (target === clean || target.endsWith(`.${clean}`)) return { kind: 'allow' }
  }
  return {
    kind: 'deny',
    reason:
      policy.allowedHosts.length === 0
        ? `工作区未配置允许的主机(默认断网),拒绝访问 ${host}`
        : `主机 ${host} 不在允许清单里`,
  }
}

/** 判定一次 shell 执行。 */
export function checkShell(policy: WorkspacePolicy): PolicyDecision {
  return policy.allowShell
    ? { kind: 'allow' }
    : { kind: 'deny', reason: '工作区未允许执行 shell(默认关闭)' }
}

/** 策略存储。 */
export interface WorkspacePolicyStore {
  get(workspaceId: string): Promise<WorkspacePolicy>
  update(
    workspaceId: string,
    patch: Partial<Omit<WorkspacePolicy, 'workspaceId'>>,
  ): Promise<WorkspacePolicy>
}

/** 内存实现。没配过的工作区返回 {@link defaultPolicy} —— 全部关死。 */
export class InMemoryWorkspacePolicyStore implements WorkspacePolicyStore {
  private readonly items = new Map<string, WorkspacePolicy>()

  async get(workspaceId: string): Promise<WorkspacePolicy> {
    return this.items.get(workspaceId) ?? defaultPolicy(workspaceId)
  }

  async update(
    workspaceId: string,
    patch: Partial<Omit<WorkspacePolicy, 'workspaceId'>>,
  ): Promise<WorkspacePolicy> {
    const current = await this.get(workspaceId)
    const next: WorkspacePolicy = {
      ...current,
      ...patch,
      workspaceId,
      updatedAt: new Date().toISOString(),
    }
    this.items.set(workspaceId, next)
    return next
  }
}
