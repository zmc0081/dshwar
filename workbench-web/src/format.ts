/**
 * 展示用的格式化 —— **纯函数,不碰 DOM、不碰网络**。
 *
 * ## 为什么单独一层,而不是在屏幕里就地格式化
 *
 * `@dshwar/design-system` 的屏幕收的是**已经格式化好的展示串**
 * (`'2.4 MB'` 而不是 `2516582`)。那条边界是刻意的:设计系统要能被
 * 三个宿主与将来的白牌前端复用,而它们的数据来源不一定相同。
 *
 * 代价是格式化必须有个家。放这里的第二个好处更实在:**这些函数能被单测**,
 * 而挂 React 树的断言不能 —— `vitest.config.ts` 只收 `*.test.ts`,
 * 且本仓刻意不引 jsdom + testing-library
 * (见 `console-web/test/console-web.test.ts` 顶部的同款表态)。
 *
 * ⇒ 于是「界面显示对不对」这个问题被拆成两半:
 * **数据变成什么样**在这里验(纯函数,可断言);
 * **长什么样**由实测台在真实浏览器里看(`packages/design-system/test/*.html`)。
 *
 * @module @dshwar/workbench-web/format
 */

/** 1 KB = 1024 B。用二进制而非十进制 —— 文件系统报的是这个。 */
const KB = 1024

/**
 * 字节数人类化。
 *
 * @param bytes 字节数。`null` / 负数 → `'—'`(取不到,不是 0)
 *
 * ⚠️ **`0` 与「取不到」必须分开。** 一个真的 0 字节文件显示 `'0 B'`,
 * 而取不到大小显示 `'—'`。合并成一个的话,用户看到 `0 B` 会以为文件是空的,
 * 而实际上可能只是没读到 —— 与「未配置 vs 配置成某个值」是同一族错误。
 */
export function humanBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) return '—'
  if (bytes < KB) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / KB
  let unit = 0
  while (value >= KB && unit < units.length - 1) {
    value /= KB
    unit += 1
  }
  // 一位小数够用:'2.4 MB' 比 '2.40 MB' 好读,而 '2 MB' 丢掉了太多。
  return `${value.toFixed(1)} ${units[unit] ?? 'KB'}`
}

/**
 * ISO 时间戳 → `'08-18 09:14'`。
 *
 * ⚠️ **按本地时区渲染。** 服务端给的是 UTC 的 ISO 串,而用户读的是
 * 「我什么时候跑的这个」—— 那是本地时间。直接切字符串(`s.slice(5,16)`)
 * 会在跨时区时差出几个小时,而那种错**看起来完全正常**。
 *
 * @param iso ISO 8601 串。解析不了 → `'—'`
 */
export function shortTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * 千分位。`48201` → `'48,201'`。
 *
 * 不用 `toLocaleString()` —— 它随运行环境的 locale 变,
 * 于是同一份数据在开发机与 CI 上渲染成两个样子,而快照测试会随机红。
 */
export function thousands(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 文件路径 → 扩展名(小写,不带点)。没有扩展名时返回 `'file'`。 */
export function extensionOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  // ⚠️ `dot <= 0` 而不是 `dot === -1`:`.gitignore` 的点在下标 0,
  //   那是**没有扩展名的隐藏文件**,不是「扩展名叫 gitignore」。
  return dot <= 0 ? 'file' : base.slice(dot + 1).toLowerCase()
}

/** 文件路径 → 文件名(去掉目录部分)。 */
export function baseNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}
