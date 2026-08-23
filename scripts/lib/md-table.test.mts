/**
 * `md-table.mjs` 的测试 —— 重点是它替掉的那两种**静默**失效方式。
 *
 * 两种都发生过,都不报错:
 * 1. 单元格里有行内代码,代码里有 `|` → 按字符 split 切错列
 * 2. Prettier 重排列宽 → 整行正则失配,`replace` 安静返回原文
 *
 * 所以这里的断言不是「正常情况能用」,而是「这两种情况**下**能用」,
 * 外加「定位失败必须抛,不许静默不改」。
 */
import { describe, expect, it } from 'vitest'
import {
  formatRow,
  isSeparatorRow,
  isTableRow,
  parseRow,
  setTableCell,
  tableRangeAfter,
  TableEditError,
} from './md-table.mjs'

describe('parseRow · 行内代码里的竖线不是分隔符', () => {
  it('★ 代码跨度内的 `|` 不切列(按字符 split 会切成 4 列)', () => {
    const line = '| 1 | `a|b` | ✅ |'
    expect(line.split('|').length - 2).toBe(4) // 朴素做法:4 列,错的
    expect(parseRow(line)).toEqual(['1', '`a|b`', '✅'])
  })

  it('转义的 \\| 不切列', () => {
    expect(parseRow('| x | a\\|b | ✅ |')).toEqual(['x', 'a\\|b', '✅'])
  })

  it('多反引号跨度按相同长度闭合', () => {
    expect(parseRow('| x | ``code with ` inside|and pipe`` | ✅ |')).toEqual([
      'x',
      '``code with ` inside|and pipe``',
      '✅',
    ])
  })

  it('普通行照常切,且 trim', () => {
    expect(parseRow('|  0   |  调研落档  | ✅  |')).toEqual(['0', '调研落档', '✅'])
  })

  it('分隔行能被认出来(不该被当数据行改)', () => {
    expect(isSeparatorRow('| --- | ---- | --- |')).toBe(true)
    expect(isSeparatorRow('| 0 | 调研 | ✅ |')).toBe(false)
  })
})

describe('setTableCell · 列宽无关', () => {
  const wide = [
    '**Session 状态**',
    '',
    '| Session | 标题                                | 状态 |',
    '| ------- | ----------------------------------- | ---- |',
    '| 0       | 调研落档                            | ✅   |',
    '| 1       | `@dshwar/llm-local`:keyless provider | ⬜   |',
    '',
  ].join('\n')

  // 同一张表,Prettier 重排过列宽 —— 内容一样,空格数不同
  const narrow = wide.replace(/ +\|/g, ' |').replace(/\| +/g, '| ')

  it('★ 宽窄两种排版都能定位并改对(整行正则做不到)', () => {
    for (const [name, md] of [
      ['宽', wide],
      ['窄', narrow],
    ] as const) {
      const out = setTableCell(md, {
        matchColumn: 0,
        matchValue: '1',
        setColumn: -1,
        setValue: '✅',
      })
      const row = out.split('\n').find((l) => parseRow(l)[0] === '1')
      expect(parseRow(row!), name).toEqual(['1', '`@dshwar/llm-local`:keyless provider', '✅'])
    }
  })

  it('★ 含反引号的单元格原样保留(五次事故就是它被吃空)', () => {
    const out = setTableCell(wide, {
      matchColumn: 0,
      matchValue: '1',
      setColumn: -1,
      setValue: '✅',
    })
    expect(out).toContain('`@dshwar/llm-local`')
  })

  it('不碰其它行', () => {
    const out = setTableCell(wide, {
      matchColumn: 0,
      matchValue: '1',
      setColumn: -1,
      setValue: '✅',
    })
    expect(parseRow(out.split('\n').find((l) => parseRow(l)[0] === '0')!)[2]).toBe('✅')
  })
})

describe('定位失败必须抛 —— 静默不改正是要根除的那件事', () => {
  const md = '| Session | 标题 | 状态 |\n| --- | --- | --- |\n| 0 | 调研 | ⬜ |\n'

  it('★ 匹配不到 → 抛,而不是原样返回', () => {
    expect(() =>
      setTableCell(md, { matchColumn: 0, matchValue: '9', setColumn: -1, setValue: '✅' }),
    ).toThrow(TableEditError)
  })

  it('匹配到多行 → 抛(要求收窄范围)', () => {
    const dup = md + '| 0 | 又一个 0 | ⬜ |\n'
    expect(() =>
      setTableCell(dup, { matchColumn: 0, matchValue: '0', setColumn: -1, setValue: '✅' }),
    ).toThrow(/匹配到 2 行/)
  })

  it('列号越界 → 抛', () => {
    expect(() =>
      setTableCell(md, { matchColumn: 0, matchValue: '0', setColumn: 9, setValue: '✅' }),
    ).toThrow(/超出/)
  })

  it('from/to 能把范围限定到一个版本块(多块同号 Session 的现实情况)', () => {
    const two = `## M0.6.5\n${md}\n## M0.6.0\n${md}`
    const secondBlock = two.indexOf('## M0.6.0')
    const out = setTableCell(two, {
      from: secondBlock,
      matchColumn: 0,
      matchValue: '0',
      setColumn: -1,
      setValue: '✅',
    })
    // 只有后一块被改
    const blocks = out.split('## M0.6.0')
    expect(blocks[0]).toContain('| 0 | 调研 | ⬜ |')
    expect(blocks[1]).toContain('✅')
  })
})

describe('formatRow', () => {
  it('往返不丢内容', () => {
    const cells = ['1', '`@dshwar/x|y`', '✅']
    expect(parseRow(formatRow(cells))).toEqual(cells)
  })
})

describe('tableRangeAfter · 按身份定位,不按位置', () => {
  // 真实形状:一个版本块里两张表,**第一列都有 `1`**。
  // 这正是 V0.9.0 撞上的那一次 —— setTableCell 抛「匹配到 2 行」。
  const twoTables = [
    '## M0.9.0 · 端',
    '',
    '**Session 状态**',
    '',
    '| Session | 标题 | 状态 |',
    '| ------- | ---- | ---- |',
    '| 0 | 裁决 | ✅ |',
    '| 1 | 移植 kit | ⬜ |',
    '',
    '### ★ 三条既定约束',
    '',
    '| #   | 约束 | 为什么 |',
    '| --- | ---- | ------ |',
    '| 1   | 不展示 shell 命令原文 | 展示到工具名与路径为止 |',
    '| 2   | 没有运行时审批弹窗 | 取而代之是工作区设置页 |',
    '',
  ].join('\n')

  it('★ 收窄到锚点后的那张表 —— 两张表首列撞车时仍唯一', () => {
    // 不收窄:两行都匹配,setTableCell 抛错(这是正确行为,先钉住它)
    expect(() =>
      setTableCell(twoTables, { matchColumn: 0, matchValue: '1', setColumn: -1, setValue: '✅' }),
    ).toThrow(TableEditError)

    // 收窄之后唯一命中
    const r = tableRangeAfter(twoTables, '**Session 状态**')
    const out = setTableCell(twoTables, {
      ...r,
      matchColumn: 0,
      matchValue: '1',
      setColumn: -1,
      setValue: '✅',
    })
    const rows = out.split('\n').filter((l) => isTableRow(l) && !isSeparatorRow(l))
    // Session 表的 `1` 变了
    expect(rows.find((l) => parseRow(l)[0] === '1' && parseRow(l)[1] === '移植 kit')).toContain(
      '✅',
    )
    // 约束表的 `1` **没被碰**
    expect(out).toContain('| 1   | 不展示 shell 命令原文 | 展示到工具名与路径为止 |')
  })

  it('★ 换成「约束表在前」也定位正确 —— 证明靠的不是位置', () => {
    // 把两张表的顺序调过来。若实现是「取第一张表」,这条会打到约束表上。
    const swapped = [
      '## M0.9.0 · 端',
      '',
      '### ★ 三条既定约束',
      '',
      '| #   | 约束 | 为什么 |',
      '| --- | ---- | ------ |',
      '| 1   | 不展示 shell 命令原文 | 展示到工具名与路径为止 |',
      '',
      '**Session 状态**',
      '',
      '| Session | 标题 | 状态 |',
      '| ------- | ---- | ---- |',
      '| 1 | 移植 kit | ⬜ |',
      '',
    ].join('\n')

    const r = tableRangeAfter(swapped, '**Session 状态**')
    const out = setTableCell(swapped, {
      ...r,
      matchColumn: 0,
      matchValue: '1',
      setColumn: -1,
      setValue: '✅',
    })
    // ⚠️ `formatRow` 不补对齐空格 —— 被改的那一行按最简形态重排,
    //    而**没被碰的行原样保留**(下一条断言就是靠这个区分「改对了」与「全表重排」)。
    expect(out).toContain('| 1 | 移植 kit | ✅ |')
    expect(out).toContain('| 1   | 不展示 shell 命令原文 | 展示到工具名与路径为止 |')
  })

  it('只取紧跟锚点的那一张表,不跨到下一张', () => {
    const r = tableRangeAfter(twoTables, '**Session 状态**')
    const slice = twoTables.slice(r.from, r.to)
    expect(slice).toContain('移植 kit')
    expect(slice).not.toContain('不展示 shell 命令原文')
  })

  it('锚点不存在 → 抛,而不是退回「取第一张表」', () => {
    expect(() => tableRangeAfter(twoTables, '**不存在的锚点**')).toThrow(TableEditError)
  })

  it('锚点存在但其后没有表格 → 抛', () => {
    expect(() =>
      tableRangeAfter('前言\n\n**孤零零的锚点**\n\n只是段落。\n', '**孤零零的锚点**'),
    ).toThrow(TableEditError)
  })

  it('from/to 之外的锚点不算数(范围收窄是硬的)', () => {
    const at = twoTables.indexOf('**Session 状态**')
    expect(() => tableRangeAfter(twoTables, '**Session 状态**', at + 1)).toThrow(TableEditError)
  })
})
