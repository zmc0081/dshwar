/**
 * 屏 D · 身份与访问。顶栏三层指示器 + 下方详情。
 *
 * ## 与设计 kit 的差别:只有两处
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成从组件层 ES import
 *    (kit 那行解构了 11 个组件,本屏实际用到 6 个,只 import 用到的);
 *    `TopBarIdentity` / `TierRow` / `RotateDialog` / `TenantSwitchDialog`
 *    在 kit 里也是 window 全局(由 `IdentityIndicator.jsx` 挂上去的),
 *    这里改成从 `./IdentityIndicator.tsx` import。
 * 2. `.jsx` → `.tsx`,props 补类型;`React.useState` 换成具名 import。
 *
 * 内联 `style={{}}` **原样保留** —— 屏幕层的样式几乎全是一次性布局。
 * 三个 `useState`(当前工作区、两个对话框的开合)都是**真状态**,
 * 不是 CSS 伪类能表达的交互态,原样留在 JS。
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/screens/auth/IdentityScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Monogram } from '../../components/Monogram.tsx'
import { PlatformFooter } from '../../components/PlatformFooter.tsx'
import { Tag } from '../../components/Tag.tsx'
import { Wordmark } from '../../components/Wordmark.tsx'
import { RotateDialog, TenantSwitchDialog, TierRow, TopBarIdentity } from './IdentityIndicator.tsx'

/* 屏 D 的容器：顶栏三层指示器 + 下方「身份与访问」详情。
   顶栏宽度演示用三个产品名长度切换，直观看到 wordmark 的形态降级（不缩字号）。 */
const NAMES = {
  short: '智造平台',
  medium: 'Shanghai Manufacturing',
  long: 'Shanghai Manufacturing Group 智造运营平台',
}

/** 三个演示用的产品名长度档 */
export type IdentityNameKey = keyof typeof NAMES

export interface IdentityScreenProps {
  /** 当前用哪个长度档的产品名 */
  nameKey: IdentityNameKey
  /** 切换长度档 */
  onNameKey: (next: IdentityNameKey) => void
  /** 演示用:回到网页登录屏 */
  onExit?: () => void
}

export function IdentityScreen({
  nameKey,
  onNameKey,
  onExit,
}: IdentityScreenProps): React.JSX.Element {
  const [workspace, setWorkspace] = useState('月度报表')
  const [rotate, setRotate] = useState(false)
  const [tenantSwitch, setTenantSwitch] = useState(false)
  const productName = NAMES[nameKey]
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        background: 'var(--surface-app)',
        color: 'var(--text-body)',
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
          tenant={{ productName }}
          workspace={workspace}
          workspaces={['月度报表', '合同比对', '工单归类', '客服话术校对']}
          onWorkspace={setWorkspace}
          onTenantSwitch={() => setTenantSwitch(true)}
          onAccount={() => {}}
        />
        <span
          style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}
        >
          {(
            [
              ['short', '短名'],
              ['medium', '中名'],
              ['long', '超长名'],
            ] as const
          ).map(([k, l]) => (
            <Button
              key={k}
              size="compact"
              variant={nameKey === k ? 'secondary' : 'ghost'}
              onClick={() => onNameKey(k)}
            >
              {l}
            </Button>
          ))}
          {onExit ? (
            <>
              <span style={{ width: 1, height: 16, background: 'var(--n-200)' }} />
              <Button size="compact" variant="ghost" onClick={onExit}>
                ← 回到网页登录
              </Button>
            </>
          ) : null}
        </span>
      </header>

      <main
        style={{
          padding: 'var(--s-8) var(--s-10)',
          display: 'grid',
          gap: 'var(--s-6)',
          alignContent: 'start',
          maxWidth: 980,
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
            身份与访问
          </h1>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            三层：租户决定配额与准入 · 工作区决定看到哪些运行与产物 · 人决定权限。
          </span>
        </div>

        <Card title="当前身份">
          <div style={{ margin: 'calc(var(--s-6) * -1)' }}>
            <TierRow
              kind="租户"
              label={productName}
              meta="tnt_9f3c21 · 配额 10.00M · 准入 2 个模型"
              actionLabel="切换租户…"
              onAction={() => setTenantSwitch(true)}
              actionVariant="secondary"
            >
              <Tag tone="neutral">低频 · 需确认</Tag>
            </TierRow>
            <TierRow
              kind="工作区"
              label={workspace}
              meta="ws_7c12de · 4,120 次运行 · 12 件产物"
              actionLabel="切换"
              onAction={() => {}}
            >
              <Tag tone="success" dot>
                高频 · 单击即切
              </Tag>
            </TierRow>
            <TierRow kind="人" label="周琳" meta="zhoulin@smg-realm · 管理员">
              <Tag tone="neutral">由贵司 IT 管理</Tag>
            </TierRow>
          </div>
        </Card>

        <Card title="租户专属登录链接">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s-5)',
                flexWrap: 'wrap',
              }}
            >
              <CodeRef copyable>https://dshwar.example/s/k7m2x9pq4w</CodeRef>
              <Tag tone="neutral">只读 · 由平台生成</Tag>
            </div>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              成员通过这个链接进来时，登录页已知租户、可显示贵司名称与主色。直接访问主域名的入口保持中性外观。
            </span>
            <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
              <Button variant="danger" icon="rotate-ccw" onClick={() => setRotate(true)}>
                轮换链接…
              </Button>
              <Button variant="ghost" icon="copy">
                复制链接
              </Button>
            </div>
          </div>
        </Card>

        <Card title="顶栏 wordmark 的宽度处理">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                color: 'var(--text-secondary)',
                maxWidth: '76ch',
              }}
            >
              顶栏里 wordmark 紧邻工作区名，两者同为 sans、同色系。
              <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>
                缩字号会让它与工作区名的字号趋同
              </b>
              ，读者失去"哪个是品牌、哪个是当前位置"的层级线索；wordmark 的 +0.14em
              字距也是身份标记，缩字号会连带削弱它。所以顶栏的处理是
              <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>换形态</b>
              ，不是缩字号。
            </span>
            <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
              {(
                [
                  ['a', '收字距', '拉丁名 +0.14em → +0.06em，字号不动'],
                  ['b', '取首段', '"Shanghai Manufacturing Group 智造运营平台" → "Shanghai"'],
                  ['c', '退到 monogram', '28×28 方块，形态整体改变，与工作区名不再可能混淆'],
                ] as const
              ).map(([k, t, d]) => (
                <span
                  key={k}
                  style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'baseline' }}
                >
                  <span
                    style={{
                      width: 20,
                      flex: '0 0 auto',
                      font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-mono)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {k}.
                  </span>
                  <span
                    style={{
                      width: 108,
                      flex: '0 0 auto',
                      font: 'var(--fw-medium) var(--fs-body)/1.5 var(--font-sans)',
                    }}
                  >
                    {t}
                  </span>
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-body)/1.5 var(--font-sans)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {d}
                  </span>
                </span>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 'var(--s-8)',
                alignItems: 'center',
                padding: 'var(--s-5)',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--r-2)',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'grid', gap: 'var(--s-3)', justifyItems: 'start' }}>
                <Wordmark name={NAMES.short} />
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  短名 · 原样
                </span>
              </span>
              <span style={{ display: 'grid', gap: 'var(--s-3)', justifyItems: 'start' }}>
                <Wordmark name={NAMES.medium} />
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  中名 · a 收字距
                </span>
              </span>
              <span style={{ display: 'grid', gap: 'var(--s-3)', justifyItems: 'start' }}>
                <Wordmark name={NAMES.long} />
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  超长 · b 取首段
                </span>
              </span>
              <span style={{ display: 'grid', gap: 'var(--s-3)', justifyItems: 'start' }}>
                <Monogram name={NAMES.long} />
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  c monogram
                </span>
              </span>
            </div>
          </div>
        </Card>
      </main>
      <PlatformFooter legalEntityName="Shanghai Manufacturing Group Co., Ltd." />
      {rotate ? <RotateDialog onClose={() => setRotate(false)} /> : null}
      {tenantSwitch ? <TenantSwitchDialog onClose={() => setTenantSwitch(false)} /> : null}
    </div>
  )
}
