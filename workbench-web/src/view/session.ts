/**
 * 协作屏的**转换层**:`Session` → `SessionScreenProps`。
 *
 * ## ⚠️ 这一屏是落差最大的一屏,先把话说清
 *
 * 设计 kit 的协作屏画的是一段**完整的对话**:每一轮谁说了什么、
 * agent 调了哪些工具、产出了什么、消耗多少。
 *
 * 而 `/v1/sessions/{id}` 返回的 `Session` **不含任何轮次内容** ——
 * 它只有 id / subjectId / workspaceId / status / model / provider /
 * includeReasoning / **turns(一个数字)** / createdAt / metadata。
 *
 * 对话内容在 **SSE 流**里(`GET /v1/sessions/{id}/stream`),而流是
 * **增量**:它给的是「接下来发生了什么」,不是「已经发生过什么」。
 * **没有历史回放端点。**
 *
 * ⇒ 于是:
 *
 * | 屏上的东西 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | 标题 / 状态 / 模型 | ✅ `Session` 有 | 直接给 |
 * | 轮次内容 | ⚠️ 只有实时流 | 传空数组 + 一条**说明为什么是空的**的说明 |
 * | 本次产物 | ⚠️ 工作区文件可近似 | 由 `deliverables` 传入,**不是**「本次运行产出的」 |
 * | 我的配额 | ❌ | `null` —— 配额在管理面 |
 * | 工作区文件树 | ⚠️ 扁平清单可近似 | 由 `deliverables` 传入 |
 *
 * **传空数组而不是编几轮假对话**,是这一层最重要的一个决定:
 * 一段看起来正常的假对话会让人以为历史回放已经能用了,
 * 而真相是「刷新一次就什么都没了」。
 *
 * @module @dshwar/workbench-web/view/session
 */
import type {
  SessionArtifact,
  SessionScreenProps,
  SessionStatus,
  SessionWorkspaceEntry,
} from '@dshwar/design-system/screens/workbench/SessionScreen'
import type { Deliverable, Session } from '../api.ts'
import { baseNameOf, humanBytes } from '../format.ts'
import { modelLabel } from './runs.ts'

/** 模型下拉的选项。**由部署方配置决定**,不写死一张清单。 */
export const MODEL_OPTIONS = ['(默认)'] as const

/**
 * `Session.status` → 屏上的状态。
 *
 * ⚠️ 闭集,无兜底档。与 `view/runs.ts` 的 `toStatus` 同一条纪律:
 * 契约加了新状态时**这里编译不过**。
 *
 * 注意屏幕的 `SessionStatus` 有四个值(running / completed / failed / stopped)
 * 而契约只有两个 —— `completed` / `failed` / `stopped` 三个终态今天到不了,
 * 因为会话没有终态:它要么空闲、要么在跑。删除会话就是删除,不留终态记录。
 */
export function toSessionStatus(status: Session['status']): SessionStatus {
  switch (status) {
    case 'running':
      return 'running'
    case 'idle':
      // ⚠️ 空闲映射到 `completed` 是这一层唯一一处**不完全诚实**的映射,
      //   因为屏幕的词表里没有「空闲」。它显示为「已完成」,
      //   而准确的说法是「这一轮跑完了,会话还在」。
      //   记在这里,等设计侧给出一个「空闲」态之后改掉。
      return 'completed'
    default: {
      const never: never = status
      throw new Error(`认不出的会话状态:${String(never)}`)
    }
  }
}

/** 工作区文件 → 右侧「本次产物」条目。 */
export function toArtifact(d: Deliverable): SessionArtifact {
  return {
    id: d.path,
    name: baseNameOf(d.path),
    size: d.kind === 'directory' ? '—' : humanBytes(d.size),
  }
}

/** 工作区文件 → 右侧「工作区文件」条目。 */
export function toWorkspaceEntry(d: Deliverable): SessionWorkspaceEntry {
  return {
    path: d.path,
    // ⚠️ 没有「这个路径下有几个文件」的聚合 —— 清单是扁平的。
    count: d.kind === 'directory' ? '目录' : humanBytes(d.size),
  }
}

/** 组装整屏的 props。 */
export function toSessionProps(input: {
  session: Session | null
  workspaceName: string
  deliverables?: readonly Deliverable[]
  draft: string
  onDraftChange?: (next: string) => void
  onSend?: () => void
  onStop?: () => void
  onModelChange?: (next: string) => void
}): SessionScreenProps {
  const files = input.deliverables ?? []
  return {
    title: input.session === null ? '(还没有会话)' : `会话 ${input.session.id}`,
    status: input.session === null ? 'stopped' : toSessionStatus(input.session.status),
    runId: input.session?.id ?? '—',
    workspace: input.workspaceName,
    model: modelLabel(input.session?.model ?? null),
    modelOptions: MODEL_OPTIONS,
    // ⚠️ 降级信息在 SSE 的 `degraded` 事件里,不在 `Session` 上。
    degrade: null,
    offline: null,
    queuedInputs: [],
    // ★ **空数组是刻意的。** 没有历史回放端点 —— 见模块顶部那张表。
    //   编几轮假对话会让人以为回放已经能用,而刷新一次就什么都没了。
    turns: [],
    draft: input.draft,
    // ⚠️ 会话级用量在管理面,这一面拿不到。
    usage: null,
    artifacts: files.filter((d) => d.kind === 'file').map(toArtifact),
    files: files.map(toWorkspaceEntry),
    // ⚠️ 配额同样在管理面(/v1/admin/subjects/{id}/quota)。
    quota: null,
    ...(input.onDraftChange === undefined ? {} : { onDraftChange: input.onDraftChange }),
    ...(input.onSend === undefined ? {} : { onSend: input.onSend }),
    ...(input.onStop === undefined ? {} : { onStop: input.onStop }),
    ...(input.onModelChange === undefined ? {} : { onModelChange: input.onModelChange }),
  }
}
