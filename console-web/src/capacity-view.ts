/**
 * 容量信息的**展示逻辑** —— D2 要求首页常驻显示的那三个数怎么说人话。
 *
 * ## 为什么单独一个模块而不是写在组件里
 *
 * 因为这里的判断有产品含义,而**产品含义需要被测试**:
 * 「逻辑档显示什么」「快满了算多少」「满了之后提示什么」——
 * 这三件事写在 JSX 里就只能靠端到端测,而端到端测不会去覆盖
 * 「memberCount === memberCap - 1」这种边界。
 *
 * 拆出来之后它是纯函数,边界条件一条一条钉得住。
 *
 * @module @dshwar/console-web/capacity-view
 */
import type { ConsoleCapacity } from '@dshwar/console-contract'

/** 容量的健康状态。界面据此选颜色,文案据此选措辞。 */
export type CapacityHealth = 'single-user' | 'ok' | 'nearly-full' | 'full'

/**
 * 判断当前容量状态。
 *
 * ⚠️ **逻辑档单独一档(`single-user`),不算「满了」。**
 * 这是 D2 那句「不吓退单用户」在界面上的落点:一个人自己用的部署
 * 永远是 1/1,若显示成「已满」并标红,他会以为出了问题 ——
 * 而实际上那正是他该有的样子。
 */
export function healthOf(capacity: ConsoleCapacity): CapacityHealth {
  if (capacity.isolationLevel === 'logical') {
    return capacity.memberCount <= 1 ? 'single-user' : 'full'
  }
  if (capacity.memberCount >= capacity.memberCap) return 'full'
  // 留一个名额时就开始提示 —— 等真满了再说,管理员已经在加人的路上了。
  if (capacity.memberCount >= capacity.memberCap - 1) return 'nearly-full'
  return 'ok'
}

/** 首页那一行主文案。 */
export function headlineOf(capacity: ConsoleCapacity): string {
  const health = healthOf(capacity)
  if (health === 'single-user') {
    // 不说「1 / 1」—— 那个写法暗示「快满了」。单用户部署没有「满」这回事。
    return '单用户部署'
  }
  return `${capacity.memberCount} / ${capacity.memberCap} 位成员`
}

/**
 * 副文案:说清代价与出路。
 *
 * 三种状态三句话,而**每一句都要能让人知道下一步做什么** ——
 * 一句只描述现状的提示("已达上限")会让人去搜文档。
 */
export function detailOf(capacity: ConsoleCapacity): string {
  switch (healthOf(capacity)) {
    case 'single-user':
      return `逻辑隔离档,只支持一位成员。要加人请把 isolation.level 改成 "process"(每位成员约 ${capacity.rssPerProcessMb} MB)。`
    case 'full':
      return capacity.isolationLevel === 'logical'
        ? `已超出逻辑隔离档的上限。必须改用进程隔离 —— 每位成员约 ${capacity.rssPerProcessMb} MB。`
        : `已达上限 ${capacity.memberCap}。加内存并调高 isolation.maxProcesses(每位成员约 ${capacity.rssPerProcessMb} MB)。`
    case 'nearly-full':
      return `还剩 1 个名额。再加人需要调高 isolation.maxProcesses,每位成员约 ${capacity.rssPerProcessMb} MB。`
    case 'ok':
      return `还可以再加 ${capacity.memberCap - capacity.memberCount} 位。上限依据:${capacity.basis}`
  }
}

/**
 * 进程上限怎么显示。
 *
 * ⚠️ 逻辑档的 `maxProcesses` 是 `null`,**显示成「—」而不是 0**。
 * 契约那边坚持用 `null` 就是为了逼这一步做判断 —— 0 会被直接渲染成
 * 「进程上限 0」,而那读起来像「一个都不能起」,是错的。
 */
export function maxProcessesLabel(capacity: ConsoleCapacity): string {
  return capacity.maxProcesses === null ? '—' : String(capacity.maxProcesses)
}
