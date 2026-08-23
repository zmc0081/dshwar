/**
 * 用量分组柱状图 + 图例。序列上限由柱宽决定,超限时先出一条「换表格」的提示。
 *
 * ## 与设计 kit 的差别
 *
 * 1. 第一行的 `window.DSHWARDesignSystem_264a5f` 解构换成 ES import。
 * 2. 内联 `style={{}}` 原样保留。柱子的填充是**按数据算出来的一次性样式**
 *    (点阵是 radial-gradient,尺寸随 `barWidth` 与数值变),做成类反而要为
 *    每个序列 × 每个高度各生成一条规则。
 * 3. 这一屏一个 `useState` 都没有 —— 三个真状态(看哪个维度 / 细柱还是常规 /
 *    几个维度)在 `UsageScreen` 手里,本组件是那三个状态的**纯投影**。
 *    受控在这一屏的含义就是「一个状态都不留」。
 *
 * ## V0.9.0 Session 3:从夹具写死改为受控 props
 *
 * 这一屏移植进来时**已经**是收 props 的,数据字段一个默认值都没有 ——
 * 所以这一轮不是「把夹具提出去」,而是把**它替调用方做的那些决定**交回去,
 * 并修掉六处「界面在说一件它并不知道的事」。
 *
 * ### 🚨 一:全是 0 的一组画出来**没有柱子**,与「没有数据」分不开
 *
 * 原版 `const max = Math.max(...groups.flatMap(…))`,柱高 `v / max`。
 * 两种真实存在的输入把它打穿:
 *
 * | 输入 | max | 柱高 |
 * | --- | --- | --- |
 * | 一个组都没有 | `Math.max()` = **-Infinity** | 负数 |
 * | 全部序列当天都是 0 | 0 | `0 / 0` = **NaN** |
 *
 * `height: NaN` 是一条无效的 CSS 声明,浏览器直接丢掉 —— 那根柱子于是**不见了**。
 * 而「这一天消耗为 0」与「这一天没有数据」是两件事:前者是一条读得出来的平基线,
 * 后者该走空态。画成同一个样子,等于请人从图上读出一个不成立的结论。
 *
 * 与 CLAUDE.md 里 `median([])` 返 NaN 是同一族:**退化输入让计算安静地失去意义**,
 * 而失去意义的那一刻,在输出上与正常那一刻一模一样。
 *
 * ⇒ 峰值改用 reduce 算(空集给 0),`peak <= 0` 时全部柱子落到地板高度 ——
 * 一条平的基线,读作「都是 0」。
 *
 * ### 🚨 二:组件自己把数字格式化成 `'412,000 tok'` —— 单位是它猜的
 *
 * 原版 tooltip 是 ``${name} · ${v.toLocaleString('en-US')} tok``。两处硬编码:
 * locale 写死 `en-US`(这是一个中文控制台),单位写死 `tok`。而本组件
 * **根本不知道**调用方喂进来的是 token、是元、还是次数 —— 同一屏的明细表里
 * 就有「成本 (¥)」那一列,把它接进来图上会显示「18,204 tok」。
 *
 * 给一个自己不知道的量标上单位,与在界面上写死一个不存在的 requestId 是同一族:
 * **界面出具了一份它没有依据的凭证。** 用户不会怀疑它,只会照着它算。
 *
 * ⇒ 读数由调用方给:{@link UsageChartProps.formatValue}。**不传就没有读数**,
 * 而不是退回一个猜的单位 —— 少一个 tooltip 是看得见的,一个错的单位不是。
 *
 * ### 🚨 三:某组的值比序列少时,少画的那根柱子读起来是 0
 *
 * 原版 `g.values.slice(0, shown)` —— 值不够就少画几根,而图例里那个维度照样列着。
 * 于是「这一天这个维度没有数」被画成了「这一天这个维度是 0」。
 *
 * 这不是数据异常(数据异常的两种形态各有一等公民的处理:0 画平基线,空走空态),
 * 是调用方把两个数组拼错了。⇒ 现在缺值即抛 `RangeError`,点名哪一组、缺第几根 ——
 * 与 `seriesAt` 越界抛出同一种做法:调用方的编程错误要在最早、最响的地方停下。
 *
 * ⚠️ 反过来「值比序列多」**不抛**:那是调用方主动少选了几个维度
 * (`UsageScreen` 的「4 维度 / 6 维度」就是这么用的),而**超出柱宽上限**的那种多,
 * 由下面那条横幅明说。少画得有人知道,而不是没人知道。
 *
 * ### 🚨 四:空态缺席 —— 零组画出来是一条 208px 的空基线加一排空图例
 *
 * 那个形状读起来像「加载失败」或「渲染坏了」,而它其实只是这个范围内没有用量。
 * **空不是错误,不该长得像错误。** ⇒ 零组与零序列各走一句朴素的空态,
 * 不带图标、不带边框、不带 danger 色。
 *
 * ### 🚨 五:底部那句低对比提示会点名屏幕上根本不存在的序列
 *
 * 「相邻序列 s2→s3 与 s5→s6 仅 2.71:1」是这套 chart token 的事实,但只画 2 条时
 * s3 / s5 / s6 一个都没出现。一句永远显示的注意事项会先变成背景噪音,
 * 然后在真正需要它的那一屏被跳过。⇒ 按**实际画出来的条数**只点在场的那一对,
 * 一对都不在场就整句不出。
 *
 * ### 🚨 六:9–11px 落在 token 文档没有定义的中间带,原版按「常规」放行 6 条
 *
 * 判据原本是 `barWidth <= 8 ? 4 : 6`,而 tokens/chart.css 写的是
 * 「细柱(≤8px)上限 4 · 常规(≥12px)上限 6」—— 9 / 10 / 11 两头都不属于。
 * 往宽了猜(给 6 条)等于在一个从未验证过的柱宽上画 6 条序列;往严了收,
 * 最多是少画两条,而且会弹出那条解释横幅。**一个会说话的降级,
 * 好过一个不会说话的放行。**
 *
 * ⇒ 判据改成 `barWidth >= 12 ? 6 : 4`,两个档把整条数轴分完,不留「其余情况」
 * 这一档(与「枚举是闭集,不留 unknown」是同一条)。今天两个真实调用值是 6 与 12,
 * 行为一个字不变。
 *
 * ## 为什么 `values` 还是数字,而不是格式化好的串
 *
 * 柱高只能由**量**算出来,`'412,000'` 算不出高度。这是本屏唯一一处数字该以
 * 数字形态进来的地方 —— 而**给人读的那一串**由 `formatValue` 给。两者分开之后,
 * 组件不再需要知道任何单位、任何 locale,也就不可能标错。
 *
 * ## 为什么没有 `selectedIndex` / `onSelect`
 *
 * 受控不等于「凡是能点的都补一个回调」。这一屏今天没有任何可点的元素,
 * 加一个没有落点的选中态,只会多出一个**没人维护的第二状态** ——
 * 它一旦与调用方的真实选中分家,高亮的那一列就会指向别处。
 * `ArtifactsScreen` 修的正是这个形状(高亮在第 5 行、右侧卡片还写着第 2 行)。
 * 要做下钻时再加,连同它的可聚焦元素与键盘路径一起加。
 *
 * ## 原 kit 注释(原样保留)
 *
 * 图表序列规则(tokens/chart.css):
 * 细柱状(柱宽 ≤8px)上限 4 · 常规(≥12px)上限 6
 * 第二编码通道 = 点阵 d1.5px / s3px / 相位固定 (1.5,1.5),不用斜纹
 * s2→s3 与 s5→s6 只有 2.71:1 → 必须同时靠形态或标注区分
 * 已配置态只换 s1 为 accent.solid,s2–s6 保持中性
 *
 * @module @dshwar/design-system/screens/console/UsageChart
 */
import type * as React from 'react'
import { CodeRef } from '../../components/CodeRef.tsx'
import { Icon } from '../../components/Icon.tsx'

interface SeriesSpec {
  /** chart.css 的序列色 token */
  tone: string
  /** 第二编码通道:实心 or 点阵 */
  fill: 'solid' | 'dot'
  /** 图例里标出的中性档位,读图时的第三个线索 */
  step: string
}

const SERIES: readonly SeriesSpec[] = [
  { tone: 'var(--chart-1)', fill: 'solid', step: 'n-900' },
  { tone: 'var(--chart-2)', fill: 'solid', step: 'n-600' },
  { tone: 'var(--chart-3)', fill: 'solid', step: 'n-300' },
  { tone: 'var(--chart-4)', fill: 'dot', step: 'n-900' },
  { tone: 'var(--chart-5)', fill: 'dot', step: 'n-600' },
  { tone: 'var(--chart-6)', fill: 'dot', step: 'n-300' },
]
const LIGHT = 2 // index of the n-300 tone within each triplet

/** tokens/chart.css 给「常规柱」定的下界。低于它一律按细柱的上限收(缺陷六)。 */
const REGULAR_MIN_WIDTH = 12
/** 常规柱能同时读清的序列数。 */
const REGULAR_CAP = 6
/** 细柱的上限 —— 点阵在 8px 上已经开始糊,再多一条只能靠颜色分,而颜色不够分。 */
const NARROW_CAP = 4

/** 柱子的地板高度(px)。0 也要留一条看得见的基线,否则它与「没有数据」同形。 */
const BAR_FLOOR = 6
/** 峰值柱的高度(px)。比容器矮 4px,留出顶部不贴边的余量。 */
const BAR_SPAN = 172

/**
 * 对比度只有 2.71:1 的两对相邻序列,以及各自「至少画到第几条才会同时在场」。
 *
 * 底部那句提示按它过滤 —— 点名一对屏幕上不存在的序列,比不提示更糟:
 * 它教会读者跳过这句话。
 */
const LOW_CONTRAST_PAIRS: readonly { readonly pair: string; readonly needs: number }[] = [
  { pair: 's2→s3', needs: 3 },
  { pair: 's5→s6', needs: 6 },
]

/**
 * `SERIES` 的下标访问。
 *
 * `noUncheckedIndexedAccess` 下数组下标是 `T | undefined`,必须收窄。
 * 越界是编程错误(调用方保证 `i < cap ≤ SERIES.length`),所以抛 ——
 * 与 kit 里读 `undefined.fill` 抛 TypeError 是同一种失败,只是消息可读。
 */
function seriesAt(i: number): SeriesSpec {
  const s = SERIES[i]
  if (s === undefined) throw new RangeError(`序列下标 ${i} 越界(共 ${SERIES.length} 条)`)
  return s
}

function fillStyle(i: number): React.CSSProperties {
  const s = seriesAt(i)
  const light = i % 3 === LIGHT
  const base: React.CSSProperties = { borderRadius: 2 }
  if (s.fill === 'dot') {
    base.background = `radial-gradient(circle at 1.5px 1.5px, ${s.tone} 0 0.75px, transparent 0.76px) 0 0/3px 3px, var(--surface-card)`
  } else {
    base.background = s.tone
  }
  if (light) {
    base.outline = '1px solid var(--chart-stroke-light)'
    base.outlineOffset = '-1px'
  }
  return base
}

/**
 * 柱宽 → 序列上限。两个档把整条数轴分完,**没有第三档**。
 *
 * 非正数或非有限数是调用方拼错了(柱宽来自布局常量,不来自数据):
 * `width: 0` 画出来是一整排看不见的柱子,而图例照样列着六个维度。
 */
function capFor(barWidth: number): number {
  if (!Number.isFinite(barWidth) || barWidth <= 0) {
    throw new RangeError(`barWidth 必须是正的有限数,收到 ${barWidth}`)
  }
  return barWidth >= REGULAR_MIN_WIDTH ? REGULAR_CAP : NARROW_CAP
}

export interface UsageSwatchProps {
  /** 序列下标,决定色与填充形态 */
  i: number
  /**
   * 边长 px,默认 12。
   *
   * ⚠️ 这个默认值是刻意留的,与「数据字段一律必填」不冲突:它是**尺寸**,
   * 不是**事实**。漏传时最坏是一个方块小了两像素,肉眼当场可见;
   * 而一个漏传的数据字段会显示成一个像模像样、却没有来源的数。
   */
  size?: number
}

/** 图例色块。与柱子共用同一个 `fillStyle`,形态因此不会两处分家。 */
export function UsageSwatch({ i, size = 12 }: UsageSwatchProps): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        flex: '0 0 auto',
        ...fillStyle(i),
      }}
    />
  )
}

export interface UsageChartGroup {
  /** X 轴刻度标签(mono)。已经是展示串,组件不做任何日期格式化。 */
  readonly label: string
  /**
   * 每个序列一个**量**,顺序与 `series` 对应。
   *
   * ⚠️ 本屏唯一以数字形态进来的字段 —— 柱高只能由量算出来。
   * 给人读的那一串走 {@link UsageChartProps.formatValue}。
   */
  readonly values: readonly number[]
}

export interface UsageChartProps {
  /** 每个 X 轴刻度一组。**零组是合法的**,走空态,不是错误。 */
  readonly groups: readonly UsageChartGroup[]
  /** 序列名,顺序与每组 `values` 对应。已经是展示名,不是 API 里的 id。 */
  readonly series: readonly string[]
  /** 柱宽 px。≥12 视为常规(序列上限 6),否则细柱(上限 4)。 */
  readonly barWidth: number
  /**
   * 把一个量格式化成给人读的串,如 `(412000, 'sonnet-4-5') => '412,000 tok'`。
   *
   * ⚠️ **不传 = 柱子上没有读数。** 这不是「缺个默认值」——
   * 单位与 locale 只有调用方知道,组件替它猜一个,猜错时界面看起来完全正常。
   */
  readonly formatValue?: (value: number, seriesName: string) => string
}

/** 一根柱子。序列名与量在这里已经配好对,渲染层不再做下标访问。 */
interface Bar {
  readonly seriesIndex: number
  readonly name: string
  readonly value: number
}

/** 一个 X 轴刻度上的一叠柱子。 */
interface Column {
  readonly label: string
  readonly bars: readonly Bar[]
}

/**
 * 把 `groups × series` 配成柱子,顺带把两处下标收窄在**同一个地方**。
 *
 * 收窄与校验合在一处是刻意的:分开写的话,渲染层还要再判一次 `undefined`,
 * 而那一次判断的两个分支(真缺值 / 编译器不知道不缺)会长得一模一样。
 */
function toColumns(
  groups: readonly UsageChartGroup[],
  series: readonly string[],
  shown: number,
): Column[] {
  return groups.map((group) => {
    const bars: Bar[] = []
    for (let i = 0; i < shown; i += 1) {
      const value = group.values[i]
      const name = series[i]
      if (value === undefined || name === undefined) {
        throw new RangeError(
          `分组「${group.label}」画不出第 ${i + 1} 根柱子(有 ${group.values.length} 个值、` +
            `${series.length} 个序列名,要画 ${shown} 根)—— 少一根柱子读起来是 0,` +
            `而它其实是「没有这个数」`,
        )
      }
      bars.push({ seriesIndex: i, name, value })
    }
    return { label: group.label, bars }
  })
}

/** 峰值。空集给 0,而不是 `Math.max()` 的 `-Infinity`(缺陷一)。 */
function peakOf(columns: readonly Column[]): number {
  let peak = 0
  for (const column of columns) {
    for (const bar of column.bars) {
      if (bar.value > peak) peak = bar.value
    }
  }
  return peak
}

/** `peak <= 0`(全 0,或全是负数这种不该出现的输入)时一律落到地板,画成平基线。 */
function barHeight(value: number, peak: number): number {
  if (peak <= 0) return BAR_FLOOR
  return Math.max(BAR_FLOOR, Math.round((value / peak) * BAR_SPAN))
}

export function UsageChart({
  groups,
  series,
  barWidth,
  formatValue,
}: UsageChartProps): React.JSX.Element {
  const cap = capFor(barWidth)
  const shown = Math.min(series.length, cap)
  const over = series.length > cap

  // 空态在最前面。两句分开写 —— 「没选维度」是操作,「没有用量」是事实,
  // 合成一句会让用户在两种完全不同的处境里读到同一个提示。
  if (series.length === 0) return <Empty text="没有选中任何维度" />
  if (groups.length === 0) return <Empty text="这个范围内还没有用量" />

  const columns = toColumns(groups, series, shown)
  const peak = peakOf(columns)
  const lowContrast = LOW_CONTRAST_PAIRS.filter((p) => shown >= p.needs).map((p) => p.pair)

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {over ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-4)',
            alignItems: 'flex-start',
            padding: 'var(--s-4) var(--s-5)',
            borderRadius: 'var(--r-1)',
            background: 'var(--surface-subtle)',
            border: '1px solid var(--border-default)',
          }}
        >
          <Icon name="table-2" size={14} />
          <span
            style={{
              font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
              color: 'var(--text-secondary)',
            }}
          >
            柱宽 <CodeRef>{barWidth}px</CodeRef> 下序列上限 {cap}，当前 {series.length}{' '}
            个维度。已只画前 {shown} 个 —— 剩下的请换
            <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>表格</b>或
            <b style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text-body)' }}>分面小图</b>
            ，不硬塞。
          </span>
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--s-5)',
          height: 208,
          padding: '0 var(--s-2)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        {columns.map((column) => (
          <div
            key={column.label}
            style={{ display: 'grid', gap: 'var(--s-3)', justifyItems: 'center' }}
          >
            <span style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 176 }}>
              {column.bars.map((bar) => (
                <span
                  key={bar.seriesIndex}
                  // 不传 formatValue 就没有这条 title —— 组件不替调用方猜单位。
                  title={formatValue?.(bar.value, bar.name)}
                  style={{
                    width: barWidth,
                    height: barHeight(bar.value, peak),
                    ...fillStyle(bar.seriesIndex),
                  }}
                />
              ))}
            </span>
            <span
              style={{
                font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                color: 'var(--text-tertiary)',
                whiteSpace: 'nowrap',
              }}
            >
              {column.label}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s-6)', flexWrap: 'wrap' }}>
        {series.slice(0, shown).map((name, i) => {
          const spec = seriesAt(i)
          return (
            // 序列名可能重名(两个部门同名是真会发生的),所以 key 带上下标。
            <span
              key={`${i}·${name}`}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}
            >
              <UsageSwatch i={i} />
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  color: 'var(--text-secondary)',
                }}
              >
                {name}
              </span>
              <span
                style={{
                  font: 'var(--fw-regular) var(--fs-caption)/1 var(--font-mono)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {spec.step}
                {spec.fill === 'dot' ? ' · 点阵' : ''}
              </span>
            </span>
          )
        })}
      </div>
      {lowContrast.length > 0 ? (
        <span
          style={{
            font: 'var(--fw-regular) var(--fs-caption)/1.6 var(--font-sans)',
            color: 'var(--text-tertiary)',
          }}
        >
          相邻序列 {lowContrast.join(' 与 ')} 仅 2.71:1 —— 图例的形态标注（实心 / 点阵 /
          描边）是它们的第二区分通道，不要只靠颜色读图。
        </span>
      ) : null}
    </div>
  )
}

/** 空态。刻意朴素 —— 空不是错误,不该长得像错误。 */
function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <span
      style={{
        font: 'var(--fw-regular) var(--fs-body)/var(--lh-body) var(--font-sans)',
        color: 'var(--text-tertiary)',
      }}
    >
      {text}
    </span>
  )
}
