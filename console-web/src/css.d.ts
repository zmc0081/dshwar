/**
 * CSS 副作用导入的环境声明。
 *
 * 与 `workbench-web/src/css.d.ts` 同一份理由,不复述:`moduleResolution: nodenext`
 * 解析不了 `.css`,而这条声明只说「它可以被副作用导入,没有导出」——
 * `import styles from './x.css'` 仍然是编译错误。
 *
 * ⚠️ **两个前端各有一份,是刻意的**:`.d.ts` 的作用域是项目,
 * 不跨 project reference 生效。抽到公共包里反而要让两个项目都把它
 * 收进 `types` 或 `include`,那是更容易漏的一种耦合。
 *
 * @module @dshwar/console-web/css
 */
declare module '*.css'
