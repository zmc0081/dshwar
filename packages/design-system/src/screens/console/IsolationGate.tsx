/**
 * 隔离档闸门(模态)。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. 内联 `style={{}}` 原样保留 —— 本屏没有 hover / active / focus 的 JS 状态,
 *    没有要转成伪类的东西,因此也没有对应的 `styles/screens/*.css`。
 * 3. 三条(为什么拦 / 出路 / 代价)的数组在 kit 里是无类型的元组数组;
 *    这里给它写出 `[标签, 色调, 正文]` 的元组类型,值一个不改。
 *
 * ## 原 kit 注释(原样保留)
 *
 * ★ 会阻止真实数据事故的闸门。
 * 视觉权重要够(浮层 shadow-2 + r-4 + danger 描边条),但不能吓退单用户部署:
 * - 它**只在添加第二个成员时**出现,单用户部署永远看不到;
 * - 标题写"需要先切换隔离档"而不是"错误";
 * - 三件事按 为什么拦 / 出路 / 代价 的顺序,代价给具体数字而不是"可能更耗内存";
 * - 提供"保持单用户"作为平级出路,不做成"取消"(取消读起来像放弃,保持是一个选择)。
 * 零 accent:这段内容是为了保护用户,不是展示品牌。
 *
 * ## 🚨 V0.9.0 Session 3:底部那行「证据」是写死的
 *
 * kit 原版是常量 `E_ISOLATION_MEMBER_CAP · req_7c12de40b1`,而且挂着 `copyable` ——
 * 在设计稿里无害,接上真实 API 之后它是一条**假证据**:
 * 用户按下复制、把它贴进工单,而服务端日志里根本没有这个 id。
 * 支持同事照着它去查一条从未发生过的请求,查不到之后被怀疑的是用户。
 *
 * 与「假成功回执」同族 —— **界面给出的凭据,与它实际拿到的不一致**。
 * 而它比回执更晚炸:回执错了当场就粘不出东西,假 id 要等到工单那头才发现,
 * 那时已经隔了几天,没人会回头怀疑这一屏。
 *
 * ⇒ 现在这一行由调用方给(见 {@link IsolationGateEvidence}),
 * 并且**允许根本没有** —— 逻辑档下宿主是先手拦的,请求从没发出去过。
 *
 * @module @dshwar/design-system/screens/console/IsolationGate
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Select } from '../../components/Select.tsx'
import type { CapacityReading } from './capacity.ts'

/**
 * 这次拦截的**证据** —— 底部那行可复制的机器串。
 *
 * 两级可空,分别对应两件**不同**的事,不要合并:
 *
 * | 形态 | 意思 |
 * | --- | --- |
 * | `evidence === null` | 请求没发出去 —— 客户端先手拦的,不存在任何服务端回执 |
 * | `requestId === null` | 请求发了、也被拒了,但这次没拿到 id(响应头缺、或走了本地降级)|
 *
 * 两者都**不许伪造**。不给 id,用户知道自己手上没有;编一个 id,
 * 他会拿着它去开工单 —— 而工单那头查不到,最后被怀疑的是用户。
 * **编一个比不给贵得多**,而两者在界面上一样好看,这正是它危险的地方。
 */
export interface IsolationGateEvidence {
  /**
   * 错误码,如 `E_ISOLATION_MEMBER_CAP`。
   *
   * ⚠️ 刻意收成 `string` 而不是字面量联合。码表属于契约,不属于设计系统:
   * 收窄在这里意味着服务端每加一个码都要发一次设计系统。
   * 该在**转换层**认不出就停下的,是界面会据此改变行为的字段
   * (比如 {@link CapacityReading} 的 `isolation`);这一串只是原样展示。
   */
  readonly code: string
  /** 这次调用的 requestId;取不到时 `null` —— **不要编一个**。 */
  readonly requestId: string | null
}

/**
 * 把证据拼成那一行可复制的串。
 *
 * ⚠️ 缺 requestId 时**显式写出来**,不省略。这一串的用途就是被按「复制」粘进工单,
 * 而一个悄悄少了 id 的串,粘出来与完整的串长得一模一样 ——
 * 于是「我没拿到 id」在传递中变成「他忘了贴 id」。
 *
 * 措辞与 `WorkspaceSettingsScreen` 的 `evidenceLine` 保持一致:
 * 两屏的这句话最终落进同一个工单系统,不该有两种说法。
 */
function evidenceText({ code, requestId }: IsolationGateEvidence): string {
  return `${code} · ${requestId ?? '(无 requestId)'}`
}

export interface IsolationGateProps {
  /**
   * 开着没有。**必填,不给默认。**
   *
   * 一个可选的 `open` 漏传时安静地什么都不画,而这一屏不画的后果是:
   * 管理员在逻辑档下顺利加进第二个人,所有人的文件落进同一个
   * `anonymous/anonymous/` 互相覆盖。
   * 数字错了看得见,**闸门没出现看不见** —— 这一处的失败方向必须是编译错误。
   */
  readonly open: boolean
  /** 「保持单用户部署」—— 刻意不叫"取消" */
  readonly onClose?: () => void
  /** 「切换到进程档并继续」 */
  readonly onSwitch?: () => void
  /**
   * 🚨 底部那行证据。`null` = 没有回执,底部就是空的。
   *
   * 逻辑档下宿主应当**先手弹这一屏**而不是打开添加表单
   * (见 `MembersScreen` 那条注释),请求根本没发出去,自然没有 id 可给。
   * 这时不要拿一句「(无)」把空位填满 —— **空不是错误,不该长得像错误**。
   */
  readonly evidence: IsolationGateEvidence | null
  /**
   * ⚠️ **V0.9.0 Session 3:两个独立默认值换成一份必填的容量读数。**
   *
   * 原先是 `memberCap = 39` / `rssPerProcessMb = 63` —— 与 `CapacityReadout`
   * 里那两个**同名同值**,却是两份各自的常量。D2 要的是同一个来源,
   * 而两个恰好相等的默认值不是同一个来源,只是今天还没分家。
   *
   * 这一屏尤其不能错:它是**开户闸门**,上面写的数就是管理员照着加人的数。
   * 显示 39 而服务端只让加 12,管理员会加到第 13 个才知道。
   */
  readonly capacity: CapacityReading
}

/** 三条说明的色调,与 kit 的 `tone === 'danger' ? … : tone === 'warn' ? … : …` 一一对应。 */
type ReasonTone = 'danger' | 'neutral' | 'warn'

export function IsolationGate({
  open,
  onClose,
  onSwitch,
  evidence,
  capacity,
}: IsolationGateProps): React.JSX.Element | null {
  if (!open) return null
  const { memberCap, rssPerProcessMb } = capacity

  const reasons: readonly [string, ReasonTone, React.ReactNode][] = [
    [
      '为什么拦',
      'danger',
      <>
        逻辑隔离档下多成员<b style={{ fontWeight: 'var(--fw-medium)' }}>根本没有分隔</b>
        ：所有人的文件都会落进同一个目录 <CodeRef>anonymous/anonymous/</CodeRef>，
        <b style={{ fontWeight: 'var(--fw-medium)' }}>互相覆盖且没有任何报错</b>
        。这不是体验问题，是会静默发生的数据事故。
      </>,
    ],
    [
      '出路',
      'neutral',
      <>
        把 <CodeRef>isolation.level</CodeRef> 改成 <CodeRef>"process"</CodeRef> ——
        每位成员一个独立进程，文件按 principal 分隔。切换后本租户的成员上限为 {memberCap} 人。
      </>,
    ],
    [
      '代价',
      'warn',
      <>
        每进程常驻内存约{' '}
        <b style={{ fontWeight: 'var(--fw-medium)', fontFamily: 'var(--font-mono)' }}>
          {rssPerProcessMb} MB
        </b>
        。按当前 basis 推导，上限 {memberCap}{' '}
        人；再多需要加内存，机器不会因为界面上的数字变大而变大。
      </>,
    ],
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      /* @blockingModal —— 有意阻断的全屏模态:用户必须处理,不会让人以为声明带不存在。
         checks/no-fixed-layers.mjs 靠这个标记放行;没有标记的 fixed 一律报错。 */
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12,15,23,.40)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s-8)',
        zIndex: 40,
      }}
    >
      <div
        style={{
          width: 620,
          maxWidth: '100%',
          background: 'var(--surface-card)',
          borderRadius: 'var(--r-4)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ height: 4, background: 'var(--danger)' }} />
        <div style={{ padding: 'var(--s-8)', display: 'grid', gap: 'var(--s-6)' }}>
          <div style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'flex-start' }}>
            <span
              style={{
                width: 28,
                height: 28,
                flex: '0 0 auto',
                borderRadius: 'var(--r-1)',
                background: 'var(--danger-surface)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Icon
                name="shield-alert"
                size={15}
                tone="inherit"
                style={{ color: 'var(--danger)' }}
              />
            </span>
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <h2
                id="gate-title"
                style={{
                  margin: 0,
                  font: 'var(--fw-bold) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                  letterSpacing: 'var(--ls-title-2)',
                }}
              >
                添加第二位成员前需要先切换隔离档
              </h2>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}
              >
                当前 <CodeRef>isolation.level "logical"</CodeRef> · MEMBER CAP 1 人
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            {reasons.map(([label, tone, body]) => (
              <div
                key={label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '72px 1fr',
                  gap: 'var(--s-5)',
                  alignItems: 'start',
                }}
              >
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-caption)/20px var(--font-sans)',
                    textAlign: 'center',
                    borderRadius: 'var(--r-1)',
                    height: 20,
                    background:
                      tone === 'danger'
                        ? 'var(--danger-surface)'
                        : tone === 'warn'
                          ? 'var(--warn-surface)'
                          : 'var(--neutral-surface)',
                    color:
                      tone === 'danger'
                        ? 'var(--danger)'
                        : tone === 'warn'
                          ? 'var(--warn)'
                          : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                    color: 'var(--text-body)',
                  }}
                >
                  {body}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 'var(--s-4)',
              padding: 'var(--s-5)',
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--r-2)',
            }}
          >
            <Select
              label="切换到"
              value="process —— 每成员独立进程"
              options={['process —— 每成员独立进程']}
              mono
            />
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.55 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              切换需要重启工作台进程池，约 20 秒；期间已有会话会排队，不会丢失。
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
            <Button variant="primary" onClick={onSwitch}>
              切换到进程档并继续
            </Button>
            <Button variant="ghost" onClick={onClose}>
              保持单用户部署
            </Button>
            {evidence === null ? null : (
              <span
                style={{
                  marginLeft: 'auto',
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}
              >
                <CodeRef copyable>{evidenceText(evidence)}</CodeRef>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
