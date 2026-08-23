/**
 * DSHWAR 主色派生 —— 规范实现(R1–R5)。
 *
 * 输入一个种子 hex,输出 10 档 ramp + 6 个角色令牌,全部带对比度证明。
 *
 * ## 为什么它在这个包,而不在 `@dshwar/console-contract`
 *
 * `branding-variables.md` 裁决「色阶不进契约,只收种子色,**色阶由客户端派生**」;
 * `design-system-sync.md` 记的是「派生算法刻意不在契约里」。
 * V0.9.0 把这句话细化成:**算法在 `packages/design-system`(实现包),
 * 契约包只有形状**。理由是契约包的价值在于**稳定** —— 它被三种 SDK 生成器读、
 * 被契约冻结检查盯、被跨包 import;而派生算法会随对比度规则调整而变。
 * 把会变的东西放进必须稳的包,迟早要拆。
 *
 * ## ⚠️ 算法常量是规范的一部分
 *
 * L 表、k 表、14 次二分、中亮带 `[0.55, 0.80]` —— **不得按实现方便修改**。
 * 本文件是 `tokens/derive-accent.js` 的逐字移植:只改类型,不改数值与控制流。
 *
 * ⚠️ **移植时刻意少了一样:`clampDemo`。** 那是规范卡上「朴素逐通道钳制会
 * 漂移 L 与 H」那张演示表的数据源,**不参与任何派生值** —— 去掉它不改变
 * 本函数的任何输出。写在这里是因为「少了一样」应该是看得见的,
 * 而不是下一个人对着两份代码数字段时才发现。
 *
 * ## 未配置态不走本算法
 *
 * `tokens/accent.css` 的默认值**不是**本算法的输出 —— 未配置态是无彩的
 * (裁决 2026-08-21:中性外观 = 客户未配置,此时不得出现任何有彩主色)。
 * 本算法只在租户配置了 `primaryColor` 时运行。
 *
 * 契约字段 `accentColor` 按裁决 A 处理:**读入但不使用** ——
 * 它不参与中性态渲染,本算法也不为它派生第二条 ramp。
 *
 * @module @dshwar/design-system/accent/derive
 */

/** OKLCH 坐标。 */
export interface Oklch {
  readonly L: number
  readonly C: number
  readonly H: number
}

/** ramp 里的一档。 */
export interface RampStep {
  readonly step: string
  /** 该档的目标明度。锚定到种子时会被改成种子的 L。 */
  L: number
  /** 钳制后的实际彩度。 */
  C: number
  /** 钳制前请求的彩度。 */
  readonly Creq: number
  /** 请求彩度超出 sRGB 边界、被钳过。 */
  readonly clamped: boolean
  hex: string
  /** 这一档就是种子本身(|ΔL| ≤ 0.07 时锚定)。 */
  anchor: boolean
}

/** 一个角色令牌的对比度证明。写入时校验读的就是这张表。 */
export interface RoleRow {
  readonly role: string
  readonly label: string
  readonly hex: string
  /** 与之配对的前景/背景色。 */
  readonly on: string
  readonly ratio: number
  readonly min: number
  readonly note: string
  readonly ratioLabel: string
  readonly minLabel: string
  readonly pass: boolean
  readonly passLabel: 'PASS' | 'FAIL'
}

export interface DeriveTrace {
  readonly seedCrW: string
  readonly seedCrInk: string
  readonly inBand: boolean
  readonly steps: number
  readonly dL: string
  readonly dE: string
  readonly bandLabel: string
  readonly seedL: string
  readonly finalL: string
  readonly onLabel: string
  readonly finalCr: string
}

export interface DeriveResult {
  readonly seed: string
  readonly ramp: readonly RampStep[]
  readonly rows: readonly RoleRow[]
  readonly trace: DeriveTrace
  readonly solid: string
  readonly on: string
  readonly hover: string
  readonly active: string
  readonly text: string
  readonly strong: string
  readonly border: string
  readonly surface: string
  readonly relit: boolean
  readonly coords: string
  readonly strategy: 'RE-LIT' | 'VERBATIM'
}

export type Theme = 'light' | 'dark'

const f = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
const fi = (x: number): number => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))

function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inG = (v: readonly number[]): boolean => v.every((x) => x >= -0.001 && x <= 1.001)

/**
 * 把彩度钳进 sRGB 色域。
 *
 * 14 次二分:`C_req ≤ 0.339`(sRGB 最大彩度 0.323 × 1.05),
 * 于是 `0.339 / 2^14 ≈ 2.1e-5` —— 是 1e-4 目标的四分之一、8 位彩度量子的约 1/70。
 * 提前退出在 1e-4。
 */
export function clampC(L: number, C: number, H: number): number {
  if (inG(oklchToRgb(L, C, H))) return C
  let lo = 0
  let hi = C
  for (let i = 0; i < 14 && hi - lo > 1e-4; i += 1) {
    const m = (lo + hi) / 2
    if (inG(oklchToRgb(L, m, H))) lo = m
    else hi = m
  }
  return lo
}

export function hex(L: number, C: number, H: number): string {
  const c = clampC(L, C, H)
  return `#${oklchToRgb(L, c, H)
    .map((v) =>
      Math.round(f(Math.min(1, Math.max(0, v))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`
}

function channels(hx: string): [number, number, number] {
  const at = (i: number): number => fi(parseInt(hx.slice(i, i + 2), 16) / 255)
  return [at(1), at(3), at(5)]
}

function lum(hx: string): number {
  const [r, g, b] = channels(hx)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度。 */
export function contrast(a: string, b: string): number {
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

export function toOklch(hx: string): Oklch {
  const [r, g, b] = channels(hx)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

/** `[档名, 目标 L, 彩度系数 k]`。**规范常量,不得按实现方便修改。** */
const STEPS: readonly (readonly [string, number, number])[] = [
  ['050', 0.972, 0.1],
  ['100', 0.94, 0.2],
  ['200', 0.885, 0.38],
  ['300', 0.81, 0.58],
  ['400', 0.73, 0.78],
  ['500', 0.66, 0.92],
  ['600', 0.59, 1.0],
  ['700', 0.51, 0.94],
  ['800', 0.425, 0.84],
  ['900', 0.33, 0.68],
]

/**
 * R5 · 暗主题替换三样:L 常量表(.300 → .940 反向)、画布(n-950)、墨色(n-050)。
 *
 * k 表不动;R3 的中亮带与 R4 的「最接近画布」判据形式不变 —— 方向由画布自动决定。
 */
const STEPS_DARK: readonly (readonly [string, number, number])[] = [
  ['050', 0.3, 0.1],
  ['100', 0.36, 0.2],
  ['200', 0.43, 0.38],
  ['300', 0.5, 0.58],
  ['400', 0.57, 0.78],
  ['500', 0.64, 0.92],
  ['600', 0.71, 1.0],
  ['700', 0.79, 0.94],
  ['800', 0.87, 0.84],
  ['900', 0.94, 0.68],
]

const THEMES = {
  light: { steps: STEPS, canvas: '#FFFFFF', ink: '#1C2029' },
  dark: { steps: STEPS_DARK, canvas: '#0C0F17', ink: '#F4F6F9' },
} as const

/** 中亮带。**规范常量。** 带内的种子会被重打光,带外原样保留。 */
export const MID_BAND: readonly [number, number] = [0.55, 0.8]

/** 归一化 hex;认不出返回 `null`。 */
export function normalizeHex(s: string | null | undefined): string | null {
  let v = (s ?? '').trim().replace(/^#/, '')
  if (v.length === 3) {
    v = v
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : null
}

/** 认不出种子时的兜底 —— 与设计系统侧同值。 */
const FALLBACK_SEED = '#3A5CCC'

export function derive(seedHex: string, bodyMin = 4.5, theme: Theme = 'light'): DeriveResult {
  const T = THEMES[theme]
  const CANVAS = T.canvas
  const INK = T.ink
  const canvasL = toOklch(CANVAS).L
  const seed = normalizeHex(seedHex) ?? FALLBACK_SEED
  const s = toOklch(seed)
  const C0 = Math.max(s.C, 0.012)

  const ramp: RampStep[] = T.steps.map(([step, L, k]) => {
    const Creq = C0 * k * 1.05
    const C = clampC(L, Creq, s.H)
    return { step, L, C, Creq, clamped: Creq - C > 0.0005, hex: hex(L, C, s.H), anchor: false }
  })

  // R2b tie-break:|ΔL| 最小者胜;完全相等时锚定**更暗**的那一档(`<=` 保留靠后的)。
  let near = ramp[0]!
  for (const r of ramp) {
    if (Math.abs(r.L - s.L) <= Math.abs(near.L - s.L)) near = r
  }
  if (Math.abs(near.L - s.L) <= 0.07) {
    near.hex = seed
    near.anchor = true
    near.L = s.L
    near.C = s.C
  }

  // R3 —— 实心填充。两段:
  //  (a) 带内吸附:L 在中亮带 [0.55, 0.80] 之外**原样保留**;带内则重打光到较近的带边
  //      (暗填充 → 白标签,亮填充 → 墨标签)。
  //  (b) 对比度保证:继续以 ΔL = 0.02 远离中间,直到标签清过 4.5:1。
  const best = (h: string): number => Math.max(contrast(h, CANVAS), contrast(h, INK))
  const seedCrW = contrast(seed, CANVAS)
  const seedCrInk = contrast(seed, INK)
  const inBand = s.L > MID_BAND[0] && s.L < MID_BAND[1]
  let solidHex = seed
  let solidL = s.L
  let steps = 0
  if (inBand) {
    solidL = s.L <= (MID_BAND[0] + MID_BAND[1]) / 2 ? MID_BAND[0] : MID_BAND[1]
    steps = Math.round(Math.abs(solidL - s.L) / 0.02)
    solidHex = hex(solidL, clampC(solidL, s.C, s.H), s.H)
  }
  let guard = 0
  while (best(solidHex) < 4.5 && guard < 45) {
    guard += 1
    solidL += solidL <= 0.675 ? -0.02 : 0.02
    solidHex = hex(solidL, clampC(solidL, s.C, s.H), s.H)
    steps += 1
  }
  const relit = solidHex !== seed

  // 标签色按填充明度定;两个主题下都取白/墨中对比更高的一个。
  const on = contrast('#FFFFFF', solidHex) >= contrast('#0C0F17', solidHex) ? '#FFFFFF' : '#0C0F17'
  const sl = toOklch(solidHex)
  const dE = Math.hypot(
    sl.L - s.L,
    sl.C * Math.cos((sl.H * Math.PI) / 180) - s.C * Math.cos((s.H * Math.PI) / 180),
    sl.C * Math.sin((sl.H * Math.PI) / 180) - s.C * Math.sin((s.H * Math.PI) / 180),
  )
  const trace: DeriveTrace = {
    seedCrW: `${seedCrW.toFixed(2)}:1`,
    seedCrInk: `${seedCrInk.toFixed(2)}:1`,
    inBand,
    steps,
    dL: `${sl.L - s.L >= 0 ? '+' : ''}${(sl.L - s.L).toFixed(3)}`,
    dE: dE.toFixed(3),
    bandLabel: `L ∈ (${MID_BAND[0].toFixed(2)}, ${MID_BAND[1].toFixed(2)})`,
    seedL: s.L.toFixed(3),
    finalL: sl.L.toFixed(3),
    onLabel: on === '#FFFFFF' ? '白字 #FFFFFF' : '墨字 n-950',
    finalCr: `${best(solidHex).toFixed(2)}:1`,
  }

  // hover / active = 实心档 L ∓ 0.05 / 0.10,**朝远离画布方向** —— 亮主题变暗,暗主题变亮。
  const shift = (d: number): string => {
    const L2 = Math.min(0.98, Math.max(0.06, solidL + (canvasL > 0.5 ? -d : d)))
    return hex(L2, clampC(L2, s.C, s.H), s.H)
  }

  // R4 —— 角色搜索:取所有满足下限的档中、明度**最接近画布**的那一档。
  // 同一行代码在两个主题下方向自动相反(亮主题 = 最浅的达标档,暗主题 = 最深的达标档)。
  const pick = (min: number): { hex: string; step: string; ratio: number } => {
    const ok = ramp
      .filter((r) => contrast(r.hex, CANVAS) >= min)
      .sort((a, b) => Math.abs(a.L - canvasL) - Math.abs(b.L - canvasL))
    const first = ok[0]
    if (first !== undefined) {
      return { hex: first.hex, step: first.step, ratio: contrast(first.hex, CANVAS) }
    }
    // 10 档全不达标时按同一原则外推:远离画布方向 ΔL = 0.02
    const dir = canvasL > 0.5 ? -0.02 : 0.02
    let L = ramp.reduce(
      (m, r) => (Math.abs(r.L - canvasL) > Math.abs(m - canvasL) ? r.L : m),
      ramp[0]!.L,
    )
    for (let n = 0; n < 45; n += 1) {
      L += dir
      if (L <= 0.04 || L >= 0.99) break
      const h = hex(L, clampC(L, s.C, s.H), s.H)
      if (contrast(h, CANVAS) >= min) {
        return { hex: h, step: dir < 0 ? '900↓' : '900↑', ratio: contrast(h, CANVAS) }
      }
    }
    return { hex: INK, step: 'ink', ratio: contrast(INK, CANVAS) }
  }

  const text = pick(bodyMin)
  const strong = pick(7)
  const border = pick(3)

  let surface = ramp[0]!
  for (const r of ramp) {
    if (
      contrast(r.hex, CANVAS) < 1.25 &&
      contrast(INK, r.hex) >= 7 &&
      contrast(r.hex, CANVAS) >= contrast(surface.hex, CANVAS)
    ) {
      surface = r
    }
  }

  const rows: RoleRow[] = (
    [
      {
        role: 'accent.solid',
        label: '实心填充 / 主按钮底',
        hex: solidHex,
        on,
        ratio: best(solidHex),
        min: 4.5,
        note: relit ? `落在中亮带,已按 R3 重打光 ${steps} 步` : '种子原值保留',
      },
      {
        role: 'accent.on',
        label: '实心之上的文字',
        hex: on,
        on: solidHex,
        ratio: best(solidHex),
        min: 4.5,
        note: on === '#FFFFFF' ? '判定为白字' : '判定为墨字',
      },
      {
        role: 'accent.text',
        label: '链接 / 强调文字',
        hex: text.hex,
        on: CANVAS,
        ratio: text.ratio,
        min: bodyMin,
        note: `ramp ${text.step}`,
      },
      {
        role: 'accent.text.strong',
        label: '正文级强调(AAA)',
        hex: strong.hex,
        on: CANVAS,
        ratio: strong.ratio,
        min: 7,
        note: `ramp ${strong.step}`,
      },
      {
        role: 'accent.border',
        label: '可交互描边 / 焦点环',
        hex: border.hex,
        on: CANVAS,
        ratio: border.ratio,
        min: 3,
        note: `ramp ${border.step}`,
      },
      {
        role: 'accent.surface',
        label: '淡底(选中行、Tag 底)',
        hex: surface.hex,
        on: INK,
        ratio: contrast(INK, surface.hex),
        min: 7,
        note: `ramp ${surface.step},墨字在其上`,
      },
    ] as const
  ).map((r) => ({
    ...r,
    ratioLabel: `${r.ratio.toFixed(2)}:1`,
    minLabel: `≥ ${r.min}`,
    // 容差 0.005:比的是四舍五入到两位之后的数,与卡片上印的数字一致。
    pass: r.ratio >= r.min - 0.005,
    passLabel: (r.ratio >= r.min - 0.005 ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
  }))

  return {
    seed,
    ramp,
    rows,
    trace,
    solid: solidHex,
    on,
    hover: shift(0.05),
    active: shift(0.1),
    text: text.hex,
    strong: strong.hex,
    border: border.hex,
    surface: surface.hex,
    relit,
    coords: `L ${s.L.toFixed(3)} · C ${s.C.toFixed(3)} · H ${s.H.toFixed(1)}°`,
    strategy: relit ? 'RE-LIT' : 'VERBATIM',
  }
}
