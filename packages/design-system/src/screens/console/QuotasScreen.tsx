/**
 * 控制台「配额与模型准入」屏(按租户)。
 *
 * ## 原 kit 注释(原样保留)
 *
 * ★ 策略执行层尚未接线:后端策略端点回落 501。这是刻意的 —— 接上会让策略被保存、
 * 被显示、却从不被查询,那比 501 危险得多。因此这一屏画成「即将可用」:
 * 所有会写入策略的控件 disabled,并逐项标「当前不生效」。
 * 通栏说明落在平台区域(零 accent、mono 标识、r-1 直角),不是品牌文案。
 *
 * ## 与设计 kit 的差别:五处,全是机械转换
 *
 * 1. 首行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. `PageHead` 在 kit 里由 `Shell.jsx` 挂到 window、`EmptyState` 由
 *    `TenantsScreen.jsx` 挂到 window;移植后分别从 `./Shell.tsx` 与
 *    `./TenantsScreen.tsx` 引 —— 定义位置没变,只是取用方式从全局变成模块导入。
 * 3. `cols` 标注 {@link TableColumn};`POLICY_STATES` 标注
 *    `Record<PolicyState, PolicyStateSpec>`,好让 `s.tone` 直接喂给 `Tag`。
 * 4. 演示态切换里的 `['unset','empty','set']` 加 `as const` —— 否则 `k` 是
 *    `string`,索引不进 `POLICY_STATES`。
 * 5. {@link Frozen} 在 kit 里定义了却没被用到(`当前不生效` 的 `Tag` 是直接写在
 *    `Card` 的 `action` 上的)。仓库开了 `noUnusedLocals`,module-local 的死函数
 *    编译不过 —— **不删,改成导出**:删掉等于替设计做主,而它是一个成型的
 *    「冻结控件」封装,后面接线时正是要用的那一个。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid / flex),
 * 做成 CSS 类会产生几百个只用一次的类。本屏没有 hover / active / focus 的
 * JS 写法,所以没有需要转成伪类的东西。
 *
 * ## 表格与端点标识里的是设计 kit 的夹具数据
 *
 * 模型名、单价、`req_2b88af51c3` 之类的请求 ID 均原样保留。
 *
 * @module @dshwar/design-system/screens/console/QuotasScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import { PageHead } from './Shell.tsx'
import { EmptyState } from './TenantsScreen.tsx'

function NotWiredNotice(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'flex-start',
        padding: 'var(--s-5) var(--s-6)',
        borderRadius: 'var(--r-1)',
        background: 'var(--warn-surface)',
        border: '1px solid var(--warn)',
      }}
    >
      <Icon name="triangle-alert" size={15} tone="inherit" style={{ color: 'var(--warn)' }} />
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <span
          style={{
            font: 'var(--fw-medium) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--warn)',
          }}
        >
          策略执行层尚未接线 —— 本屏配置当前不生效
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '86ch',
          }}
        >
          策略端点回落 <CodeRef tone="danger">501 NOT_IMPLEMENTED</CodeRef>
          。这是刻意的：接上执行层之前先开放保存，会让策略被保存、被显示、却从不被查询——那比 501
          危险得多。在执行层落地前，这些控件只读。
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
            color: 'var(--text-tertiary)',
          }}
        >
          <CodeRef copyable>GET /v1/tenants/{'{id}'}/policy · 501 · req_2b88af51c3</CodeRef>
        </span>
      </div>
    </div>
  )
}

/** 三态的取值。见 {@link POLICY_STATES}。 */
export type PolicyState = 'unset' | 'empty' | 'set'

/**
 * 一个策略态的完整描述。
 *
 * `tone` 与 {@link Tag} 的 `tone` 是同一套取值 —— 这里写成字面量联合而不是
 * `TagProps['tone']`,因为后者是可选属性、带 `undefined`,而
 * `exactOptionalPropertyTypes` 下把 `undefined` 显式传给可选 prop 会报错。
 */
interface PolicyStateSpec {
  label: string
  tone: 'success' | 'warn' | 'danger' | 'neutral' | 'accent'
  code: string
  verdict: string
  /** `null` = 这一态不对应任何错误码 */
  err: string | null
  why: string
}

/* 三态：未配置 / 显式空清单 / 已配清单。
   三者都不得长得像"默认全部允许" —— 缺席不等于放行。 */
const POLICY_STATES: Record<PolicyState, PolicyStateSpec> = {
  unset: {
    label: '未配置',
    tone: 'warn',
    code: 'allowlist: absent',
    verdict: '一律拒绝',
    err: 'E_POLICY_UNSET',
    why: '该租户的准入策略还没设。缺席不等于放行——在策略缺席时放行，等于让"忘记配置"变成"全部开放"。',
  },
  empty: {
    label: '显式空清单',
    tone: 'danger',
    code: 'allowlist: []',
    verdict: '全部拒绝',
    err: 'E_POLICY_EMPTY_DENY',
    why: '有人显式表达了"一个模型都不给用"。同样是拒绝，但原因不同：这是一个决定，不是一个遗漏。',
  },
  set: {
    label: '已配清单',
    tone: 'success',
    code: 'allowlist: [2 models]',
    verdict: '按清单放行',
    err: null,
    why: '清单内的模型可用，清单外一律拒绝。',
  },
}

function PolicyStateBar({ state }: { state: PolicyState }): React.JSX.Element {
  const s = POLICY_STATES[state]
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--s-4)',
        padding: 'var(--s-5) var(--s-6)',
        background: 'var(--surface-subtle)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-5)',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            letterSpacing: '.06em',
            color: 'var(--text-tertiary)',
          }}
        >
          POLICY STATE
        </span>
        <Tag tone={s.tone}>{s.label}</Tag>
        <CodeRef>{s.code}</CodeRef>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <Icon name="arrow-right" size={13} />
          <span
            style={{
              font: 'var(--fw-medium) var(--fs-body)/1 var(--font-sans)',
              color: s.tone === 'success' ? 'var(--text-body)' : 'var(--danger)',
            }}
          >
            {s.verdict}
          </span>
        </span>
        {s.err ? (
          <CodeRef copyable tone="danger">
            {s.err}
          </CodeRef>
        ) : null}
      </div>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
          color: 'var(--text-secondary)',
          maxWidth: '84ch',
        }}
      >
        {s.why}
      </span>
    </div>
  )
}

/**
 * 「冻结控件」封装:控件本体 + 一枚「当前不生效」的 neutral Tag。
 *
 * ⚠️ kit 里定义了但没用到 —— 见本文件模块注释第 5 条,不删是刻意的。
 */
export function Frozen({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-3)' }}>
      {children}
      <Tag tone="neutral">当前不生效</Tag>
    </span>
  )
}

export interface QuotasScreenProps {
  /** 空态演示:一个租户都还没有 */
  empty?: boolean
  /** 该租户的策略态,默认 `set` */
  policyState?: PolicyState
  /** 演示用:切换策略态。省略则不渲染那组切换按钮 */
  onPolicyState?: (state: PolicyState) => void
}

export function QuotasScreen({
  empty,
  policyState = 'set',
  onPolicyState,
}: QuotasScreenProps): React.JSX.Element {
  const cols: TableColumn[] = [
    { key: 'on', label: '准入', width: '56px' },
    { key: 'name', label: '模型', mono: true },
    { key: 'ctx', label: '上下文', align: 'right', mono: true },
    { key: 'price', label: '单价 (¥/Mtok)', align: 'right', mono: true },
    { key: 'state', label: '上游状态' },
    { key: 'a', label: '', align: 'right', width: '40px' },
  ]
  const row = (
    name: string,
    ctx: string,
    price: string,
    st: React.ReactNode,
    on: boolean,
  ): Record<string, React.ReactNode> => ({
    on: <Checkbox checked={on} disabled onChange={() => {}} />,
    name,
    ctx,
    price,
    state: st,
    a: <IconButton icon="more-horizontal" label="更多" disabled />,
  })
  const allowed = policyState === 'set'
  const rows: Record<string, React.ReactNode>[] = [
    row('claude-opus-4-1', '200K', '112.00', <Tag tone="warn">容量受限</Tag>, false),
    row(
      'claude-sonnet-4-5',
      '200K',
      '21.60',
      <Tag tone="success" dot>
        可用
      </Tag>,
      allowed,
    ),
    row(
      'claude-haiku-4-5',
      '200K',
      '7.20',
      <Tag tone="success" dot>
        可用
      </Tag>,
      allowed,
    ),
  ]
  return (
    <>
      <PageHead
        title="配额与模型准入"
        sub="按租户配置：可用模型清单 · token 预算 · 超预算降级目标 · 并发上限"
        actions={
          <>
            <Button disabled>放弃更改</Button>
            <Button variant="primary" disabled>
              保存策略
            </Button>
          </>
        }
      />
      <NotWiredNotice />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s-5)', flexWrap: 'wrap' }}>
        <Select
          label="租户"
          value="acme-prod"
          options={['acme-prod', 'acme-staging', 'lab-sandbox']}
          onChange={() => {}}
          style={{ width: 200 }}
        />
        {onPolicyState ? (
          <span style={{ display: 'grid', gap: 'var(--s-3)' }}>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                letterSpacing: '.06em',
                color: 'var(--text-tertiary)',
              }}
            >
              演示：切换该租户的策略状态
            </span>
            <span style={{ display: 'flex', gap: 'var(--s-3)' }}>
              {(['unset', 'empty', 'set'] as const).map((k) => (
                <Button
                  key={k}
                  size="compact"
                  variant={policyState === k ? 'secondary' : 'ghost'}
                  onClick={() => {
                    onPolicyState(k)
                  }}
                >
                  {POLICY_STATES[k].label}
                </Button>
              ))}
            </span>
          </span>
        ) : null}
      </div>
      <PolicyStateBar state={policyState} />

      {empty ? (
        <EmptyState
          icon="boxes"
          title="还没有租户可配"
          body="模型准入与预算按租户配置。先创建租户，再回到这一屏设定策略。"
          action={
            <Button variant="primary" icon="plus">
              创建租户
            </Button>
          }
          hint="策略执行层尚未接线 · 端点回落 501"
        />
      ) : (
        <>
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-5)' }}>
              <h2
                style={{
                  margin: 0,
                  color: 'var(--text-body)',
                  whiteSpace: 'nowrap',
                  font: 'var(--fw-semi) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                  letterSpacing: 'var(--ls-title-2)',
                }}
              >
                模型准入清单
              </h2>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {policyState === 'unset'
                  ? '未配置：下方勾选状态是上游目录的默认呈现，不代表任何租户的放行结果。'
                  : policyState === 'empty'
                    ? '显式空清单：清单内 0 个模型，全部请求被拒。'
                    : '清单内 2 个模型可用，清单外一律拒绝。'}
              </span>
            </div>
            <Table columns={cols} rows={rows} density="default" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
            <Card title="token 预算" action={<Tag tone="neutral">当前不生效</Tag>}>
              <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
                <QuotaBar used={1284905} total={2000000} target={1800000} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-5)' }}>
                  <Input
                    label="月度预算"
                    value="2,000,000"
                    suffix="tok"
                    disabled
                    onChange={() => {}}
                  />
                  <Input
                    label="单次运行上限"
                    value="200,000"
                    suffix="tok"
                    disabled
                    onChange={() => {}}
                  />
                </div>
              </div>
            </Card>
            <Card title="超预算行为" action={<Tag tone="neutral">当前不生效</Tag>}>
              <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
                <Select
                  label="超出预算时"
                  value="降级至指定模型"
                  options={['降级至指定模型', '暂停 Agent', '仅告警']}
                  disabled
                  onChange={() => {}}
                />
                <Select
                  label="降级目标"
                  value="claude-haiku-4-5"
                  options={['claude-haiku-4-5', 'claude-sonnet-4-5']}
                  mono
                  disabled
                  onChange={() => {}}
                />
                <Input label="并发上限" value="8" suffix="并发" disabled onChange={() => {}} />
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  降级目标必须在准入清单内。
                  {policyState !== 'set'
                    ? '当前清单不放行任何模型，降级无处可去——执行层接线后这里会拒绝保存。'
                    : ''}
                </span>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  )
}
