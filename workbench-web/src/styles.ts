/**
 * 设计系统样式的**唯一引入点**。
 *
 * ## 为什么要一个清单文件,而不是在 index.html 里写一串 `<link>`
 *
 * 设计系统有 8 份令牌 + 20 份组件样式 + 3 份屏幕样式,共 31 个 CSS。
 * 写成 `<link>` 的话:
 *
 * 1. **顺序是隐式的** —— 令牌必须先于用它们的组件样式加载,
 *    而 HTML 里那是一串看不出依赖关系的行;
 * 2. **漏一个不会报错**,只会让某个组件在某个状态下没样式 ——
 *    而那看起来像「设计稿就是这样」,不像缺文件;
 * 3. 三个宿主(远端 Web / sidecar / Tauri)各有各的 HTML 入口,
 *    清单写三遍就会分家。
 *
 * ⇒ 集中成一个模块:import 顺序即加载顺序,少一个立刻 build 报错。
 *
 * ⚠️ 组件只出 `className`,样式全在 CSS —— 交互态(hover / active /
 * focus-visible)因此天然落在伪类上而不是 JS 状态。
 * `check-guards.mjs` 有一条守卫盯着这件事。
 *
 * @module @dshwar/workbench-web/styles
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

// ---- 屏幕层。只有三处需要自己的样式(其余是一次性内联布局)----
import '@dshwar/design-system/styles/screens/workbenchshell.css'
import '@dshwar/design-system/styles/screens/toolcalls.css'
