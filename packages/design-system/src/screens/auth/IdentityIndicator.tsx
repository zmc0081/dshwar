/**
 * 屏 D 的部件:三层身份指示器(租户 → 工作区 → 人)与两个确认对话框。
 *
 * ## 与设计 kit 的差别:只有两处
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成从组件层 ES import
 *    (kit 那行解构了 10 个组件,本文件实际用到 6 个,只 import 用到的);
 * 2. `.jsx` → `.tsx`,props 补类型;`React.useState` 换成具名 import。
 *
 * 内联 `style={{}}` **原样保留** —— 屏幕层的样式几乎全是一次性布局。
 * 这里的两个 `useState`(下拉是否展开、确认勾选)都是**真状态**,
 * 不是 hover / active / focus 那类 CSS 伪类本来就能表达的交互态 ——
 * 没有 `:open` 伪类能表达一个 div 下拉的展开与否,伪类换不掉它们。
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/screens/auth/IdentityIndicator
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { LogoSlot } from '../../components/LogoSlot.tsx'
import { Tag } from '../../components/Tag.tsx'

/* 屏 D · 三层身份指示器：租户 → 工作区 → 人
   ————————————————————————————————————————————————————————————————
   ① 顶栏 wordmark 宽度不够时**不缩字号**。理由：顶栏里 wordmark 紧邻工作区名，
      两者同为 sans、同色系；wordmark 一缩就与工作区名的字号趋同，
      读者失去"哪个是品牌、哪个是当前位置"的层级线索——它们会混成一片。
      wordmark 的字距（+0.14em）也是它的身份标记之一，缩字号会连带削弱它。
      顶栏的处理是**换形态**，按序降级：
        a. 拉丁名字距 +0.14em → +0.06em（先收字距，字号不动）
        b. 取首段（"Shanghai Manufacturing Group 智造运营平台" → "Shanghai"）
        c. 退到 monogram 28×28（形态整体改变，与工作区名不再可能混淆）
      —— 与模板里那次降级同一阶梯，但顶栏可用宽度更紧，所以更早落到 b/c。
   ② 切工作区高频、切租户低频，同处一个指示器里。**交互重量必须分开**：
      工作区 = 单击即切，无确认，列表直接可选；
      租户 = 需要二次确认（换租户会换掉配额、模型准入、审计域），
      且入口在菜单更深一层、按钮是 secondary 而非行内直选。
      高频那个不因为和低频放在一起而变慢。
   ③ signInHandle 轮换是破坏性操作：旧链接**立刻**失效，所有拿着旧 URL 的
      员工都进不来。所以确认对话里要写清后果与影响面（多少人正在用旧链接、
      他们会看到什么、恢复办法），而不是只问"确定吗"。 */

export interface TierRowProps {
  /** 层名:租户 / 工作区 / 人 */
  kind: string
  /** 该层当前的值 */
  label: string
  /** 副行,mono */
  meta?: string
  /** 行尾操作;省略则不渲染按钮 */
  onAction?: () => void
  /** 行尾按钮文案 */
  actionLabel?: string
  /** 交互重量:低频且需确认的那层用 secondary,高频用 ghost */
  actionVariant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  /** 插在副行与按钮之间的标记(通常是一枚 Tag) */
  children?: React.ReactNode
}

export function TierRow({
  kind,
  label,
  meta,
  onAction,
  actionLabel,
  actionVariant = 'ghost',
  children,
}: TierRowProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-5)',
        padding: 'var(--s-5) var(--s-6)',
        borderBottom: '1px solid var(--border-hairline)',
      }}
    >
      <span
        style={{
          width: 52,
          flex: '0 0 auto',
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          letterSpacing: '.06em',
          color: 'var(--text-tertiary)',
        }}
      >
        {kind}
      </span>
      <span style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
        <span
          style={{
            font: 'var(--fw-medium) var(--fs-body)/1.4 var(--font-sans)',
            color: 'var(--text-body)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'clip',
          }}
        >
          {label}
        </span>
        {meta ? (
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-caption)/1.4 var(--font-mono)',
              color: 'var(--text-tertiary)',
            }}
          >
            {meta}
          </span>
        ) : null}
      </span>
      {children}
      {onAction ? (
        <Button size="compact" variant={actionVariant} onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export interface TopBarIdentityProps {
  /**
   * 租户层。`productName` 必填 —— 它要往下传给 `LogoSlot.name`,
   * 而在 `exactOptionalPropertyTypes` 下把 `string | undefined` 传给
   * `name?: string` 是类型错误。唯一的调用点(IdentityScreen)本来就总是给值。
   */
  tenant: { productName: string }
  /** 当前工作区 */
  workspace: string
  /** 可切换的工作区列表 */
  workspaces: string[]
  /** 工作区 = 高频,单击即切,无确认 */
  onWorkspace: (next: string) => void
  /** 租户 = 低频,入口在菜单更深一层,点开确认对话框 */
  onTenantSwitch: () => void
  /** 人层,点头像进账户 */
  onAccount: () => void
  /**
   * ⚠️ 接受但**不使用** —— kit 原版就是如此(见上方注释:
   * 「放不下时 Wordmark 自己切 monogram —— 调用方不再猜 compact」)。
   * 保留在签名里是为了不改调用面;`noUnusedParameters` 下不解构它。
   */
  compact?: boolean
}

/* 顶栏三层指示器。租户层用 LogoSlot（无 logo 时自动落到 wordmark / monogram）。 */
export function TopBarIdentity({
  tenant,
  workspace,
  workspaces,
  onWorkspace,
  onTenantSwitch,
  onAccount,
}: TopBarIdentityProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-5)', flex: '0 0 auto' }}>
      {/* 租户层 —— 品牌槽位。无 logo 时是 wordmark（logoFor 第三级） */}
      {/* 放不下时 Wordmark 自己切 monogram —— 调用方不再猜 compact */}
      <LogoSlot name={tenant.productName} context="topbar" />
      <Icon name="chevron-right" size={13} />
      {/* 工作区层 —— 高频，单击直切 */}
      <span
        style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-3)',
            height: 26,
            padding: '0 var(--s-4)',
            background: open ? 'var(--surface-hover)' : 'transparent',
            border: '1px solid transparent',
            borderRadius: 'var(--r-2)',
            cursor: 'pointer',
            font: 'var(--fw-medium) var(--fs-body)/1 var(--font-sans)',
            color: 'var(--text-body)',
          }}
        >
          {workspace}
          <Icon name="chevrons-up-down" size={12} />
        </button>
        {open ? (
          <div
            style={{
              position: 'absolute',
              top: 32,
              left: 0,
              width: 268,
              zIndex: 30,
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--r-3)',
              boxShadow: 'var(--shadow-2)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: '1px solid var(--border-hairline)',
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                letterSpacing: '.06em',
                color: 'var(--text-tertiary)',
              }}
            >
              切换工作区 · 立即生效
            </div>
            {workspaces.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  onWorkspace(w)
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-4)',
                  width: '100%',
                  height: 34,
                  padding: '0 var(--s-5)',
                  background: w === workspace ? 'var(--accent-surface)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: `${w === workspace ? 'var(--fw-medium)' : 'var(--fw-regular)'} var(--fs-body)/1 var(--font-sans)`,
                  color: w === workspace ? 'var(--accent-text-strong)' : 'var(--text-body)',
                }}
              >
                {w === workspace ? (
                  <Icon name="check" size={13} tone="inherit" />
                ) : (
                  <span style={{ width: 13 }} />
                )}
                {w}
              </button>
            ))}
            {/* 租户层入口在菜单更深一层：低频、且需确认 */}
            <div
              style={{
                borderTop: '1px solid var(--border-hairline)',
                padding: 'var(--s-4) var(--s-5)',
                display: 'grid',
                gap: 'var(--s-3)',
              }}
            >
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                切换租户会换掉配额、模型准入与审计域，需要确认。
              </span>
              <Button
                size="compact"
                onClick={() => {
                  setOpen(false)
                  onTenantSwitch()
                }}
              >
                切换租户…
              </Button>
            </div>
          </div>
        ) : null}
      </span>
      <Icon name="chevron-right" size={13} />
      {/* 人层 */}
      <button
        type="button"
        onClick={onAccount}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-3)',
          height: 26,
          padding: '0 var(--s-3) 0 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 'var(--r-full)',
            background: 'var(--n-800)',
            color: 'var(--n-050)',
            display: 'grid',
            placeItems: 'center',
            font: 'var(--fw-medium) 9px/1 var(--font-sans)',
          }}
        >
          周琳
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/1 var(--font-sans)',
            color: 'var(--text-secondary)',
          }}
        >
          周琳
        </span>
      </button>
    </span>
  )
}

export interface RotateDialogProps {
  /** 取消与确认都走它 —— kit 原版两个按钮同一个回调 */
  onClose: () => void
}

/* ③ 轮换确认 —— 写清后果与影响面，不是只问"确定吗" */
export function RotateDialog({ onClose }: RotateDialogProps): React.JSX.Element {
  const [ack, setAck] = useState(false)
  return (
    /* @blockingModal —— 破坏性操作的确认，必须阻断。 */
    <div
      role="dialog"
      aria-modal="true"
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
          width: 560,
          maxWidth: '100%',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--r-4)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: 'var(--s-8)', display: 'grid', gap: 'var(--s-6)' }}>
          <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
            <Tag tone="danger">破坏性操作</Tag>
            <h2
              style={{
                margin: 0,
                color: 'var(--text-body)',
                font: 'var(--fw-bold) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                letterSpacing: 'var(--ls-title-2)',
              }}
            >
              轮换登录链接会立刻切断现有链接
            </h2>
          </div>
          <div
            style={{
              display: 'grid',
              gap: 'var(--s-5)',
              padding: 'var(--s-6)',
              background: 'var(--danger-surface)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--r-1)',
            }}
          >
            <span style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  letterSpacing: '.06em',
                  color: 'var(--danger)',
                }}
              >
                影响面
              </span>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  color: 'var(--text-body)',
                }}
              >
                <b
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 'var(--fw-regular)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  47
                </b>{' '}
                位成员的书签、邮件与内部文档里的旧链接会**立即**失效——不是过一段时间，是保存的那一刻。
              </span>
            </span>
            <span style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  letterSpacing: '.06em',
                  color: 'var(--danger)',
                }}
              >
                他们会看到
              </span>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  color: 'var(--text-body)',
                }}
              >
                旧链接返回 <CodeRef tone="danger">404 · E_HANDLE_ROTATED</CodeRef>
                ，没有自动跳转、没有提示新地址（否则轮换就失去意义）。他们只能向你索取新链接。
              </span>
            </span>
            <span style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  letterSpacing: '.06em',
                  color: 'var(--danger)',
                }}
              >
                不可撤销
              </span>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  color: 'var(--text-body)',
                }}
              >
                旧句柄不会被保留，也无法找回；再轮换一次只会再换一个新的。
                <b style={{ fontWeight: 'var(--fw-medium)' }}>轮换前请先准备好通知渠道。</b>
              </span>
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gap: 'var(--s-4)',
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            }}
          >
            <span style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'baseline' }}>
              <span style={{ width: 72, color: 'var(--text-tertiary)' }}>当前</span>
              <CodeRef>/s/k7m2x9pq4w</CodeRef>
            </span>
            <span style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'baseline' }}>
              <span style={{ width: 72, color: 'var(--text-tertiary)' }}>轮换后</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                /s/&lt;保存时生成&gt;
              </span>
            </span>
          </div>
          <Checkbox checked={ack} onChange={setAck} label="我已准备好把新链接发给这 47 位成员" />
          <div style={{ display: 'flex', gap: 'var(--s-4)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button variant="danger" disabled={!ack} onClick={onClose}>
              轮换并使旧链接失效
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface TenantSwitchDialogProps {
  /** 取消与确认都走它 —— kit 原版两个按钮同一个回调 */
  onClose: () => void
}

export function TenantSwitchDialog({ onClose }: TenantSwitchDialogProps): React.JSX.Element {
  return (
    /* @blockingModal —— 低频且影响面大的切换，必须确认。 */
    <div
      role="dialog"
      aria-modal="true"
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
          width: 480,
          maxWidth: '100%',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--r-4)',
          padding: 'var(--s-8)',
          display: 'grid',
          gap: 'var(--s-6)',
        }}
      >
        <h2
          style={{
            margin: 0,
            color: 'var(--text-body)',
            font: 'var(--fw-bold) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
            letterSpacing: 'var(--ls-title-2)',
          }}
        >
          切换到另一个租户
        </h2>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
          }}
        >
          配额、模型准入与审计域都会随之改变，当前未保存的草稿会留在原租户。切换是低频操作，因此这里需要一次确认；工作区切换不需要。
        </span>
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          {['smg-prod（当前）', 'smg-staging', 'smg-lab'].map((t, i) => (
            <span
              key={t}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                border: `1px solid ${i === 0 ? 'var(--accent-border)' : 'var(--border-default)'}`,
                borderRadius: 'var(--r-2)',
                background: i === 0 ? 'var(--accent-surface)' : 'transparent',
              }}
            >
              <span
                style={{
                  font: 'var(--fw-medium) var(--fs-body)/1 var(--font-sans)',
                  color: i === 0 ? 'var(--accent-text-strong)' : 'var(--text-body)',
                }}
              >
                {t}
              </span>
              <CodeRef>{['tnt_9f3c21', 'tnt_7c12de', 'tnt_2b88af'][i]}</CodeRef>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={onClose}>
            切换并重新加载
          </Button>
        </div>
      </div>
    </div>
  )
}
