/**
 * CSS 副作用导入的环境声明。
 *
 * ## 为什么需要它
 *
 * `styles.ts` 用 `import '@dshwar/design-system/styles/xxx.css'` 把 31 份样式
 * 收在一处(理由见那个文件)。而 TypeScript 在 `moduleResolution: nodenext` 下
 * 解析不了 `.css` —— 它不是模块,没有类型。
 *
 * ⚠️ **这不是「关掉一个检查」。** 声明只说「`.css` 可以被 import,它没有导出」,
 * 于是 `import styles from './x.css'` 仍然是错的(它没有 default 导出),
 * 只有副作用导入合法。那正是本仓要的形态:组件只出 `className`,
 * 样式不从 TS 里取值 —— CSS-in-JS 那条路是被守卫明确禁掉的。
 *
 * @module @dshwar/workbench-web/css
 */
declare module '*.css'
