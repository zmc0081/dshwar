/**
 * 工作台的浏览器入口 —— **只做 DOM 那一步**。
 *
 * 装配全部在 `bootstrap.tsx`,理由写在那个文件顶部:一个在模块顶层就
 * 找 `#root`、建 root、渲染的入口**没法被测试调用**,于是每个测试
 * 都只能自己拼装一遍被测系统 —— 验的是「这么拼能工作」,
 * 不是「出厂真的这么拼」。
 *
 * ⇒ 这里剩下的两件事都是纯 DOM 动作,不含任何判断:
 * 找 `#root`,把真实的 `createRoot().render` 交给 {@link bootstrapWorkbench}。
 *
 * ⚠️ **别把配置读取搬回来。** `test/shipped-entry.test.ts` 有一条读源码的
 * 断言盯着这件事:本文件里除了下面这一次,不许再出现第二个装配点。
 *
 * @module @dshwar/workbench-web/main
 */
import { createRoot } from 'react-dom/client'
import { bootstrapWorkbench } from './bootstrap.tsx'
import './styles.ts'

const host = document.getElementById('root')
if (host === null) throw new Error('页面缺少 #root —— 宿主的 HTML 与预期不符')

const root = createRoot(host)
bootstrapWorkbench(window, document, (element) => {
  root.render(element)
})
