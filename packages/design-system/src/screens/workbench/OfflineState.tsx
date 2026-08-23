/**
 * 离线两态。`OfflineBanner`(降级横幅)+ `QueuedInputCard`(排队输入,不自动发出)。
 *
 * kit 里两者同在一个文件、连同 `MODES` 一起挂到 window(名为 `OFFLINE_MODES`),
 * 这里保持同一个文件、三个具名导出 —— `MODES` 对外仍叫 `OFFLINE_MODES`。
 *
 * ## V0.9.0 Session 2:从「夹具写死」改为**受控组件**
 *
 * 移植时(Session 1)队列内容、本地模型型号、队列上限全部写死在文件里 ——
 * 那是刻意的,那一轮的纪律是机械转换。这一轮把它们提成 props。
 *
 * **props 是表现层类型,不是 API 类型。** `at` 收到的是已经格式化好的 `'09:41'`,
 * `localModel` 收到的是能直接念出来的 `'ollama（qwen2.5:14b）'`。
 * 理由:`@dshwar/design-system` **不依赖 `@dshwar/sdk`**,也不该依赖 ——
 * 设计系统要能被三个宿主、以及将来的白牌前端复用,而它们的数据来源不一定相同。
 * 换算(ISO 时间 → `'09:41'`、模型描述符 → 一串能读的字)是调用方的事。
 *
 * ## 🚨 顺带修三处真缺陷,前两处是同一族:**回执与事实脱钩**
 *
 * kit 原版把 props 灌进 `useState(items)`,此后增删只改这份本地副本:
 *
 * 1. **丢弃不落地。** 点「丢弃这条」,那一条从列表里消失了 —— 而队列的真身在
 *    调用方手里,它一无所知,恢复连接后照发。用户读到的是「已经丢掉了」,
 *    系统做到的是「一条都没丢」。「全部丢弃」更彻底:清空后
 *    `if (!queue.length) return null` 让整张卡消失,一次性给出「三条都没了」的
 *    回执,而三条一条没少。
 *    —— 与 `CodeRef` 那次「`setDone(true)` 在 try 之外」同族:回执与事实脱钩。
 *    这一处更贵:那次骗的是「复制成功了吗」,这里骗的是
 *    **「agent 待会儿会不会按这条指令去改我的文件」**。
 * 2. **新排队的输入进不来。** `useState(initial)` 只认第一次渲染的值;断网期间
 *    用户再敲一条,调用方把四条传下来,卡片仍显示三条、标题仍写「3 条」。
 *    而这张卡存在的全部理由就是「恢复前让用户重新读一遍自己写过什么」——
 *    一份读不全的清单比没有清单更糟,它让人以为自己读全了。
 * 3. **「全部发送」连 `onClick` 都没有。** 主操作点下去毫无反应,而它旁边的
 *    「全部丢弃」看起来生效了(见第 1 条)—— 两个按钮一个假动作、一个假回执。
 *
 * ⇒ 现在 `items` 完全受控,`onDiscard` / `onDiscardAll` / `onSendAll` 交给调用方;
 * 组件不再持有任何队列副本。
 *
 * ⚠️ 上一版这里写着「`queue` state **不能**换成 CSS 伪类:它是队列内容本身,
 * 不是 hover / active / focus 那类样式态」。**那个判断是对的,只是结论差一步** ——
 * 正因为它是数据而不是样式态,它就根本不该由组件持有:数据的主人是调用方。
 *
 * ## 空态:这一处的空态就是**不出现**
 *
 * `items` 为空时整块返回 `null`,不画空卡片。这不是「空态被漏掉了」——
 * 这张卡是叠在会话上的条件插入物,不是一屏的主体;没有排队输入时,
 * 一张写着「暂无排队输入」的卡只会占走用户读会话的位置。
 * (「空不是错误」在这里的落法是**安静**,不是画一个更响的空盒子。)
 *
 * ## 与设计 kit 的差别:三处
 *
 * 1. 首行的 `const { … } = window.DSHWARDesignSystem_264a5f` 换成 ES import。
 * 2. `MODES` 补了 `Record<OfflineMode, OfflineModeSpec>` 标注 —— 不标的话
 *    `tone` 被推断成 `string`,传给 `Tag` 的 `'success' | 'warn' | …` 不兼容。
 * 3. `OfflineModeSpec.body` 从常量串改成**函数**,因为 local 档的正文里嵌着
 *    一个型号(`ollama（qwen2.5:14b）`)—— 那是运行时数据,不是文案。写死它
 *    意味着任何跑别的本地模型的部署,横幅都在陈述一件不成立的事,
 *    而用户恰恰要靠这句话判断「长任务会不会被截断」。
 *    `MODES` 本身留在模块里:它是「枚举 → 表现」的映射(tone / 图标 / 文案),
 *    与 `ArtifactsScreen` 的 `TONE_OF` 同类,不是夹具。
 *
 * ⚠️ `OfflineBanner` 里 `if (!m) return null` 这条兜底**原样留着**,尽管
 * 类型上 `MODES[mode]` 取不出 `undefined`。类型只管得住本包内部的调用方,
 * 而 `mode` 的实际来源是运行时的连接状态判定 —— 兜底删掉等于把一个
 * 「传了表外的值就整块消失」换成「整块崩掉」。
 *
 * 内联 `style={{}}` 原样保留:全是一次性布局。这一屏没有 hover / active /
 * focus 的 JS 写法,因此没有需要换成伪类的东西。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 离线不是错误,是降级运行模式。断网时仍可用:历史会话、产物、工作区文件、本地工具执行。
 * Agent 推理需要本地模型(Ollama)。
 *
 * ★ 两种离线态视觉上必须分开 —— 它们对用户的意义完全不同:
 *   'local'  本地模型可用   → **降级但能干活**:warn 语义色,说明降级了什么(模型、速度、上下文)
 *   'readonly' 本地模型不可用 → **只能看**:neutral 语义色 + 明确说出"agent 无法推理",
 *                             并且输入区整体禁用(不是让人敲完才发现发不出去)
 * 为什么 readonly 用 neutral 而不是 danger:danger 在这套语言里意味着失败。
 * 断网不是失败,是环境。用 danger 会让用户以为出了故障去排查,而他该做的是等网或开本地模型。
 *
 * @module @dshwar/design-system/screens/workbench/OfflineState
 */
import type * as React from 'react'
import { Button } from '../../components/Button.tsx'
import { Card } from '../../components/Card.tsx'
import { Icon } from '../../components/Icon.tsx'
import { IconButton } from '../../components/IconButton.tsx'
import { Tag } from '../../components/Tag.tsx'

/**
 * local = 本地模型可用(降级但能干活)· readonly = 本地模型不可用(只能看)
 *
 * ⚠️ **闭集,不要加「未知」档。** 认不出的连接状态应该在**转换层**停下来报错,
 * 而不是在界面上退化成一条含糊的横幅 —— 后者会把一个新增的运行态
 * 悄悄显示成两个已知态里的一个,而它们的可用性承诺完全不同。
 */
export type OfflineMode = 'local' | 'readonly'

export interface OfflineModeSpec {
  /** warn = 降级但能干活 · neutral = 只能看。**不用 danger**,理由见模块注释 */
  readonly tone: 'warn' | 'neutral'
  /** Lucide 图标名 */
  readonly icon: string
  /** 右侧 mono Tag 的文字 */
  readonly tag: string
  /** 横幅标题 */
  readonly title: string
  /**
   * 横幅正文:说明降级了什么、还剩什么可用。
   *
   * 是函数而不是常量串,因为 local 档要把**顶班的那个本地模型**填进去 ——
   * 型号是运行时数据。取不到时(`undefined`)退成「本地模型」,**不猜一个型号**。
   */
  readonly body: (localModel: string | undefined) => string
}

const MODES: Record<OfflineMode, OfflineModeSpec> = {
  local: {
    tone: 'warn',
    icon: 'wifi-off',
    tag: '离线 · 本地模型',
    title: '已离线 —— 改用本地模型继续',
    body: (localModel) =>
      `Agent 推理已切到本地${localModel === undefined ? '模型' : ` ${localModel}`}。历史会话、产物、工作区文件与本地工具执行均正常。上下文窗口与速度低于云端模型，长任务可能被截断。`,
  },
  readonly: {
    tone: 'neutral',
    icon: 'cloud-off',
    tag: '离线 · 仅查看',
    title: '已离线 —— Agent 暂不可用',
    body: () =>
      '本工作区未启用本地模型，因此 agent 无法推理。历史会话、产物与工作区文件仍可读，本地工具执行仍可用。恢复网络，或在工作区设置里启用本地模型。',
  },
}

export { MODES as OFFLINE_MODES }

export interface OfflineBannerProps {
  readonly mode: OfflineMode
  /**
   * `local` 档下顶班的本地模型标识,**原样**填进正文,如 `'ollama（qwen2.5:14b）'`。
   *
   * 省略时正文退成「已切到本地模型」—— 少一句具体,好过说一个不对的型号:
   * 用户读这句话是为了估「上下文够不够、会不会被截断」。
   * `readonly` 档用不到它(那一档根本没有模型在跑)。
   */
  readonly localModel?: string
  /**
   * `readonly` 档右侧「工作区设置」按钮。这一档的正文明写「在工作区设置里
   * 启用本地模型」,而那条出路只有这个按钮 —— 不接等于把人指向一扇打不开的门。
   */
  readonly onOpenSettings?: () => void
}

export function OfflineBanner({
  mode,
  localModel,
  onOpenSettings,
}: OfflineBannerProps): React.JSX.Element | null {
  const m = MODES[mode]
  if (!m) return null
  const warn = m.tone === 'warn'
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 'var(--s-4)',
        alignItems: 'flex-start',
        padding: 'var(--s-5) var(--s-6)',
        borderRadius: 'var(--r-1)',
        background: warn ? 'var(--warn-surface)' : 'var(--neutral-surface)',
        border: `1px solid ${warn ? 'var(--warn)' : 'var(--border-control)'}`,
      }}
    >
      <Icon
        name={m.icon}
        size={15}
        tone="inherit"
        style={{ color: warn ? 'var(--warn)' : 'var(--text-secondary)' }}
      />
      <div style={{ display: 'grid', gap: 'var(--s-3)', flex: 1 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-4)',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              font: 'var(--fw-medium) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: warn ? 'var(--warn)' : 'var(--text-body)',
            }}
          >
            {m.title}
          </span>
          <Tag tone={m.tone} mono>
            {m.tag}
          </Tag>
        </span>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '84ch',
          }}
        >
          {m.body(localModel)}
        </span>
      </div>
      {mode === 'readonly' ? (
        <Button size="compact" onClick={() => onOpenSettings?.()}>
          工作区设置
        </Button>
      ) : null}
    </div>
  )
}

/** 队列里的一条:断网期间敲下的指令原文 + 敲下的时刻。 */
export interface QueuedInput {
  /** 时刻,**已格式化好的展示串**(如 `'09:41'`);mono caption,列宽固定 44px */
  readonly at: string
  /** 指令原文。**原样列出** —— 用户要靠它重新认出自己写过什么 */
  readonly text: string
}

export interface QueuedInputCardProps {
  /**
   * 排队的输入。**受控** —— 组件不留副本,增删都要走回调改到真身上。
   * 空数组时整块不渲染(理由见模块注释「空态」一节)。
   */
  readonly items: readonly QueuedInput[]
  /** readonly 下发送按钮禁用,队列保留到恢复连接 */
  readonly mode: OfflineMode
  /**
   * 队列上限,只用来渲染右上角那句说明。**执行上限的是调用方** ——
   * 组件说出来的数必须与调用方真正执行的那个一致,否则又是一句不成立的陈述。
   * 默认 5,即设计侧定下的那条策略。
   */
  readonly limit?: number
  /** 丢弃第 `index` 条。不接则「丢弃这条」点下去什么也不发生,**而不是假装丢掉了** */
  readonly onDiscard?: (index: number) => void
  readonly onDiscardAll?: () => void
  readonly onSendAll?: () => void
}

/** 设计侧定下的队列上限。见 {@link QueuedInputCardProps.limit}。 */
const DEFAULT_QUEUE_LIMIT = 5

/* ★ 已排队但没发出去的输入:**保留,恢复后一次性确认,不自动发出。**
   自动发出的风险是用户已经忘了自己敲过什么 —— 断网期间敲的三条指令在恢复时
   同时开跑,agent 按十分钟前的意图改文件,用户看到的是"它自己动了"。
   逐条确认的风险是恢复网络后要点三次,而且每次都要重新读一遍。
   折中:**整批一次确认,但把原文和时间戳完整列出来**,让用户重新读到自己写过什么,
   一次点发送;不想发的逐条丢弃。门槛落在"你还认这些指令吗",只花一次点击。
   队列上限 5 条并写明:无上限的队列会变成一个用户看不见的待办堆。 */
export function QueuedInputCard({
  items,
  mode,
  limit = DEFAULT_QUEUE_LIMIT,
  onDiscard,
  onDiscardAll,
  onSendAll,
}: QueuedInputCardProps): React.JSX.Element | null {
  if (!items.length) return null
  return (
    <Card
      title={`离线期间排队的输入 · ${items.length} 条`}
      action={
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
            color: 'var(--text-tertiary)',
          }}
        >
          上限 {limit} 条
        </span>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--s-5)' }}>
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
            color: 'var(--text-secondary)',
            maxWidth: '80ch',
          }}
        >
          这些指令
          <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>不会自动发出</b>
          。恢复连接后请先读一遍——你可能已经忘了断网时写过什么，而 agent 会按它们改文件。
        </span>
        <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
          {items.map((q, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 'var(--s-5)',
                alignItems: 'flex-start',
                padding: 'var(--s-5)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--r-2)',
                background: 'var(--surface-subtle)',
              }}
            >
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                  flex: '0 0 auto',
                  width: 44,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {q.at}
              </span>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
                  color: 'var(--text-body)',
                  flex: 1,
                }}
              >
                {q.text}
              </span>
              {/* ⚠️ 按钮**逐行**构造,于是每个都知道自己是第几条。
                  kit 原版共享一份 `queue.filter(...)` 的本地闭包 —— 表面上「知道」,
                  实际只改到了组件自己的副本,调用方那份原封不动。 */}
              <IconButton icon="trash-2" label="丢弃这条" onClick={() => onDiscard?.(i)} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center' }}>
          <Button
            variant="primary"
            icon="send"
            disabled={mode === 'readonly'}
            onClick={() => onSendAll?.()}
          >
            全部发送（{items.length} 条）
          </Button>
          <Button variant="ghost" onClick={() => onDiscardAll?.()}>
            全部丢弃
          </Button>
          {mode === 'readonly' ? (
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1.5 var(--font-sans)',
                color: 'var(--text-tertiary)',
              }}
            >
              仅查看态下无法发送——队列会保留到恢复连接。
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
