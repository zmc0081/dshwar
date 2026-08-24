/**
 * 变异清单落盘 —— **进程被杀之后还能自愈**。
 *
 * ## 它补的是 `try/finally` 挡不住的那一半
 *
 * 变异型负向验证的做法是「把东西改坏、跑一次检查、再改回来」。
 * `finally` 挡得住异常与正常退出,**挡不住 SIGKILL**。
 *
 * 而负向验证恰恰是最容易被杀的一类:它故意让东西坏掉,
 * 然后跑一个可能很慢的检查 —— V0.9.0 收尾实测过一次,
 * 去掉 `MAX_PAGES` 之后测试**不终止**,后台任务挂了十分钟,
 * 强杀之后变异过的 `api.ts` 留在了工作区。
 *
 * 留下的后果不是「少改一行」那么直白:后续 `check-guards` 报的是
 * 症状而不是原因(那一次是「`console-web/src` 不存在」
 * 「登记了不存在的项目」),顺着它们改会把两处本来正确的东西改坏。
 *
 * ## 两层,缺一不可
 *
 * | 层 | 挡什么 | 由谁做 |
 * | --- | --- | --- |
 * | `try/finally` | 异常、正常退出、`process.exit` | 调用方 |
 * | **清单落盘** | **SIGKILL、断电、任务被强停** | 本模块 |
 *
 * ## ⚠️ 自愈要**吵**
 *
 * 悄悄修好会让下一个人只看到「莫名其妙好了」,而下一次同样的事仍会发生。
 * 所以 {@link reclaimMutations} 每还原一个文件都打印一行,并说明它是怎么来的。
 *
 * @module scripts/lib/mutation-journal
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * 清单落在哪。
 *
 * ⚠️ **不放 `node_modules/`** —— `pnpm install` 会清它,而清单必须比
 * 任何一次安装活得久。放在仓库根的一个点开头目录里,并进 `.gitignore`。
 */
const JOURNAL_DIR = '.mutation-journal'

/** @param {string} repo */
function journalPath(repo) {
  return join(repo, JOURNAL_DIR, 'pending.json')
}

/**
 * 开一次变异会话:**先落盘,再动手**。
 *
 * @param {string} repo 仓库根
 * @param {readonly string[]} files 将要被改的文件(仓库相对路径)
 * @returns {{ restore: () => void, done: () => void }}
 *   `restore()` 还原全部并清掉清单;`done()` 只清清单(用于确认已还原)
 *
 * ⚠️ **顺序是硬的**:原文必须在**第一次写入之前**存下来。
 * 反过来做的话,进程恰好死在「已经改了、还没记下原文」之间,
 * 就再也还原不回去了 —— 而那个窗口虽然小,却是唯一真正危险的窗口。
 */
export function beginMutation(repo, files) {
  /** @type {Record<string, string>} */
  const originals = {}
  for (const rel of files) {
    const abs = resolve(repo, rel)
    originals[rel] = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  }
  const path = journalPath(repo)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ at: 'mutation-in-progress', originals }, null, 2), 'utf8')

  const restore = () => {
    for (const [rel, text] of Object.entries(originals)) {
      writeFileSync(resolve(repo, rel), text, 'utf8')
    }
    rmSync(path, { force: true })
  }
  return { restore, done: () => rmSync(path, { force: true }) }
}

/**
 * 开机自愈:把上一次跑崩时没还原的文件还原掉。
 *
 * @param {string} repo
 * @returns {number} 还原了几个文件
 *
 * ⚠️ **无条件还原,不做「内容变了没有」的判断。**
 * 判断需要一个「正确内容」的参照,而清单里存的就是那个参照 ——
 * 拿它去比再决定要不要写,与直接写的结果完全一样,只是多一个出错的机会。
 */
export function reclaimMutations(repo) {
  const path = journalPath(repo)
  if (!existsSync(path)) return 0
  /** @type {{ originals?: Record<string, string> }} */
  let journal
  try {
    journal = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    console.log(`⚠️  ${JOURNAL_DIR}/pending.json 读不动 —— 留着待查,不猜它的内容`)
    return 0
  }
  const originals = journal.originals ?? {}
  const names = Object.keys(originals)
  if (names.length === 0) {
    rmSync(path, { force: true })
    return 0
  }

  for (const rel of names) {
    writeFileSync(resolve(repo, rel), originals[rel] ?? '', 'utf8')
    console.log(`♻️  上次跑崩遗留:已还原被变异的 ${rel}`)
  }
  console.log('    (变异型负向验证会临时改坏文件;进程被强杀时 finally 跑不到)')
  console.log('    ⚠️ 若这几个文件里有你自己的改动,它们已被清单里的原文覆盖 ——')
  console.log('       清单是变异**开始前**存的,所以覆盖的是变异,不是你的改动。')
  rmSync(path, { force: true })
  return names.length
}
