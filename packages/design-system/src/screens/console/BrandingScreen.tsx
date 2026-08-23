/**
 * 品牌与外观屏。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. **第二个 window 全局**:kit 里还有 `window.DshwarAccent`(`tokens/derive-accent.js`)。
 *    它的 `derive` 在本仓已经是 `accent/derive.ts` 的公开导出,直接换成 import;
 *    `applyAccent` **本仓没有对应导出**,见下方那个函数的注释。
 * 3. 一次性布局的 `style={{}}` 原样保留;本屏没有 hover / active / focus 的 JS 状态,
 *    因此也没有对应的 `styles/screens/*.css`。
 * 4. `seed` / `name` 两个 `useState` 是**表单数据**,不是交互态 —— 伪类换不掉,原样保留。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 契约裁决 ② RE-LIT 不静默:保存前必须并排显示原色与重打光后的按钮、ΔL 与 ΔE,并要求管理员确认。
 *
 * @module @dshwar/design-system/screens/console/BrandingScreen
 */
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { derive, type DeriveResult, type RoleRow, type Theme } from '../../accent/derive.ts'
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
 * 把派生结果写进 CSS 自定义属性 —— kit 的
 * `tokens/derive-accent.js#applyAccent` 逐行搬过来,写哪些属性、写什么值都没有改。
 *
 * ⚠️ **它落在这里是移植的将就,不是设计决定。** 本仓的 `accent/derive.ts` 只导出了
 * `derive`,没有 `applyAccent`;而本屏的「Logo 槽位与回落」卡片要把派生出来的主色
 * 真的打到那块 DOM 上,少了它预览就永远是中性外观 —— 那会让这一屏的主要用途失效。
 * 本轮的任务边界是「不碰 accent/ 与 index.ts」,所以先原样落在屏幕里。
 * 之后若有第二个消费方(kit 的 `ui_kits/auth` 外壳就已经在用),应当提到 `accent/` 去。
 *
 * ⚠️ 一律走 `setProperty`,不给内联样式属性直接赋值 —— 后者是
 * `check-guards.mjs` 明禁的写法(那条守卫按正则扫,**注释里也算**),
 * 何况自定义属性本来就只能经 `setProperty` 写。
 *
 * kit 原注释:theme 'light'(默认)或 'dark' —— 暗主题必须传,否则亮主题派生的文字色
 * 落在 n-950 画布上只有 2 点几比一。
 */
function applyAccent(seedHex: string, el: HTMLElement, theme: Theme = 'light'): DeriveResult {
  const d = derive(seedHex, 4.5, theme)
  const t = el.style
  t.setProperty('--seed', d.seed)
  for (const r of d.ramp) t.setProperty(`--a-${r.step}`, r.hex)
  t.setProperty('--accent-solid', d.solid)
  t.setProperty('--accent-on', d.on)
  t.setProperty('--accent-hover', d.hover)
  t.setProperty('--accent-active', d.active)
  t.setProperty('--accent-text', d.text)
  t.setProperty('--accent-text-strong', d.strong)
  t.setProperty('--accent-border', d.border)
  t.setProperty('--accent-surface', d.surface)
  t.setProperty('--link-underline', 'none')
  el.setAttribute('data-brand', 'configured')
  return d
}

export function BrandingScreen(): React.JSX.Element {
  // primaryColor: string | null。null = 未配置 = 无彩中性外观(NEUTRAL_BRANDING)。
  // '#1D5BD4' 只是配置页的**建议起点占位**,不是契约默认值。
  const SUGGESTED = '#1D5BD4'
  const [seed, setSeed] = useState<string | null>(null)
  const [name, setName] = useState('Acme Console')
  const d = seed ? derive(seed, 4.5) : null
  const scope = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scope.current && seed) applyAccent(seed, scope.current)
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
            <Button variant="ghost">重置为中性外观</Button>
            <Button variant="primary">保存并确认派生结果</Button>
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
                  value={seed || ''}
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
            <Input label="法律实体（legalEntityName）" value="Acme Inc." onChange={() => {}} />
            <Input
              label="支持邮箱（supportEmail）"
              value="ops@acme.example"
              mono
              hint="与 supportUrl 至少给一个，否则用户求助无门。"
              onChange={() => {}}
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
