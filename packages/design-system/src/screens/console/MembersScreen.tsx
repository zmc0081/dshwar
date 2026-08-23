/**
 * 控制台「成员与权限」屏。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 成员来自客户自己的 IdP —— DSHWAR 不实现登录(硬规则 4:不存密码、不签发身份令牌、
 * 不做注册流程)。所以这屏没有"新建成员":只有同步状态与停用/启用。
 *
 * ## 与设计 kit 的差别:四处,全是机械转换
 *
 * 1. 首行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. `PageHead` 在 kit 里由 `Shell.jsx` 挂到 window、`EmptyState` 由
 *    `TenantsScreen.jsx` 挂到 window;移植后分别从 `./Shell.tsx` 与
 *    `./TenantsScreen.tsx` 引 —— 定义位置没变,只是取用方式从全局变成模块导入。
 * 3. `React.useState` → 具名 `useState` import(kit 里 React 是全局)。
 * 4. `cols` 标注 {@link TableColumn}:不标的话 `align: 'right'` 会被推宽成 `string`。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid / flex),
 * 做成 CSS 类会产生几百个只用一次的类。本屏没有 hover / active / focus 的
 * JS 写法,所以没有需要转成伪类的东西。
 *
 * ## 表格里的是设计 kit 的夹具数据
 *
 * 四位成员、IdP principal、同步时间戳均原样保留。接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/console/MembersScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { CredentialTag } from '../../components/CredentialTag.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import { PageHead } from './Shell.tsx'
import { EmptyState } from './TenantsScreen.tsx'

export interface MembersScreenProps {
  /** 空态演示:尚未同步到任何成员,且 IdP 连接未配置 */
  empty?: boolean
  /** 隔离档。`logical` = 单用户部署,成员上限 1 人 */
  isolation?: 'logical' | 'process'
  /** 点「添加成员」;逻辑档下由宿主弹出隔离档切换闸门 */
  onRequestSecondMember?: () => void
}

export function MembersScreen({
  empty,
  isolation,
  onRequestSecondMember,
}: MembersScreenProps): React.JSX.Element {
  const [sel, setSel] = useState(0)
  const single = isolation === 'logical'
  const act = (
    <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
      <IconButton icon="pause" label="停用" />
      <IconButton icon="more-horizontal" label="更多" />
    </span>
  )
  const cols: TableColumn[] = [
    { key: 'name', label: '成员' },
    { key: 'principal', label: 'IdP principal', mono: true },
    { key: 'role', label: '角色' },
    { key: 'synced', label: '同步于', mono: true },
    { key: 'last', label: '最近活动', mono: true },
    { key: 'state', label: '状态' },
    { key: 'a', label: '', align: 'right', width: '72px' },
  ]
  const all: Record<string, React.ReactNode>[] = [
    {
      name: '周琳',
      principal: 'zhoulin@acme.example',
      role: '管理员',
      synced: '08-21T09:14Z',
      last: '12 分钟前',
      state: (
        <Tag tone="success" dot>
          已启用
        </Tag>
      ),
      a: act,
    },
    {
      name: '陈默',
      principal: 'chenmo@acme.example',
      role: '成员',
      synced: '08-21T09:14Z',
      last: '2 小时前',
      state: (
        <Tag tone="success" dot>
          已启用
        </Tag>
      ),
      a: act,
    },
    {
      name: '李文博',
      principal: 'liwb@acme.example',
      role: '成员',
      synced: '08-21T09:14Z',
      last: '昨天',
      state: <Tag tone="neutral">已停用</Tag>,
      a: act,
    },
    {
      name: '孙宇',
      principal: 'sunyu@acme.example',
      role: '审计员',
      synced: '08-20T22:03Z',
      last: '3 天前',
      state: <Tag tone="warn">IdP 已移除</Tag>,
      a: act,
    },
  ]
  const rows = single ? all.slice(0, 1) : all
  return (
    <>
      <PageHead
        title="成员与权限"
        sub={<>成员由贵方 IdP 同步而来 · 本产品不做注册、不存密码、不签发身份令牌</>}
        actions={
          <>
            <Button icon="refresh-cw">立即同步</Button>
            <Button variant="primary" icon="user-plus" onClick={onRequestSecondMember}>
              添加成员
            </Button>
          </>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 300px',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          {single ? (
            <div
              style={{
                display: 'flex',
                gap: 'var(--s-4)',
                alignItems: 'flex-start',
                padding: 'var(--s-5)',
                borderRadius: 'var(--r-1)',
                background: 'var(--neutral-surface)',
                border: '1px solid var(--border-default)',
              }}
            >
              <Icon name="info" size={15} />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  color: 'var(--text-secondary)',
                }}
              >
                当前 <CodeRef>isolation.level "logical"</CodeRef> —— 单用户部署，成员上限 1
                人。这是一个完整且受支持的形态；添加第二位成员时会要求先切换隔离档。
              </span>
            </div>
          ) : null}

          {empty ? (
            <EmptyState
              icon="users"
              title="还没有同步到成员"
              body="成员来自贵方 IdP（Keycloak / Entra / 任意 OIDC 提供方）。配置好连接后点「立即同步」，已授权的人会出现在这里。本产品不创建用户，也不存密码。"
              action={<Button icon="refresh-cw">立即同步</Button>}
              hint="尚未配置 IdP 连接 · 见「集成」页"
            />
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 'var(--s-5)',
                  alignItems: 'end',
                }}
              >
                <Input label="筛选成员" placeholder="姓名 / name@domain" mono />
                <Select
                  label="角色"
                  value="全部"
                  options={['全部', '管理员', '成员', '审计员']}
                  onChange={() => {}}
                />
                <Select
                  label="状态"
                  value="全部"
                  options={['全部', '已启用', '已停用', 'IdP 已移除']}
                  onChange={() => {}}
                />
              </div>
              <Table columns={cols} rows={rows} selectedIndex={sel} onRowClick={setSel} />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {single ? '1 / 1' : '4 / 4'} · 上次同步 2026-08-21T09:14Z ·{' '}
                <CodeRef copyable>req_51ea9c07d2</CodeRef>
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="IdP 连接">
            <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  提供方
                </span>
                <CodeRef>{empty ? '未配置' : 'keycloak · acme-realm'}</CodeRef>
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  客户端密钥
                </span>
                <CredentialTag configured={!empty} />
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  同步频率
                </span>
                <Select
                  value="每 15 分钟"
                  options={['每 15 分钟', '每小时', '仅手动']}
                  onChange={() => {}}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                <Button size="compact">测试连接</Button>
                <Button size="compact" variant="ghost">
                  查看审计
                </Button>
              </div>
            </div>
          </Card>
          <Card title="停用与移除">
            <div
              style={{
                display: 'grid',
                gap: 'var(--s-4)',
                font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                color: 'var(--text-secondary)',
              }}
            >
              <span>
                在 IdP 中被移除的人会标记为「IdP 已移除」，但
                <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>不会</b>
                自动删除其运行记录与产物 —— 那些属于租户，不属于个人。
              </span>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.55 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}
              >
                member.disable · member.reinstate 均进审计
              </span>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
