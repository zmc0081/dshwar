/**
 * 开户闸门 —— 把隔离档的约束表达在**建成员**那一步(V0.5.0,D2)。
 *
 * ## 为什么拦在这里,不拦在登录时
 *
 * 三个候选时机,只有一个是对的:
 *
 * | 时机 | 问题 |
 * | --- | --- |
 * | **登录时** | 太早。单用户部署一个人反复登录,会被一条与他无关的多用户约束反复打扰 |
 * | **建第二个成员时** | ✅ **这才是第一次真正违反约束的动作** |
 * | 运行时(建会话) | 太晚。成员已经建好、管理员已经把账号发给同事,数据已经开始往 `anonymous/` 里混 |
 *
 * V0.4.7 已经有两道闸门:配置层的 `assertSinglePrincipalCapable`(启动时)
 * 与运行时的 per-agent 兜底。**它们都不管开户** —— 一个部署可以配置合法地
 * 启动(单令牌、逻辑档),然后管理员从 SCIM 推进来第二个人。
 * 那一刻没有任何东西拦他,而问题在下一次 agent 执行时才显形。
 *
 * ## 为什么装饰 store,而不是加在某个端点上
 *
 * 因为**入口不止一个**。今天是 SCIM 推,明天是控制台 API 建,
 * 后天可能是批量导入。在端点上加检查,等于要求每一个新入口的作者
 * 记得加 —— 而这个仓库已经反复证明「靠人记得」的事会被忘。
 *
 * 装饰 `SubjectStore` 之后,**所有创建路径都穿过同一个点**,
 * 忘不掉,因为没有别的路。
 *
 * @module @dshwar/gateway/member-capacity
 */
import { deriveMaxProcesses, RSS_PER_PROCESS_MB } from '@dshwar/supervisor'
import type { Subject, SubjectInput, SubjectStore } from '@dshwar/subject'
import type { IsolationLevel } from './isolation.ts'

/**
 * 成员数超出当前隔离档能承载的上限。
 *
 * 错误信息按 V0.4.7 闸门同款三要素:**给出路 · 写明代价 · 不吓退单用户**。
 * 第三条最容易被忽略 —— 一条只讲「你不能这么做」的错误,会让一个
 * 只想自己用的人以为这个产品不适合他。
 */
export class MemberCapacityError extends Error {
  readonly code = 'member_capacity_exceeded'
  /** 当前档位能容纳的成员数。 */
  readonly memberCap: number
  /** 已有成员数。 */
  readonly memberCount: number

  constructor(options: {
    level: IsolationLevel
    memberCap: number
    memberCount: number
    maxProcesses: number | null
  }) {
    const { level, memberCap, memberCount, maxProcesses } = options
    super(
      level === 'logical'
        ? [
            `逻辑隔离档只支持 1 个成员,当前已有 ${memberCount} 个,拒绝再建。`,
            '',
            '原因不是「隔离强度不够」,是**根本没有分隔** —— 逻辑档下 principal',
            '到不了 agent 执行层,多个成员的文件会全部落进 anonymous/anonymous/',
            '并互相静默覆盖。再互相信任的同事也不接受这个。',
            '',
            '出路:把 isolation.level 改成 "process"(一 principal 一进程)。',
            `代价:每个活跃成员常驻约 ${RSS_PER_PROCESS_MB} MB。`,
            '',
            '⚠️ 只有你一个人用的话,现在这样就是对的 —— 这条约束与你无关,',
            '不需要改任何配置。',
          ].join('\n')
        : [
            `当前配置最多容纳 ${memberCap} 个成员(maxProcesses=${maxProcesses ?? '—'}),`,
            `已有 ${memberCount} 个,拒绝再建。`,
            '',
            `出路:加内存并调高 isolation.maxProcesses。每个活跃成员约 ${RSS_PER_PROCESS_MB} MB,`,
            '容量规划见 docs/DEPLOYMENT.md §2.5。',
          ].join('\n'),
    )
    this.name = 'MemberCapacityError'
    this.memberCap = memberCap
    this.memberCount = memberCount
  }
}

/** 当前部署能容纳多少成员,以及为什么。 */
export interface MemberCapacity {
  readonly level: IsolationLevel
  /** 逻辑档下 `null` —— 它不起子进程,这个数没有意义。 */
  readonly maxProcesses: number | null
  readonly memberCap: number
  readonly rssPerProcessMb: number
  readonly basis: string
}

/**
 * 算出当前部署的成员容量。
 *
 * ⚠️ **进程上限从 `@dshwar/supervisor` 的 `deriveMaxProcesses` 来,不另算一遍。**
 * 各算各的结果是控制台显示 64、实际拦在 39 —— 而管理员会相信界面上那个数。
 *
 * @param totalMemoryBytes 整机内存,通常是 `os.totalmem()`。传进来是为了可测。
 * @param configuredMax 显式配置的 `isolation.maxProcesses`;未配时走推导。
 */
export function memberCapacityOf(options: {
  level: IsolationLevel
  totalMemoryBytes: number
  configuredMax?: number | undefined
}): MemberCapacity {
  const { level, totalMemoryBytes, configuredMax } = options

  if (level === 'logical') {
    // V0.4.7 起逻辑档只支持单 principal —— 这不是配置能放宽的,是架构限制。
    return {
      level,
      maxProcesses: null,
      memberCap: 1,
      rssPerProcessMb: RSS_PER_PROCESS_MB,
      basis: '逻辑隔离档只支持单个 principal(V0.4.7 架构限制,非配置项)',
    }
  }

  const derived = deriveMaxProcesses(totalMemoryBytes)
  const maxProcesses = configuredMax ?? derived.value
  return {
    level,
    maxProcesses,
    // 一 principal 一进程 —— 成员上限就是进程上限。
    memberCap: maxProcesses,
    rssPerProcessMb: RSS_PER_PROCESS_MB,
    basis:
      configuredMax === undefined
        ? derived.basis
        : `显式配置 maxProcesses=${configuredMax}(按内存推导会得到 ${derived.value})`,
  }
}

/**
 * 给 `SubjectStore` 套上开户闸门。
 *
 * ⚠️ **只拦「新建」,不拦「更新」。** SCIM 会对已存在的成员反复 upsert
 * (改名、改组、停用),那些不增加成员数 —— 拦掉它们会让一个已经超限的
 * 部署**连停用成员都做不到**,而停用恰恰是他脱困的办法。
 *
 * ⚠️ **停用的成员不计入。** 判据是「会不会真的起一个进程」,而停用的人
 * 登录都会被拒。把他们算进去等于让管理员为一个不存在的负载付钱。
 */
export function guardMemberCapacity(
  inner: SubjectStore,
  capacity: () => MemberCapacity,
): SubjectStore {
  return {
    // ⚠️ **逐个显式转发,不要写 `...inner`。**
    //
    // `{ ...inner }` 对**类实例**展开时不复制原型方法 —— 而
    // `InMemorySubjectStore` 的方法全在原型上。结果是包装后的 store
    // 只剩下这里显式写出的 `upsert`,`get` / `list` / `deactivate` 全部消失。
    //
    // ★ **而 TypeScript 看不见这个 bug**:它给类实例的 spread 类型里
    // *包含*方法,于是赋值给 `SubjectStore` 完全合法。类型检查全绿,
    // 运行时 `store.deactivate is not a function`。
    //
    // 这个错误由 `gateway/test/member-capacity.test.ts` 的「停用之后腾出名额」
    // 一条抓出来 —— 那条测试原本是为了验业务语义,顺带证明了
    // **业务测试是这类 TS/JS 语义错位的唯一防线**。
    //
    // ★ 换成显式转发之后,类型检查**立刻**报了漏掉的 `remove`(TS2741)——
    // 同一个类型系统,前一种写法瞎、后一种写法灵。差别不在类型标注,
    // 在于**有没有给它一个能核对的清单**。将来 `SubjectStore` 加方法,
    // 这里会红,而不是又静默丢一个。
    get: (id) => inner.get(id),
    getByExternalId: (source, externalId) => inner.getByExternalId(source, externalId),
    list: (filter) => inner.list(filter),
    deactivate: (id) => inner.deactivate(id),
    remove: (id) => inner.remove(id),
    upsert: async (input: SubjectInput): Promise<Subject> => {
      const existing = await inner.getByExternalId(input.source, input.externalId)
      // 更新已有成员:放行。见上方注释。
      if (existing !== undefined) return inner.upsert(input)

      // 新建 —— 且这个新成员本身是启用的(默认启用)才占名额。
      // 推一个一上来就停用的成员是合法的(供给系统同步历史用户),不该拦。
      if (input.active === false) return inner.upsert(input)

      const cap = capacity()
      // 用 store 自己的过滤,而不是取全量再 filter —— 后者在 KV 后端上
      // 是一次全表扫描,而这段代码在**每次新建成员**时都会跑。
      const active = await inner.list({ tenantId: input.tenantId, active: true })
      if (active.length >= cap.memberCap) {
        throw new MemberCapacityError({
          level: cap.level,
          memberCap: cap.memberCap,
          memberCount: active.length,
          maxProcesses: cap.maxProcesses,
        })
      }
      return inner.upsert(input)
    },
  }
}
