/**
 * 屏 C · 账户。身份只读(由 IdP 提供),可改的是偏好与个人访问令牌。
 *
 * ## 与设计 kit 的差别:只有两处
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成从组件层 ES import
 *    (kit 那行解构了 15 个组件,本屏实际用到 12 个,只 import 用到的);
 * 2. `.jsx` → `.tsx`,props 补类型。
 *
 * 内联 `style={{}}` **原样保留** —— 屏幕层的样式几乎全是一次性布局。
 * 本屏没有任何 hover / active / focus 的 JS 状态,因此不涉及伪类改写。
 * 理由见 `docs/DECISIONS/design-kit-adoption.md`。
 *
 * @module @dshwar/design-system/screens/auth/AccountScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { Metric } from '../../components/Metric.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Select } from '../../components/Select.tsx'
import { Table } from '../../components/Table.tsx'
import type { TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'

/** 主题偏好三态。`system` = 跟随系统。 */
export type ThemePreference = 'light' | 'dark' | 'system'

interface ReadOnlyFieldProps {
  /** 字段名 */
  label: string
  /** 字段值 */
  value: string
  /** 标识串置 true → 用 CodeRef 渲染 */
  mono?: boolean
  /** 归属说明:说明"为什么"只读,而不是"不能" */
  note?: string
}

/* ★ 只读必须看起来是"有意的产品决策"，不是坏了或没做完。三个做法：
   1. 只读字段不画成 disabled 输入框（那读作"暂时不能填"），
      而是**定义列表形态**：标签 + 值 + 一枚 neutral「由贵司 IT 管理」Tag；
   2. 每组只读区给出**归属说明**（身份由 IdP 管），说明"为什么"而不是"不能"；
   3. 密码 / MFA **连入口都不出现** —— 不放灰掉的按钮，因为灰掉的按钮
      恰恰暗示"以后会有"。 */
function ReadOnlyField({ label, value, mono, note }: ReadOnlyFieldProps): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <span
        style={{
          font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
          color: 'var(--text-secondary)',
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
        {mono ? (
          <CodeRef>{value}</CodeRef>
        ) : (
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body-lg)/1.4 var(--font-sans)',
              color: 'var(--text-body)',
            }}
          >
            {value}
          </span>
        )}
        <Tag tone="neutral">由贵司 IT 管理</Tag>
      </span>
      {note ? (
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
            color: 'var(--text-tertiary)',
          }}
        >
          {note}
        </span>
      ) : null}
    </div>
  )
}

/* 个人访问令牌：后端可能还不存在（现有的是 OIDC bearer 与按租户签发的服务账号
   API Key，个人令牌是第三种）。按屏 3 的做法处理：控件只读 + 逐项标注，
   不画成看起来能用的表单。 */
function TokensCard(): React.JSX.Element {
  const cols: TableColumn[] = [
    { key: 'name', label: '名称' },
    { key: 'prefix', label: '前缀', mono: true },
    { key: 'scope', label: '范围' },
    { key: 'created', label: '创建于', mono: true },
    { key: 'used', label: '最后使用', mono: true },
    { key: 'a', label: '', align: 'right', width: '40px' },
  ]
  const rows: Record<string, React.ReactNode>[] = [
    {
      name: 'ci-report-export',
      prefix: 'pat_7c12…',
      scope: '只读用量',
      created: '2026-07-02',
      used: '3 小时前',
      a: <IconButton icon="ban" label="吊销" disabled />,
    },
    {
      name: 'local-dev',
      prefix: 'pat_2b88…',
      scope: '读写产物',
      created: '2026-06-18',
      used: '从未使用',
      a: <IconButton icon="ban" label="吊销" disabled />,
    },
  ]
  return (
    <Card title="个人访问令牌" action={<Tag tone="neutral">当前不生效</Tag>}>
      <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-4)',
            alignItems: 'flex-start',
            padding: 'var(--s-5)',
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
              个人令牌尚未在服务端落地 —— 本卡片即将可用
            </span>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                color: 'var(--text-secondary)',
                maxWidth: '82ch',
              }}
            >
              现有的两种凭据是 OIDC bearer（登录会话）与按租户签发的服务账号 API
              Key。个人访问令牌是第三种，签发与吊销链路还没接。下方列表是形态预览，创建按钮不可用——不做成能点但保存不生效的表单。
            </span>
            <CodeRef copyable>POST /v1/me/tokens · 501 · req_c9d0e1f4a7</CodeRef>
          </div>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s-5)', flexWrap: 'wrap' }}
        >
          <Input
            label="令牌名称"
            placeholder="ci-report-export"
            disabled
            onChange={() => {}}
            style={{ minWidth: 200, flex: 1 }}
          />
          <Select
            label="范围"
            value="只读用量"
            options={['只读用量', '读写产物']}
            disabled
            onChange={() => {}}
            style={{ width: 160 }}
          />
          <Button variant="primary" icon="plus" disabled>
            创建令牌
          </Button>
        </div>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
            color: 'var(--text-tertiary)',
          }}
        >
          令牌值只在创建时显示一次，之后不可再查看（与凭据的「已配置（值不可见）」同一规则）。
        </span>
        <Table columns={cols} rows={rows} />
      </div>
    </Card>
  )
}

export interface AccountScreenProps {
  /** 当前主题偏好;缺省显示为「跟随系统」 */
  theme?: ThemePreference
  /** 主题下拉改动时调用 */
  onTheme?: (next: ThemePreference) => void
}

export function AccountScreen({ theme, onTheme }: AccountScreenProps): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)' }}>
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
            账户
          </h1>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            身份信息由贵司的身份提供方管理，在此只读。可改的是偏好与个人访问令牌。
          </span>
        </div>
        <Button variant="ghost" icon="log-out">
          退出登录
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="身份（由 IdP 提供）">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <div style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'center' }}>
                <span
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 'var(--r-full)',
                    background: 'var(--n-800)',
                    color: 'var(--n-050)',
                    display: 'grid',
                    placeItems: 'center',
                    font: 'var(--fw-medium) 17px/1 var(--font-sans)',
                  }}
                >
                  周琳
                </span>
                <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-sans)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    头像
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                    <span
                      style={{
                        font: 'var(--fw-regular) var(--fs-body)/1.4 var(--font-sans)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      取自 IdP 的 picture claim；未提供时用姓名缩写
                    </span>
                    <Tag tone="neutral">由贵司 IT 管理</Tag>
                  </span>
                </div>
              </div>
              <div style={{ height: 1, background: 'var(--border-hairline)' }} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--s-6)',
                }}
              >
                <ReadOnlyField label="显示名" value="周琳" />
                <ReadOnlyField
                  label="邮箱"
                  value="zhoulin.operations@shanghai-manufacturing-group.example"
                  mono
                />
                <ReadOnlyField
                  label="IdP principal"
                  value="zhoulin@smg-realm"
                  mono
                  note="登录、改名、改邮箱都在贵司 IdP 侧完成，改动会在下次同步（每 15 分钟）后反映到这里。"
                />
                <ReadOnlyField
                  label="角色"
                  value="管理员"
                  note="角色由 IdP 的组映射决定，不在本产品内编辑。"
                />
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
                <Icon name="info" size={14} />
                <span
                  style={{
                    font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  这里没有「修改密码」与「多因素认证」——不是暂缺，是本产品不实现登录：不存密码、不签发身份令牌、不做注册流程。相关设置请在贵司
                  IdP（<CodeRef>keycloak · smg-realm</CodeRef>）内完成。
                </span>
              </div>
            </div>
          </Card>

          <Card title="偏好">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
                <Select
                  label="界面语言"
                  value="简体中文"
                  options={['简体中文', 'English', '日本語']}
                  onChange={() => {}}
                />
                <Select
                  label="主题"
                  value={theme === 'dark' ? '暗' : theme === 'light' ? '亮' : '跟随系统'}
                  options={['跟随系统', '亮', '暗']}
                  onChange={(e) => {
                    onTheme?.(
                      e.target.value === '暗'
                        ? 'dark'
                        : e.target.value === '亮'
                          ? 'light'
                          : 'system',
                    )
                  }}
                />
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  通知
                </span>
                <Checkbox checked label="运行失败时通知我" onChange={() => {}} />
                <Checkbox checked label="配额达到 90% 时通知我" onChange={() => {}} />
                <Checkbox checked={false} label="产物生成完成时通知我" onChange={() => {}} />
              </div>
            </div>
          </Card>

          <TokensCard />
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="我的用量与余额">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <Metric label="本周期消耗" value="1.28M" sub="tok · 6,412 次运行" />
              <QuotaBar used={1284905} total={2000000} note="租户配额 · 平台值 · 非承诺值" />
              <div style={{ height: 1, background: 'var(--border-hairline)' }} />
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--s-4)',
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                }}
              >
                <span
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s-5)' }}
                >
                  <span style={{ color: 'var(--text-tertiary)' }}>所属租户</span>
                  <CodeRef>tnt_9f3c21</CodeRef>
                </span>
                <span
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s-5)' }}
                >
                  <span style={{ color: 'var(--text-tertiary)' }}>余额</span>
                  <span
                    style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    715,095 tok
                  </span>
                </span>
              </div>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                配额由管理员在运营后台设定，个人不可自调。
              </span>
            </div>
          </Card>
          <Card title="会话">
            <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
              <ReadOnlyField label="当前会话" value="OIDC bearer · 剩余 47 分钟" mono />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                会话由 IdP 续期；退出登录会同时结束本地会话。
              </span>
              <Button size="compact" variant="danger" icon="log-out">
                退出所有设备
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
