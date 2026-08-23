/**
 * 容量读数的**转换层** —— D2 那笔老账在代码里的收口处。
 *
 * ## D2 要的是「同一个来源」,而来源有三个
 *
 * 移植进来的 kit 里,两屏各自带着一份默认值:
 *
 * | 屏 | 独立的默认值 |
 * | --- | --- |
 * | `CapacityReadout` | `maxProcesses = 39` · `memberCap = 39` · `rssPerProcessMb = 63` |
 * | `IsolationGate` | `memberCap = 39` · `rssPerProcessMb = 63` |
 *
 * 加上服务端 `/v1/admin/capacity` 真正在用的那个,一共三个。
 * 而它们今天恰好都是 39 —— **渲染出来完全一致**,分家要等到某一次只改了一处。
 *
 * ⇒ 设计系统那边已经去掉全部默认值、合成一个必填的 `CapacityReading`
 * (漏传是编译错误)。**这个文件是它唯一的构造点。**
 *
 * ## ⚠️ `isolationLevel` 认不出的第三档在这里停下
 *
 * 契约里它是 `string`,而界面只认 `'logical' | 'process'` ——
 * 两档的行为不同(逻辑档下 MEMBER CAP 恒为 1)。
 * 服务端将来加第三档时,**在这里抛**,不在界面上退化成某一档:
 * 退化的后果是界面按错误的规则显示上限,而管理员照着它加人。
 *
 * @module @dshwar/console-web/view/capacity
 */
import type { ConsoleCapacity } from '@dshwar/console-contract'
import type { CapacityReading } from '@dshwar/design-system/screens/console/capacity'

/**
 * 服务器可用内存总量(MB)。
 *
 * ⚠️ **契约的 `Capacity` 里没有这个字段。** 容量条用它画「basis 多少 MB」,
 * 而服务端只给算好的 `basis` 字符串,不给原始的总量。
 *
 * 于是这里给 `0`,并让容量条优先显示 `basis` —— **不编一个数**。
 * 编出来的总量会被管理员当成采购依据。
 *
 * ⇒ 真要显示它,该做的是往契约里加字段,不是在前端猜。
 */
const TOTAL_MB_UNKNOWN = 0

/**
 * `/v1/admin/capacity` → 界面用的那一份读数。
 *
 * @throws 当 `isolationLevel` 不是已知的两档之一 —— 见模块注释。
 */
export function toCapacityReading(capacity: ConsoleCapacity): CapacityReading {
  return {
    isolation: toIsolation(capacity.isolationLevel),
    maxProcesses: capacity.maxProcesses,
    memberCap: capacity.memberCap,
    memberCount: capacity.memberCount,
    rssPerProcessMb: capacity.rssPerProcessMb,
    basis: capacity.basis,
    totalMb: TOTAL_MB_UNKNOWN,
  }
}

/**
 * 隔离档收窄。
 *
 * ⚠️ **认不出就抛,不回落。** 回落到 `'logical'` 会让界面显示
 * 「MEMBER CAP 1 人」,而一个新档位可能允许几百人;回落到 `'process'`
 * 会让它显示服务端给的 `memberCap`,而那个数在新档下未必是这个含义。
 *
 * 两种回落都是**在猜**,而猜错的表现是一个看起来正常的数字。
 * 抛出来至少会让人看见。
 */
export function toIsolation(level: string): CapacityReading['isolation'] {
  if (level === 'logical' || level === 'process') return level
  throw new Error(
    `认不出的隔离档 "${level}" —— 界面只认 logical / process 两档,它们的成员上限规则不同。\n` +
      '回落到任一档都是在猜,而猜错的表现是一个看起来正常的上限数字,\n' +
      '管理员会照着它加人。请先在 view/capacity.ts 里补上这一档的规则。',
  )
}
