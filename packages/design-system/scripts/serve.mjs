/**
 * 设计系统的最小静态服务器。
 *
 * ## 为什么需要它
 *
 * 两件事只有在**真实 HTTP** 下才成立:
 *
 * 1. `test/focus-visible.html` 用 `<link>` 引真实的 token CSS —— 以 `file://`
 *    打开时预览面板会把页面渲染成静态快照,相对路径解析不了,令牌全空。
 * 2. `:focus-visible` 只能在真实浏览器里验 —— **jsdom 不实现它**,
 *    于是一个用错伪类(`:focus`)的实现在 vitest 里照样全绿。
 *
 * 刻意不引依赖:一个静态服务器不值得一个 npm 包,而这个文件要能在
 * `pnpm install` 之前就跑得起来(与 `scripts/lib/scan.mjs` 同款理由)。
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PORT = Number(process.env['PORT'] ?? 4321)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

createServer((req, res) => {
  // ⚠️ 目录穿越:normalize 之后必须再确认落点仍在 ROOT 内 ——
  // 只 normalize 不校验,`/../../etc/passwd` 照样出得去。
  const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')).replace(
    /^[/\\]+/,
    '',
  )
  const file = join(ROOT, rel)
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden')
    return
  }
  let target = file
  try {
    if (statSync(target).isDirectory()) target = join(target, 'index.html')
    // ⚠️ 目录换成 index.html 之后**必须再 stat 一次**。
    //   只 stat 目录的话,没有 index.html 时会走到下面去开一个不存在的文件,
    //   而 createReadStream 的 'error' 是**未处理事件** —— 它不是返回 404,
    //   是**把整个服务器进程掀掉**。第一次跑就撞上了:浏览器先请求 `/`。
    statSync(target)
  } catch {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' })
  const stream = createReadStream(target)
  // 双保险:stat 与 open 之间文件被删掉的窗口虽小,但那种崩溃很难查。
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`design-system 静态服务器 http://127.0.0.1:${PORT}`)
  console.log(`focus-visible 实测台   http://127.0.0.1:${PORT}/test/focus-visible.html`)
})
