/**
 * 工作区设置 —— 预授权哪些工具、路径、网络与 shell 可用。
 *
 * ## 与设计 kit 的差别:只换了取组件的方式
 *
 * kit 里第一行是 `const { Card, ... } = window.DSHWARDesignSystem_264a5f`,
 * 移植后从 `../../components/*.tsx` 逐个 import。本屏**没有**任何 JS 表达的交互态
 * —— 全屏控件都是 `disabled`(见下方 501 那条),因此不需要配套的 screens CSS 文件。
 *
 * 内联 `style` 与夹具数据原样保留。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 与 console 的 QuotasScreen 是**同一套策略的两个视角**:
 * 管理员在运营后台按租户配(上界),用户在这里按项目配(收窄)。
 * 所以这一屏不是"另一套设置",它必须把两者的关系显示出来 ——
 * 否则用户会以为自己在这里放宽了限制,而实际上被上界挡住,且没有任何提示。
 *
 * ★ 501 的处理沿用 QuotasScreen:策略端点未接线,所有会写入策略的控件 disabled,
 *   逐项标「当前不生效」。理由相同 —— 让策略被保存、被显示、却从不被查询,比 501 危险。
 *
 * ★ 优先级规则**待定**,因此界面上不画成已定:
 *   "取更严者"是本设计的预期,但后端未定;把它画成确定的会制造一个
 *   用户以为已生效、实际未定的语义。所以「当前生效」列标为 推算值 · 未执行,
 *   并在上方单独一条 待定 说明。这与 501 同理:不确定就如实标,不要画一个看起来定了的界面。
 *
 * @module @dshwar/design-system/screens/workbench/WorkspaceSettingsScreen
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Checkbox } from '../../components/Checkbox.tsx'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Input } from '../../components/Input.tsx'
import { Select } from '../../components/Select.tsx'
import { Table } from '../../components/Table.tsx'
import { Tag } from '../../components/Tag.tsx'

function NotWiredNotice(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'flex-start',
        padding: 'var(--s-5)',
        borderRadius: 'var(--r-1)',
        background: 'var(--warn-surface)',
        border: '1px solid var(--warn)',
      }}
    >
      <Icon name="triangle-alert" size={15} tone="inherit" style={{ color: 'var(--warn)' }} />
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <span
          style={{
            font: 'var(--fw-medium) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--warn)',
          }}
        >
          策略执行层尚未接线 —— 本屏配置当前不生效
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '86ch',
          }}
        >
          策略端点回落 <CodeRef tone="danger">501 NOT_IMPLEMENTED</CodeRef>
          。接上执行层之前先开放保存,会让策略被保存、被显示、却从不被查询——那比 501 危险得多。
        </span>
        <CodeRef copyable>PUT /v1/workspaces/{'{id}'}/policy · 501 · req_2b88af51c3</CodeRef>
      </div>
    </div>
  )
}

/* 优先级规则未定,单独一条 —— 与 501 分开,因为它们是两件事:
   501 是"还没接",待定是"还没决定接成什么样"。混在一句里会让人以为接上就定了。 */
function UndecidedNotice(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'flex-start',
        padding: 'var(--s-5)',
        borderRadius: 'var(--r-1)',
        background: 'var(--surface-subtle)',
        border: '1px solid var(--border-control)',
      }}
    >
      <Icon name="circle-help" size={15} />
      <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <span
          style={{
            font: 'var(--fw-medium) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-body)',
          }}
        >
          优先级规则待定
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '86ch',
          }}
        >
          本设计的预期是:租户策略是
          <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>上界</b>
          ,工作区只能收窄不能放宽;两者都设时
          <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>取更严的那个</b>
          。但这条规则尚未在后端裁定,因此下表「当前生效」列是
          <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>按该预期推算</b>
          的,不是执行层的回答。
        </span>
      </div>
    </div>
  )
}

/* 三列对照:租户上界 / 本工作区 / 当前生效。
   把"我设的"和"管理员设的"并排放,是这一屏唯一不可省的结构 ——
   用户提出的三个问题(能不能放宽 / 谁生效 / 冲突时看到什么)都在这张表里有位置。 */
function PolicyTable(): React.JSX.Element {
  const cell = (t: string, tone?: 'muted'): React.JSX.Element => (
    <span
      style={{
        font: 'var(--fw-regular) var(--fs-mono)/1.4 var(--font-mono)',
        color: tone === 'muted' ? 'var(--text-tertiary)' : 'var(--text-body)',
      }}
    >
      {t}
    </span>
  )
  const rows: {
    cap: string
    tenant: string
    ws: string
    eff: string
    note: React.JSX.Element
  }[] = [
    {
      cap: '文件读取',
      tenant: 'workspace/**',
      ws: 'workspace/reports/**',
      eff: 'workspace/reports/**',
      note: <Tag tone="neutral">工作区更严 · 生效</Tag>,
    },
    {
      cap: '文件写入',
      tenant: 'workspace/reports/**',
      ws: 'workspace/**',
      eff: 'workspace/reports/**',
      note: <Tag tone="warn">已被租户上界挡回</Tag>,
    },
    {
      cap: 'shell 执行',
      tenant: '允许 · 仅工作区内',
      ws: '允许 · 仅工作区内',
      eff: '允许 · 仅工作区内',
      note: <Tag tone="neutral">相同</Tag>,
    },
    {
      cap: '出站网络',
      tenant: '禁止',
      ws: '允许 internal-api',
      eff: '禁止',
      note: <Tag tone="warn">已被租户上界挡回</Tag>,
    },
    {
      cap: '本地模型',
      tenant: '允许 ollama',
      ws: '禁止',
      eff: '禁止',
      note: <Tag tone="neutral">工作区更严 · 生效</Tag>,
    },
  ]
  return (
    <Table
      density="default"
      columns={[
        { key: 'cap', label: '能力', width: '124px' },
        { key: 'tenant', label: '租户上界(管理员)', mono: true },
        { key: 'ws', label: '本工作区(我)', mono: true },
        { key: 'eff', label: '当前生效 · 推算值 · 未执行', mono: true },
        { key: 'note', label: '' },
      ]}
      rows={rows.map((r) => ({
        cap: r.cap,
        tenant: cell(r.tenant, 'muted'),
        ws: cell(r.ws),
        eff: cell(r.eff),
        note: r.note,
      }))}
    />
  )
}

export interface WorkspaceSettingsScreenProps {
  /** 当前工作区名,进标题 */
  workspace: string
}

export function WorkspaceSettingsScreen({
  workspace,
}: WorkspaceSettingsScreenProps): React.JSX.Element {
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
            工作区设置 · {workspace}
          </h1>
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
              maxWidth: '80ch',
            }}
          >
            预授权哪些工具、路径、网络与 shell 可用。
            <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>
              预授权替代运行时审批
            </b>
            :在这里一次配好,agent 干活时不再逐次弹窗打断。
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)' }}>
          <Button disabled>放弃更改</Button>
          <Button variant="primary" disabled>
            保存策略
          </Button>
        </div>
      </div>
      <NotWiredNotice />
      <UndecidedNotice />

      <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
        <h2
          style={{
            margin: 0,
            color: 'var(--text-body)',
            font: 'var(--fw-semi) var(--fs-title-2)/var(--lh-title-2) var(--font-sans)',
            letterSpacing: 'var(--ls-title-2)',
          }}
        >
          与租户策略的关系
        </h2>
        <PolicyTable />
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
            color: 'var(--text-tertiary)',
            maxWidth: '92ch',
          }}
        >
          冲突时用户看到的是
          <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-secondary)' }}>
            「已被租户上界挡回」
          </b>
          而不是静默失效——他在这里设过的值仍原样留着(不被改写、不被清空),只是不生效。改写用户输入会让他下次打开时以为自己没设过。
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--s-6)',
          alignItems: 'start',
        }}
      >
        <Card title="工具与路径">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            {(
              [
                ['read_file', '读取工作区文件', true],
                ['edit_file', '修改工作区文件', true],
                ['bash', '在工作区内执行命令', true],
                ['http_get', '出站 HTTP 请求', false],
              ] as const
            ).map(([tool, desc, on]) => (
              <div
                key={tool}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s-5)' }}
              >
                <Checkbox checked={on} disabled onChange={() => {}} />
                <div style={{ display: 'grid', gap: 2, flex: 1 }}>
                  <CodeRef>{tool}</CodeRef>
                  <span
                    style={{
                      font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {desc}
                  </span>
                </div>
                <Tag tone="neutral">当前不生效</Tag>
              </div>
            ))}
            <Input
              label="允许的路径前缀"
              value="workspace/reports/**"
              mono
              disabled
              onChange={() => {}}
              hint="相对工作区根目录。留空 = 继承租户上界。"
            />
          </div>
        </Card>
        <Card title="网络与模型">
          <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
            <Select
              label="出站网络"
              value="禁止"
              options={['禁止', '仅允许清单内域名']}
              disabled
              onChange={() => {}}
            />
            <Input
              label="允许的域名"
              value="internal-api.smg.example"
              mono
              disabled
              onChange={() => {}}
              hint="租户上界为「禁止」,因此该清单当前被挡回。"
            />
            <Select
              label="本地模型(离线推理)"
              value="禁止"
              options={['禁止', '允许 ollama']}
              disabled
              onChange={() => {}}
            />
            <div
              style={{
                display: 'flex',
                gap: 'var(--s-4)',
                alignItems: 'flex-start',
                padding: 'var(--s-5)',
                borderRadius: 'var(--r-1)',
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-hairline)',
              }}
            >
              <Icon name="info" size={13} />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
                  color: 'var(--text-tertiary)',
                }}
              >
                本地模型关掉时,断网即进入「只能看」的离线态——历史与产物仍可读,但 agent 无法推理。
              </span>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
