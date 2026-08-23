/**
 * 工作台外壳。
 *
 * ## 与设计 kit 的差别:侧栏项的 hover 走 CSS 伪类,不走 `useState`
 *
 * kit 原版的 `SideItem` 用 `React.useState(false)` + 一对鼠标进出事件记 hover,
 * 再在 style 里三元判断底色。移植时换成 `.ds-side-item:hover`,
 * 见 `styles/screens/workbenchshell.css`。**优先级链(active > hover > 透明)
 * 原样保留**,由 CSS 的源码顺序表达。
 *
 * 顶栏 tab 的底色由 `tab === t.id` 决定 —— 那是数据态不是交互态,仍留在内联
 * style 上;其余一次性布局同理。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 工作台外壳:顶栏三层身份(租户 → 工作区 → 我)+ 左侧当前工作区的 Agent 列表
 * + 主区 + 平台声明带。
 * 顶栏直接复用 auth kit 的 TopBarIdentity —— 同一套三层指示器不写第二遍:
 * 工作区切换高频(单击即切)、租户切换低频(需确认)的重量差在那里已经定好了。
 *
 * @module @dshwar/design-system/screens/workbench/WorkbenchShell
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PlatformFooter } from '../../components/PlatformFooter.tsx'
import { Select } from '../../components/Select.tsx'
import { TenantSwitchDialog, TopBarIdentity } from '../auth/IdentityIndicator.tsx'
import { OfflineBanner } from './OfflineState.tsx'
import type { OfflineMode } from './OfflineState.tsx'

/** 顶栏的五个 tab —— 集合固定在本文件内,不由宿主扩展。 */
export type WorkbenchTab = 'session' | 'jobs' | 'runs' | 'artifacts' | 'settings'

export interface SideItemProps {
  /** Agent 名 */
  label: string
  /** 副行,mono —— 模型名 · token 数 */
  meta: string
  active?: boolean
  /** warn → var(--warn) · danger → var(--danger) · 其余(ok / 省略)→ var(--success) */
  tone?: 'ok' | 'warn' | 'danger'
  onClick?: () => void
}

export function SideItem({ label, meta, active, tone, onClick }: SideItemProps): React.JSX.Element {
  const classes = ['ds-side-item']
  if (active === true) classes.push('ds-side-item--active')
  return (
    <button
      type="button"
      onClick={onClick}
      className={classes.join(' ')}
      style={{
        display: 'grid',
        gap: 'var(--s-2)',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        padding: 'var(--s-4) var(--s-4)',
        border: '1px solid transparent',
        borderRadius: 'var(--r-2)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 'var(--r-full)',
            background:
              tone === 'warn'
                ? 'var(--warn)'
                : tone === 'danger'
                  ? 'var(--danger)'
                  : 'var(--success)',
          }}
        />
        <span
          style={{
            font: `${active === true ? 'var(--fw-medium)' : 'var(--fw-regular)'} var(--fs-body)/1.3 var(--font-sans)`,
            color: active === true ? 'var(--accent-text-strong)' : 'var(--text-body)',
          }}
        >
          {label}
        </span>
      </span>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1.4 var(--font-mono)',
          color: 'var(--text-tertiary)',
          paddingLeft: 13,
        }}
      >
        {meta}
      </span>
    </button>
  )
}

export interface WorkbenchShellProps {
  branding: {
    productName: string
    /** ⚠ 界面显示用,不进发票 */
    legalEntityName: string
  }
  tab: WorkbenchTab
  onTab: (tab: WorkbenchTab) => void
  workspace: string
  workspaces: string[]
  onWorkspace: (workspace: string) => void
  /** 侧栏当前工作区的 Agent 列表,通常是一串 `SideItem` */
  side?: React.ReactNode
  agentCount: number
  /** `null` = 在线。两个离线态的差别见 `OfflineState.tsx` 的 MODES 表。 */
  offline: OfflineMode | null
  onOffline: (mode: OfflineMode | null) => void
  /** 失败未读数,挂在「作业」tab 上;0 或省略 = 不显示 */
  unread?: number
  children?: React.ReactNode
}

export function WorkbenchShell({
  branding,
  tab,
  onTab,
  workspace,
  workspaces,
  onWorkspace,
  side,
  agentCount,
  offline,
  onOffline,
  unread,
  children,
}: WorkbenchShellProps): React.JSX.Element {
  const TABS: { id: WorkbenchTab; label: string; badge?: number | undefined }[] = [
    { id: 'session', label: '协作' },
    { id: 'jobs', label: '作业', badge: unread },
    { id: 'runs', label: '运行记录' },
    { id: 'artifacts', label: '产物' },
    { id: 'settings', label: '设置' },
  ]
  const [tenantSwitch, setTenantSwitch] = useState(false)
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
        <TopBarIdentity
          tenant={{ productName: branding.productName }}
          workspace={workspace}
          workspaces={workspaces}
          onWorkspace={onWorkspace}
          onTenantSwitch={() => setTenantSwitch(true)}
          onAccount={() => {}}
        />
        <span style={{ width: 1, height: 18, background: 'var(--n-200)' }} />
        <nav style={{ display: 'flex', gap: 'var(--s-1)', flex: '0 0 auto' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              style={{
                height: 28,
                padding: '0 var(--s-5)',
                cursor: 'pointer',
                border: '1px solid transparent',
                borderRadius: 'var(--r-2)',
                background: tab === t.id ? 'var(--accent-surface)' : 'transparent',
                color: tab === t.id ? 'var(--accent-text-strong)' : 'var(--text-secondary)',
                font: `${tab === t.id ? 'var(--fw-medium)' : 'var(--fw-regular)'} var(--fs-label)/1 var(--font-sans)`,
              }}
            >
              {t.label}
              {/* 失败通知这一版只做界面内未读标记 —— 不推送。 */}
              {t.badge ? (
                <span
                  style={{
                    marginLeft: 6,
                    display: 'inline-grid',
                    placeItems: 'center',
                    minWidth: 15,
                    height: 15,
                    padding: '0 4px',
                    borderRadius: 'var(--r-full)',
                    background: 'var(--danger)',
                    color: 'var(--n-000)',
                    font: 'var(--fw-medium) 9px/1 var(--font-sans)',
                    fontVariantNumeric: 'tabular-nums',
                    verticalAlign: 'middle',
                  }}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        {/* 离线演示开关必须是**一个**控件而不是三个按钮:
            三个按钮那一组占 340px,比五个 tab 加起来还宽,把整行挤满后
            品牌槽位被 flex 压到 64px 下限、静默降级成 monogram。
            品牌的呈现不该取决于旁边放了几个按钮。 */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-4)',
            flex: '0 0 auto',
          }}
        >
          <Select
            value={
              offline === 'local'
                ? '离线 · 本地模型'
                : offline === 'readonly'
                  ? '离线 · 仅查看'
                  : '在线'
            }
            options={['在线', '离线 · 本地模型', '离线 · 仅查看']}
            onChange={(e) =>
              onOffline(
                e.target.value === '离线 · 本地模型'
                  ? 'local'
                  : e.target.value === '离线 · 仅查看'
                    ? 'readonly'
                    : null,
              )
            }
            style={{ width: 152 }}
          />
          <Button variant="ghost" size="compact" icon="life-buoy">
            获取帮助
          </Button>
        </div>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: '244px 1fr', alignItems: 'start' }}>
        <aside
          style={{
            padding: 'var(--s-5)',
            borderRight: '1px solid var(--border-default)',
            background: 'var(--surface-card)',
            minHeight: 620,
            display: 'grid',
            gap: 'var(--s-2)',
            alignContent: 'start',
          }}
        >
          {/* 侧栏作用域是"当前工作区",不是"我的全部 agent":
              工作区是项目容器(D3),切换工作区就换掉这一列。 */}
          <div style={{ display: 'grid', gap: 'var(--s-3)', padding: '0 var(--s-4) var(--s-4)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
              <Icon name="folder" size={13} />
              <span
                style={{
                  font: 'var(--fw-medium) var(--fs-body)/1 var(--font-sans)',
                  color: 'var(--text-body)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {workspace}
              </span>
            </span>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              工作区是项目容器,<b style={{ fontWeight: 'var(--fw-medium)' }}>不跨用户共享</b>。
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 var(--s-4) var(--s-3)',
              borderTop: '1px solid var(--border-hairline)',
              paddingTop: 'var(--s-4)',
            }}
          >
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                letterSpacing: '.08em',
                color: 'var(--text-tertiary)',
              }}
            >
              AGENTS · {agentCount}
            </span>
            <Icon name="plus" size={13} />
          </div>
          {side}
        </aside>
        <main
          style={{
            padding: 'var(--s-8)',
            display: 'grid',
            gap: 'var(--s-6)',
            alignContent: 'start',
          }}
        >
          {offline === null ? null : <OfflineBanner mode={offline} />}
          {children}
        </main>
      </div>
      <PlatformFooter legalEntityName={branding.legalEntityName} />
      {tenantSwitch ? <TenantSwitchDialog onClose={() => setTenantSwitch(false)} /> : null}
    </div>
  )
}
