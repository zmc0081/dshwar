/**
 * 容量读数的**唯一表现层类型** —— 容量条与开户闸门共用它。
 *
 * ## 它存在的理由:V0.5.0 D2 的老账
 *
 * D2 要求「容量读数与开户闸门是**同一个来源**」。理由不是整洁:
 * 两处各算各的话,界面会显示一个数(比如「上限 39 人」),
 * 而管理员照着加人、**加到一半被服务端拒掉** —— 那时他会以为是 bug,
 * 而实际上是两个数从来就不一样。
 *
 * 而移植进来的 kit 里,两屏各自带着一份默认值:
 *
 * | 屏 | 独立的默认值 |
 * | --- | --- |
 * | `CapacityReadout` | `maxProcesses = 39` · `memberCap = 39` · `rssPerProcessMb = 63` |
 * | `IsolationGate` | `memberCap = 39` · `rssPerProcessMb = 63` |
 *
 * 那不是「有两个来源」,是**有三个** —— 加上服务端真正在用的那个。
 *
 * ## ⚠️ 所以这些字段**没有默认值**,而且是必填
 *
 * 默认值在这里不是便利,它是**第二个事实源**:
 * 调用方漏传一个字段,界面照样显示一个像模像样的数,而没有任何东西会红。
 *
 * 必填之后,漏传是**编译错误** —— 那是最早、最响的一种失败。
 *
 * ⚠️ 不要因为「测试里写起来麻烦」把它们改回可选。麻烦正是这条约束在起作用:
 * 每一处构造都必须说清这五个数从哪来。
 *
 * @module @dshwar/design-system/screens/console/capacity
 */

/**
 * 一份容量读数。**字段与契约的 `Capacity` 一一对应**,只是类型是表现层的。
 *
 * 对应关系(`packages/api-contract` 的 `Capacity`):
 *
 * | 这里 | 契约 |
 * | --- | --- |
 * | `isolation` | `isolationLevel`(`'logical' \| 'process'`)|
 * | `maxProcesses` | `maxProcesses`(逻辑档下服务端给 `null`)|
 * | `memberCap` | `memberCap` |
 * | `memberCount` | `memberCount` |
 * | `rssPerProcessMb` | `rssPerProcessMb` |
 * | `basis` | `basis` —— 这个数是**怎么算出来的**,给管理员看的依据 |
 *
 * ⚠️ **`isolation` 收窄成两个字面量,而契约里是 `string`。** 那是刻意的:
 * 界面对这两档的行为不同(逻辑档下 MEMBER CAP 恒为 1),
 * 认不出的第三档必须在**转换层**停下来,而不是在这里退化成某一档。
 */
export interface CapacityReading {
  readonly isolation: 'logical' | 'process'
  /** 逻辑档下服务端给 `null` —— **`null` 不是 0**,是「这一档不按进程算」。 */
  readonly maxProcesses: number | null
  readonly memberCap: number
  readonly memberCount: number
  readonly rssPerProcessMb: number
  /** 上限是怎么推出来的,原样展示。空串表示服务端没给依据。 */
  readonly basis: string
  /** 可用内存总量(MB)。容量条用它画占比。 */
  readonly totalMb: number
}
