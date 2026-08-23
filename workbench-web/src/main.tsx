/**
 * 工作台的浏览器入口。
 *
 * ## 三个宿主的差别只有这个文件
 *
 * V0.7.0 的已定决策是「一份 React 代码,三个宿主,**差别只有 baseURL**」。
 * 这里就是那个差别落地的地方:`baseUrl` 与 `token` 从**运行期配置**读,
 * 而不是编译进产物。
 *
 * | 宿主 | baseUrl 从哪来 |
 * | --- | --- |
 * | 远端 Web | 部署时注入的 `window.__DSHWAR_CONFIG__` |
 * | 本地 sidecar | 同上,值是 `http://127.0.0.1:<port>` |
 * | Tauri | 壳注入,值同上 —— **不能推断**,`tauri://localhost` 不是网关 |
 *
 * ⚠️ **不从 `window.location` 推断。** 推断在远端能用、在 Tauri 里指到
 * `tauri://localhost/v1/...`,而那时报出来的是一句无关的网络错误。
 *
 * ## 品牌也是运行期的
 *
 * 白牌走运行期主题,安装包永远中性 —— 一个二进制服务所有租户。
 * 所以 `productName` / `legalEntityName` 与 baseUrl 走同一条注入通道。
 *
 * @module @dshwar/workbench-web/main
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { createWorkbenchApi } from './api.ts'
import './styles.ts'

/** 运行期注入的配置。宿主在加载本模块**之前**把它挂上。 */
export interface RuntimeConfig {
  readonly baseUrl: string
  readonly token: string
  readonly productName: string
  readonly legalEntityName: string
}

declare global {
  interface Window {
    __DSHWAR_CONFIG__?: Partial<RuntimeConfig>
  }
}

/**
 * 读运行期配置。
 *
 * ⚠️ **缺 `baseUrl` 或 `token` 一律拒绝启动**,不给默认值。
 *
 * 给默认值(比如同源、或空 token)会让失败推迟到第一次请求 ——
 * 那时的症状是「界面空白」或「一直转圈」,而真正的原因是配置没注入。
 * 与硬规则 6 的 fail closed 同一条:**缺前提就停下,不要猜一个继续跑。**
 */
export function readConfig(raw: Partial<RuntimeConfig> | undefined): RuntimeConfig {
  const missing: string[] = []
  if (raw?.baseUrl === undefined || raw.baseUrl === '') missing.push('baseUrl')
  if (raw?.token === undefined || raw.token === '') missing.push('token')
  if (missing.length > 0) {
    throw new Error(
      `运行期配置缺少 ${missing.join(' / ')} —— 宿主必须在加载前挂上 window.__DSHWAR_CONFIG__。\n` +
        '没有默认值是刻意的:一个「默认同源」的默认值会让 Tauri 里的失败推迟到运行时。',
    )
  }
  return {
    baseUrl: raw?.baseUrl ?? '',
    token: raw?.token ?? '',
    // 品牌可以缺 —— 缺了就是中性外观,那是**合法状态**而不是配置错误。
    productName: raw?.productName ?? 'DSHWAR',
    legalEntityName: raw?.legalEntityName ?? '',
  }
}

const host = document.getElementById('root')
if (host === null) throw new Error('页面缺少 #root —— 宿主的 HTML 与预期不符')

const config = readConfig(window.__DSHWAR_CONFIG__)

createRoot(host).render(
  <StrictMode>
    <App
      api={createWorkbenchApi({ baseUrl: config.baseUrl, token: config.token })}
      branding={{ productName: config.productName, legalEntityName: config.legalEntityName }}
    />
  </StrictMode>,
)
