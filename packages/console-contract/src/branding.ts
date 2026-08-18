/**
 * 租户品牌(白牌)—— 运行期主题的配置契约。
 *
 * 完整的清单、每一项的理由、以及**刻意不开放的那些**,见
 * `docs/DECISIONS/branding-variables.md`。这里只放形状与最要紧的约束。
 *
 * ## 🚨 应用图标不在此列 —— 这是决策的直接后果,不是遗漏
 *
 * 界面内的一切都能换(logo / 主色 / 产品名 / favicon),但**操作系统层面的
 * 应用图标**(任务栏、程序坞、开始菜单、安装程序)换不了 —— 它烧在安装包里,
 * 而既定决策是「安装包永远中性,**一个二进制服务所有租户**」。
 * 一个二进制就只有一个应用图标,运行期主题改不到那一层。
 *
 * 客户要自己的应用图标,唯一的路是**白牌构建 + 客户自己签名**
 * (界面挂谁的品牌,签名主体就该是谁)。
 *
 * ⚠️ **这不是「以后支持」。** 除非推翻「一个二进制服务所有租户」,
 * 否则它永远是这样 —— 别把它记成待办。
 *
 * ## 全部字段只影响显示层
 *
 * 没有任何一个参与权限判定。一旦有代码按 `productName` 分支,
 * 白牌就从换肤变成了分叉 —— 而分叉出来的那一支没人测。
 *
 * ## 不在这里的东西同样是决策
 *
 * 隔离档警告、模型降级提示、错误码、审计词表、上游归属声明、开源许可
 * **刻意不可替换**。判据只有一条:**这段内容是为了保护用户,还是为了展示品牌?**
 * 前者不可换 —— 而想改它的人,通常正是最不该改它的那个人。
 *
 * @module @dshwar/console-contract/branding
 */

/**
 * 控制平面内的资产引用。**不是 URL。**
 *
 * 不接受外链的第一条理由(企业安全评审会直接问的那条):
 * **外链等于向那台服务器报告客户每个员工的每次访问** —— IP、UA、时间、
 * 频次全都过去,而在托管白牌形态下那台服务器就是我方。
 * 自托管之后请求落在客户已经信任并部署了的系统上,评审无从问起。
 *
 * 另外三条:离线部署下外链是碎图标(V0.6.5 的核心卖点)、
 * CSP 白名单与「租户可填任意 URL」天然冲突、外链资产可被持有方随时替换。
 */
export interface AssetRef {
  readonly id: string
  /**
   * 由控制平面提供的相对路径,直接给 `<img src>` 用。
   *
   * ⚠️ **前端不要自己拼这个字符串** —— 拼接会把「资产放在哪」这个知识
   * 复制到每个用它的组件里,而三个宿主(远端 Web / 本地 sidecar / Tauri)
   * 的答案不一样。
   */
  readonly path: string
}

/**
 * 一个租户的品牌配置。
 *
 * ## 未配置 = 中性 DSHWAR 外观
 *
 * 那**不是**「半成品状态」,是一个完整的、受支持的形态 ——
 * 开源自建模式的默认就是它。
 */
export interface TenantBranding {
  /**
   * 产品名。影响浏览器标题、顶栏 wordmark、关于页、空状态文案。
   *
   * ⚠️ 两条约束,**都必须在写入时校验并拒绝**,而不是渲染时过滤 ——
   * 拒绝发生在管理员面前,过滤发生在最终用户面前,前者能改后者不能:
   *
   * 1. **不得含 "DeepSeek"**(CLAUDE.md 第九节:对上游的引用限于指名性使用)
   * 2. 商标尽调是**客户的法律责任** —— 我们既不知道客户在哪些法域经营,
   *    也不知道他注册了什么。配置界面上要有一句话说明这一点
   */
  readonly productName: string
  /** 浅色主题的标志。 */
  readonly logoLight: AssetRef | null
  /**
   * 深色主题的标志。
   *
   * 为什么是独立字段而不是自动反色:自动反色对**单色标志**有效,
   * 对带渐变或摄影元素的标志会毁掉它 —— 而「深色背景上用另一版」
   * 是品牌方的常识,不是边缘情况。
   */
  readonly logoDark: AssetRef | null
  /**
   * 站点图标。**与 logo 分开**是因为宽高比与尺寸完全不同 ——
   * 横向 wordmark 自动裁成正方,通常只剩一个字母的一部分。
   *
   * ⚠️ 这是**浏览器标签页**的图标,不是操作系统的应用图标(见模块注释)。
   */
  readonly favicon: AssetRef | null
  /**
   * 品牌主色,`#RRGGBB`。
   *
   * ★ **只收种子色,色阶由客户端确定性派生** —— 派生算法不在契约里。
   * 放进契约等于允许两端各派生一套,而那两套迟早会不一样。
   *
   * ⚠️ **写入时校验对比度,不达标就拒绝保存**(WCAG AA ≥ 4.5:1),
   * 不要悄悄换一个近似色 —— 客户以为自己设了品牌色而看到的不是它,
   * 他会认为那是 bug。这与「认不出或不安全就拒,不降级服务」是同一条判据,
   * 只是这次「不安全」指的是**读不了**。
   */
  readonly primaryColor: string
  /** 次级强调色。留空则由主色派生。 */
  readonly accentColor: string | null
  /** 「获取帮助」的落点。与 {@link supportEmail} 至少给一个,否则用户求助无门。 */
  readonly supportUrl: string | null
  readonly supportEmail: string | null
  readonly docsUrl: string | null
  /**
   * 页脚版权行里的法律实体名。
   *
   * ⚠️ **只作界面显示,不进发票。** 发票的卖方是**另一个字段、另一个契约**
   * (`@dshwar/billing`),两者刻意不复用:这个填错只是页脚难看,
   * 那个填错是开错发票 —— 而发票是法律文件。
   */
  readonly legalEntityName: string | null
  readonly privacyPolicyUrl: string | null
  readonly termsOfServiceUrl: string | null
  /**
   * 认证入口页的主标题。
   *
   * ⚠️ **DSHWAR 不实现登录**(硬规则 4)。所谓「登录页」只是一个把用户送去
   * 客户自己 IdP 的入口页 —— IdP 的表单、密码规则、MFA 引导都不在我们的页面上。
   *
   * ⚠️ **V0.7.x 之前它在首屏不生效**:认证前服务端还不知道来者属于哪个租户,
   * 而裁决是**认证前保持中性**。见 {@link signInHandle}。
   */
  readonly signInHeadline: string | null
  readonly signInSubtext: string | null
  /**
   * 【预留,V0.7.x】租户专属登录入口的句柄。**V0.7.x 之前恒为 `null`。**
   *
   * ## 为什么认证前不挂品牌
   *
   * 登录前服务端不知道你是谁,**任何品牌化都必然泄漏点什么**:
   *
   * - 按 hostname 提供公开品牌端点 → **把租户列表变成可枚举资源**。
   *   对 ToB 产品,**客户名单本身就是敏感信息**
   * - 客户端缓存上次的品牌 → **把 A 公司的存在泄漏给共用设备上 B 公司的员工**
   *
   * 两者泄漏的都**不是我们的信息,是客户的客户名单** —— 不是我们有资格
   * 拿去换观感的东西。
   *
   * ## 这个字段是那条不泄漏的路
   *
   * 访问者通过 URL 本身声明了租户,于是可以直接套主题。
   *
   * ⚠️ **必须是随机不可猜的句柄,不能是公司名。** `/s/acme` 与 `/s/globex`
   * 一样可枚举 —— 那只是把「猜 hostname」换成了「猜路径」。
   * 由**服务端生成**(自选就会有人选 `acme`),且**可轮换**(泄漏了要能换掉)。
   *
   * ## 为什么现在就预留
   *
   * 预留一个字段的成本是一行;而事后加一个**会改变 URL 空间**的字段,
   * 要动路由、部署文档、以及客户已经发出去的链接。
   */
  readonly signInHandle: string | null
}

/**
 * 未配置任何品牌时的中性外观。
 *
 * ⚠️ 这是**受支持的形态**,不是缺省的半成品 —— 开源自建模式的默认就是它。
 */
export const NEUTRAL_BRANDING: TenantBranding = {
  productName: 'DSHWAR',
  logoLight: null,
  logoDark: null,
  favicon: null,
  primaryColor: '#2F6FEB',
  accentColor: null,
  supportUrl: null,
  supportEmail: null,
  docsUrl: null,
  legalEntityName: null,
  privacyPolicyUrl: null,
  termsOfServiceUrl: null,
  signInHeadline: null,
  signInSubtext: null,
  signInHandle: null,
}

/**
 * 标志的三级回落:深色 → 浅色 → **文字 wordmark**。
 *
 * ★ **最后一级是关键**:两个标志都没传时回落到产品名的文字,
 * **而不是 DSHWAR 的标志** —— 一个只填了产品名的租户,
 * 界面上不该出现我们的标志。
 *
 * @param theme 当前主题
 * @returns 要显示的资产;`null` 表示调用方应当渲染 `productName` 的文字 wordmark
 */
export function logoFor(branding: TenantBranding, theme: 'light' | 'dark'): AssetRef | null {
  if (theme === 'dark') return branding.logoDark ?? branding.logoLight
  return branding.logoLight
}
