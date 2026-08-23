/**
 * 租户详情屏:配额与容量 + 近期运行 + 右栏本月指标与凭据。
 *
 * ## V0.9.0 Session 3:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)整屏是常量 —— 那一轮的纪律是机械转换,刻意不动数据。
 * 这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `tokens` 收到的是已经带千分位的
 * `'48,201'`,`createdAt` 是 `'2026-03-14'`,`status` 是一个枚举而不是一段
 * `<Tag>` JSX。理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,
 * 也不该依赖 —— 设计系统要能被三个宿主、以及将来的白牌前端复用,
 * 而它们的数据来源不一定相同。换算(字节 → `'2.4 MB'`、ISO 时间 → `'03-14'`)
 * 是调用方的事。
 *
 * **数据字段一律没有默认值。** 默认值在这里不是便利,是**第二个事实源**:
 * 漏传一个字段,界面照样显示一个像模像样的数,而没有任何东西会红。
 * 必填之后漏传是**编译错误** —— 那是最早、最响的一种失败,
 * 也正是 `capacity.ts` 里那笔 D2 老账。
 *
 * ⚠️ 全屏只有三个字段是数字:配额条的 `used` / `total` / `target`。
 * 它们**是几何量**而不是展示串 —— 填充宽度与目标线位置只能由比值算,
 * 而排版(千分位、百分比)由 `QuotaBar` 自己做。其余每一个数都是格式化好的串。
 *
 * ## 🚨 缺陷一:同一个月度消耗在同一屏上说了两遍,而且差一倍
 *
 * kit 原版左边的配额条是 `used={2560000} total={4000000}` → 条上印着 **64.0%**;
 * 右栏「本月」的指标是 `value="1.28M" sub="配额 4.00M · 32%"` → **32%**。
 * 同一个租户、同一个月,两个数恰好差一倍,而用户看到哪一个,
 * 取决于他先看哪半边屏。
 *
 * 这不是「夹具随手填的」,是两个来源各算各的必然结果 —— 与 D2 老账同一形状:
 * 两处各带一份数,今天恰好都在,明天一定分家。
 *
 * ⇒ 现在指标的数值与百分比都从 `quota` 这**一份**读数来:`usedCompact` 是
 * `used` 的另一种写法,百分比由屏幕现算。⚠️ 「另一种写法」这件事组件替不了
 * 调用方把关,但至少不再有两份**互相独立**的数。
 *
 * ## 🚨 缺陷二:隔离横幅无条件渲染
 *
 * `<QuarantineBanner />` 不带任何条件,于是**每一个租户**(包括一切正常的)
 * 头上都顶着「该租户处于隔离档,出站请求已阻断。」,外加档位码 `QUARANTINE_T3`
 * —— 那个码是组件的默认值,服务端从来没发过。
 *
 * 与「假成功回执」同族,方向反过来:回执谎报成功,这条谎报事故。
 * 代价还更直接 —— 管理员会拿着 `QUARANTINE_T3` 去开支持工单,
 * 而工单那头查不到任何一次隔离。
 *
 * ⇒ `quarantineCode: string | null`,`null` = 没有被隔离,**整条横幅不渲染**。
 * 档位码必填而不给默认值:一条说得出具体档位的警告才值得信,
 * 而一个「默认档位」是自相矛盾的东西。
 *
 * ## 🚨 缺陷三:四行运行共用同一个 `act` 常量
 *
 * 原版把两个 IconButton 提成一个常量,四行共享同一份 JSX。于是
 * **没有任何一行的按钮知道自己属于哪一行** —— 「查看」接不上 onClick,
 * 不是忘了接,是接了也不知道该看谁。现在按行构造,`onViewRun` 收到这一行的 `id`。
 *
 * ## 🚨 缺陷四:四个受控控件配着空 onChange,静默吞掉编辑
 *
 * 月度配额、单次运行上限、超限行为、通知开关,四个都是受控的,
 * 而 onChange 是 `() => {}`:用户改完数字、焦点一移**弹回原样**,
 * 没有任何提示。这不是「还没接」——「还没接」是**不给** onChange,
 * 那时 `Input` / `Select` 按契约退化成只展示(见它们的模块注释)。
 * 给一个吞掉的 onChange,是界面收下了一次交互然后假装无事发生。
 *
 * ## 🚨 缺陷五:写死的标识串接上真实 API 之后是**假证据**
 *
 * `tnt_9f3c21`(租户 id,带复制按钮)、`sh_71c2f8a04d9e`(签入句柄,带复制按钮)、
 * 四个 `run_*`。在设计 kit 里它们是占位符,没有害处;接上真实 API 之后,
 * 它们是用户按下复制、贴进支持工单的东西 —— 而服务端日志里没有这个句柄。
 * 与假成功回执同一族:**界面给出的凭证与它实际掌握的东西不一致**,
 * 而且用户不会怀疑界面,只会怀疑自己抄错了。
 *
 * ⇒ 全部成为 props。`checkinHandle` 允许 `null`(还没签入),
 * 那时显示空态 —— **不显示一个像模像样的假句柄**。
 *
 * ## 交出去的与留下的
 *
 * 这一屏改完**一个 `useState` 都不剩**。表单草稿(四个控件的当前值)决定
 * 「保存变更」保存什么、`dirty` 决定它能不能按,这些调用方必须知道,
 * 不是「只有这一屏关心」的瞬时状态。
 *
 * ⚠️ 凭据区仍然只走 `CredentialTag` 的 describe 语义
 * (configured / source / writable),**永不显示凭据值** —— 硬规则 5。
 * 所以 props 里关于 API 密钥的只有一个布尔,连掩码串都不收:
 * 掩码本身也泄漏一点信息(长度),而它对用户没有任何用处。
 *
 * 内联 `style={{}}` 原样保留 —— 屏幕里的多是一次性布局,
 * 做成类会产生几百个只用一次的类。
 *
 * @module @dshwar/design-system/screens/console/TenantScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { CredentialTag } from '../../components/CredentialTag.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { Metric } from '../../components/Metric.tsx'
import { QuarantineBanner } from '../../components/QuarantineBanner.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import type { RunStatus } from '../workbench/RunsScreen.tsx'
import { PageHead } from './Shell.tsx'

/**
 * 租户的身份与抬头信息。
 *
 * ⚠️ **`billingInherited` 是布尔而不是文案。** kit 原版整句写死成
 * 「创建于 2026-03-14 · 计费主体 Acme Inc.(继承自组织)」——
 * 括号里那句是一个**判断**,一旦调用方改了计费主体却忘了改括号,
 * 界面就在陈述一件不再成立的事。布尔改不错。
 */
export interface TenantIdentity {
  /** 租户 id,原样展示(mono + 可复制)—— 禁止本地化、禁止改写大小写。 */
  readonly id: string
  /** 租户名,作为页标题。 */
  readonly name: string
  /** 已格式化的创建日期,如 `'2026-03-14'`。 */
  readonly createdAt: string
  /** 计费主体名,如 `'Acme Inc.'`。 */
  readonly billingSubject: string
  /** 计费主体是否继承自组织。 */
  readonly billingInherited: boolean
}

/**
 * 一份配额读数。
 *
 * ⚠️ **`used` / `total` / `target` 是全屏仅有的数字字段**,因为配额条要按
 * 它们的比值画填充宽度与目标线位置 —— 那是几何,不是排版。千分位与百分比
 * 由 `QuotaBar` 自己出,调用方不必也不应该先格式化。
 *
 * ⚠️ `usedCompact` / `totalCompact` 是 `used` / `total` 的**紧凑写法**
 * (设计规格里右栏指标是「本月消耗 2.56M」这个形态),不是另外两个数。
 * 见模块注释缺陷一:它们必须从同一个数格出来。
 */
export interface TenantQuotaReading {
  /** 已用量。 */
  readonly used: number
  /** 平台容量(非承诺值)。 */
  readonly total: number
  /** 客户自设的目标线;`null` = 没设,条上不画那根线。 */
  readonly target: number | null
  /** 计量单位,如 `'tok'`。配额条与两个输入框的后缀共用它。 */
  readonly unit: string
  /** `used` 的紧凑写法,如 `'1.28M'`。 */
  readonly usedCompact: string
  /** `total` 的紧凑写法,如 `'4.00M'`。 */
  readonly totalCompact: string
}

/**
 * 超限之后怎么办。**闭集**。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的取值应该在**转换层**停下来报错,
 * 而不是在界面上退化成某一档 —— 尤其是这一档决定超配额时**要不要停 Agent**,
 * 猜错的两个方向各有代价:猜成暂停会白停一个正常租户,猜成告警会让账单跑飞。
 */
export type OverageAction = 'pause' | 'downgrade' | 'warn'

/**
 * 下拉里的一项。
 *
 * ⚠️ **值与标签分开**,而不是像 kit 那样直接把中文当选项值。
 * 「降级至 haiku-4-5」这句话里带着一个模型名 —— 它由准入配置决定,只有调用方知道;
 * 而写回服务端的是 `'downgrade'`。把中文标签当值回传,等于把 UI 文案变成协议:
 * 改一次措辞就改一次线上行为。
 */
export interface OverageOption {
  readonly value: OverageAction
  readonly label: string
}

/**
 * 「配额与容量」卡里四个控件的**当前草稿值**。
 *
 * 它是草稿而不是已保存值:用户改完还没按「保存变更」时,界面显示的就是这里。
 * 由调用方持有 —— 见模块注释「交出去的与留下的」。
 */
export interface TenantLimitsForm {
  /** 月度配额输入框的当前值,已带千分位,如 `'4,000,000'`。 */
  readonly monthlyQuota: string
  /** 单次运行上限的当前值,如 `'200,000'`。 */
  readonly perRunCap: string
  readonly overageAction: OverageAction
  /** 达到 90% 时是否通知计费联系人。 */
  readonly notifyAtNinety: boolean
  /**
   * 草稿与已保存值是否不同。「保存变更」据此启用。
   *
   * ⚠️ 不给默认值,也不由屏幕自己猜:屏幕只拿得到草稿,拿不到已保存值。
   * 没有改动却让「保存变更」可按,点下去会发一个空请求、回来一个「已保存」——
   * 那是**没有对应任何变更的成功回执**,与假回执同族。
   */
  readonly dirty: boolean
}

/**
 * 表里的一行。字段都是**已经格式化好的展示串**。
 *
 * ⚠️ 刻意**不是** `RunsScreen` 的 `RunRow`:那份多两个必填字段
 * (`duration` / `startedAt`),而这张表只有五列、从不显示它们。
 * 要求调用方为不显示的列供数,等于逼他现编两个值 —— 编出来的值迟早会被
 * 当成真的读一次。
 *
 * 但 `status` **就用** `RunsScreen` 导出的那个枚举:同一个词表两处各写一份,
 * 服务端新增一档时只有一处会红,另一处安静地把它显示成别的东西。
 * 这里是 `import type`,编译后一行不剩 —— 不引入任何运行时耦合。
 */
export interface TenantRunRow {
  /** 运行 id,原样展示(mono 列)—— 禁止本地化、禁止改写大小写。 */
  readonly id: string
  /** 发起这次运行的 Agent 名。 */
  readonly agent: string
  /** 模型标识,如 `'sonnet-4-5'`。 */
  readonly model: string
  /** 已带千分位的 token 数,如 `'48,201'`。取不到时传 `'—'`。 */
  readonly tokens: string
  readonly status: RunStatus
}

/**
 * 右栏「运行次数」指标要用的三个数。
 *
 * 它与 `runs` 是两回事:`runs` 只是**近期**几行,这里是本月全量。
 * 失败率由调用方算好 —— 屏幕手上只有那几行,自己算会得出一个荒唐的比例。
 */
export interface TenantRunTotals {
  /** 已带千分位的本月运行次数,如 `'4,120'`。 */
  readonly count: string
  /** 已带千分位的失败次数,如 `'18'`。 */
  readonly failed: string
  /** 已格式化的失败率,如 `'0.44%'`。取不到时传 `'—'`。 */
  readonly failureRate: string
}

/**
 * 凭据区。**只有 describe 语义,没有值** —— 硬规则 5。
 *
 * ⚠️ 这里连「掩码后的串」都不收。掩码看着无害,却仍然泄漏长度,
 * 而长度对用户没有任何用处 —— 掩码该由 `CredentialTag` 自己画成固定的
 * 八个点,与真实密钥无关。
 */
export interface TenantCredentials {
  /** API 密钥配没配。`false` → 标签显示「未配置」,「吊销密钥」同时置灰。 */
  readonly apiKeyConfigured: boolean
  /**
   * 签入句柄,原样展示(mono + 可复制)。
   *
   * `null` = 还没签入。那时显示空态,**不显示一个像模像样的假句柄** ——
   * 见模块注释缺陷五。
   */
  readonly checkinHandle: string | null
}

export interface TenantScreenProps {
  readonly tenant: TenantIdentity
  /**
   * 隔离档位码,如 `'QUARANTINE_T3'`;`null` = 这个租户**没有**被隔离,
   * 整条横幅不渲染。见模块注释缺陷二。
   */
  readonly quarantineCode: string | null
  readonly quota: TenantQuotaReading
  readonly limits: TenantLimitsForm
  /**
   * 「超限行为」下拉的全部选项。
   *
   * ⚠️ `limits.overageAction` 必须在这个表里。不在表里时下拉显示**空**,
   * 而不是回落到第一项 —— 显示一个用户没选过的档,比显示空更糟。
   */
  readonly overageOptions: readonly OverageOption[]
  /** 近期运行。空数组渲染朴素空态,不渲染一张空表。 */
  readonly runs: readonly TenantRunRow[]
  readonly runTotals: TenantRunTotals
  readonly credentials: TenantCredentials
  readonly onBack?: () => void
  readonly onExportUsage?: () => void
  /** 「吊销密钥」—— 不可逆,调用方自己决定要不要二次确认。 */
  readonly onRevokeKeys?: () => void
  readonly onSave?: () => void
  /** 收到的是**用户输入的原文**,解析千分位是调用方的事 —— 屏幕不猜。 */
  readonly onMonthlyQuotaChange?: (next: string) => void
  readonly onPerRunCapChange?: (next: string) => void
  readonly onOverageActionChange?: (next: OverageAction) => void
  /** 收到的是**变更后**的值。 */
  readonly onNotifyAtNinetyChange?: (next: boolean) => void
  /** 收到的是**这一行**的运行 id。见模块注释缺陷三。 */
  readonly onViewRun?: (id: string) => void
  readonly onRotateCredential?: () => void
  readonly onViewAudit?: () => void
}

/**
 * 状态 → 标签样式。`Record<RunStatus, …>` 是刻意的:
 * `RunStatus` 新增一档而这里忘了跟,是**编译错误**,不是显示成灰色。
 */
const RUN_TONE: Record<
  RunStatus,
  { tone: 'success' | 'warn' | 'danger' | 'neutral'; label: string; dot: boolean }
> = {
  completed: { tone: 'success', label: '完成', dot: true },
  degraded: { tone: 'warn', label: '降级', dot: false },
  failed: { tone: 'danger', label: '失败', dot: false },
  draft: { tone: 'neutral', label: '草稿', dot: false },
  running: { tone: 'success', label: '运行中', dot: true },
  idle: { tone: 'neutral', label: '空闲', dot: false },
}

const RUN_COLUMNS: TableColumn[] = [
  { key: 'id', label: '运行 ID', mono: true },
  { key: 'agent', label: 'Agent' },
  { key: 'model', label: '模型', mono: true },
  { key: 'tok', label: 'tok', align: 'right', mono: true },
  { key: 'st', label: '状态' },
  { key: 'a', label: '', align: 'right', width: '72px' },
]

export function TenantScreen({
  tenant,
  quarantineCode,
  quota,
  limits,
  overageOptions,
  runs,
  runTotals,
  credentials,
  onBack,
  onExportUsage,
  onRevokeKeys,
  onSave,
  onMonthlyQuotaChange,
  onPerRunCapChange,
  onOverageActionChange,
  onNotifyAtNinetyChange,
  onViewRun,
  onRotateCredential,
  onViewAudit,
}: TenantScreenProps): React.JSX.Element {
  // 右栏「消耗」的百分比与左边那条配额条**同源**,见模块注释缺陷一。
  // `total` 为 0 时不给百分比 —— 除零编不出一个诚实的数,那时只说配额。
  const usedPercent = quota.total > 0 ? `${Math.round((quota.used / quota.total) * 100)}%` : null
  const consumedNote =
    usedPercent === null
      ? `配额 ${quota.totalCompact}`
      : `配额 ${quota.totalCompact} · ${usedPercent}`

  const billing = tenant.billingInherited
    ? `计费主体 ${tenant.billingSubject}（继承自组织）`
    : `计费主体 ${tenant.billingSubject}`

  const currentOverage = overageOptions.find((o) => o.value === limits.overageAction)

  const runRows = runs.map((run) => {
    const { tone, label, dot } = RUN_TONE[run.status]
    return {
      id: run.id,
      agent: run.agent,
      model: run.model,
      tok: run.tokens,
      st: (
        <Tag tone={tone} dot={dot}>
          {label}
        </Tag>
      ),
      // ⚠️ 每行**各自**的操作区。kit 原版是一个共享的 `act` 常量 ——
      //   于是没有任何一行的按钮知道自己属于哪一行,接不上 onClick。
      a: (
        <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <IconButton icon="eye" label="查看" onClick={() => onViewRun?.(run.id)} />
          <IconButton icon="more-horizontal" label="更多" />
        </span>
      ),
    }
  })

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
        <Button variant="ghost" size="compact" icon="arrow-left" onClick={() => onBack?.()}>
          租户
        </Button>
        <CodeRef copyable>{tenant.id}</CodeRef>
      </div>
      {quarantineCode === null ? null : <QuarantineBanner code={quarantineCode} />}
      <PageHead
        title={tenant.name}
        sub={`创建于 ${tenant.createdAt} · ${billing}`}
        actions={
          <>
            <Button icon="download" onClick={() => onExportUsage?.()}>
              导出用量
            </Button>
            <Button
              variant="danger"
              disabled={!credentials.apiKeyConfigured}
              onClick={() => onRevokeKeys?.()}
            >
              吊销密钥
            </Button>
            <Button variant="primary" disabled={!limits.dirty} onClick={() => onSave?.()}>
              保存变更
            </Button>
          </>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="配额与容量">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <QuotaBar
                used={quota.used}
                total={quota.total}
                unit={quota.unit}
                // `exactOptionalPropertyTypes` 下不能把 `undefined` 显式赋给可选属性;
                // 没有目标线时**不传**这个属性,而不是传 0 —— 0 会画出一根贴在最左边的线,
                // 读起来像「目标是零」。
                {...(quota.target === null ? {} : { target: quota.target })}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 'var(--s-5)',
                }}
              >
                <Input
                  label="月度配额"
                  value={limits.monthlyQuota}
                  suffix={quota.unit}
                  onChange={(e) => onMonthlyQuotaChange?.(e.target.value)}
                />
                <Input
                  label="单次运行上限"
                  value={limits.perRunCap}
                  suffix={quota.unit}
                  onChange={(e) => onPerRunCapChange?.(e.target.value)}
                />
                <Select
                  label="超限行为"
                  // 表里找不到当前值时给空串:宁可显示空,也不要显示一个用户没选过的档。
                  value={currentOverage === undefined ? '' : currentOverage.label}
                  options={overageOptions.map((o) => o.label)}
                  onChange={(e) => {
                    // `Select` 的契约是按**标签**收发的,所以这里把标签映回枚举值。
                    // 映不回去只可能是 options 与 value 不同源 —— 那时什么都不做,
                    // 比回传一个猜出来的枚举好:后者会把一个界面上没发生过的选择写进服务端。
                    const picked = overageOptions.find((o) => o.label === e.target.value)
                    if (picked !== undefined) onOverageActionChange?.(picked.value)
                  }}
                />
              </div>
              <Checkbox
                checked={limits.notifyAtNinety}
                label="达到 90% 时通知计费联系人"
                onChange={(next) => onNotifyAtNinetyChange?.(next)}
              />
            </div>
          </Card>
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <h2
              style={{
                margin: 0,
                color: 'var(--text-body)',
                font: 'var(--fw-semi) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                letterSpacing: 'var(--ls-title-2)',
              }}
            >
              近期运行
            </h2>
            {runs.length === 0 ? (
              <Empty text="这个租户还没有运行记录。" />
            ) : (
              <Table columns={RUN_COLUMNS} rows={runRows} />
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="本月">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <Metric label="消耗" value={quota.usedCompact} sub={consumedNote} />
              <Metric
                label="运行次数"
                value={runTotals.count}
                sub={`失败 ${runTotals.failed} · ${runTotals.failureRate}`}
              />
            </div>
          </Card>
          <Card title="凭据">
            <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  API 密钥
                </span>
                <CredentialTag configured={credentials.apiKeyConfigured} />
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  签入句柄
                </span>
                {credentials.checkinHandle === null ? (
                  <Empty text="还没有签入句柄。" />
                ) : (
                  <CodeRef copyable>{credentials.checkinHandle}</CodeRef>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                <Button size="compact" onClick={() => onRotateCredential?.()}>
                  轮换
                </Button>
                <Button size="compact" variant="ghost" onClick={() => onViewAudit?.()}>
                  查看审计
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

/** 卡片与列表里的空态。刻意朴素 —— 空不是错误,不该长得像错误。 */
function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <span
      style={{
        font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
        color: 'var(--text-tertiary)',
      }}
    >
      {text}
    </span>
  )
}
