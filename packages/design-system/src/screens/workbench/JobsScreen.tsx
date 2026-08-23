/**
 * 作业屏。长任务在服务端排队与执行,关掉客户端不会中断;重新打开时从服务端状态恢复。
 *
 * 两个导出:`AwayDigest`(你不在时的进展)与 `JobsScreen`(整屏)。
 * kit 里两者同在一个文件、同挂到 window,这里保持同一个文件、两个具名导出。
 *
 * ## 与设计 kit 的差别:三处,都不改任何数值与文案
 *
 * 1. 首行的 `const { … } = window.DSHWARDesignSystem_264a5f` 换成 ES import。
 * 2. `cols` 补了 `TableColumn[]` 标注 —— 不标的话 `align: 'right'` 被推断成
 *    `string`,与 `'left' | 'right'` 不兼容。
 * 3. 摘要顶部那四个计数从 JSX 里的匿名数组提到 `stats`,并标成
 *    `[string, string, string][]`。不标的话它被推断成 `string[][]`,
 *    在 `noUncheckedIndexedAccess` 下解构出来的三个变量各带一个 `undefined`。
 *    **标注只影响类型,四组值与顺序原样。**
 *
 * 内联 `style={{}}` 原样保留:全是一次性布局。这一屏没有 hover / active /
 * focus 的 JS 写法,因此没有需要换成伪类的东西。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 长任务跨重启恢复:用户关掉客户端、作业还在跑。
 *
 * ★ 所以这一屏的第一块不是队列表,而是「你不在时的进展」——
 *   让用户自己去翻运行记录对时间戳,等于把服务端已经知道的事推给用户重算。
 *   摘要按"上次打开"这个时间锚给出:完成了什么、失败了什么、还在跑什么。
 *
 * ★ 失败通知:**这一版不做推送**(无系统通知、无邮件、无 webhook)。
 *   只做界面内未读标记 + 本摘要。写明理由:推送需要常驻客户端、通知权限、
 *   以及每用户的通知偏好存储,这三样都还没定;先做一个"打开就看得到"的诚实版本,
 *   比先上一个只在某些平台生效、静默漏掉其余情况的推送更好。
 *   ——这是一个明确的取舍,不是遗漏。
 *
 * ## 表里的数据是演示夹具
 *
 * 行、摘要流水、失败详情全部硬编码,接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/workbench/JobsScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'

export interface AwayDigestProps {
  /** 时间锚 = 上次打开的时刻,显示在卡片头部「自 {since}」 */
  since: string
}

export function AwayDigest({ since }: AwayDigestProps): React.JSX.Element {
  const line = (icon: string, tone: string, text: string, meta: string): React.JSX.Element => (
    <div
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'center',
        padding: 'var(--s-4) 0',
        borderTop: '1px solid var(--border-hairline)',
      }}
    >
      <Icon name={icon} size={14} tone="inherit" style={{ color: tone }} />
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-body)/1.5 var(--font-sans)',
          color: 'var(--text-body)',
          flex: 1,
        }}
      >
        {text}
      </span>
      <span
        style={{
          font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
          color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {meta}
      </span>
    </div>
  )
  const stats: [string, string, string][] = [
    ['完成', '2', 'var(--success)'],
    ['失败', '1', 'var(--danger)'],
    ['仍在跑', '1', 'var(--warn)'],
    ['新产物', '5', 'var(--text-secondary)'],
  ]
  return (
    <Card
      title="你不在时的进展"
      action={
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            color: 'var(--text-tertiary)',
          }}
        >
          自 {since}
        </span>
      }
    >
      <div style={{ display: 'grid' }}>
        <div style={{ display: 'flex', gap: 'var(--s-6)', paddingBottom: 'var(--s-5)' }}>
          {stats.map(([l, n, c]) => (
            <span key={l} style={{ display: 'grid', gap: 2 }}>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {l}
              </span>
              <span
                style={{
                  font: 'var(--fw-bold) var(--fs-title-2)/1 var(--font-sans)',
                  color: c,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {n}
              </span>
            </span>
          ))}
        </div>
        {line(
          'circle-check',
          'var(--success)',
          '「月度报表生成」完成，产出 3 件产物',
          '昨天 23:41',
        )}
        {line(
          'circle-x',
          'var(--danger)',
          '「附件抽取」在第 2 步失败，已重试 3 次后停止',
          '今天 02:14',
        )}
        {line('circle-check', 'var(--success)', '「术语一致性检查」完成，无差异', '今天 04:02')}
        {line('loader', 'var(--warn)', '「合同条款比对」仍在运行，已跑 6h 12m', '进行中')}
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-4)',
            alignItems: 'center',
            paddingTop: 'var(--s-5)',
            borderTop: '1px solid var(--border-hairline)',
          }}
        >
          <Button size="compact">查看失败详情</Button>
          <Button size="compact" variant="ghost">
            全部标为已读
          </Button>
          <span
            style={{
              marginLeft: 'auto',
              font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
              color: 'var(--text-tertiary)',
            }}
          >
            本版不做推送通知（无系统通知 / 邮件 / webhook）——只在界面内标未读。
          </span>
        </div>
      </div>
    </Card>
  )
}

export function JobsScreen(): React.JSX.Element {
  const [sel, setSel] = useState(1)
  const act = (
    <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
      <IconButton icon="rotate-ccw" label="重跑" />
      <IconButton icon="more-horizontal" label="更多" />
    </span>
  )
  const cols: TableColumn[] = [
    { key: 'id', label: '作业 ID', mono: true },
    { key: 'agent', label: 'Agent' },
    { key: 'step', label: '步骤', align: 'right', mono: true },
    { key: 'el', label: '已运行', align: 'right', mono: true },
    { key: 'started', label: '开始', mono: true },
    { key: 'resumed', label: '跨重启', mono: true },
    { key: 'st', label: '状态' },
    { key: 'a', label: '', align: 'right', width: '72px' },
  ]
  const rows = [
    {
      id: 'job_9f3c21ab',
      agent: '合同条款比对',
      step: '14 / 22',
      el: '6h 12m',
      started: '昨天 21:30',
      resumed: '2 次',
      st: (
        <Tag tone="warn" dot>
          运行中
        </Tag>
      ),
      a: act,
    },
    {
      id: 'job_2b88af51',
      agent: '附件抽取',
      step: '2 / 9',
      el: '4m 51s',
      started: '今天 02:09',
      resumed: '1 次',
      st: <Tag tone="danger">失败</Tag>,
      a: act,
    },
    {
      id: 'job_7c12de40',
      agent: '月度报表生成',
      step: '18 / 18',
      el: '2h 04m',
      started: '昨天 21:37',
      resumed: '1 次',
      st: (
        <Tag tone="success" dot>
          完成
        </Tag>
      ),
      a: act,
    },
    {
      id: 'job_51ea9c07',
      agent: '术语一致性检查',
      step: '6 / 6',
      el: '11m 02s',
      started: '今天 03:51',
      resumed: '—',
      st: (
        <Tag tone="success" dot>
          完成
        </Tag>
      ),
      a: act,
    },
    {
      id: 'job_a41b8c92',
      agent: '超配额分析',
      step: '0 / 12',
      el: '—',
      started: '—',
      resumed: '—',
      st: <Tag tone="neutral">排队中</Tag>,
      a: act,
    },
  ]
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 'var(--s-8)',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <h1
            style={{
              margin: 0,
              color: 'var(--text-body)',
              font: 'var(--fw-bold) var(--fs-title-1)/var(--lh-title-1) var(--font-sans)',
              letterSpacing: 'var(--ls-title-1)',
            }}
          >
            作业
          </h1>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            长任务在服务端排队与执行，
            <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>
              关掉客户端不会中断
            </b>
            ；重新打开时从服务端状态恢复。
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'flex-end' }}>
          <Select
            value="本工作区"
            options={['本工作区', '全部工作区']}
            style={{ width: 150 }}
            onChange={() => {}}
          />
          <Button icon="download">导出</Button>
        </div>
      </div>
      <AwayDigest since="昨天 21:04" />
      <Table columns={cols} rows={rows} selectedIndex={sel} onRowClick={setSel} />
      <Card title="失败详情">
        <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
          <CodeRef copyable tone="danger">
            E_TOOL_DENIED · req_2b88af51c3
          </CodeRef>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
              maxWidth: '84ch',
            }}
          >
            <CodeRef>job_2b88af51</CodeRef> 第 2 步请求写入 <CodeRef>workspace/inbox/</CodeRef>
            ，不在预授权路径内。重试 3 次后停止——重试不会让策略变宽，所以三次都是同样结果。
          </span>
          <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
            <Button size="compact">前往工作区设置</Button>
            <Button size="compact" variant="ghost">
              查看该步骤的工具调用
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
