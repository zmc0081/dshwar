/**
 * 容量页 —— D2 要求的「控制台首页常驻显示」。
 *
 * ⚠️ 组件里**没有任何网络调用**:数据由 `props` 传进来。
 * 这不只是为了可测,更是 D7 约束 3 的实践 —— 请求只在
 * `src/api.ts` 里发生,组件拿到的是已经取好的数据。
 *
 * ⚠️ 组件里也**没有任何浏览器专有 API**(D7 约束 2)。
 * 用 `<a href>` 而不是那个跳转 API,让浏览器自己处理导航。
 *
 * @module @dshwar/console-web/pages/Capacity
 */
import type { ConsoleCapacity } from '@dshwar/console-contract'
import type { JSX } from 'react'
import { detailOf, headlineOf, healthOf, maxProcessesLabel } from '../capacity-view.ts'
import { hrefOf } from '../router.ts'

export interface CapacityPageProps {
  readonly capacity: ConsoleCapacity
}

export function CapacityPage({ capacity }: CapacityPageProps): JSX.Element {
  const health = healthOf(capacity)

  return (
    <section data-testid="capacity" data-health={health}>
      <h1>{headlineOf(capacity)}</h1>
      <p>{detailOf(capacity)}</p>

      <dl>
        <dt>隔离档</dt>
        <dd data-testid="isolation-level">{capacity.isolationLevel}</dd>

        <dt>进程上限</dt>
        <dd data-testid="max-processes">{maxProcessesLabel(capacity)}</dd>

        <dt>成员上限</dt>
        <dd data-testid="member-cap">{capacity.memberCap}</dd>

        <dt>每进程常驻</dt>
        <dd>{capacity.rssPerProcessMb} MB</dd>
      </dl>

      {/* 用 href 而不是 onClick + 跳转 API:浏览器自己知道怎么处理链接,
          而那份处理在三个宿主里都对。 */}
      <a href={hrefOf('members')}>管理成员</a>
    </section>
  )
}
