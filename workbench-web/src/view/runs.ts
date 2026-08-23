/**
 * 运行历史屏的**转换层**:`Session[]` → `RunsScreenProps`。
 *
 * ## ⚠️ 一处必须说清的落差:「运行」与「会话」不是一回事
 *
 * 设计 kit 的运行历史屏画的是**一次 Agent 运行**:agent 名、模型、
 * 消耗多少 token、跑了多久、什么时候开始、成功还是降级。
 *
 * 而 `/v1` 今天能给的是**会话**(`Session`)。两者的关系是一对多:
 * 一个会话里有若干轮,每一轮才对应一次「运行」。**按轮次的记录还不存在** ——
 * `/v1/jobs` 是 `planned`,而它才是这些字段的将来来源。
 *
 * 于是这一屏在真实数据下是「**每个会话一行**」,而不是「每次运行一行」。
 * 那不是接错了,是**这一版能诚实提供的粒度**。
 *
 * | 屏上的列 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | 运行 id | ⚠️ 用会话 id | 如实用 `Session.id`,不编 `run_xxx` |
 * | Agent | ❌ | `'—'` |
 * | 模型 | ⚠️ `Session.model` 可空 | 为 null 时 `'(默认)'` —— 那是「用部署方配的默认值」,不是缺失 |
 * | 消耗 | ❌ | `'—'` —— 会话级用量要 `/v1/admin/subjects/{id}/usage`,那是管理面 |
 * | 时长 | ❌ | `'—'` —— **`Session` 里没有 `updatedAt`**,只有 `createdAt` |
 * | 状态 | ⚠️ 词表不重叠 | 见下 |
 *
 * ⇒ 三个 `'—'` 是**刻意留白**。编出来会让人以为运行级记录已经能用了。
 *
 * ## ⚠️ 状态词表几乎不重叠 —— 这是设计与契约的一处真分歧
 *
 * 屏幕原本只有四个**终态**(完成 / 降级 / 失败 / 草稿),因为设计稿画的是
 * 已经跑完的历史。而 `Session.status` 只有 `'idle' | 'running'` 两个值。
 *
 * 硬映射会说谎:把 `running` 显示成「草稿」,是对着一个正在跑的会话
 * 说它还没开始。⇒ 给 `RunStatus` 补了 `running` / `idle` 两个成员
 * (见 `RunsScreen.tsx` 的类型注释),终态四个留给 `/v1/jobs` 落地之后用。
 *
 * @module @dshwar/workbench-web/view/runs
 */
import type {
  RunRow,
  RunStatus,
  RunsScreenProps,
} from '@dshwar/design-system/screens/workbench/RunsScreen'
import type { Session } from '../api.ts'
import { shortTime } from '../format.ts'

/** 状态筛选的选项。第一项是「全部」。 */
export const STATUS_OPTIONS = ['全部状态', '完成', '降级', '失败', '草稿'] as const
export const MODEL_OPTIONS = ['全部模型'] as const

/**
 * `Session.status` → 屏上的状态。
 *
 * ⚠️ **闭集,没有兜底档。** 认不出的状态在这里抛,而不是渲染成一个含糊的灰标签 ——
 * 后者会让服务端新增的一个状态悄悄退化成「看起来正常」。
 * 这与 `ArtifactStatus` 的注释是同一条纪律。
 */
export function toStatus(status: Session['status']): RunStatus {
  switch (status) {
    case 'idle':
      return 'idle'
    case 'running':
      return 'running'
    default: {
      // 穷尽性检查:契约加了新状态时**这里编译不过**,而不是运行时静默。
      const never: never = status
      throw new Error(`认不出的会话状态:${String(never)}`)
    }
  }
}

/**
 * 模型标识。
 *
 * ⚠️ `Session.model` 是 `string | null`,而 **null 不是「取不到」** ——
 * 契约写明省略即用部署方配置的默认值。显示成 `'—'` 会让人以为模型信息丢了,
 * 而实际上那是一个明确的选择。与 `primaryColor: null` 是同一族区分。
 */
export function modelLabel(model: string | null): string {
  return model === null ? '(默认)' : model
}

/** 一个会话变成表里的一行。 */
export function toRow(s: Session): RunRow {
  return {
    id: s.id,
    // ⚠️ 没有 agent 维度 —— 会话不记「哪个 agent 跑的」。
    agent: '—',
    model: modelLabel(s.model),
    // ⚠️ 会话级 token 用量在管理面(/v1/admin/subjects/{id}/usage),不在这一面。
    tokens: '—',
    // ⚠️ `Session` 里**没有 `updatedAt`** —— 算不出时长。
    //   拿 `createdAt` 到「现在」当时长是错的:会话空闲着也会一直涨。
    duration: '—',
    startedAt: shortTime(s.createdAt),
    status: toStatus(s.status),
  }
}

/** 组装整屏的 props。 */
export function toRunsProps(input: {
  sessions: readonly Session[]
  selectedIndex?: number
  query?: string
  status?: string
  model?: string
  onQueryChange?: (next: string) => void
  onStatusChange?: (next: string) => void
  onModelChange?: (next: string) => void
  onSelect?: (index: number) => void
  onRerun?: (id: string) => void
  onExport?: () => void
}): RunsScreenProps {
  return {
    rows: input.sessions.map(toRow),
    selectedIndex: input.selectedIndex ?? -1,
    // ⚠️ 失败详情要按轮次的记录才给得出 —— 今天没有,传 null 而不是编一段。
    failure: null,
    query: input.query ?? '',
    status: input.status ?? STATUS_OPTIONS[0],
    statusOptions: STATUS_OPTIONS,
    model: input.model ?? MODEL_OPTIONS[0],
    modelOptions: MODEL_OPTIONS,
    ...(input.onQueryChange === undefined ? {} : { onQueryChange: input.onQueryChange }),
    ...(input.onStatusChange === undefined ? {} : { onStatusChange: input.onStatusChange }),
    ...(input.onModelChange === undefined ? {} : { onModelChange: input.onModelChange }),
    ...(input.onSelect === undefined ? {} : { onSelect: input.onSelect }),
    ...(input.onRerun === undefined ? {} : { onRerun: input.onRerun }),
    ...(input.onExport === undefined ? {} : { onExport: input.onExport }),
  }
}
