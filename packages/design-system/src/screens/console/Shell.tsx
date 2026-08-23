/**
 * 运营后台外壳：固定顶栏（Logo 槽位 + 平台入口）+ 左侧导航 + 内容区 + 平台声明带。
 *
 * ## 与设计 kit 的差别:左侧导航项的交互态进了 CSS
 *
 * kit 里的 `NavItem` 用 `React.useState(false)` + 一对鼠标进出事件
 * 三元判断底色。移植时换成 `.ds-shell-nav:hover` ——
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * ⚠️ 底色一旦进 CSS,同一条属性的另外两种取值(选中 / 默认)就**不能**再留在
 * 内联 `style`:内联优先级高于类,留下来会把 `:hover` 压掉。于是整块 NavItem
 * 样式一起搬进 `styles/screens/shell.css`。屏幕里其余的一次性布局仍是内联。
 *
 * 顶栏的 `Seg` 分段控件在 kit 里**没有** hover 态(底色只由 `value` 决定),
 * 所以它保持内联 —— 这里不给它补一个 kit 没有的交互态。
 *
 * @module @dshwar/design-system/screens/console/Shell
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Icon } from '../../components/Icon.tsx'
import { LogoSlot } from '../../components/LogoSlot.tsx'
import { PlatformFooter } from '../../components/PlatformFooter.tsx'
import { Tag } from '../../components/Tag.tsx'

/** 左侧导航能到达的屏。`settings` 不在 `CONSOLE_NAV` 里,它在分隔线之下单列。 */
export type ConsoleScreenId =
  'overview' | 'tenants' | 'members' | 'models' | 'billing' | 'audit' | 'settings'

export interface ConsoleNavItem {
  id: ConsoleScreenId
  label: string
  /** Lucide 图标名 */
  icon: string
}

/** 主导航六项。`settings`(品牌与外观)刻意不在其中 —— 它在分隔线之下。 */
export const CONSOLE_NAV: readonly ConsoleNavItem[] = [
  { id: 'overview', label: '总览', icon: 'layout-dashboard' },
  { id: 'tenants', label: '租户', icon: 'building-2' },
  { id: 'members', label: '成员与权限', icon: 'users' },
  { id: 'models', label: '模型准入', icon: 'boxes' },
  { id: 'billing', label: '配额与账单', icon: 'receipt' },
  { id: 'audit', label: '审计', icon: 'scroll-text' },
]

interface NavItemProps {
  item: ConsoleNavItem
  active: boolean
  onClick: () => void
}

function NavItem({ item, active, onClick }: NavItemProps): React.JSX.Element {
  const classes = ['ds-shell-nav']
  if (active) classes.push('ds-shell-nav--active')
  return (
    <button type="button" onClick={onClick} className={classes.join(' ')}>
      <Icon name={item.icon} size={14} tone={active ? 'inherit' : 'default'} />
      {item.label}
    </button>
  )
}

interface SegOption<T extends string> {
  id: T
  label: string
}

interface SegProps<T extends string> {
  options: readonly SegOption<T>[]
  /** 当前值;`undefined` 时没有任何一段呈选中态 */
  value: T | undefined
  onChange: (id: T) => void
}

/** 顶栏的演示开关(有数据 / 空状态、逻辑档 / 进程档、浅色 / 深色)。kit 里无 hover 态。 */
function Seg<T extends string>({ options, value, onChange }: SegProps<T>): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border-control)',
        borderRadius: 'var(--r-2)',
        overflow: 'hidden',
      }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => {
            onChange(o.id)
          }}
          style={{
            height: 26,
            padding: '0 var(--s-4)',
            border: 'none',
            cursor: 'pointer',
            background: value === o.id ? 'var(--surface-hover)' : 'transparent',
            color: value === o.id ? 'var(--text-body)' : 'var(--text-tertiary)',
            font: `${value === o.id ? 'var(--fw-medium)' : 'var(--fw-regular)'} var(--fs-caption)/1 var(--font-sans)`,
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

export interface ShellBranding {
  /** 契约 productName,给 LogoSlot 作 alt 与文字回落 */
  productName: string
  /** 契约 legalEntityName,给平台声明带;null → 隐藏版权行 */
  legalEntityName: string | null
}

export interface ShellProps {
  branding: ShellBranding
  /** 当前屏,决定左侧导航哪一项呈选中 */
  screen: ConsoleScreenId
  onNavigate: (id: ConsoleScreenId) => void
  children?: React.ReactNode
  theme?: 'light' | 'dark'
  /** 省略即不渲染主题分段控件 */
  onTheme?: (theme: 'light' | 'dark') => void
  dataState?: 'data' | 'empty'
  /** 省略即不渲染「有数据 / 空状态」分段控件 */
  onDataState?: (state: 'data' | 'empty') => void
  isolation?: 'logical' | 'process'
  /** 省略即不渲染「逻辑档 / 进程档」分段控件 */
  onIsolation?: (isolation: 'logical' | 'process') => void
}

export function Shell({
  branding,
  screen,
  onNavigate,
  children,
  theme,
  onTheme,
  dataState,
  onDataState,
  isolation,
  onIsolation,
}: ShellProps): React.JSX.Element {
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        background: 'var(--surface-app)',
      }}
    >
      <header
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-6)',
          padding: '0 var(--s-8)',
          background: 'var(--surface-card)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <LogoSlot
          name={branding.productName}
          theme={theme === 'dark' ? 'dark' : 'light'}
          context="topbar"
        />
        <span style={{ width: 1, height: 18, background: 'var(--n-200)' }} />
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/1 var(--font-sans)',
            color: 'var(--text-secondary)',
          }}
        >
          运营后台
        </span>
        <div
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}
        >
          {onDataState ? (
            <Seg
              value={dataState}
              onChange={onDataState}
              options={[
                { id: 'data', label: '有数据' },
                { id: 'empty', label: '空状态' },
              ]}
            />
          ) : null}
          {onIsolation ? (
            <Seg
              value={isolation}
              onChange={onIsolation}
              options={[
                { id: 'logical', label: '逻辑档' },
                { id: 'process', label: '进程档' },
              ]}
            />
          ) : null}
          {onTheme ? (
            <Seg
              value={theme}
              onChange={onTheme}
              options={[
                { id: 'light', label: '浅色' },
                { id: 'dark', label: '深色' },
              ]}
            />
          ) : null}
          <Tag tone="accent">acme-prod</Tag>
          <Button variant="ghost" size="compact" icon="life-buoy">
            获取帮助
          </Button>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 'var(--r-full)',
              background: 'var(--n-800)',
              color: 'var(--n-050)',
              display: 'grid',
              placeItems: 'center',
              font: 'var(--fw-medium) 10px/1 var(--font-sans)',
            }}
          >
            AD
          </span>
        </div>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: '188px 1fr', alignItems: 'start' }}>
        <nav
          style={{
            position: 'sticky',
            top: 0,
            padding: 'var(--s-6) var(--s-5)',
            display: 'grid',
            gap: 'var(--s-1)',
            alignContent: 'start',
            borderRight: '1px solid var(--border-default)',
            background: 'var(--surface-card)',
            minHeight: 560,
          }}
        >
          {CONSOLE_NAV.map((n) => (
            <NavItem
              key={n.id}
              item={n}
              active={screen === n.id}
              onClick={() => {
                onNavigate(n.id)
              }}
            />
          ))}
          <div
            style={{ height: 1, background: 'var(--border-hairline)', margin: 'var(--s-4) 0' }}
          />
          <NavItem
            item={{ id: 'settings', label: '品牌与外观', icon: 'palette' }}
            active={screen === 'settings'}
            onClick={() => {
              onNavigate('settings')
            }}
          />
        </nav>
        <main
          style={{
            padding: 'var(--s-8) var(--s-10)',
            display: 'grid',
            gap: 'var(--s-8)',
            alignContent: 'start',
          }}
        >
          {children}
        </main>
      </div>
      <PlatformFooter legalEntityName={branding.legalEntityName} />
    </div>
  )
}

export interface PageHeadProps {
  /** title-1 26/700 */
  title: string
  /** 副标题,body / n-700;省略则不渲染 */
  sub?: React.ReactNode
  /** 右下对齐的操作区(通常是若干 Button) */
  actions?: React.ReactNode
}

export function PageHead({ title, sub, actions }: PageHeadProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 'var(--s-8)',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <h1
          style={{
            margin: 0,
            color: 'var(--text-body)',
            font: 'var(--fw-bold) var(--fs-title-1)/var(--lh-title-1) var(--font-sans)',
            letterSpacing: 'var(--ls-title-1)',
          }}
        >
          {title}
        </h1>
        {sub ? (
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            {sub}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-4)' }}>{actions}</div>
    </div>
  )
}
