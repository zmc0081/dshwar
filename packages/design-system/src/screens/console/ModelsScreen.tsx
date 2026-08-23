/**
 * 控制台「模型准入」屏(组织级白名单)。
 *
 * ## 与设计 kit 的差别:四处,全是机械转换
 *
 * 1. 首行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. `PageHead` 在 kit 里由 `Shell.jsx` 挂到 window,移植后从 `./Shell.tsx` 引。
 * 3. `React.useState` → 具名 `useState` import(kit 里 React 是全局)。
 * 4. `cols` 标注 {@link TableColumn};`allow` 的键收成 {@link ModelName} 联合 ——
 *    `noUncheckedIndexedAccess` 下用 `string` 索引一个无索引签名的对象取不到值。
 *
 * ## 屏幕层的 `style={{}}` 保留内联
 *
 * 这一层的内联样式是**一次性布局**(这一屏这一处的 grid),做成 CSS 类会产生
 * 几百个只用一次的类。本屏没有 hover / active / focus 的 JS 写法,
 * 所以没有需要转成伪类的东西,也就不需要 `styles/screens/modelsscreen.css`。
 *
 * ## 表格里的是设计 kit 的夹具数据
 *
 * 模型名、上下文、单价、上游事件均原样保留。接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/console/ModelsScreen
 */
import type * as React from 'react'
import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { DegradeNotice } from '../../components/DegradeNotice.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import { PageHead } from './Shell.tsx'

/**
 * 白名单里的三个模型。
 *
 * kit 里 `allow` 是一个字面量对象,键就是这三个串;这里把它收成联合类型,
 * 好让 `allow[name]` 在 `noUncheckedIndexedAccess` 下仍然是 `boolean` 而非
 * `boolean | undefined` —— 取值集合没变,只是把 kit 里隐含的约束写了出来。
 */
type ModelName = 'claude-opus-4-1' | 'claude-sonnet-4-5' | 'claude-haiku-4-5'

export function ModelsScreen(): React.JSX.Element {
  const [allow, setAllow] = useState<Record<ModelName, boolean>>({
    'claude-opus-4-1': false,
    'claude-sonnet-4-5': true,
    'claude-haiku-4-5': true,
  })
  const cols: TableColumn[] = [
    { key: 'on', label: '准入', width: '56px' },
    { key: 'name', label: '模型', mono: true },
    { key: 'ctx', label: '上下文', align: 'right', mono: true },
    { key: 'price', label: '单价 (¥/Mtok)', align: 'right', mono: true },
    { key: 'st', label: '状态' },
    { key: 'a', label: '', align: 'right', width: '40px' },
  ]
  const model = (
    name: ModelName,
    ctx: string,
    price: string,
    st: React.ReactNode,
  ): Record<string, React.ReactNode> => ({
    on: (
      <Checkbox
        checked={allow[name]}
        onChange={(v) => {
          setAllow((s) => ({ ...s, [name]: v }))
        }}
      />
    ),
    name,
    ctx,
    price,
    st,
    a: <IconButton icon="more-horizontal" label="更多" />,
  })
  const rows: Record<string, React.ReactNode>[] = [
    model('claude-opus-4-1', '200K', '112.00', <Tag tone="warn">容量受限</Tag>),
    model(
      'claude-sonnet-4-5',
      '200K',
      '21.60',
      <Tag tone="success" dot>
        可用
      </Tag>,
    ),
    model(
      'claude-haiku-4-5',
      '200K',
      '7.20',
      <Tag tone="success" dot>
        可用
      </Tag>,
    ),
  ]
  return (
    <>
      <PageHead
        title="模型准入"
        sub="白名单对该组织下全部租户生效；租户可在此范围内自选默认模型"
        actions={
          <>
            <Button>同步上游目录</Button>
            <Button variant="primary">保存白名单</Button>
          </>
        }
      />
      <DegradeNotice from="opus-4-1" to="sonnet-4-5" />
      <Table columns={cols} rows={rows} density="default" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-6)' }}>
        <Card title="降级策略">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <Select
              label="容量受限时"
              value="降级至次一档模型"
              options={['降级至次一档模型', '排队等待', '直接失败']}
              onChange={() => {}}
            />
            <Select
              label="降级目标"
              value="claude-sonnet-4-5"
              options={['claude-sonnet-4-5', 'claude-haiku-4-5']}
              mono
              onChange={() => {}}
            />
            <Checkbox checked label="在工作台内向员工展示降级提示" onChange={() => {}} />
          </div>
        </Card>
        <Card title="最近上游事件">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <CodeRef copyable tone="danger">
                E_MODEL_UNAVAILABLE · req_9f3c21ab7e
              </CodeRef>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/var(--lh-caption) var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                2026-08-18T09:14Z · opus-4-1 · 上游返回容量不足
              </span>
            </div>
            <div style={{ height: 1, background: 'var(--border-hairline)' }} />
            <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
              <CodeRef copyable>E_RATE_LIMITED · req_7c12de40b1</CodeRef>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/var(--lh-caption) var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                2026-08-17T22:03Z · sonnet-4-5 · 租户 acme-staging
              </span>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
