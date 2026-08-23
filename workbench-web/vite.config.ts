/**
 * 工作台的开发服务器。
 *
 * ## 它**不**产出交付物
 *
 * `package.json` 的 `build` 仍是 `tsc -b`,产物在 `dist/`。这里只有
 * dev server —— 用来在真实浏览器里把八屏跑起来看。真正的打包(三宿主、
 * Tauri sidecar、原生模块)是 **Session 6 单独排的两周**,不在本 Session。
 *
 * 写清楚是因为「仓库里有 vite.config」通常意味着「产物由 vite 打」,
 * 而这里不是 —— 一个错误的推断会让人去找不存在的 vite 构建产物。
 *
 * ## 为什么需要打包器
 *
 * **React 19 只发 CJS**(`react-dom/index.js` 是 `require('./cjs/...')`),
 * 浏览器 `import` 不了,UMD 也不再提供。于是「import map 指向 node_modules」
 * 那条最省事的路是死的 —— 在 `packages/design-system` 上实测过。
 * Vite 的依赖预打包把 CJS 转成 ESM,顺带编 `.tsx`。
 *
 * ⚠️ 本文件在**包根**,不属于产品项目的 `include: ["src/**"]`。
 * 它被 `tsconfig.test.json` 收进去 —— 否则它整个不被类型检查,
 * 而 `check-guards.mjs` 的「包根的 .ts 都在某份 tsconfig 的 include 里」会红。
 * 那条守卫正是因为 design-system 的同名文件漏检才加的:
 * 打开类型检查的第一刻就抓到一个从未生效的配置项。
 */
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  server: {
    // 4321 是 design-system 实测台占的。两个 dev server 会同时开着。
    port: 4322,
    // 端口被占时**报错而不是换一个** —— 换端口会让自动化连到上一次的残留进程,
    // 而那时读到的是旧代码的行为,与「改动没生效」无法区分。
    strictPort: true,
    /**
     * 开发期把 `/v1` 代理到本地网关,让浏览器看到的是**同源**请求。
     *
     * ## 为什么需要它
     *
     * 网关不发 CORS 头。dev server 在 :4322、网关在 :8787,直接 fetch 会得到
     * `TypeError: Failed to fetch` —— 实测过,而且那个错误信息**不提 CORS**,
     * 与「网关没起来」长得一模一样。
     *
     * ## ⚠️ 这不是在掩盖一个将来的问题,但也没有解决它
     *
     * 三个宿主里前端与网关的同源关系各不相同:
     *
     * | 宿主 | 同源吗 |
     * | --- | --- |
     * | 远端 Web | ✅ 前端由同一个服务提供 |
     * | 本地 sidecar | ✅ 同上 |
     * | **Tauri** | ❌ 前端是 `tauri://localhost`,网关是 `http://127.0.0.1:<port>` |
     *
     * 第三行是**真问题**,但它的解法在 Tauri 那一侧(HTTP 允许清单),
     * 不是给网关加 CORS —— 那会给远端部署开一个不需要的口子。
     * 归 Session 5,记在这里免得那时重新发现一遍。
     */
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  },
})
