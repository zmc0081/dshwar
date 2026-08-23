/**
 * 实测台的开发服务器 —— **只服务 `test/` 下的实测页,不产出任何交付物**。
 *
 * ## 为什么需要它,而不能继续用 `scripts/serve.mjs`
 *
 * `serve.mjs` 是个零依赖静态服务器,够用于纯 CSS 的 `focus-visible.html`。
 * 但要挂**真实 React 树**就不行了:**React 19 只发 CJS**
 * (`react-dom/index.js` 是 `require('./cjs/react-dom.development.js')`),
 * 浏览器 `import` 不了,而 React 19 也不再提供 UMD 构建。
 * 于是「用 import map 指向 node_modules」这条最省事的路是死的 —— 实测过。
 *
 * ⇒ 必须有一个把 CJS 转成 ESM 的东西。Vite 做这件事(依赖预打包),
 * 顺带把 `.tsx` 也编了。
 *
 * ## 为什么是 Vite 而不是别的
 *
 * 1. 它**已经在依赖树里** —— Vitest 4 依赖它,`pnpm-lock.yaml` 里就是
 *    `vitest@4.1.10(vite@8.2.1)`。显式声明只是把传递依赖变成直接依赖,
 *    不引入新的东西。
 * 2. Session 5 的 Tauri v2 壳按官方模板就是 Vite ——
 *    现在选它,那时不用换。
 *
 * ⚠️ **本配置不参与任何构建产物。** `package.json` 的 `main` 仍指向
 * `tsc -b` 出的 `dist/`,`build` 脚本仍是 `tsc -b`。这里只有 dev server。
 * 写清楚是因为「仓库里有 vite.config」通常意味着「产物由 vite 打」,
 * 而这里不是 —— 一个错误的推断会让人去找不存在的 vite 构建产物。
 */
import { defineConfig } from 'vite'

export default defineConfig({
  // 根设在包目录:`test/*.html` 与 `src/styles/*.css` 的相对路径原样可用。
  root: import.meta.dirname,
  server: {
    port: 4321,
    // 实测要的是确定的端口 —— 端口被占时换一个,会让自动化连到上一次的残留进程。
    strictPort: true,
  },
  // 依赖预打包:把 react / react-dom 的 CJS 转成浏览器能 import 的 ESM。
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  },
  esbuild: {
    // tsconfig 里是 `jsx: react-jsx`,这里对齐 —— 否则实测页要手工 import React。
    jsx: 'automatic',
  },
})
