/**
 * 策略执行 —— **判定与审计绑在一起**(V0.5.5 Session 2)。
 *
 * ## 为什么不让调用方自己记审计
 *
 * 验收要求是「被策略拒绝的动作必须进审计,而不是静默失败」。
 * 若把 `checkTool()` 与 `audit.record()` 留给调用方分别调用,那条要求就
 * **依赖每个调用点都记得记** —— 而这个仓库已经反复证明「靠人记得」的事会被忘。
 *
 * 所以这里只暴露一个入口:**判定的同时就记了**。
 * 想拿到判定结果就必须经过它,没有「只判不记」的路。
 *
 * ## 为什么静默拒绝特别糟
 *
 * 不是「少一条日志」这么简单。用户看到一个动作没生效、没有任何解释,
 * 第一反应是**这是个 bug** —— 然后他会去想办法绕过它:
 * 换个工具名、换条路径、把文件挪到别处。
 *
 * 换句话说,**静默的拒绝会主动训练用户去对抗策略**,
 * 而一条说清「被什么规则拒了、去哪改」的记录会让他去改配置。
 *
 * ## 只记拒绝,不记放行
 *
 * 放行是常态 —— 每次工具调用都记一条会把审计淹掉,而淹掉的审计等于没有。
 * 审计要留给**异常**:被拒了什么、谁拒的、什么时候。
 *
 * ⚠️ 若将来有合规要求「全量留痕」,那是另一条通路(操作日志),
 * 不该挤进审计 —— 两者的保留期、查询模式、体量都差一个数量级。
 *
 * @module @dshwar/gateway/workspaces/enforce
 */
import type { Principal } from '@dshwar/principal'
import type { AuditSink } from '../admin/audit.ts'
import {
  checkHost,
  checkShell,
  checkTool,
  checkWrite,
  type PolicyDecision,
  type WorkspacePolicyStore,
} from './policy.ts'

/** 一次受策略管辖的动作。 */
export type GuardedAction =
  | { readonly kind: 'tool'; readonly tool: string }
  | { readonly kind: 'write'; readonly path: string }
  | { readonly kind: 'network'; readonly host: string }
  | { readonly kind: 'shell' }

export interface PolicyEnforcerOptions {
  readonly policies: WorkspacePolicyStore
  readonly audit: AuditSink
}

/** 动作的审计 target —— 让查询能按类型圈定。 */
function targetOf(action: GuardedAction): string {
  switch (action.kind) {
    case 'tool':
      return `tool:${action.tool}`
    case 'write':
      return `path:${action.path}`
    case 'network':
      return `host:${action.host}`
    case 'shell':
      return 'shell'
  }
}

/**
 * 建一个策略执行器。
 *
 * ⚠️ **返回的对象只有一个方法**,而它既判定又记录。
 * 这不是把两件事硬凑到一起 —— 是让「判了但没记」在结构上不存在。
 */
export function createPolicyEnforcer(options: PolicyEnforcerOptions) {
  return {
    /**
     * 判定一次动作,**被拒时自动进审计**。
     *
     * @param requestId 用于把审计记录与那一次请求对上。查日志靠它,
     *   而不是靠把原始错误塞进审计 —— 后者可能带凭据片段。
     */
    async check(input: {
      principal: Principal
      workspaceId: string
      action: GuardedAction
      requestId: string
    }): Promise<PolicyDecision> {
      const policy = await options.policies.get(input.workspaceId)

      let decision: PolicyDecision
      switch (input.action.kind) {
        case 'tool':
          decision = checkTool(policy, input.action.tool)
          break
        case 'write':
          decision = checkWrite(policy, input.action.path)
          break
        case 'network':
          decision = checkHost(policy, input.action.host)
          break
        case 'shell':
          decision = checkShell(policy)
          break
      }

      if (decision.kind === 'deny') {
        options.audit.record({
          at: new Date().toISOString(),
          // actor 是**发起动作的主体**,不是凭证。审计要能回答「谁被拒了」。
          actor: input.principal.id,
          tenantId: input.principal.tenantId,
          action: 'workspace.policy.denied',
          target: targetOf(input.action),
          // before/after 在这里是「策略」与「被拒的原因」——
          // 让审计自己就能解释这次拒绝,不必再去翻当时的配置版本。
          before: { workspaceId: input.workspaceId, policy },
          after: { denied: decision.reason },
          requestId: input.requestId,
        })
      }

      return decision
    },
  }
}
