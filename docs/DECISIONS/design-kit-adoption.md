# 设计 kit 的采用方式:移植 `.jsx`,不照 `.prompt.md` 重写

日期:2026-08-22(V0.9.0 Session 0)· 状态:已裁决 · 关联:D7

> 交付物:Claude Design 产出的 22 屏 / 3 kit、21 组件(各带 `.d.ts` + `.prompt.md`)、
> 24 张规范卡、6 模板、tokens(CSS 变量 + `derive-accent.js`)、`checks/no-fixed-layers.js`。
>
> **要回答的是**:这些 `.jsx` 能不能当实现起点?
> 答案决定 Session 1 是「搭骨架」还是「移植 kit」—— 工作量差一个数量级。

---

## 裁决 1:`.jsx` 作实现起点

判据是实测的:

| 判据                | 实测                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 组件层模块形态      | **20/20 是真 ES 模块**(`import React` + 相对 import)                                                                                     |
| 屏幕层模块形态      | 26/26 用 `window.DSHWARDesignSystem_264a5f` 解构 —— **只有第一行**                                                                       |
| D7 三条约束的违规   | **0** —— `localStorage` / browser router / 直接 `fetch` / `window.location` 全为 0                                                       |
| 类型                | **20 个 `.d.ts`,286 行真 TS 声明**,精确联合类型 + JSDoc                                                                                  |
| 与仓库契约的关系    | `tokens/derive-accent.js` 与 `console-contract/src/branding.ts` **是同一套算法**:中亮带 `[0.55, 0.80]`、RE-LIT / VERBATIM、14 次二分钳制 |
| `.prompt.md` 是什么 | 每个约 **14 行的用法规则**,不是实现规格                                                                                                  |

**决定性的是最后一行。** `.prompt.md` 写的是「一屏一个 primary」「禁用态 2.15:1
刻意 < 3.0」「表格行内不放 primary」这类**规则**;而 `.jsx` 里是这些规则
**已经落成的像素与 token 决策**。照 prompt 重写 = 把已经做完的推导重做一遍,
而且做不回原样。

⇒ **Session 1 是「移植 kit」,不是「搭骨架」。**
规模:组件 748 行 + 屏幕 2589 行 + 类型 286 行 + tokens 316 行 CSS。

---

## 裁决 2:三笔账在移植时一次付清

| 账                       | 现状                                                                      | 为什么不能拖                                          |
| ------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| **全内联样式**           | 3337 行全是 JS style 对象;hover / active / focus 走 React state           | 见下,这是唯一一笔**架构债**                           |
| **`.jsx` → `.tsx`**      | 仓库是 strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` | 机械转换;20 个 `.d.ts` 已把签名写好                   |
| **屏幕层的 window 全局** | 26 个文件各一行                                                           | 现在换零成本;拖到后面要在几十个已改过的文件里再找一遍 |

### 为什么内联样式那笔必须付

**它让设计语言里明写的可达性规则在实现里落不了地。**

规范卡写着焦点环 = `accent.border` 2px + 2px offset,≥3:1 于画布,
并且「键盘可达性不依赖颜色差异」。而内联样式只有 `onFocus` / `onBlur` ——
**没有 `:focus-visible`**,于是鼠标点击也会显示焦点环。
焦点环一旦对鼠标用户也常亮,它就不再是键盘通道的指示,那条规则名存实亡。

第二条同样致命:**内联样式写不了媒体查询**。
Tauri 桌面窗口可缩放,而工作台是三栏布局 —— 没有断点就没有三栏。

其余代价:每次 hover 一次 re-render;触屏上 `onMouseEnter` 语义不对。

⇒ 迁移时改成 **CSS 类 + `:hover` / `:active` / `:focus-visible`**,
token 仍走 CSS 自定义属性(那一层本来就是对的)。

**谁盯着它**:`check-guards.mjs` 的「前端不得用 JS style 对象承载
hover / active / focus」守卫 —— 否则移植完了,下一个人会照着旧 kit 的写法加组件。

---

## 顺带确认的两件

1. **kit 与仓库有一处演示值分歧**:`SKILL.md` 用 `#3A5CCC` 当演示种子,
   仓库的 `SUGGESTED_PRIMARY_COLOR` 是 `#1D5BD4`。两者都只是演示值,
   中性态(`primaryColor: null`)双方一致 —— 但这正是
   [[design-system-sync]] 警告过的「两个副本、无自动同步」。
   ⇒ Session 1 验收项:**同一个种子,两边派生的六个角色令牌逐字节相同**。

2. **设计已经把三条既定约束画进去了**。`QuotasScreen` 自带通栏
   「策略执行层尚未接线 —— 本屏配置当前不生效」+ 全部写入控件 disabled +
   `501 NOT_IMPLEMENTED` 的 `CodeRef`,理由原文是「接上执行层之前先开放保存,
   会让策略被保存、被显示、却从不被查询——那比 501 危险得多」。
   与 [[comment-implementation-mismatch]] 的确认 ⑤ 完全一致。
