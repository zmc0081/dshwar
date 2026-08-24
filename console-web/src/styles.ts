/**
 * 设计系统样式的**唯一引入点**。
 *
 * ## 为什么要一个清单文件,而不是在 index.html 里写一串 `<link>`
 *
 * 与 `workbench-web/src/styles.ts` 同一份理由(顺序是隐式的 · 漏一个不报错 ·
 * 三个宿主各有各的 HTML 入口),去读那个文件。这里只记**与它不同**的一处:
 *
 * > 屏幕层只有 `screens/shell.css` —— 控制台九屏里,**只有 `Shell` 的左侧导航
 * > 有 JS 之外的交互态**(`:hover` / `:focus-visible`)。其余屏幕的 `style={{}}`
 * > 都是一次性布局,做成类会产生几百个只用一次的类。
 *
 * ⚠️ 判据是「有没有伪类要表达」,不是「屏幕大不大」。哪天某一屏加了
 * hover 态,它就必须同时加一份 CSS —— 用 JS 状态表达 hover 是
 * `check-guards.mjs` 明确禁掉的写法(`onMouseEnter` 族)。
 *
 * ⚠️ **组件层一个不能少,即使这一版某个组件没被用到。**
 * 少一个的表现是「某个组件在某个状态下没样式」,而那看起来像
 * 「设计稿就是这样」,不像缺文件 —— 这正是不写 `<link>` 清单的理由本身。
 *
 * @module @dshwar/console-web/styles
 */

// ---- 令牌层。必须最先,后面所有 var() 都来自这里 ----
import '@dshwar/design-system/styles/neutral.css'
import '@dshwar/design-system/styles/semantic.css'
import '@dshwar/design-system/styles/accent.css'
import '@dshwar/design-system/styles/space.css'
import '@dshwar/design-system/styles/typography.css'
import '@dshwar/design-system/styles/fonts.css'
import '@dshwar/design-system/styles/elevation.css'
import '@dshwar/design-system/styles/chart.css'

// ---- 组件层 ----
import '@dshwar/design-system/styles/components/auditline.css'
import '@dshwar/design-system/styles/components/button.css'
import '@dshwar/design-system/styles/components/card.css'
import '@dshwar/design-system/styles/components/checkbox.css'
import '@dshwar/design-system/styles/components/coderef.css'
import '@dshwar/design-system/styles/components/credentialtag.css'
import '@dshwar/design-system/styles/components/degradenotice.css'
import '@dshwar/design-system/styles/components/icon.css'
import '@dshwar/design-system/styles/components/iconbutton.css'
import '@dshwar/design-system/styles/components/input.css'
import '@dshwar/design-system/styles/components/logoslot.css'
import '@dshwar/design-system/styles/components/metric.css'
import '@dshwar/design-system/styles/components/monogram.css'
import '@dshwar/design-system/styles/components/platformfooter.css'
import '@dshwar/design-system/styles/components/quarantinebanner.css'
import '@dshwar/design-system/styles/components/quotabar.css'
import '@dshwar/design-system/styles/components/select.css'
import '@dshwar/design-system/styles/components/table.css'
import '@dshwar/design-system/styles/components/tag.css'
import '@dshwar/design-system/styles/components/wordmark.css'

// ---- 屏幕层。控制台只有外壳需要自己的样式,理由见模块注释 ----
import '@dshwar/design-system/styles/screens/shell.css'
