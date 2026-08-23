/**
 * Checkbox 键盘可达性实测台 —— **挂的是真实 React 树**。
 *
 * ## 它与前一版的差别
 *
 * V0.9.0 Session 1 的第一版是**手抄 DOM**:照 `Checkbox.tsx` 的输出
 * 逐属性写了一份等价的 HTML,再用原生 `addEventListener` 复刻了 `onKeyDown`。
 * 那一版验的是「这份 DOM 的键盘行为对」,**不是**「Checkbox 组件的键盘行为对」——
 * 两者之间隔着「我抄对了没有」这一步,而那一步没有任何东西盯着。
 *
 * Session 2 装上 `react-dom` 之后改成本文件:`createRoot` 渲染真实的
 * `<Checkbox>`,`onChange` 是组件自己调的,`tabIndex` 与 `onKeyDown`
 * 是组件自己给的。**手抄那一层没有了。**
 *
 * ## 仍然验不到的
 *
 * `:focus-visible` 要真实浏览器,jsdom 不实现它 —— 所以这条不能写成 vitest。
 * 见 `focus-visible.html` 顶部的说明。
 *
 * ⚠️ 本文件**不导出任何东西**,也不进 `src/`。它是实测台的入口,
 * 不是交付物 —— `tsconfig.json` 的 `include` 不含 `test/`。
 *
 * ---
 *
 * ## 实测记录(V0.9.0 Session 2 · 2026-08-23 · Chromium 1280×900)
 *
 * **五项结论与手抄版完全一致**,另有三条手抄版做不到的证据。
 *
 * | 项                        | 读数                                                              |
 * | ------------------------- | ----------------------------------------------------------------- |
 * | Tab 落在可用方块          | `onBox=true` · `fv=true` · ring = 白 2px + `#8E929A` 2px          |
 * | **Enter(真实按键)**      | `toggles 0→1` · `reactChecked=true` · `aria-checked false→true` · 页面不滚动 |
 * | 空格(合成,见下 ⚠️)       | `defaultPrevented=true` · 切换                                    |
 * | 其他键 `'a'`              | `defaultPrevented=false` · 不切换 ← 反向对照                       |
 * | **禁用方块的空格**        | `defaultPrevented=false` · 不切换 ← **手抄版做不到的对照**         |
 * | Tab 再按一次              | `activeElement=sentinel`,**跳过禁用方块**                         |
 * | 鼠标点击                  | `onBox=true` 而 `fv=false`、`box-shadow=none`,`toggles` 仍 +1     |
 *
 * ★ 手抄版拿不到的三条:①`tabIndex` / `role` / `aria-disabled` 是**组件给的**,
 * 不是我抄的(探针里 `boxTabIndex` / `boxRole` / `disabledAriaDisabled`);
 * ②禁用分支真的走到了(手抄版根本没抄那个分支);
 * ③`onChange` 回流到 React 状态 —— 组件与调用方之间那一跳被验到了。
 *
 * ⚠️ **空格仍是合成事件。** 驱动送不出真实空格,两种拼法都试过:
 * `key: 'space'` 到达元素时 `e.key === ""`;`key: 'Space'` 与 `type: ' '`
 * **完全不产生 keydown**。Session 1 记下这条局限时是这样,装上 react-dom 之后
 * 仍是这样 —— **是驱动的限制,不是组件的**。
 * 「浏览器真的因此不滚动」那一半由 Enter 分支用真实按键覆盖,两支只差一个字面量。
 */
import type * as React from 'react'
import { StrictMode, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Checkbox } from '../src/components/Checkbox.tsx'

/** 自动化读的探针。挂在 window 上,与手抄版同名同形 —— 实测脚本不用改。 */
declare global {
  interface Window {
    __dsCheckboxProbe?: Record<string, unknown>
    __dsProbeReady?: boolean
  }
}

const NONE = new Set(['none', '', 'rgba(0, 0, 0, 0) 0px 0px 0px 0px'])

/**
 * React 状态的**最新快照**,供 document 级监听读。
 *
 * ⚠️ 这一层是实测台第一版的 bug 修出来的,值得留着理由:
 * 焦点与点击不改 React 状态,所以它们的刷新走 document 监听 ——
 * 而那些监听是在 effect 里注册的,**闭包捕获的是注册那一刻的 state**。
 * 于是「累计 onChange 次数」永远显示注册时的旧值(实测里恒为 0),
 * 而那与「组件的 onChange 根本没被调用」在读数上**一模一样**。
 *
 * 差点据此判定组件坏了。用一个模块级快照绕开闭包,读的永远是当下。
 */
const latest = { checked: false, toggles: 0, label: '(初始)' }

function Harness(): React.JSX.Element {
  const [checked, setChecked] = useState(false)
  const [toggles, setToggles] = useState(0)
  const [lastLabel, setLastLabel] = useState('(初始)')

  // 每渲染一次同步一份快照 —— document 监听读它,不读闭包。
  latest.checked = checked
  latest.toggles = toggles
  latest.label = lastLabel

  const onChange = (next: boolean): void => {
    setChecked(next)
    setToggles((n) => n + 1)
    setLastLabel('组件的 onChange 被调用')
  }

  return (
    <>
      <h1 style={{ font: 'var(--fw-medium) 18px/1.4 var(--font-sans)' }}>
        Checkbox 键盘可达性实测台 · <strong>真实 React 树</strong>
      </h1>

      <ol style={{ maxWidth: '74ch', lineHeight: 1.7 }}>
        <li>
          点「起点」,按 <kbd>Tab</kbd> —— 焦点应落在<strong>可用</strong>方块上并出现焦点环。
        </li>
        <li>
          按 <kbd>空格</kbd> —— 应切换,且页面<strong>不滚动</strong>。
        </li>
        <li>
          再按 <kbd>Tab</kbd> —— 应<strong>跳过</strong>禁用方块,直接到「终点」。
        </li>
        <li>
          鼠标点可用方块 —— 应切换,但<strong>不出现</strong>焦点环。
        </li>
      </ol>

      <div
        style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'center', margin: '24px 0' }}
        id="row"
      >
        <button id="start" type="button">
          起点
        </button>
        <Checkbox id="box" checked={checked} label="可用" onChange={onChange} />
        <Checkbox id="boxDisabled" checked={false} label="禁用" disabled onChange={onChange} />
        <button id="sentinel" type="button" style={{ marginLeft: 8 }}>
          终点
        </button>
      </div>

      <Verdict checked={checked} toggles={toggles} label={lastLabel} />
    </>
  )
}

/**
 * 读一次 DOM 状态并写进探针。
 *
 * ⚠️ **必须在提交之后调**。第一版直接写在 `Verdict` 的渲染体里,
 * 于是 `document.getElementById('box')` 在首渲时是 `null` ——
 * React 还没把节点插进文档。探针里因此全是 `null`,
 * 而那与「组件没给 tabIndex」在读数上**长得一模一样**。
 */
function readDom(label: string): string {
  const { checked: checkedState, toggles } = latest
  const box = document.getElementById('box')
  const disabled = document.getElementById('boxDisabled')
  const sentinel = document.getElementById('sentinel')
  const active = document.activeElement

  const onBox = box !== null && active === box
  const ring = box === null ? 'none' : getComputedStyle(box).boxShadow
  const ringShown = onBox && !NONE.has(ring.trim())
  const fv = onBox && box !== null && box.matches(':focus-visible')

  window.__dsCheckboxProbe = {
    label,
    mounted: box !== null,
    onBox,
    onDisabled: disabled !== null && active === disabled,
    onSentinel: sentinel !== null && active === sentinel,
    fv,
    ring,
    ringShown,
    toggles,
    reactChecked: checkedState,
    checked: box?.getAttribute('aria-checked') ?? null,
    // ★ 下面四项是「真实 React 树」独有的证据:属性由组件给,不是我抄的。
    boxTabIndex: box?.getAttribute('tabindex') ?? null,
    disabledTabIndex: disabled?.getAttribute('tabindex') ?? null,
    boxRole: box?.getAttribute('role') ?? null,
    disabledAriaDisabled: disabled?.getAttribute('aria-disabled') ?? null,
  }

  return [
    '触发                     : ' + label,
    '',
    '── 组件给出的属性(不是抄的)──',
    '挂上了吗                 : ' + (box !== null),
    '可用方块  tabindex       : ' + (box?.getAttribute('tabindex') ?? '—'),
    '禁用方块  tabindex       : ' + (disabled?.getAttribute('tabindex') ?? '—'),
    'role                     : ' + (box?.getAttribute('role') ?? '—'),
    'aria-checked             : ' + (box?.getAttribute('aria-checked') ?? '—'),
    '',
    '── 实测 ──',
    '焦点在可用方块上         : ' + onBox,
    '焦点在禁用方块上         : ' + (disabled !== null && active === disabled),
    '焦点在「终点」上         : ' + (sentinel !== null && active === sentinel),
    ':focus-visible 命中      : ' + fv,
    'computed box-shadow      : ' + ring,
    '焦点环可见               : ' + ringShown,
    'React state.checked      : ' + checkedState,
    '累计 onChange 次数       : ' + toggles,
  ].join('\n')
}

function Verdict({
  checked,
  toggles,
  label,
}: {
  checked: boolean
  toggles: number
  label: string
}): React.JSX.Element {
  const [text, setText] = useState('(还没读)')

  // 提交之后读 —— 这是首渲拿不到节点的那一层。
  useLayoutEffect(() => {
    setText(readDom(label))
  }, [label, checked, toggles])

  // 焦点与键盘不改 React 状态,但会改**焦点环与 :focus-visible** ——
  // 所以另外挂一组监听把它们也刷进来。
  // ⚠️ 依赖数组是**空的**,监听只注册一次 —— 因为它读的是模块级快照,
  //    不再依赖任何 state。带依赖会让每次 state 变化都重注册一遍,
  //    而那正是上一版把旧值封进闭包的路径。
  useEffect(() => {
    const refresh = (what: string) => () => window.setTimeout(() => setText(readDom(what)), 0)
    const onFocus = refresh('焦点变化')
    const onKey = refresh('键盘')
    const onClick = refresh('鼠标')
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onFocus)
    document.addEventListener('keyup', onKey)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onFocus)
      document.removeEventListener('keyup', onKey)
      document.removeEventListener('click', onClick)
    }
  }, [])

  return (
    <div
      id="verdict"
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        whiteSpace: 'pre',
        padding: '12px 14px',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-1)',
        background: 'var(--surface-subtle)',
        marginTop: 24,
      }}
    >
      {text}
    </div>
  )
}

const host = document.getElementById('root')
if (host === null) throw new Error('实测台缺少 #root —— 页面结构与预期不符')

// ⚠️ 不用 StrictMode 的双调用会掩盖「onChange 被调了几次」这个观察量,
//    但去掉 StrictMode 又会让实测台与真实应用的行为不一致。
//    折中:开着 StrictMode,而 toggles 用函数式更新 —— 双调用下计数仍然对。
createRoot(host).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)

// 让自动化知道「React 已经挂完了」——否则它可能在挂载前就读探针。
window.__dsProbeReady = true
