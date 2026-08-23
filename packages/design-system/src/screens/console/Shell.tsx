/**
 * 运营后台外壳:固定顶栏(Logo 槽位 + 平台入口)+ 左侧导航 + 内容区 + 平台声明带。
 *
 * ## V0.9.0 Session 3:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)顶栏右侧那一串 —— 租户标签 `acme-prod`、头像里的 `AD`、
 * 一个不接线的「获取帮助」—— 全部是常量。那是刻意的,那一轮的纪律是机械转换。
 * 这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `scope` 收到的是**已经取好**的租户标识串,
 * `account.initials` 是**调用方截好**的两个字母(从姓名截首字母的规则各语言不同,
 * 设计系统不猜)。理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 *
 * ## 🚨 一、顶栏那个 `acme-prod` 是 **accent** 标签 —— 它是一句断言,不是装饰
 *
 * `Tag` 的 accent 档在设计语言里**只用于「当前 / 选中」**(见 `components/Tag.tsx`)。
 * 于是外壳恒定挂着 `acme-prod`,读作「你现在操作的是 acme-prod」——
 * 而运营后台本身是**跨租户**的:配额屏自己有一个租户选择器、租户详情屏打开的是
 * 被点的那一个。两处随时可以指着不同的租户,而外壳那句话看起来更权威:
 * 它在最上面,且从不变。
 *
 * 管理员会照着它截图进工单、照着它确认「我是在正确的租户里做的这次停用」——
 * 与写死的 `req_7c12de40b1` 同族:**一条具体的、可被引用的假证据**。
 * ⇒ 提成必填的 {@link ShellProps.scope};**`null` 是一等形态**,表示
 * 「此刻不在任何单一租户的作用域里」,那时这个标签根本不渲染。
 * 少说一句,好过说一句不知真假的。
 *
 * ## 🚨 二、头像里的 `AD` 写死 —— 界面对每一个登录者说同一句「你是谁」
 *
 * 运营后台的每个动作都进 `@dshwar/audit`,记的是**调用者**(CLAUDE.md §七)。
 * 顶栏那两个字母是用户核对「我是以谁的身份在做这件事」的唯一入口 ——
 * 写死之后它与审计里那一行**必然**对不上,而只有事后翻审计的人会发现。
 * ⇒ {@link ShellAccount} 必填,且**同时**要全名:两个字母不足以确认身份,
 * 全名进 `title` / `aria-label`。
 *
 * ## 🚨 三、两个点不动的入口:头像与「获取帮助」
 *
 * 原版头像是一个 `<span>`;「获取帮助」是一个没有 `onClick` 的 `<Button>` ——
 * 它有 `cursor: pointer`、有 hover 底色,点下去什么都不发生,而调用方连
 * 「有人点了」都收不到。**空回调与「没有这个入口」在代码里长得很像,
 * 在界面上完全不同:后者不会让人点第二次。**
 * ⇒ 两者都只在对应 handler 在场时才成为可点控件;`onHelp` 缺席时**不画**这个按钮。
 *
 * ⚠️ 左侧导航是例外:`onNavigate` 缺席时照画。导航项除了跳转,还在**指示位置**
 * (哪一屏是当前),那一层信息不依赖点击。「获取帮助」没有这一层 ——
 * 它除了被点没有别的作用,接不住就不该画。
 *
 * ## 🚨 四、「有数据 / 空状态」「逻辑档 / 进程档」是**设计走查的开关**,不是平台设置
 *
 * 它们长在真实顶栏里、与主题开关并排,三个控件一模一样,读起来就是三项平台设置。
 * 「逻辑档 / 进程档」尤其危险:**隔离级别不是配置偏好,是安全等级**
 * (CLAUDE.md §七),它由 profile 决定、切换要重启进程。管理员按一下,
 * 界面立刻翻成进程档,而服务端一个字节都没变 —— 一张关于**安全等级**的假回执。
 *
 * ⇒ 两个开关收进 {@link ShellPreview},且 `preview` **必填**:
 * 生产宿主必须显式写 `preview={null}`。分组不是为了整洁,是让「我不要演示开关」
 * 成为一句**写出来的话**,而不是一次遗漏。主题开关不在其中 ——
 * 深浅色是真实的用户偏好,不是走查装置。
 *
 * ⚠️ {@link ShellPreview.isolation} 与 `capacity.ts` 的 `CapacityReading.isolation`
 * 是**同一件事的两处显示**,一致性由调用方保证(与产物屏「预览必须属于选中行」
 * 同一条约束)。所以这里的类型直接取自那一处,不另写一份 `'logical' | 'process'` ——
 * 一份联合抄两遍就是两个来源,而这一版刚为同一个理由拆掉五个默认值。
 *
 * ## ⚠️ 五项客户配置到不了界面
 *
 * `LogoSlot` 收 `src` / `srcDark`,`PlatformFooter` 收 `privacyUrl` / `termsUrl` / `year`,
 * 而原版一项都不传:白牌客户配了徽标与条款链接,**在运营后台里永远看不到**
 * (徽标静默退回 productName 的 wordmark),版权行则恒为组件默认的 `2026` ——
 * 与总览屏「计费周期写死八月,到九月仍显示八月」同族,只是慢了一整年才发作。
 * ⇒ {@link ShellBranding} 补齐这五项。可空的一律 `string | null`,
 * `null` 的含义是「客户没配」,不是「调用方忘了传」—— 后者现在是编译错误。
 *
 * ## 导航是**闭集**,不是 prop
 *
 * {@link CONSOLE_NAV} 与控制台的路由是同一个集合:多一项少一项都要连路由一起改,
 * 而不是由宿主传一个数组进来。与 `WorkbenchShell` 的五个 tab 同一条理由。
 *
 * ## 空态:主区没有内容时说一句话
 *
 * 一个全空的主区,与「CSS 没加载」「子树渲染抛了异常被吞掉」在屏幕上完全一样。
 * 所以 `children` 为空时渲染一行朴素说明。朴素是刻意的:
 * **空不是错误,不该长得像错误。**
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
import type { CapacityReading } from './capacity.ts'

/** 左侧导航能到达的屏。`settings` 不在 `CONSOLE_NAV` 里,它在分隔线之下单列。 */
export type ConsoleScreenId =
  'overview' | 'tenants' | 'members' | 'models' | 'billing' | 'audit' | 'settings'

export interface ConsoleNavItem {
  readonly id: ConsoleScreenId
  readonly label: string
  /** Lucide 图标名 */
  readonly icon: string
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

/**
 * 分隔线之下那一项。提成模块常量而不是在 JSX 里现拼 ——
 * 现拼的话每次渲染都是一个新对象,而它一辈子都不会变。
 */
const SETTINGS_NAV: ConsoleNavItem = { id: 'settings', label: '品牌与外观', icon: 'palette' }

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
  /**
   * 当前值。**必填** —— 一个哪一段都不选中的分段控件,说的是
   * 「界面不知道自己处在哪一档」,而它长得与「处在某一档」几乎一样。
   */
  value: T
  onChange: (id: T) => void
}

/** 顶栏的分段开关(浅色 / 深色、以及 {@link ShellPreview} 里那两个)。kit 里无 hover 态。 */
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

/** 浅色 / 深色。**闭集**,没有「跟随系统」档 —— 那一档要由宿主先解析成这两个之一。 */
export type ShellTheme = 'light' | 'dark'

/** 演示开关里的「有数据 / 空状态」。**闭集**,只有走查宿主认识它。 */
export type ShellDataState = 'data' | 'empty'

/**
 * 隔离档。**类型取自 `CapacityReading`,不另写一份联合** ——
 * 两处显示同一件事,写两遍就是两个来源,而其中一处早晚会漏掉新加的档。
 */
export type ShellIsolation = CapacityReading['isolation']

const THEME_OPTIONS: readonly SegOption<ShellTheme>[] = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
]

const DATA_STATE_OPTIONS: readonly SegOption<ShellDataState>[] = [
  { id: 'data', label: '有数据' },
  { id: 'empty', label: '空状态' },
]

const ISOLATION_OPTIONS: readonly SegOption<ShellIsolation>[] = [
  { id: 'logical', label: '逻辑档' },
  { id: 'process', label: '进程档' },
]

/**
 * 品牌配置的**表现层**投影。字段与配置契约一一对应,可空的一律 `string | null`。
 *
 * ⚠️ 没有一个字段有默认值。默认值在这里是**第二个事实源**:
 * 漏传 `legalEntityName`,声明带会显示一个像模像样的名字而没有任何东西会红;
 * 必填之后漏传是**编译错误** —— 那是最早、最响的一种失败。
 * 客户确实没配的,传 `null`,那是一种**受支持的完整形态**(见 `PlatformFooter`
 * 的 NEUTRAL_BRANDING),与「忘了传」在类型上就分得开。
 */
export interface ShellBranding {
  /** 契约 productName,给 LogoSlot 作 alt 与文字回落 */
  readonly productName: string
  /** 契约 legalEntityName,给平台声明带;null → 隐藏版权行。⚠ 界面显示用,不进发票 */
  readonly legalEntityName: string | null
  /**
   * 契约 logoLight 的 `AssetRef.path`,**不是 URL**,组件内不拼串。
   * null → 回落到 productName 的 wordmark。
   */
  readonly logoPath: string | null
  /** 契约 logoDark 的 `AssetRef.path`;null → 深色下沿用 {@link logoPath},不做自动反色。 */
  readonly logoDarkPath: string | null
  /** 契约 privacyPolicyUrl;null → 声明带里不出现这条链接。 */
  readonly privacyUrl: string | null
  /** 契约 termsOfServiceUrl;null → 同上。 */
  readonly termsUrl: string | null
  /**
   * 版权年份。必填是因为组件层的默认值会**过期**:一个写死的年份到了明年
   * 仍在页脚上说去年,而没有任何东西会红。
   */
  readonly copyrightYear: number
}

/**
 * 顶栏右上角的「我是谁」。
 *
 * 两个字段都必填,且**不是一个字段**:头像里放得下的两个字母不足以确认身份,
 * 而全名放不进 24px 的圆。缩写由调用方截 —— 截取规则各语言不同,
 * 设计系统猜一个出来只会在某些语言上猜错。
 */
export interface ShellAccount {
  /** 头像里那一到两个字母,**调用方已截好**。 */
  readonly initials: string
  /** 完整身份(姓名 / 邮箱),进 `title` 与 `aria-label`,供用户核对。 */
  readonly name: string
}

/**
 * 设计走查用的两个演示开关。**真实部署一律传 `preview={null}`。**
 *
 * 🚨 它们不是平台设置:切换「逻辑档 / 进程档」不会改变任何服务端状态,
 * 而界面会立刻表现得像改了。隔离档是安全等级(CLAUDE.md §七),
 * 一张关于安全等级的假回执比一条错误的数字贵得多。
 *
 * 值必填、handler 可选:接不住的那一段**不渲染**,不画一个按了没反应的开关。
 */
export interface ShellPreview {
  readonly dataState: ShellDataState
  readonly onDataState?: (state: ShellDataState) => void
  /** ⚠️ 必须与同屏 `CapacityReading.isolation` 是同一个值,一致性由调用方保证。 */
  readonly isolation: ShellIsolation
  readonly onIsolation?: (isolation: ShellIsolation) => void
}

export interface ShellProps {
  readonly branding: ShellBranding
  /** 当前屏,决定左侧导航哪一项呈选中 */
  readonly screen: ConsoleScreenId
  /** 深浅色。必填 —— 它同时决定取哪一版徽标,猜错就是把客户的深色徽标换掉。 */
  readonly theme: ShellTheme
  /**
   * 顶栏那个 accent 标签:**当前作用域的租户标识**,如 `'acme-prod'`。
   *
   * `null` = 此刻不限定在单一租户上(跨租户的总览、租户列表……),那时不渲染标签。
   * 🚨 不要为了「好看一点」随便填一个:accent 档读作「当前 / 选中」,
   * 它会被截图进工单,当成这次操作发生在哪个租户的证据。
   */
  readonly scope: string | null
  readonly account: ShellAccount
  /** 走查开关。生产环境传 `null`;必填是为了让这个决定被**写出来**。 */
  readonly preview: ShellPreview | null
  readonly children?: React.ReactNode
  /** 缺席时导航仍然渲染 —— 它同时是位置指示,不只是跳转入口。 */
  readonly onNavigate?: (id: ConsoleScreenId) => void
  /** 缺席即不渲染主题分段控件。 */
  readonly onTheme?: (theme: ShellTheme) => void
  /** 缺席时头像仍显示(它是身份指示),但不是按钮 —— 不画点了没反应的控件。 */
  readonly onAccount?: () => void
  /** 缺席即不渲染「获取帮助」:那个按钮除了被点没有别的作用。 */
  readonly onHelp?: () => void
}

export function Shell({
  branding,
  screen,
  theme,
  scope,
  account,
  preview,
  children,
  onNavigate,
  onTheme,
  onAccount,
  onHelp,
}: ShellProps): React.JSX.Element {
  // `LogoSlot` 的 src / srcDark 是 `string | undefined`,而这里的缺失是 `null`;
  // exactOptionalPropertyTypes 下不能写 `src={x ?? undefined}`(显式 undefined 也不接受),
  // 所以按「有才带上这个键」拼一次。
  const logo: { src?: string; srcDark?: string } = {}
  if (branding.logoPath !== null) logo.src = branding.logoPath
  if (branding.logoDarkPath !== null) logo.srcDark = branding.logoDarkPath

  // `false` 也算空:宿主写 `{cond && <Screen />}` 时给过来的就是它。
  const hasContent = children !== undefined && children !== null && children !== false

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
        <LogoSlot {...logo} name={branding.productName} theme={theme} context="topbar" />
        <span style={{ width: 1, height: 18, background: 'var(--n-200)' }} />
        {/* 「运营后台」命名的是**这个应用**,不是客户 —— 白牌换掉的是徽标与法人名,
            不是「这是运营后台」这件事。所以它不是 prop。 */}
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
          {preview === null ? null : (
            <>
              {preview.onDataState === undefined ? null : (
                <Seg
                  value={preview.dataState}
                  onChange={(id) => preview.onDataState?.(id)}
                  options={DATA_STATE_OPTIONS}
                />
              )}
              {preview.onIsolation === undefined ? null : (
                <Seg
                  value={preview.isolation}
                  onChange={(id) => preview.onIsolation?.(id)}
                  options={ISOLATION_OPTIONS}
                />
              )}
            </>
          )}
          {onTheme === undefined ? null : (
            <Seg value={theme} onChange={(id) => onTheme?.(id)} options={THEME_OPTIONS} />
          )}
          {/* 租户标识是标识串 → mono(`Tag` 自己的规则)。null 时整个标签不出现,
              而不是显示一个「—」:占位符会被读成「这里本该有个租户」。 */}
          {scope === null ? null : (
            <Tag tone="accent" mono>
              {scope}
            </Tag>
          )}
          {onHelp === undefined ? null : (
            <Button
              variant="ghost"
              size="compact"
              icon="life-buoy"
              onClick={() => {
                onHelp?.()
              }}
            >
              获取帮助
            </Button>
          )}
          <Avatar account={account} onAccount={onAccount} />
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
                onNavigate?.(n.id)
              }}
            />
          ))}
          <div
            style={{ height: 1, background: 'var(--border-hairline)', margin: 'var(--s-4) 0' }}
          />
          <NavItem
            item={SETTINGS_NAV}
            active={screen === SETTINGS_NAV.id}
            onClick={() => {
              onNavigate?.(SETTINGS_NAV.id)
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
          {hasContent ? children : <EmptyMain />}
        </main>
      </div>
      <PlatformFooter
        legalEntityName={branding.legalEntityName}
        privacyUrl={branding.privacyUrl}
        termsUrl={branding.termsUrl}
        year={branding.copyrightYear}
      />
    </div>
  )
}

interface AvatarProps {
  account: ShellAccount
  /**
   * 省略 = 这个部署没有「我的账户」入口,那时它只是身份指示,不是按钮。
   *
   * ⚠️ 显式写出 `| undefined`(公开的 {@link ShellProps.onAccount} 没有):
   * `exactOptionalPropertyTypes` 下「可省略」不等于「可以传 undefined」,
   * 而这里正是把上一层那个可选值原样透下来。**这是内部形状,不是给调用方的松口。**
   */
  onAccount?: (() => void) | undefined
}

/**
 * 顶栏右上角的头像。
 *
 * 两种形态共用同一副外观,差别只在**它是不是一个可点的东西** ——
 * 这正是原版丢掉的那一层:一个永远不可点的 `<span>` 与一个接了线的按钮,
 * 在截图里一模一样,在用上去的时候完全不同。
 */
function Avatar({ account, onAccount }: AvatarProps): React.JSX.Element {
  const face: React.CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: 'var(--r-full)',
    background: 'var(--n-800)',
    color: 'var(--n-050)',
    display: 'grid',
    placeItems: 'center',
    font: 'var(--fw-medium) 10px/1 var(--font-sans)',
  }
  if (onAccount === undefined) {
    return (
      <span style={face} title={account.name}>
        {account.initials}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-label={account.name}
      title={account.name}
      onClick={() => {
        onAccount?.()
      }}
      style={{ ...face, border: 'none', padding: 0, cursor: 'pointer' }}
    >
      {account.initials}
    </button>
  )
}

/**
 * 主区没有内容时的那一行字。
 *
 * 刻意朴素:没有图标、没有边框、没有 accent。**空不是错误,不该长得像错误** ——
 * 而一片纯白的主区连「空」都说不出口,它与样式没加载、子树抛异常被吞掉长得一样。
 */
function EmptyMain(): React.JSX.Element {
  return (
    <span
      style={{
        font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
        color: 'var(--text-tertiary)',
      }}
    >
      这一屏没有内容。
    </span>
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
