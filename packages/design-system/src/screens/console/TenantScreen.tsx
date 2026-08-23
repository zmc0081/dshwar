/**
 * 租户详情屏：配额与容量 + 近期运行 + 右栏本月指标与凭据。
 *
 * ## 与设计 kit 的差别:只有 `window` 全局换成了 ES import
 *
 * 这一屏没有 JS 承载的交互态,样式全部保持内联 ——
 * 屏幕里的 `style={{}}` 多是一次性布局,做成类会产生几百个只用一次的类。
 *
 * ⚠️ 凭据区用的是 `CredentialTag`(describe 语义:configured / source / writable),
 * **永不显示凭据值** —— 那是上游 `dsh-credentials` 的既有约束。
 *
 * 屏内的夹具数据(4 行运行、配额数字)原样保留,接真实 API 是后面 Session 的事。
 *
 * @module @dshwar/design-system/screens/console/TenantScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { CredentialTag } from '../../components/CredentialTag.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Input } from '../../components/Input.tsx'
import { Metric } from '../../components/Metric.tsx'
import { QuarantineBanner } from '../../components/QuarantineBanner.tsx'
import { QuotaBar } from '../../components/QuotaBar.tsx'
import { Select } from '../../components/Select.tsx'
import { Table, type TableColumn } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'
import { PageHead } from './Shell.tsx'

export interface TenantScreenProps {
  /** 租户名,作为页标题 */
  tenant: string
  /** 返回租户列表 */
  onBack: () => void
}

export function TenantScreen({ tenant, onBack }: TenantScreenProps): React.JSX.Element {
  const runCols: TableColumn[] = [
    { key: 'id', label: '运行 ID', mono: true },
    { key: 'agent', label: 'Agent' },
    { key: 'model', label: '模型', mono: true },
    { key: 'tok', label: 'tok', align: 'right', mono: true },
    { key: 'st', label: '状态' },
    { key: 'a', label: '', align: 'right', width: '72px' },
  ]
  const act = (
    <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
      <IconButton icon="eye" label="查看" />
      <IconButton icon="more-horizontal" label="更多" />
    </span>
  )
  const runs: Record<string, React.ReactNode>[] = [
    {
      id: 'run_9f3c21ab',
      agent: '月度报表生成',
      model: 'sonnet-4-5',
      tok: '48,201',
      st: (
        <Tag tone="success" dot>
          完成
        </Tag>
      ),
      a: act,
    },
    {
      id: 'run_7c12de40',
      agent: '合同条款比对',
      model: 'sonnet-4-5',
      tok: '12,884',
      st: <Tag tone="warn">降级</Tag>,
      a: act,
    },
    {
      id: 'run_2b88af51',
      agent: '工单归类',
      model: 'haiku-4-5',
      tok: '3,902',
      st: <Tag tone="danger">失败</Tag>,
      a: act,
    },
    {
      id: 'run_51ea9c07',
      agent: '月度报表生成',
      model: 'opus-4-1',
      tok: '96,440',
      st: <Tag tone="neutral">草稿</Tag>,
      a: act,
    },
  ]
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
        <Button variant="ghost" size="compact" icon="arrow-left" onClick={onBack}>
          租户
        </Button>
        <CodeRef copyable>tnt_9f3c21</CodeRef>
      </div>
      <QuarantineBanner />
      <PageHead
        title={tenant}
        sub="创建于 2026-03-14 · 计费主体 Acme Inc.（继承自组织）"
        actions={
          <>
            <Button icon="download">导出用量</Button>
            <Button variant="danger">吊销密钥</Button>
            <Button variant="primary">保存变更</Button>
          </>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="配额与容量">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <QuotaBar used={2560000} total={4000000} target={3600000} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 'var(--s-5)',
                }}
              >
                <Input label="月度配额" value="4,000,000" suffix="tok" onChange={() => {}} />
                <Input label="单次运行上限" value="200,000" suffix="tok" onChange={() => {}} />
                <Select
                  label="超限行为"
                  value="暂停 Agent"
                  options={['暂停 Agent', '降级至 haiku-4-5', '仅告警']}
                  onChange={() => {}}
                />
              </div>
              <Checkbox checked label="达到 90% 时通知计费联系人" onChange={() => {}} />
            </div>
          </Card>
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <h2
              style={{
                margin: 0,
                color: 'var(--text-body)',
                font: 'var(--fw-semi) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
                letterSpacing: 'var(--ls-title-2)',
              }}
            >
              近期运行
            </h2>
            <Table columns={runCols} rows={runs} />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
          <Card title="本月">
            <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
              <Metric label="消耗" value="1.28M" sub="配额 4.00M · 32%" />
              <Metric label="运行次数" value="4,120" sub="失败 18 · 0.44%" />
            </div>
          </Card>
          <Card title="凭据">
            <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  API 密钥
                </span>
                <CredentialTag />
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
                <span
                  style={{
                    font: 'var(--fw-medium) var(--fs-label)/1 var(--font-sans)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  签入句柄
                </span>
                <CodeRef copyable>sh_71c2f8a04d9e</CodeRef>
              </div>
              <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
                <Button size="compact">轮换</Button>
                <Button size="compact" variant="ghost">
                  查看审计
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
