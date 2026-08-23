/**
 * Markdown 表格的**结构化**读写 —— 替掉在正则上打补丁。
 *
 * ## 为什么值得一个模块
 *
 * `SESSION_TASKS.md` 的 Session 状态表被反复改(每完成一个 Session 翻一次
 * ✅),而此前的做法是拿正则去匹配整行,例如:
 *
 * ```js
 * s.replace(/\| 2 +\| 离线判定与自动降级[^\n]*\n/, …)
 * ```
 *
 * 它有两种失效方式,**都不会报错**:
 *
 * 1. **Prettier 会重排表格列宽** —— 空格数一变,`\| 2 +\|` 就失配,
 *    状态静默退回上一个值。V0.4.x 真发生过,靠回读断言才抓住。
 * 2. **单元格里有 `|`** —— 行内代码 `` `a|b` `` 里的竖线不是列分隔符,
 *    而按字符 split 会把一行切错列。
 *
 * 本模块按 Markdown 的实际语法切分:**行内代码跨度内的 `|` 与转义的 `\|`
 * 都不算分隔符**。列宽由调用方重排(或交给 Prettier),本模块不猜。
 *
 * ⚠️ 只处理 GFM 管道表格。不做完整 Markdown 解析 —— 那需要一个解析器依赖,
 * 而本仓的门禁脚本刻意零依赖(供应链面越小越好)。**范围收窄到表格**,
 * 是因为出问题的一直只有表格。
 */

/**
 * 一行是不是表格行(以 `|` 开头,忽略前导空白)。
 * @param {string} line
 */
export function isTableRow(line) {
  return /^\s*\|/.test(line)
}

/**
 * 是不是表格的分隔行(`| --- | :---: |`)。
 * @param {string} line
 */
export function isSeparatorRow(line) {
  return isTableRow(line) && /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-')
}

/**
 * 把一行表格切成单元格。
 *
 * **行内代码跨度内的 `|` 不算分隔符** —— 这是与「按 `|` split」的关键差别,
 * 也是 `` | `@dshwar/a|b` | `` 这类单元格被切错的原因。
 * 转义的 `\|` 同样不算。
 *
 * @param {string} line
 * @returns {string[]} 单元格内容(已 trim,不含首尾的空串)
 */
export function parseRow(line) {
  /** @type {string[]} */
  const cells = []
  let cur = ''
  /** 当前所处的行内代码跨度的反引号个数;0 = 不在代码里 */
  let fence = 0

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]

    if (ch === '\\' && line[i + 1] === '|') {
      cur += '\\|'
      i += 1
      continue
    }

    if (ch === '`') {
      // 数连续反引号:行内代码跨度由**相同长度**的反引号串闭合
      let run = 0
      while (line[i + run] === '`') run += 1
      if (fence === 0) fence = run
      else if (fence === run) fence = 0
      cur += '`'.repeat(run)
      i += run - 1
      continue
    }

    if (ch === '|' && fence === 0) {
      cells.push(cur)
      cur = ''
      continue
    }

    cur += ch
  }
  cells.push(cur)

  // 首尾的 `|` 会各产生一个空串,去掉
  if (cells.length > 0 && cells[0]?.trim() === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

/**
 * 把单元格拼回一行。列宽不做对齐 —— 交给 Prettier,它是本仓的格式权威。
 * @param {readonly string[]} cells
 */
export function formatRow(cells) {
  return `| ${cells.join(' | ')} |`
}

/** 未能定位到目标 —— **必须抛**,不能静默不改(那正是要根除的失效方式)。 */
export class TableEditError extends Error {
  constructor(/** @type {string} */ message) {
    super(message)
    this.name = 'TableEditError'
  }
}

/**
 * 在一段 Markdown 里改一个表格单元格。
 *
 * 定位方式是**按列内容匹配**,不是按整行正则 —— 列宽怎么变都不影响。
 *
 * @param {string} markdown 全文
 * @param {object} opts
 * @param {number} [opts.from] 只在这个字符偏移之后找(限定到某个版本块)
 * @param {number} [opts.to] 只在这个字符偏移之前找
 * @param {number} opts.matchColumn 用哪一列定位(0 基)
 * @param {string} opts.matchValue 该列的值(trim 后精确相等)
 * @param {number} opts.setColumn 改哪一列(0 基;负数从末尾数)
 * @param {string} opts.setValue 新值
 * @returns {string} 改过的全文
 * @throws {TableEditError} 没找到、找到多行、或列数不够
 */
export function setTableCell(markdown, opts) {
  const from = opts.from ?? 0
  const to = opts.to ?? markdown.length
  const head = markdown.slice(0, from)
  const body = markdown.slice(from, to)
  const tail = markdown.slice(to)

  const lines = body.split('\n')
  /** @type {number[]} */
  const hits = []

  for (const [i, line] of lines.entries()) {
    if (!isTableRow(line) || isSeparatorRow(line)) continue
    const cells = parseRow(line)
    if (cells[opts.matchColumn]?.trim() === opts.matchValue) hits.push(i)
  }

  if (hits.length === 0) {
    throw new TableEditError(
      `没有找到 第${opts.matchColumn}列 === ${JSON.stringify(opts.matchValue)} 的表格行。` +
        `定位失败必须报错 —— 静默不改会让状态退回上一个值而没人发现。`,
    )
  }
  if (hits.length > 1) {
    throw new TableEditError(
      `第${opts.matchColumn}列 === ${JSON.stringify(opts.matchValue)} 匹配到 ${hits.length} 行` +
        `(行号 ${hits.map((h) => h + 1).join(', ')})。请收窄 from/to 范围。`,
    )
  }

  // noUncheckedIndexedAccess 下 hits[0] 是 number | undefined,
  // 而上面已经排除了 length === 0 —— 显式收窄,不用 `!`
  const idx = hits[0] ?? -1
  const cells = parseRow(lines[idx] ?? '')
  const col = opts.setColumn < 0 ? cells.length + opts.setColumn : opts.setColumn
  if (col < 0 || col >= cells.length) {
    throw new TableEditError(`要改的列 ${opts.setColumn} 超出该行的 ${cells.length} 列`)
  }
  cells[col] = opts.setValue
  lines[idx] = formatRow(cells)

  return head + lines.join('\n') + tail
}

/**
 * 在 `[from, to)` 里定位**紧跟某个标记之后的第一张表**,返回它的字符区间。
 *
 * ## 为什么需要它:按位置定位与按身份定位
 *
 * `setTableCell` 要求调用方把范围收窄到「只有一张候选表」。而现实中一个
 * 版本块里常有好几张表,且**它们的第一列可能撞车** —— V0.9.0 块里
 * 「Session 状态」表与「三条既定约束」表的第 0 列都有 `1`。
 *
 * 不收窄的话 `setTableCell` 会抛「匹配到 2 行」——**那是对的行为**。
 * 而绕过它的诱惑是「取第一条匹配就行,反正 Session 表在前面」——
 * 那是**按位置定位**,今天成立只因为排版恰好如此。哪天在它之前插一张
 * 首列是数字的表,读和写会一致地跑到另一张表上,于是一致地「通过」。
 *
 * ⇒ 本函数按**身份**定位:先找标记文本,再取其后的第一张表。
 * 找不到标记就抛 —— 拒绝猜。
 *
 * @param {string} markdown
 * @param {string} marker 表格前的锚点文本,例如 `'**Session 状态**'`
 * @param {number} [from] 搜索起点(默认 0)
 * @param {number} [to] 搜索终点(默认全文)
 * @returns {{from: number, to: number}} 表格首行到末行的字符区间
 * @throws {TableEditError} 标记不存在,或标记之后没有表格
 */
export function tableRangeAfter(markdown, marker, from = 0, to = markdown.length) {
  const region = markdown.slice(from, to)
  const at = region.indexOf(marker)
  if (at === -1) {
    throw new TableEditError(
      `在给定范围里找不到锚点 ${JSON.stringify(marker)} —— 无法定位到唯一一张表,拒绝猜。`,
    )
  }

  const lines = region.slice(at).split('\n')
  let first = -1
  let last = -1
  for (const [i, line] of lines.entries()) {
    const isRow = isTableRow(line)
    if (isRow) {
      if (first === -1) first = i
      last = i
    } else if (first !== -1) {
      break // 表已结束 —— 只取紧跟标记的**那一张**,不跨到下一张
    }
  }
  if (first === -1) {
    throw new TableEditError(`锚点 ${JSON.stringify(marker)} 之后没有表格行 —— 结构与预期不符。`)
  }

  const head = lines.slice(0, first).join('\n').length + 1
  const through = lines.slice(0, last + 1).join('\n').length
  return { from: from + at + head, to: from + at + through }
}
