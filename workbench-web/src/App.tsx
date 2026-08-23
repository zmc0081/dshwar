/**
 * 工作台应用 —— 把八屏接进真实 `/v1` API。
 *
 * ## 它做什么、不做什么
 *
 * 做:hash 路由 → 选屏 · 拉数据 → 转换层 → props · 用户操作 → api.ts。
 * 不做:任何网络原语。`fetch` / `EventSource` 只出现在 `api.ts`
 * (守卫盯着,一个包只许一个出口)。
 *
 * ## 三条既定约束在这一层的落点
 *
 * | 约束 | 落点 |
 * | --- | --- |
 * | 1 不展示 shell 命令原文 | `ToolCall` 的类型里**根本没有命令字段**,这里也就传不进去 |
 * | 2 没有运行时审批弹窗 | 本文件没有任何 modal / confirm;设置页是替代品 |
 * | 3 策略端点回落 501 | `api.getWorkspacePolicy` 返回 `not-implemented`,**如实往下传** |
 *
 * ⚠️ 约束 3 的具体含义是:**不要在这里把 501 兜成一个空策略**。
 * 兜掉之后界面会显示一份「当前策略」,而那份策略从来没被任何东西查询过 ——
 * 那比一个诚实的 501 危险得多。
 *
 * ## 加载与错误:三态,不是两态
 *
 * `loading` / `ok` / `failed` 之外还有第四种 —— **`not-implemented`**。
 * 它不属于 `failed`:失败该让人重试,而没实现重试一万次也一样。
 * 混在一起的后果是用户对着一个红色失败态反复点刷新。
 *
 * @module @dshwar/workbench-web/App
 */
import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { ArtifactsScreen } from '@dshwar/design-system/screens/workbench/ArtifactsScreen'
import { JobsScreen } from '@dshwar/design-system/screens/workbench/JobsScreen'
import { RunsScreen } from '@dshwar/design-system/screens/workbench/RunsScreen'
import { SessionScreen } from '@dshwar/design-system/screens/workbench/SessionScreen'
import { WorkbenchShell } from '@dshwar/design-system/screens/workbench/WorkbenchShell'
import {
  WorkspaceSettingsScreen,
  type PolicyEvidence,
} from '@dshwar/design-system/screens/workbench/WorkspaceSettingsScreen'
import type { WorkbenchApi, Deliverable, Session, Workspace } from './api.ts'
import { hrefOf, parseLocation, type Location, type Route } from './router.ts'
import { DEFAULT_RANGE, toArtifactsProps } from './view/artifacts.ts'
import { toRunsProps } from './view/runs.ts'
import { toSessionProps } from './view/session.ts'

/** 一次远程读取的四种状态。**`not-implemented` 不是 `failed` 的一种。** */
export type Remote<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'not-implemented'
      readonly plannedVersion: string | null
      readonly requestId: string | null
    }

/**
 * 订阅 hash 变化。
 *
 * ⚠️ 用 `hashchange` 而不是 `popstate` —— 后者是 history router 的事件,
 * 而 D7 约束 1 明确不用 history router。两者在同一个页面里表现相近,
 * 但 `popstate` 在 Tauri 的文件协议下不触发。
 */
function useLocation(): Location {
  const [loc, setLoc] = useState<Location>(() => parseLocation(window.location.hash))
  useEffect(() => {
    const onHash = (): void => setLoc(parseLocation(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return loc
}

export interface AppProps {
  readonly api: WorkbenchApi
  /**
   * 品牌信息。**运行期下发**,不编译进产物 —— 安装包永远中性,白牌走运行期主题。
   * 见 V0.7.0 已定决策的「白牌」一行。
   */
  readonly branding: { productName: string; legalEntityName: string }
}

export function App({ api, branding }: AppProps): React.JSX.Element {
  const loc = useLocation()
  const [workspaces, setWorkspaces] = useState<Remote<Workspace[]>>({ kind: 'loading' })
  const [deliverables, setDeliverables] = useState<Remote<Deliverable[]>>({ kind: 'loading' })
  const [sessions, setSessions] = useState<Remote<Session[]>>({ kind: 'loading' })
  const [policy, setPolicy] = useState<Remote<unknown>>({ kind: 'loading' })
  const [selected, setSelected] = useState(-1)
  const [range, setRange] = useState<string>(DEFAULT_RANGE)
  const [draft, setDraft] = useState('')

  const go = useCallback((next: Partial<Location>): void => {
    const target: Location = {
      route: next.route ?? parseLocation(window.location.hash).route,
      workspaceId:
        next.workspaceId === undefined
          ? parseLocation(window.location.hash).workspaceId
          : next.workspaceId,
    }
    // ⚠️ 赋值给 `location.hash` 而不是 `history.pushState` ——
    //   后者被 D7 约束 1 的守卫明确禁掉(它在 Tauri 里没有服务端回落)。
    window.location.hash = hrefOf(target)
  }, [])

  // ---- 工作区清单。整个应用的入口数据 ----
  useEffect(() => {
    let alive = true
    api.listWorkspaces().then(
      (value) => {
        if (alive) setWorkspaces({ kind: 'ok', value })
      },
      (error: unknown) => {
        if (alive) setWorkspaces({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  const wsId = loc.workspaceId

  // ---- 当前工作区的产物 ----
  useEffect(() => {
    if (wsId === null) {
      setDeliverables({ kind: 'ok', value: [] })
      return
    }
    let alive = true
    setDeliverables({ kind: 'loading' })
    api.listDeliverables(wsId).then(
      (value) => {
        if (alive) setDeliverables({ kind: 'ok', value })
      },
      (error: unknown) => {
        if (alive) setDeliverables({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api, wsId])

  // ---- 会话清单 ----
  useEffect(() => {
    let alive = true
    api.listSessions().then(
      (value) => {
        if (alive) setSessions({ kind: 'ok', value })
      },
      (error: unknown) => {
        if (alive) setSessions({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  // ---- 工作区策略。★ 今天必然是 not-implemented,**如实往下传** ----
  useEffect(() => {
    if (wsId === null) return
    let alive = true
    setPolicy({ kind: 'loading' })
    api.getWorkspacePolicy(wsId).then(
      (result) => {
        if (!alive) return
        setPolicy(
          result.kind === 'ok'
            ? { kind: 'ok', value: result.value }
            : {
                kind: 'not-implemented',
                plannedVersion: result.plannedVersion,
                requestId: result.requestId,
              },
        )
      },
      (error: unknown) => {
        if (alive) setPolicy({ kind: 'failed', message: messageOf(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [api, wsId])

  const wsList = workspaces.kind === 'ok' ? workspaces.value : []
  const currentWs = wsList.find((w) => w.id === wsId) ?? null

  return (
    <WorkbenchShell
      branding={branding}
      tab={loc.route}
      onTab={(tab) => go({ route: tab as Route })}
      workspace={currentWs?.name ?? '(未选择工作区)'}
      workspaces={wsList.map((w) => w.name)}
      onWorkspace={(name) => {
        const hit = wsList.find((w) => w.name === name)
        go({ workspaceId: hit?.id ?? null })
      }}
      agentCount={sessions.kind === 'ok' ? sessions.value.length : 0}
      offline={null}
      onOffline={() => {}}
    >
      {renderScreen()}
    </WorkbenchShell>
  )

  function renderScreen(): React.JSX.Element {
    switch (loc.route) {
      case 'artifacts':
        return (
          <ArtifactsScreen
            {...toArtifactsProps({
              deliverables: deliverables.kind === 'ok' ? deliverables.value : [],
              selectedIndex: selected,
              range,
              onRangeChange: setRange,
              onSelect: setSelected,
            })}
          />
        )
      case 'runs':
        return (
          <RunsScreen
            {...toRunsProps({ sessions: sessions.kind === 'ok' ? sessions.value : [] })}
          />
        )
      case 'jobs':
        // ★ `/v1/jobs` 在契约里是 `planned` → 501。**如实呈现**,
        //   不显示一个空表 —— 空表读作「没有作业」,而真相是「还没建」。
        return (
          <JobsScreen
            unavailable={{
              endpoint: 'GET /v1/jobs',
              plannedVersion: '0.9.0',
              requestId: null,
            }}
            rows={[]}
            selectedIndex={-1}
            digest={null}
            failure={null}
            scope="本工作区"
            scopeOptions={['本工作区', '全部工作区']}
          />
        )
      case 'settings':
        return (
          <WorkspaceSettingsScreen workspace={currentWs?.name ?? '—'} evidence={policyEvidence()} />
        )
      case 'session':
      default:
        return (
          <SessionScreen
            {...toSessionProps({
              session: sessions.kind === 'ok' ? (sessions.value[0] ?? null) : null,
              workspaceName: currentWs?.name ?? '—',
              draft,
              onDraftChange: setDraft,
            })}
          />
        )
    }
  }

  /**
   * 策略端点那个 501 的证据。
   *
   * ⚠️ **从真实响应里取**,不写死。取不到就传 `null` —— `evidenceLine`
   * 会把它显式渲染成「(无 requestId)」,而不是留一段看起来完整的假串。
   */
  function policyEvidence(): PolicyEvidence {
    const endpoint = 'PATCH /v1/workspaces/{id}/policy'
    return policy.kind === 'not-implemented'
      ? { endpoint, plannedVersion: policy.plannedVersion, requestId: policy.requestId }
      : { endpoint, plannedVersion: null, requestId: null }
  }
}

/** 把任何 throw 出来的东西变成一句能显示的话。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
