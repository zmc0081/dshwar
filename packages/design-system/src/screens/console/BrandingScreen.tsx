/**
 * 品牌与外观屏。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. **第二个 window 全局**:kit 里还有 `window.DshwarAccent`(`tokens/derive-accent.js`)。
 *    它的 `derive` 与 `applyAccent` 在本仓都是 `accent/` 的公开导出,直接换成 import。
 *
 *    ⚠️ **V0.9.0 Session 5:`applyAccent` 已提到 `accent/apply.ts`。** 移植时它落在
 *    本文件内部,注释里写着「之后若有第二个消费方,应当提到 `accent/` 去」——
 *    第二个消费方(三个宿主的应用外壳)现在有了,这里是那条 TODO 的兑现:
 *    本文件删掉那份私有实现,改从 `accent/apply.ts` 引。
 * 3. 一次性布局的 `style={{}}` 原样保留;本屏没有 hover / active / focus 的 JS 状态,
 *    因此也没有对应的 `styles/screens/*.css`。
 * 4. **V0.9.0 Session 3:两个 `useState` 提成受控 props。** 移植时(Session 1)它们是
 *    本地表单状态 —— 那一轮的纪律是机械转换。接真实 API 之后不行了:
 *    保存要走 `console-contract`,而本地 state 与服务端上的值会分家。
 *
 *    ⚠️ 顺带修一处:原先 `const d = seed ? derive(...) : null` 用**真值**判断,
 *    于是**空串被当成「未配置」**。空串是配置错误(有人清空了输入框却没点重置),
 *    显示成中性外观、而保存下去的是一个空串。判据改成 `=== null || === ''`,
 *    两种情况都不派生,但**理由不同**,将来要分开报警时判据就在那一行。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 契约裁决 ② RE-LIT 不静默:保存前必须并排显示原色与重打光后的按钮、ΔL 与 ΔE,并要求管理员确认。
 *
 * @module @dshwar/design-system/screens/console/BrandingScreen
 */
import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { applyAccent } from '../../accent/apply.ts'
import { derive, type RoleRow } from '../../accent/derive.ts'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Input } from '../../components/Input.tsx'
import { LogoSlot } from '../../components/LogoSlot.tsx'
import { Monogram } from '../../components/Monogram.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Select } from '../../components/Select.tsx'
import { Tag } from '../../components/Tag.tsx'
import { Wordmark } from '../../components/Wordmark.tsx'
import { PageHead } from './Shell.tsx'

/**
 * 品牌配置的**表现层形状**。
 *
 * ⚠️ 字段名与 `@dshwar/console-contract` 的 `TenantBranding` 一一对应,
 * 但**类型不是从那里 import 的** —— 设计系统不依赖契约包,
 * 它要能被三个宿主与白牌前端复用。转换由调用方做。
 *
 * ## 🚨 `primaryColor: string | null` 的 null 不许被兜底
 *
 * `null` = **未配置** = 无彩中性外观(`NEUTRAL_BRANDING`)。
 * 它与「配置成某个颜色」在类型层就是分开的 —— V0.8.0 把哨兵默认色
 * `#2F6FEB` 改掉,为的就是这个区分。
 *
 * 一行 `branding.primaryColor ?? '#2F6FEB'` 能把那次改动**完全抵消**,
 * 而不会有任何东西变红。`check-guards.mjs` 有一条守卫盯着这个形状。
 */
export interface BrandingDraft {
  readonly productName: string
  /** `null` = 未配置 = 中性外观。**空串是配置错误,不是未配置。** */
  readonly primaryColor: string | null
  readonly legalEntityName: string
  readonly supportEmail: string
}

export interface BrandingScreenProps {
  readonly branding: BrandingDraft
  /**
   * 配置页输入框的**建议起点占位**,不是契约默认值。
   *
   * ⚠️ 必填且由调用方给 —— 写死在这里就等于设计系统里藏了一个默认色,
   * 而那正是 V0.8.0 拆掉的东西。调用方应当传
   * `console-contract` 的 `SUGGESTED_PRIMARY_COLOR`。
   */
  readonly suggestedSeed: string
  readonly onChange?: (next: BrandingDraft) => void
  readonly onSave?: () => void
  readonly onReset?: () => void
  /** 保存进行中 —— 写入控件应当 disabled。 */
  readonly saving?: boolean
}

export function BrandingScreen({
  branding,
  suggestedSeed,
  onChange,
  onSave,
  onReset,
  saving,
}: BrandingScreenProps): React.JSX.Element {
  const SUGGESTED = suggestedSeed
  const { primaryColor: seed, productName: name } = branding
  const setSeed = (next: string | null): void => onChange?.({ ...branding, primaryColor: next })
  const setName = (next: string): void => onChange?.({ ...branding, productName: next })

  // ⚠️ **判据是 `=== null`,不是真值。** 空串是**配置错误**(有人清空了输入框
  //   却没点重置),不是「未配置」—— 用 `seed ?` 会把两者合并,
  //   于是界面显示中性外观、而保存下去的是一个空串。
  //   与 LogoSlot 的 `??` vs `||` 是同一条。
  const d = seed === null || seed === '' ? null : derive(seed, 4.5)
  const scope = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 🚨 未配置时**也要调** —— `applyAccent(null, …)` 会清掉上一次写进去的那 20 个属性。
    //    原先这里是 `seed !== null && seed !== ''` 才调:清空主色之后,上一次的
    //    ramp 与角色令牌原样留在这块 DOM 上,预览卡片继续显示旧品牌色,
    //    而同一屏上就写着「留空 = 未配置 = 中性外观」。
    //    判空已经收敛在 applyAccent 里,这里不该再判一次(判两次总有一次判错)。
    //
    // 本屏的预览画布是亮主题,所以显式传 'light' —— `applyAccent` 不给默认值。
    if (scope.current !== null) applyAccent(seed, scope.current, 'light')
  }, [seed])
  const roleRow = (r: RoleRow): React.JSX.Element => (
    <div
      key={r.role}
      style={{
        display: 'grid',
        gridTemplateColumns: '150px 22px 74px 60px 1fr',
        gap: 'var(--s-4)',
        alignItems: 'center',
        padding: 'var(--s-3) 0',
        borderTop: '1px solid var(--border-hairline)',
      }}
    >
      <span style={{ font: 'var(--fw-regular) 11px/1.4 var(--font-mono)' }}>{r.role}</span>
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 'var(--r-1)',
          background: r.hex,
          border: '1px solid var(--border-default)',
        }}
      />
      <span
        style={{
          font: 'var(--fw-regular) 11px/1.4 var(--font-mono)',
          color: 'var(--text-secondary)',
        }}
      >
        {r.hex}
      </span>
      <span
        style={{
          font: 'var(--fw-regular) 11px/1.4 var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {r.ratioLabel}
      </span>
      <span style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
        <Tag tone={r.pass ? 'success' : 'danger'}>{r.passLabel}</Tag>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.4 var(--font-sans)',
            color: 'var(--text-tertiary)',
          }}
        >
          {r.note}
        </span>
      </span>
    </div>
  )
  return (
    <>
      <PageHead
        title="品牌与外观"
        sub="平台只接受一个种子色；ramp 与六个角色令牌按对比度约束派生"
        actions={
          <>
            <Button variant="ghost" disabled={saving === true} onClick={() => onReset?.()}>
              重置为中性外观
            </Button>
            <Button variant="primary" disabled={saving === true} onClick={() => onSave?.()}>
              {saving === true ? '保存中…' : '保存并确认派生结果'}
            </Button>
          </>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <Card title="品牌变量">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <Input
              label="产品名（productName）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={
                /deepseek/i.test(name)
                  ? '不得含 "DeepSeek"。写入时校验，不达标拒绝保存。'
                  : name.length > 40
                    ? '不得超过 40 字符。'
                    : ''
              }
              hint={`${name.length} / 40 字符 · 商标尽调是贵方的法律责任：平台不知道贵方在哪些法域经营，也不知道注册了什么。`}
            />
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr',
                  gap: 'var(--s-4)',
                  alignItems: 'end',
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 34,
                    borderRadius: 'var(--r-2)',
                    border: '1px solid var(--border-default)',
                    background: seed || 'var(--surface-disabled)',
                  }}
                />
                <Input
                  label="主色种子（primaryColor）"
                  value={seed ?? ''}
                  placeholder={SUGGESTED + '（建议起点）'}
                  mono
                  onChange={(e) => setSeed(e.target.value || null)}
                />
              </div>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/var(--lh-caption) var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                留空 = 未配置 = 中性外观（无彩）。这是受支持的完整形态，不是半成品。
              </span>
              {!seed ? (
                <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                  <Button size="compact" onClick={() => setSeed(SUGGESTED)}>
                    用建议起点 {SUGGESTED}
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                  <Button size="compact" variant="ghost" onClick={() => setSeed(null)}>
                    清空 → 回到中性外观
                  </Button>
                </div>
              )}
            </div>
            <Select
              label="第二强调色（accentColor）"
              value="留空 —— 由主色派生"
              options={['留空 —— 由主色派生']}
              disabled
              onChange={() => {}}
            />
            <Input
              label="法律实体（legalEntityName）"
              value={branding.legalEntityName}
              onChange={(e) => onChange?.({ ...branding, legalEntityName: e.target.value })}
            />
            <Input
              label="支持邮箱（supportEmail）"
              value={branding.supportEmail}
              mono
              hint="与 supportUrl 至少给一个，否则用户求助无门。"
              onChange={(e) => onChange?.({ ...branding, supportEmail: e.target.value })}
            />
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <span
                style={{
                  font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                  color: 'var(--text-secondary)',
                }}
              >
                登录入口句柄（signInHandle）
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                <CodeRef copyable>s/k7m2x9pq4w</CodeRef>
                <Button size="compact" variant="danger">
                  轮换
                </Button>
              </div>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/var(--lh-caption) var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                只读 · 服务端生成，不可自选（自选就会有人选公司名，而那与猜 hostname 一样可枚举）·
                轮换后旧链接立即失效
              </span>
            </div>
          </div>
        </Card>
        <Card title="Logo 槽位与回落">
          <div ref={scope} style={{ display: 'grid', gap: 'var(--s-6)' }}>
            <div
              style={{
                display: 'flex',
                gap: 'var(--s-8)',
                alignItems: 'center',
                padding: 'var(--s-5)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--r-2)',
              }}
            >
              <LogoSlot name={name} />
              <Wordmark name={name} />
              <Monogram name={name} />
            </div>
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                派生策略 <CodeRef>{d ? d.strategy : '—'}</CodeRef> · {d ? d.coords : ''}
              </span>
              <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                <Button variant="primary">主操作</Button>
                <Button>次操作</Button>
                <Tag tone="accent">选中态</Tag>
                <a
                  href="#"
                  style={{
                    alignSelf: 'center',
                    font: 'var(--fw-regular) var(--fs-body)/1 var(--font-sans)',
                    color: 'var(--accent-text)',
                  }}
                >
                  链接文字
                </a>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <Card title="角色令牌复核（实时测量）">
        {d ? (
          <div>{d.rows.map(roleRow)}</div>
        ) : (
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            primaryColor 为 null（未配置）—— 八个 accent
            角色令牌落回中性档，界面零彩度。无需复核对比度：中性档的实测值是固定的。
          </span>
        )}
      </Card>
      {/* kit 原文是 `d && d.relit`。多出来的 `seed !== null` 是**纯类型收窄**:
          `d` 非 null 当且仅当 `seed` 非空(上面那行三元就是这么写的),所以它恒真,
          分支的取舍一个没变 —— 加它只为让下面的 `background: seed` 拿到 string。 */}
      {d && d.relit && seed !== null ? (
        <Card title="保存前必须确认 —— 实心填充已重打光">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                color: 'var(--text-secondary)',
              }}
            >
              契约禁止静默替换主色。该种子落在中亮带（L ∈ 0.55–0.80），实心填充已按 R3
              推到带边；链接与描边由反查得出，不受影响。品牌色本体仍作为 ramp 锚定档保留在界面里。
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-5)' }}>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    height: 40,
                    borderRadius: 'var(--r-2)',
                    background: seed,
                    display: 'grid',
                    placeItems: 'center',
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--n-900)',
                  }}
                >
                  原色
                </span>
                <CodeRef>
                  {seed} · L {d.trace.seedL}
                </CodeRef>
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    height: 40,
                    borderRadius: 'var(--r-2)',
                    background: d.solid,
                    display: 'grid',
                    placeItems: 'center',
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: d.on,
                  }}
                >
                  RE-LIT
                </span>
                <CodeRef>
                  {d.solid} · L {d.trace.finalL} · ΔL {d.trace.dL} · ΔE {d.trace.dE}
                </CodeRef>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
              <Button variant="primary">确认并保存</Button>
              <Button variant="ghost">改用其他主色</Button>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                派生结果三项下限不成立时保存被拒绝，不做近似替换。
              </span>
            </div>
          </div>
        </Card>
      ) : null}
      <Card title="平台容量（不随品牌变化）">
        <QuotaBar used={2560000} total={4000000} />
      </Card>
    </>
  )
}
