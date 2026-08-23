/**
 * 控制台「成员与权限」屏。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 成员来自客户自己的 IdP —— DSHWAR 不实现登录(硬规则 4:不存密码、不签发身份令牌、
 * 不做注册流程)。所以这屏没有"新建成员":只有同步状态与停用/启用。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid / flex),
 * 做成 CSS 类会产生几百个只用一次的类。本屏没有 hover / active / focus 的
 * JS 写法,所以没有需要转成伪类的东西。
 *
 * ## V0.9.0 Session 3:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)四位成员、筛选值、同步时间、requestId 全部硬编码 ——
 * 那是刻意的,那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `syncedAt` 收到的是已经格式化好的
 * `'08-21T09:14Z'`,`lastActiveAt` 是 `'12 分钟前'`;`status` 是一个枚举
 * 而不是一段 `<Tag>` JSX。理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,
 * 也不该依赖 —— 设计系统要能被三个宿主、以及将来的白牌前端复用,
 * 而它们的数据来源不一定相同。换算(ISO 时间 → `'12 分钟前'`)是调用方的事。
 *
 * 选中行、三个筛选值也一并交出去了,这一屏改完**一个 `useState` 都不剩**:
 * 选中谁、筛成什么样,决定的是宿主接下来拿谁去调 `member.disable` ——
 * 组件自己留一份副本,等于让宿主和界面各信各的。
 *
 * ## 🚨 缺陷一:逻辑档下组件**自己把表裁到一行**,而计数写死成「1 / 1」
 *
 * kit 原版是 `const rows = single ? all.slice(0, 1) : all`,配一句
 * `{single ? '1 / 1' : '4 / 4'}`。两处凑在一起,界面**自洽地**少了三个人:
 * 表里一行,计数说总共一行,没有任何地方提示「还有三位没显示」。
 *
 * 而逻辑档下那三个人恰恰是最该被看见的 —— 他们的文件全落进
 * `anonymous/anonymous/`,互相静默覆盖(见 `docs/DECISIONS/principal-scope-binding.md`)。
 * 界面把他们藏起来,等于把这个事故的**唯一征兆**也藏了。
 *
 * ⇒ 组件不裁剪 `rows`,来什么显示什么;计数是 `rows.length / totalCount`。
 *
 * ## 🚨 缺陷二:四行共用一个 `act` 常量,而且对着已停用的人显示「停用」
 *
 * 原版把 `<IconButton icon="pause" label="停用" />` 提成一个常量,四行共享同一份
 * JSX —— **没有任何一行的按钮知道自己属于哪一行**,接不上 onClick(不是忘了接,
 * 是接了也不知道该停用谁)。更直接的一处:第三行状态是「已停用」,行尾按钮
 * 仍然写着「停用」。现在按行构造,并按 `status` 给出「停用」或「启用」。
 *
 * ## 🚨 缺陷三:`req_51ea9c07d2` 与「上次同步 2026-08-21T09:14Z」是写死的
 *
 * 在设计 kit 里它们只是好看的夹具;接到真 API 之后它们是**假证据** ——
 * 用户把这个 requestId 抄进工单,而服务端日志里根本没有这条 id,
 * 支持侧只能回「查无此请求」。与「假成功回执」同族:界面给出的凭证
 * 与它实际做过的事对不上。⇒ 两者都是 props,而且**可空**:
 * 拿不到 requestId 就**不渲染**那段 `CodeRef`,不要凑一个出来。
 *
 * ## 🚨 缺陷四:三个筛选器一个都接不上
 *
 * 输入框没有 `value`,两个下拉是受控值 + 空 `onChange` —— 用户选了「已停用」,
 * 下拉**弹回「全部」**,什么也没发生,也没有提示。这不是「还没接」:
 * 「还没接」是不给 onChange,那时 `Select` 按契约退化成只展示;
 * 给一个吞掉的 onChange,是界面接收了一次交互然后假装无事发生。
 *
 * ## ⚠️ 与契约 `Subject` 对不齐的五处(转换层要负责的事)
 *
 * | kit 这一列 | 契约 `Subject` | 这里怎么处理 |
 * | --- | --- | --- |
 * | 成员(总有姓名) | `displayName` **可空** | `string \| null`;空时显示「未提供显示名」,**不拿 id 顶替** |
 * | IdP principal(放的是邮箱) | `id`,而 `SubjectId` 明写**不得使用邮箱** | 收 `id`。邮箱会变(改名、换姓),而这一列是审计里指认某个人的那个串 |
 * | 角色(单值) | `roles` 是**数组** | 收数组;只显示第一个会让权限复核**看漏兼任**(既是管理员又是审计员) |
 * | 最近活动 | **契约里没有这个字段** | `lastActiveAt: string \| null`,来自用量/审计侧;取不到传 `null` |
 * | 状态三档 | 只有 `active: boolean` | 见 {@link MemberStatus} —— 第三档推不出来 |
 *
 * @module @dshwar/design-system/screens/console/MembersScreen
 */
import type * as React from 'react'
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
import type { CapacityReading } from './capacity.ts'
import { PageHead } from './Shell.tsx'
import { EmptyState } from './TenantsScreen.tsx'

/**
 * 一位成员的状态。**闭集**,与 `Tag` 的 tone 一一对应。
 *
 * ⚠️ **只有前两档能从契约的 `Subject.active` 推出来。**
 * 「IdP 已移除」与「已停用」是两件事:前者是这个人在 IdP 里不存在了,
 * 后者是他还在、只是被停用。SCIM 的 `DELETE` 与 `active: false` 也是两条不同的路。
 * 镜像侧不另外记这件事,转换层就**分不出来** —— 那时不要猜:
 * 猜错的方向是把一个还在职的人显示成「已移除」,或者反过来。
 *
 * ⚠️ 不要在这里加「未知」档。认不出的状态应该在**转换层**停下来报错,
 * 而不是在界面上显示成一个含糊的灰标签 —— 后者会让一个新增的服务端状态
 * 悄悄退化成「看起来正常」。
 */
export type MemberStatus = 'active' | 'disabled' | 'idp-removed'

/**
 * 表里的一行。字段都是**已经格式化好的展示串**。
 *
 * 契约 `Subject` 的 `tenantId` 与 `createdAt` 不在这一屏上 —— 不是漏了:
 * 租户在控制台的上下文里是已知的,而「加入时间」这屏从来不展示。
 * 将来要显示,加字段,别在这里塞一个 `Record<string, unknown>` 的口子。
 */
export interface MemberRow {
  /**
   * 主体标识,即契约的 `Subject.id`。原样展示(mono 列)。
   *
   * ⚠️ 它必须是 IdP 的**不可变主键**(OIDC sub / SCIM id / 目录 object id)。
   * 契约层没做正则校验(合法形状五花八门),所以这条约束的最后一道防线
   * 就是转换层 —— 别把邮箱塞进来。
   */
  readonly id: string
  /** 契约的 `displayName`,**可空** —— IdP 不保证给。 */
  readonly displayName: string | null
  /** 契约的 `roles`。可以是空数组(没有任何角色的成员是合法的)。 */
  readonly roles: readonly string[]
  /** 已格式化的镜像更新时间(契约的 `updatedAt`),如 `'08-21T09:14Z'`。 */
  readonly syncedAt: string
  /**
   * 已人类化的最近活动时间,如 `'12 分钟前'`。**契约的 `Subject` 里没有这个字段**,
   * 它来自用量/审计侧;取不到就传 `null`(显示 `—`)。
   *
   * 🚨 **不要拿 `updatedAt` 冒充。** 那是镜像被同步的时间,同步是定时跑的 ——
   * 一个三个月没登录的人,每 15 分钟就会被刷成「刚刚活动过」。
   */
  readonly lastActiveAt: string | null
  readonly status: MemberStatus
}

/**
 * IdP 连接卡的内容。`null` = 尚未配置连接。
 *
 * ⚠️ **这里只有 `secretConfigured`,没有密钥值,将来也不许加。**
 * 硬规则 5:凭据端点只暴露 `describe` 语义(configured / source / writable),
 * 永不返回值 —— 这条约束要一路传到界面的类型上,否则它只是网关里的一句话。
 */
export interface IdpConnection {
  /** 提供方标识,如 `'keycloak · acme-realm'`。原样展示。 */
  readonly provider: string
  /** 客户端密钥是否已配置。**只有「在不在」,没有「是什么」。** */
  readonly secretConfigured: boolean
  /** 同步频率的当前值与可选项。选项是部署侧的清单,所以是裸串。 */
  readonly syncInterval: string
  readonly syncIntervalOptions: readonly string[]
}

export interface MembersScreenProps {
  readonly rows: readonly MemberRow[]
  /** 选中行的下标。`-1` = 未选中;越界同样按未选中处理。 */
  readonly selectedIndex: number
  /**
   * 全部成员数(未经筛选)。计数行显示 `rows.length / totalCount`。
   *
   * ⚠️ **与 `capacity.memberCount` 不是同一个数,不要互相顶替。**
   * 契约明写后者「只数**启用**的成员,停用的不计」,而这张表连已停用、
   * IdP 已移除的一起列 —— 拿它当总数会显示出「4 / 2」这种读数。
   */
  readonly totalCount: number
  /**
   * 整份容量读数。隔离档与成员上限都从这里读,本屏**不另算一份**。
   *
   * V0.5.0 的 D2 要的就是这件事:容量条与开户闸门是同一个来源。
   * 详见 {@link CapacityReading} 的模块注释。
   */
  readonly capacity: CapacityReading
  /** 筛选输入框的当前值。 */
  readonly query: string
  /**
   * 角色与状态两个下拉的当前值与可选项。
   *
   * 这里是**裸串**而不是枚举,与 {@link MemberStatus} 的闭集是两回事:
   * 行的状态来自服务端,认不出就该报错;而下拉的选项是这套部署的清单
   * (角色名由客户的 IdP 定义,「全部」这一档也只是筛选器的约定),它是数据。
   */
  readonly role: string
  readonly roleOptions: readonly string[]
  readonly status: string
  readonly statusOptions: readonly string[]
  /** 已格式化的上次同步时间。`null` = 从未同步过 —— 那时显示「从未同步」。 */
  readonly lastSyncedAt: string | null
  /**
   * 本次列表响应的 requestId,与服务端日志和审计记录对得上的那一个。
   *
   * `null` = 这一屏的数据不是从一次真实调用来的(离线夹具、缓存回放)。
   * 那时**整段都不渲染** —— 见模块注释缺陷三,一个查无此请求的 id
   * 比没有 id 更糟:它会让用户和支持侧一起浪费一轮。
   */
  readonly requestId: string | null
  /** IdP 连接。`null` = 尚未配置。 */
  readonly idp: IdpConnection | null
  /** 省略即为只展示 —— 这一屏的筛选值一律由调用方持有,组件不留副本。 */
  readonly onQueryChange?: (next: string) => void
  readonly onRoleChange?: (next: string) => void
  readonly onStatusChange?: (next: string) => void
  readonly onSelect?: (index: number) => void
  /** 立即同步。没有 IdP 连接时按钮禁用,这个回调不会被调到。 */
  readonly onSync?: () => void
  /**
   * 点「添加成员」。
   *
   * ⚠️ 逻辑档下宿主应当弹出 `IsolationGate` 而不是打开添加表单 ——
   * 组件不替宿主做这个决定(它不知道宿主有没有那个闸门,也不该知道)。
   */
  readonly onAddMember?: () => void
  /** 停用 / 启用某一位。收到的是**这一行**的主体标识,两者均进审计。 */
  readonly onDisable?: (id: string) => void
  readonly onReinstate?: (id: string) => void
  readonly onSyncIntervalChange?: (next: string) => void
  readonly onTestConnection?: () => void
  readonly onViewAudit?: () => void
}

const TONE_OF: Record<MemberStatus, { tone: 'success' | 'warn' | 'neutral'; label: string }> = {
  active: { tone: 'success', label: '已启用' },
  disabled: { tone: 'neutral', label: '已停用' },
  'idp-removed': { tone: 'warn', label: 'IdP 已移除' },
}

const COLS: TableColumn[] = [
  { key: 'name', label: '成员' },
  { key: 'principal', label: 'IdP principal', mono: true },
  { key: 'role', label: '角色' },
  { key: 'synced', label: '同步于', mono: true },
  { key: 'last', label: '最近活动', mono: true },
  { key: 'state', label: '状态' },
  { key: 'a', label: '', align: 'right', width: '72px' },
]

export function MembersScreen({
  rows,
  selectedIndex,
  totalCount,
  capacity,
  query,
  role,
  roleOptions,
  status,
  statusOptions,
  lastSyncedAt,
  requestId,
  idp,
  onQueryChange,
  onRoleChange,
  onStatusChange,
  onSelect,
  onSync,
  onAddMember,
  onDisable,
  onReinstate,
  onSyncIntervalChange,
  onTestConnection,
  onViewAudit,
}: MembersScreenProps): React.JSX.Element {
  const single = capacity.isolation === 'logical'
  const connected = idp !== null

  const tableRows = rows.map((row) => {
    const { tone, label } = TONE_OF[row.status]
    return {
      // 显示名可空。空时给一句人话而不是 `—`:这一格空着是 **IdP 侧**该补的东西,
      // 而 `—` 会读成「这个人没有名字」。也不拿 id 顶替 —— 那会让相邻两列
      // 显示同一个串,看起来像重复渲染,并且把「IdP 没给显示名」这个事实盖掉。
      name:
        row.displayName === null ? (
          <span style={{ color: 'var(--text-tertiary)' }}>未提供显示名</span>
        ) : (
          row.displayName
        ),
      principal: row.id,
      // 角色是数组:兼任要全部显示出来,权限复核看的就是这一列。
      role: row.roles.length === 0 ? '—' : row.roles.join(' · '),
      synced: row.syncedAt,
      last: row.lastActiveAt ?? '—',
      state: (
        <Tag tone={tone} dot={row.status === 'active'}>
          {label}
        </Tag>
      ),
      // ⚠️ 每行**各自**的操作区。kit 原版是一个共享的 `act` 常量 ——
      //   于是没有任何一行的按钮知道自己属于哪一行,接不上 onClick。
      a: (
        <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          {row.status === 'active' ? (
            <IconButton icon="pause" label="停用" onClick={() => onDisable?.(row.id)} />
          ) : (
            // 「IdP 已移除」这一档禁用:IdP 里已经没有这个人,本地启用之后
            // 下一次同步就会把他改回去 —— 一个会自己撤销的操作,
            // 与假成功回执同族。要真的恢复,得先在 IdP 里恢复。
            <IconButton
              icon="play"
              label="启用"
              disabled={row.status === 'idp-removed'}
              onClick={() => onReinstate?.(row.id)}
            />
          )}
          <IconButton icon="more-horizontal" label="更多" />
        </span>
      ),
    }
  })

  return (
    <>
      <PageHead
        title="成员与权限"
        sub={<>成员由贵方 IdP 同步而来 · 本产品不做注册、不存密码、不签发身份令牌</>}
        actions={
          <>
            <Button icon="refresh-cw" disabled={!connected} onClick={() => onSync?.()}>
              立即同步
            </Button>
            <Button variant="primary" icon="user-plus" onClick={() => onAddMember?.()}>
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
                {/*
                  上限的数从 `capacity.memberCap` 读,不在这里写死一个 1。
                  契约写明「逻辑档恒为 1」,所以合规的服务端下两者一模一样;
                  而服务端若给出别的值,写死的 1 会**安静地替它圆场** ——
                  管理员照着界面加人、加到一半被服务端拒掉,正是 D2 那笔账的形状。
                */}
                当前 <CodeRef>{`isolation.level "${capacity.isolation}"`}</CodeRef> ——
                单用户部署，成员上限 {capacity.memberCap}{' '}
                人。这是一个完整且受支持的形态；添加第二位成员时会要求先切换隔离档。
              </span>
            </div>
          ) : null}

          {connected ? (
            <>
              {/*
                ⚠️ 零行时**照样渲染筛选条**。把它跟表格一起藏起来,用户就没有办法
                取消那个恰好筛掉了所有人的条件 —— 只能对着一句「没有成员」发呆。
              */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 'var(--s-5)',
                  alignItems: 'end',
                }}
              >
                <Input
                  label="筛选成员"
                  placeholder="姓名 / 主体标识"
                  mono
                  value={query}
                  onChange={(e) => onQueryChange?.(e.target.value)}
                />
                <Select
                  label="角色"
                  value={role}
                  options={[...roleOptions]}
                  onChange={(e) => onRoleChange?.(e.target.value)}
                />
                <Select
                  label="状态"
                  value={status}
                  options={[...statusOptions]}
                  onChange={(e) => onStatusChange?.(e.target.value)}
                />
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  icon="users"
                  title="没有符合条件的成员"
                  body="上一次同步没有返回任何成员，或者当前的筛选条件把他们都排除了。这两件事界面分不出来 —— 所以这里不替你猜是哪一种。"
                  action={
                    <Button icon="refresh-cw" onClick={() => onSync?.()}>
                      立即同步
                    </Button>
                  }
                />
              ) : (
                <Table
                  columns={COLS}
                  rows={tableRows}
                  selectedIndex={selectedIndex}
                  onRowClick={(index) => onSelect?.(index)}
                />
              )}

              {/*
                计数行留在零行的情况下也渲染 —— requestId 恰恰是**列表为空**时
                最该拿得到的东西:用户要问的正是「为什么一个人都没有」。
              */}
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {rows.length} / {totalCount} · 上次同步{' '}
                {lastSyncedAt === null ? '从未同步' : lastSyncedAt}
                {requestId === null ? null : (
                  <>
                    {' · '}
                    <CodeRef copyable>{requestId}</CodeRef>
                  </>
                )}
              </span>
            </>
          ) : (
            <EmptyState
              icon="users"
              title="还没有同步到成员"
              body="成员来自贵方 IdP（Keycloak / Entra / 任意 OIDC 提供方）。配置好连接后点「立即同步」，已授权的人会出现在这里。本产品不创建用户，也不存密码。"
              // 没有连接就没有可同步的东西。按钮留着(它指出了下一步在哪),但**禁用** ——
              // 可点而什么都不发生,与「界面接收了一次交互然后假装无事发生」是同一件事。
              action={
                <Button icon="refresh-cw" disabled onClick={() => onSync?.()}>
                  立即同步
                </Button>
              }
              hint="尚未配置 IdP 连接 · 见「集成」页"
            />
          )}
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="IdP 连接">
            <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
              <Field label="提供方">
                <CodeRef>{idp === null ? '未配置' : idp.provider}</CodeRef>
              </Field>
              <Field label="客户端密钥">
                <CredentialTag configured={idp !== null && idp.secretConfigured} />
              </Field>
              <Field label="同步频率">
                {idp === null ? (
                  // 没有连接时不渲染下拉:一个有当前值、有选项、还能改的控件
                  // 会让人以为这个设置已经在生效,而它背后什么都没有。
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-mono)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    —
                  </span>
                ) : (
                  <Select
                    value={idp.syncInterval}
                    options={[...idp.syncIntervalOptions]}
                    onChange={(e) => onSyncIntervalChange?.(e.target.value)}
                  />
                )}
              </Field>
              <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                <Button size="compact" disabled={idp === null} onClick={() => onTestConnection?.()}>
                  测试连接
                </Button>
                <Button size="compact" variant="ghost" onClick={() => onViewAudit?.()}>
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

/** 卡片里的一栏:标签 + 值。三处结构相同,提出来只是去掉重复的标签排版。 */
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
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
      {children}
    </div>
  )
}
