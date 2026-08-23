/**
 * 屏 A · 认证入口(网页)。中性视觉,只有一个把用户送去企业 IdP 的入口。
 *
 * ## 与设计 kit 的差别:只有两处
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成从组件层 ES import;
 * 2. `.jsx` → `.tsx`,props 补类型。
 *
 * 内联 `style={{}}` **原样保留** —— 屏幕层的样式几乎全是一次性布局
 * (某一屏某一处的 grid / padding),做成 CSS 类会产出几百个只用一次的类名。
 * 本屏没有任何 hover / active / focus 的 JS 状态,因此不涉及伪类改写。
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/screens/auth/SignInScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PlatformFooter } from '../../components/PlatformFooter.tsx'
import { Select } from '../../components/Select.tsx'
import { Wordmark } from '../../components/Wordmark.tsx'

export interface SignInScreenProps {
  /** 点「前往 <idp> 完成认证」时调用 —— 跳转由宿主发起,本组件不碰 location */
  onSignIn?: () => void
  /** 身份提供方名称,显示在 CodeRef 与按钮文案里。默认 keycloak */
  idp?: string
  /** true = 经租户专属入口(/s/<handle>)进来,已知租户,可显示其名称 */
  handleMode?: boolean
  /** 演示用:在「主域名入口 / 租户专属入口」之间切换 */
  onHandleMode?: () => void
  /** 演示用:跳到桌面客户端认证屏 */
  onDesktop?: () => void
  /** 演示用:跳到身份指示器屏 */
  onIdentity?: () => void
}

/* ★ 认证前必须保持中性视觉（DSHWAR 自己的品牌），不能显示客户品牌：
   认证前服务端还不知道来者属于哪个租户，任何品牌化都会泄漏客户名单
   ——按 hostname 提供公开品牌端点会把租户列表变成可枚举资源；
   客户端缓存上次品牌会把 A 公司的存在泄漏给共用设备上 B 公司的员工。
   泄漏的都不是我们的信息，是客户的客户名单。

   本产品不存密码、不做注册、不实现找回流程 —— 身份由企业自己的 IdP 提供。
   所以这一屏没有：账号密码表单、注册入口、忘记密码、第三方社交登录。
   只有一个把用户送去企业 IdP 的入口。

   过渡处理（否则用户会觉得"跳了个站"）：
   1. 中性态就用与租户态**同一套骨架**（同一顶栏高度、同一栅格、同一按钮形态），
      认证后只有 wordmark 槽位与 accent 令牌改变，版式一格不动；
   2. 按钮上预告下一步落点（"前往 keycloak 完成认证"），而不是笼统的"登录"；
   3. 认证回跳后不闪白：租户品牌在同一骨架上原地替换，不重排。 */
export function SignInScreen({
  onSignIn,
  idp = 'keycloak',
  handleMode = false,
  onHandleMode,
  onDesktop,
  onIdentity,
}: SignInScreenProps): React.JSX.Element {
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
        <Wordmark context="topbar" />
        <span style={{ width: 1, height: 18, background: 'var(--n-200)' }} />
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/1 var(--font-sans)',
            color: 'var(--text-secondary)',
          }}
        >
          认证入口
        </span>
        <span
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}
        >
          {onHandleMode ? (
            <Button
              size="compact"
              variant={handleMode ? 'secondary' : 'ghost'}
              onClick={onHandleMode}
            >
              {handleMode ? '租户专属入口' : '主域名入口'}
            </Button>
          ) : null}
          {onDesktop ? (
            <Button size="compact" variant="ghost" onClick={onDesktop}>
              桌面客户端 →
            </Button>
          ) : null}
          {onIdentity ? (
            <Button size="compact" variant="ghost" onClick={onIdentity}>
              身份指示器 →
            </Button>
          ) : null}
          <Select value="简体中文" options={['简体中文', 'English']} style={{ width: 132 }} />
        </span>
      </header>

      <main style={{ display: 'grid', placeItems: 'center', padding: 'var(--s-10) var(--s-8)' }}>
        <div style={{ width: 420, maxWidth: '100%', display: 'grid', gap: 'var(--s-8)' }}>
          <div style={{ display: 'grid', gap: 'var(--s-5)', justifyItems: 'start' }}>
            <Wordmark style={{ fontSize: 21 }} />
            <h1
              style={{
                margin: 0,
                color: 'var(--text-body)',
                font: 'var(--fw-bold) var(--fs-title-1)/var(--lh-title-1) var(--font-sans)',
                letterSpacing: 'var(--ls-title-1)',
              }}
            >
              {handleMode ? '登录 · 上海智造集团' : '登录'}
            </h1>
            <p
              style={{
                margin: 0,
                font: 'var(--fw-regular) var(--fs-body-lg)/var(--lh-body-lg) var(--font-sans)',
                color: 'var(--text-secondary)',
                maxWidth: '46ch',
              }}
            >
              身份由贵司的身份提供方管理。DSHWAR 不保存密码、不提供注册与找回流程。
            </p>
          </div>

          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--r-3)',
              padding: 'var(--s-8)',
              display: 'grid',
              gap: 'var(--s-6)',
            }}
          >
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  letterSpacing: '.06em',
                  color: 'var(--text-tertiary)',
                }}
              >
                IDENTITY PROVIDER
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                <Icon name="key-round" size={15} />
                <CodeRef>{idp}</CodeRef>
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-sans)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  由贵司 IT 配置
                </span>
              </span>
            </div>
            <Button
              variant="primary"
              icon="external-link"
              onClick={onSignIn}
              style={{ height: 38, width: '100%' }}
            >
              前往 {idp} 完成认证
            </Button>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              点击后跳转到贵司的身份提供方；认证完成后自动返回，届时界面会切换为贵司的品牌与主色。
            </span>
          </div>

          {handleMode ? (
            <div
              style={{
                display: 'flex',
                gap: 'var(--s-4)',
                alignItems: 'flex-start',
                padding: 'var(--s-5)',
                borderRadius: 'var(--r-1)',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-default)',
              }}
            >
              <Icon name="link" size={14} />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                你通过租户专属入口 <CodeRef>/s/k7m2x9pq4w</CodeRef>{' '}
                进来，因此这一屏已知租户、可显示其名称。直接访问主域名时不显示任何客户信息。
              </span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: 'var(--s-4)',
                alignItems: 'flex-start',
                padding: 'var(--s-5)',
                borderRadius: 'var(--r-1)',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-default)',
              }}
            >
              <Icon name="shield" size={14} />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                本页刻意保持中性外观。认证前服务端尚不知道你属于哪个租户，任何品牌化都会泄漏客户名单——那是客户的信息，不是可以拿来换观感的东西。
              </span>
            </div>
          )}

          <div
            style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Button variant="ghost" size="compact" icon="life-buoy">
              获取帮助
            </Button>
            <span style={{ width: 1, height: 12, background: 'var(--n-300)' }} />
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              没有账号？请联系贵司 IT —— 账号由 IdP 统一开通。
            </span>
          </div>
          <CodeRef copyable>req_0c4a71e2b8 · build 0.7.0+1a9f</CodeRef>
        </div>
      </main>
      <PlatformFooter />
    </div>
  )
}
