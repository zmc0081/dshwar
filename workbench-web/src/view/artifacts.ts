/**
 * 产物屏的**转换层**:`/v1/workspaces/{id}/deliverables` → `ArtifactsScreenProps`。
 *
 * ## 这一层存在的理由,以及它守的那条线
 *
 * 屏幕收表现层类型,API 给的是 `Deliverable`。中间这一跳如果写在组件里,
 * 设计系统就依赖了 SDK,而它必须能被三个宿主与白牌前端复用。
 *
 * 更实在的理由:**这一层可以被单测**,而挂 React 树的断言不能
 * (本仓刻意不引 jsdom + testing-library)。于是「界面显示对不对」被拆成
 * 「数据变成什么样」(在这里验)与「长什么样」(实测台在真实浏览器里看)。
 *
 * ## ⚠️ 一处必须停下来说清的落差
 *
 * `Deliverable` 只有四个字段:`path` / `size` / `kind`(file|directory)/
 * `modifiedAt`。而产物屏要显示**来源运行、模型、消耗、租户、产物状态**。
 *
 * **那五样今天一个都没有来源。** `/v1/workspaces/{id}/deliverables` 返回的是
 * 工作区里的**文件**,不是「某次运行产出了什么」—— 两者之间没有关联记录。
 *
 * 处理办法是**如实呈现缺失**,不是编:
 *
 * | 屏上的字段 | 有来源吗 | 这里怎么做 |
 * | --- | --- | --- |
 * | 名称 / 类型 / 大小 / 时间 | ✅ `Deliverable` 直接有 | 格式化后给 |
 * | 来源运行 | ❌ | 传 `'—'`,溯源卡给 `null` |
 * | 状态 | ⚠️ 只能从 `kind` 推 | 目录与文件都记为 `completed`,不假造降级态 |
 *
 * ⇒ **溯源卡在真实数据下是空态。** 那不是 bug,是「这个关联还没建」。
 * 编一个 `run_9f3c21ab` 出来会让人以为溯源已经能用了,而那是最贵的一类谎。
 * 关联记录要等作业/运行落库(`/v1/jobs` 今天还是 `planned`)。
 *
 * @module @dshwar/workbench-web/view/artifacts
 */
import type {
  ArtifactPreview,
  ArtifactProvenance,
  ArtifactRow,
  ArtifactsScreenProps,
} from '@dshwar/design-system/screens/workbench/ArtifactsScreen'
import type { Deliverable } from '../api.ts'
import { baseNameOf, extensionOf, humanBytes, shortTime } from '../format.ts'

/** 时间范围筛选的选项。与设计 kit 一致。 */
export const RANGE_OPTIONS = ['近 24 小时', '近 7 天', '近 30 天'] as const
export type Range = (typeof RANGE_OPTIONS)[number]
export const DEFAULT_RANGE: Range = '近 7 天'

/** 一个 `Deliverable` 变成表里的一行。 */
export function toRow(d: Deliverable): ArtifactRow {
  const isDir = d.kind === 'directory'
  return {
    id: d.path,
    name: baseNameOf(d.path),
    kind: isDir ? 'dir' : extensionOf(d.path),
    // 目录没有有意义的大小 —— 传 '—' 而不是 '0 B'。
    size: isDir ? '—' : humanBytes(d.size),
    // ⚠️ 没有来源运行的记录。传 '—',不编一个 id。
    runId: '—',
    createdAt: shortTime(d.modifiedAt),
    // ⚠️ 只有「在那儿」这一个事实。目录不可下载。
    status: 'completed',
    downloadable: !isDir,
  }
}

/**
 * 能不能给这个产物出预览。
 *
 * ⚠️ 今天**一律返回 `null`** —— 没有读取文件内容的端点。
 * `/v1/workspaces/{id}/deliverables` 只列清单,不给正文。
 *
 * 保留这个函数而不是在调用点写死 `null`,是为了让「为什么没有预览」
 * 有一个能读到理由的地方:下一个人看到屏上永远是空态时,
 * 会顺着 `preview` 找到这里,而不是以为自己接错了。
 */
export function toPreview(_d: Deliverable | undefined): ArtifactPreview | null {
  return null
}

/**
 * 溯源信息。
 *
 * ⚠️ 同样**一律返回 `null`**:运行 → 产物的关联记录还不存在。
 * 见模块顶部那张表。
 */
export function toProvenance(_d: Deliverable | undefined): ArtifactProvenance | null {
  return null
}

/** 组装整屏的 props。`selectedIndex` 与筛选值由调用方持有。 */
export function toArtifactsProps(input: {
  deliverables: readonly Deliverable[]
  selectedIndex: number
  range: string
  onRangeChange?: (next: string) => void
  onSelect?: (index: number) => void
  onDownload?: (id: string) => void
  onDownloadAll?: () => void
}): ArtifactsScreenProps {
  const rows = input.deliverables.map(toRow)
  const selected = input.deliverables[input.selectedIndex]
  return {
    rows,
    selectedIndex: input.selectedIndex,
    preview: toPreview(selected),
    provenance: toProvenance(selected),
    range: input.range,
    rangeOptions: RANGE_OPTIONS,
    ...(input.onRangeChange === undefined ? {} : { onRangeChange: input.onRangeChange }),
    ...(input.onSelect === undefined ? {} : { onSelect: input.onSelect }),
    ...(input.onDownload === undefined ? {} : { onDownload: input.onDownload }),
    ...(input.onDownloadAll === undefined ? {} : { onDownloadAll: input.onDownloadAll }),
  }
}
