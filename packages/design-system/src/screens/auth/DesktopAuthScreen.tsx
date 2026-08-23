/**
 * 屏 B · 桌面端认证等待态(loopback 回调静默失败与三条出口)。
 *
 * ## 与设计 kit 的差别:只有两处
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成从组件层 ES import;
 * 2. `.jsx` → `.tsx`,props 补类型;`React.useState` / `React.useEffect`
 *    换成具名 import。
 *
 * 内联 `style={{}}` **原样保留** —— 屏幕层的样式几乎全是一次性布局。
 * 本屏的 `useState` 是**计秒读数**,不是 hover / active / focus 那类
 * CSS 伪类本来就能表达的交互态,伪类换不掉它,原样留在 JS。
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/screens/auth/DesktopAuthScreen
 */
import type * as React from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PlatformFooter } from '../../components/PlatformFooter.tsx'
import { Tag } from '../../components/Tag.tsx'
import { Wordmark } from '../../components/Wordmark.tsx'

/* 屏 B · 桌面端认证等待态
   ————————————————————————————————————————————————————————————————
   三种失败模式里最静默的一种：**浏览器侧一切正常，客户端侧只是没等到**。
   成因是 loopback 回调没抵达 —— 防火墙拦了 127.0.0.1 绑定、端口被占、
   浏览器/代理拦了向 127.0.0.1 的跳转。用户会觉得"我明明登录了"，
   而客户端还在转圈；没有出口就只能杀进程重来。

   出口方案（2026-08-21 裁决）—— 关键判据是**码的传递方向**：
     ① 自动换端口重试一次（静默，不打扰）。代价：无。
        loopback 绑定校验完整保留，只是换一个端口重新发起 PKCE 往返。
     ② 手动"重试" = 新端口 + 全新 PKCE 往返。代价：低。
        用户需在浏览器再点一次，但 IdP 会话通常还在，通常是一次点击。
        **这是首选出口。**
     ③ 配对码（RFC 8628 设备授权流）。代价：中 —— 需 IdP 支持设备端点。
        码由**客户端生成、显示在客户端、用户念进浏览器**：方向是 app → browser。
        没有任何机密从浏览器流回客户端，客户端只是轮询自己发起的那个请求。
        绑定关系换了一种形式仍然成立。
     ④ 手工粘贴授权码（OOB）—— **本设计明确不实现**。
        方向是 browser → app，这正是危险的方向：loopback 的价值在于
        "码被投递给了发起请求的同一台机器上的同一个进程"，粘贴把这条绑定
        彻底去掉。PKCE 能挡住攻击者拿走码去兑换（没有 verifier 兑不出），
        但挡不住反向的社工——诱导用户把**自己的**码粘进攻击者的客户端。
        更根本的是，"从浏览器复制一串码粘到应用里"这个习惯本身就是钓鱼面。
        RFC 8252 明确不建议 OOB；把它做成兜底，等于用一个长期风险
        换一次性的便利。③ 已经提供了同样的逃生口，没有理由再开 ④。

   动效：规范里没有动效章节。等待态不用转圈动画，用**计秒读数**
   （mono + tabular-nums）——它比 spinner 多给一条信息：已经等了多久。 */

/** 三个阶段:等待浏览器 / 回调静默失败 / 改走配对码 */
export type DesktopAuthPhase = 'waiting' | 'stalled' | 'pairing'

interface TitleBarProps {
  /** 窗口标题栏里的应用名 */
  name: string
}

function TitleBar({ name }: TitleBarProps): React.JSX.Element {
  return (
    <div
      style={{
        height: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-4)',
        padding: '0 var(--s-5)',
        background: 'var(--surface-subtle)',
        borderBottom: '1px solid var(--border-default)',
        borderRadius: 'var(--r-3) var(--r-3) 0 0',
      }}
    >
      <Icon name="app-window" size={13} />
      <span
        style={{
          font: 'var(--fw-medium) var(--fs-caption)/1 var(--font-sans)',
          color: 'var(--text-secondary)',
        }}
      >
        {name}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-3)' }}>
        <span style={{ width: 9, height: 1, background: 'var(--n-400)' }} />
        <span style={{ width: 8, height: 8, border: '1px solid var(--n-400)' }} />
        <Icon name="x" size={10} />
      </span>
    </div>
  )
}

interface DiagProps {
  /**
   * 每行是 `[键, 值, 是否异常]`。异常行的值取 danger 色。
   *
   * 写成元组数组(而不是 `string[][]`)是为了让调用点的字面量被上下文定型 ——
   * `noUncheckedIndexedAccess` 下从 `string[]` 解构会带出 `undefined`。
   */
  rows: [string, string, boolean][]
}

function Diag({ rows }: DiagProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--s-3)',
        padding: 'var(--s-5)',
        background: 'var(--surface-subtle)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-1)',
      }}
    >
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          letterSpacing: '.06em',
          color: 'var(--text-tertiary)',
        }}
      >
        CALLBACK DIAGNOSTICS
      </span>
      {rows.map(([k, v, bad]) => (
        <span key={k} style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'baseline' }}>
          <span
            style={{
              width: 132,
              flex: '0 0 auto',
              font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-mono)',
              color: 'var(--text-tertiary)',
            }}
          >
            {k}
          </span>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-mono)',
              color: bad ? 'var(--danger)' : 'var(--text-secondary)',
              userSelect: 'all',
            }}
          >
            {v}
          </span>
        </span>
      ))}
    </div>
  )
}

export interface DesktopAuthScreenProps {
  /** 当前阶段 */
  phase: DesktopAuthPhase
  /** 切换阶段 */
  onPhase: (next: DesktopAuthPhase) => void
  /** 演示用:回到网页登录屏 */
  onExit?: () => void
}

export function DesktopAuthScreen({
  phase,
  onPhase,
  onExit,
}: DesktopAuthScreenProps): React.JSX.Element {
  const [secs, setSecs] = useState(phase === 'waiting' ? 6 : 47)
  useEffect(() => {
    setSecs(phase === 'waiting' ? 6 : 47)
    if (phase !== 'waiting') return
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const stalled = phase === 'stalled' || phase === 'pairing'
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
          桌面客户端 · 认证
        </span>
        <span
          style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}
        >
          {(
            [
              ['waiting', '等待中'],
              ['stalled', '静默失败'],
              ['pairing', '配对码'],
            ] as const
          ).map(([k, l]) => (
            <Button
              key={k}
              size="compact"
              variant={phase === k ? 'secondary' : 'ghost'}
              onClick={() => onPhase(k)}
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

      <main style={{ display: 'grid', placeItems: 'center', padding: 'var(--s-10) var(--s-8)' }}>
        <div
          style={{
            width: 560,
            maxWidth: '100%',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-3)',
            overflow: 'hidden',
          }}
        >
          <TitleBar name="DSHWAR 桌面客户端" />
          <div style={{ padding: 'var(--s-8)', display: 'grid', gap: 'var(--s-6)' }}>
            {phase === 'pairing' ? (
              <>
                <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
                  <h1
                    style={{
                      margin: 0,
                      color: 'var(--text-body)',
                      font: 'var(--fw-bold) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                      letterSpacing: 'var(--ls-title-2)',
                    }}
                  >
                    用配对码完成认证
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                      color: 'var(--text-secondary)',
                      maxWidth: '58ch',
                    }}
                  >
                    在浏览器打开下面的地址，输入这个码。码由本客户端生成，只在这台机器上有效 ——
                    不需要从浏览器复制任何东西回来。
                  </p>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: 'var(--s-5)',
                    padding: 'var(--s-6)',
                    background: 'var(--surface-subtle)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--r-2)',
                    justifyItems: 'center',
                  }}
                >
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                      letterSpacing: '.06em',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    PAIRING CODE · 有效期 4:52
                  </span>
                  <span
                    style={{
                      font: 'var(--fw-bold) 34px/1 var(--font-mono)',
                      letterSpacing: '.22em',
                      color: 'var(--text-body)',
                      fontVariantNumeric: 'tabular-nums',
                      userSelect: 'all',
                    }}
                  >
                    KQ7M-2X9P
                  </span>
                  <CodeRef copyable>https://auth.dshwar.example/device</CodeRef>
                </div>
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
                  <Icon name="shield-check" size={14} />
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    码的方向是
                    <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)' }}>
                      客户端 → 浏览器
                    </b>
                    ：客户端生成并轮询自己发起的这个请求，没有任何机密从浏览器流回来。反过来（从浏览器复制一串码粘进应用）会去掉
                    loopback 的绑定校验，本产品不提供那条路径。
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                  <Button variant="ghost" onClick={() => onPhase('waiting')}>
                    返回
                  </Button>
                  <span
                    style={{
                      marginLeft: 'auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--s-4)',
                    }}
                  >
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                        color: 'var(--text-tertiary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      轮询中 · 每 5s
                    </span>
                  </span>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                    {stalled ? (
                      <Tag tone="warn">未收到回调</Tag>
                    ) : (
                      <Tag tone="neutral" dot>
                        等待浏览器
                      </Tag>
                    )}
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                        color: 'var(--text-tertiary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      已等待 {String(Math.floor(secs / 60)).padStart(2, '0')}:
                      {String(secs % 60).padStart(2, '0')}
                    </span>
                  </span>
                  <h1
                    style={{
                      margin: 0,
                      color: 'var(--text-body)',
                      font: 'var(--fw-bold) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                      letterSpacing: 'var(--ls-title-2)',
                    }}
                  >
                    {stalled ? '浏览器已完成，但这里没收到回调' : '已在浏览器打开认证页'}
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                      color: 'var(--text-secondary)',
                      maxWidth: '60ch',
                    }}
                  >
                    {stalled
                      ? '认证结果通过本机回环地址送回客户端。防火墙、端口占用或浏览器拦截都会让这一步静默失败——浏览器侧看起来一切正常，客户端只是没等到。下面三条出口任选其一。'
                      : '在浏览器完成认证后，这里会自动继续。可以把这个窗口留在后台。'}
                  </p>
                </div>

                {stalled ? (
                  <>
                    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--s-5)',
                          alignItems: 'center',
                          padding: 'var(--s-5)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--r-2)',
                        }}
                      >
                        <span style={{ display: 'grid', gap: 2, flex: 1 }}>
                          <span
                            style={{ font: 'var(--fw-medium) var(--fs-body)/1.4 var(--font-sans)' }}
                          >
                            换个端口重试
                          </span>
                          <span
                            style={{
                              font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            重新监听并再发起一次认证。IdP 会话若还在，通常只需在浏览器点一次。
                          </span>
                        </span>
                        <Button variant="primary" icon="rotate-ccw">
                          重试
                        </Button>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--s-5)',
                          alignItems: 'center',
                          padding: 'var(--s-5)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--r-2)',
                        }}
                      >
                        <span style={{ display: 'grid', gap: 2, flex: 1 }}>
                          <span
                            style={{ font: 'var(--fw-medium) var(--fs-body)/1.4 var(--font-sans)' }}
                          >
                            改用配对码
                          </span>
                          <span
                            style={{
                              font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            不走回环地址。客户端出码、你念进浏览器——机密不回流。
                          </span>
                        </span>
                        <Button icon="key-round" onClick={() => onPhase('pairing')}>
                          获取配对码
                        </Button>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--s-5)',
                          alignItems: 'center',
                          padding: 'var(--s-5)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--r-2)',
                        }}
                      >
                        <span style={{ display: 'grid', gap: 2, flex: 1 }}>
                          <span
                            style={{ font: 'var(--fw-medium) var(--fs-body)/1.4 var(--font-sans)' }}
                          >
                            把诊断给 IT
                          </span>
                          <span
                            style={{
                              font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            端口与绑定结果已记录，复制后连同 requestId 一起发出。
                          </span>
                        </span>
                        <Button icon="copy">复制诊断</Button>
                      </div>
                    </div>
                    <Diag
                      rows={[
                        ['listen', '127.0.0.1:51734', false],
                        ['bind', 'EACCES · 权限被拒', true],
                        ['fallback', '127.0.0.1:51735 · 已尝试 · 无回调', true],
                        ['redirect_uri', 'http://127.0.0.1:51734/cb', false],
                        ['idp', 'keycloak · smg-realm', false],
                        ['error', 'E_CALLBACK_TIMEOUT · req_7c12de40b1', true],
                      ]}
                    />
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      不提供"从浏览器复制授权码粘贴到这里"：那会去掉回环地址的绑定校验，且把"复制一串码粘进应用"变成习惯——那本身就是钓鱼面。
                    </span>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
                      <Button variant="ghost" icon="external-link">
                        重新打开浏览器
                      </Button>
                      <Button variant="ghost" onClick={() => onPhase('stalled')}>
                        我已在浏览器完成，但这里没反应
                      </Button>
                      <Button variant="ghost" style={{ marginLeft: 'auto' }}>
                        取消
                      </Button>
                    </div>
                    <Diag
                      rows={[
                        ['listen', '127.0.0.1:51734', false],
                        ['redirect_uri', 'http://127.0.0.1:51734/cb', false],
                        ['idp', 'keycloak · smg-realm', false],
                        ['request', 'req_7c12de40b1', false],
                      ]}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </main>
      <PlatformFooter />
    </div>
  )
}
