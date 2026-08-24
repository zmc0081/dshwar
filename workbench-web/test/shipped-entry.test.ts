/**
 * 出厂装配的测试 —— 验的是**出厂那条路**,不是「这么拼能工作」。
 *
 * ## 为什么单独一个文件,而不是并进 `hosts.test.ts`
 *
 * `hosts.test.ts` 证明的是「`hostConfig` 这个函数三宿主同构」。
 * 那句话即使全绿,也**完全不排除**出厂入口根本不调它 ——
 * 而那正是本仓付过三个版本代价的形状(CLAUDE.md 第六节那张表第 4 行):
 * `registerWorkspaceRoutes` 实现完整、测试齐全,`server.ts` 从不传它,
 * 七条路由在真实部署里全 404,一道红都没有。
 *
 * ⇒ 这里调的是 `bootstrap.tsx` 的 {@link bootstrapWorkbench} —— 出厂入口
 * 除去「找 `#root` + createRoot」之外的全部。那剩下的一行由本文件末尾
 * 一条**读源码**的断言盯着:`main.tsx` 里不许有第二个装配点。
 *
 * ## 主题那条断言为什么不看 `data-theme` 就算完
 *
 * 属性写对而派生用了另一个主题,是这一层最隐蔽的坏法:
 * 派生出的文字色落在暗画布上只有 2 点几比一,看起来像「颜色淡了点」。
 * 所以断言两头一起看:属性的值,与**真的写进 DOM 的那个 `--accent-text`**
 * 必须来自同一个主题(拿 `derive()` 现算两个主题的值,一个必须相等、
 * 另一个必须不等 —— 只断言相等的话,两个主题碰巧同值时它测不到任何东西)。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { derive } from '@dshwar/design-system'
import { bootstrapWorkbench, type RuntimeConfig } from '../src/bootstrap.tsx'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 记账用的假 documentElement —— 只实现 `BootstrapDocument` 要的那几个成员。 */
function fakeDoc(): {
  doc: { documentElement: FakeElement }
  props: Map<string, string>
  attrs: Map<string, string>
  removedProps: string[]
} {
  const props = new Map<string, string>()
  const attrs = new Map<string, string>()
  const removedProps: string[] = []
  const documentElement: FakeElement = {
    style: {
      setProperty: (name, value) => void props.set(name, value),
      removeProperty: (name) => {
        removedProps.push(name)
        props.delete(name)
      },
    },
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
  }
  return { doc: { documentElement }, props, attrs, removedProps }
}

interface FakeElement {
  readonly style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): void
  }
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** 跑一次出厂装配,返回结果与全部副作用。 */
function boot(config: Partial<RuntimeConfig>): {
  result: ReturnType<typeof bootstrapWorkbench>
  mounted: number
  props: Map<string, string>
  attrs: Map<string, string>
} {
  const { doc, props, attrs } = fakeDoc()
  let mounted = 0
  const result = bootstrapWorkbench({ __DSHWAR_CONFIG__: config }, doc, () => {
    mounted += 1
  })
  return { result, mounted, props, attrs }
}

const TOKEN = 'runtime-bearer-for-test'

describe('出厂装配走 hostConfig', () => {
  it('Tauri 的 baseUrl 由注入的端口算出来,不由宿主直接给', () => {
    const { result, mounted } = boot({ hostKind: 'tauri', gatewayPort: 51789, token: TOKEN })
    expect(result.baseUrl).toBe('http://127.0.0.1:51789')
    expect(mounted).toBe(1)
  })

  it('同源宿主拿到 "/" —— 不是空串,空串与「没配」无法区分', () => {
    for (const kind of ['remote-web', 'local-sidecar'] as const) {
      expect(boot({ hostKind: kind, token: TOKEN }).result.baseUrl).toBe('/')
    }
  })

  it('Tauri 缺端口时拒绝启动,而不是猜一个同源地址', () => {
    expect(() => boot({ hostKind: 'tauri', token: TOKEN })).toThrow(/端口/)
  })
})

describe('出厂装配 fail closed', () => {
  it('缺 hostKind 拒绝启动 —— 不回落到 remote-web', () => {
    expect(() => boot({ token: TOKEN })).toThrow(/hostKind/)
  })

  it('缺 token 拒绝启动', () => {
    expect(() => boot({ hostKind: 'remote-web' })).toThrow(/token/)
  })

  it('hostKind 拼错时停下,不安静地跑在同源配置上', () => {
    // 宿主注入的是运行期的 JSON,类型在那一刻已经不管用了 —— 这一条验的正是
    // 「类型说得对而运行期值是别的」那一格,所以这里必须绕过类型。
    const bogus = { hostKind: 'tauri-desktop', token: TOKEN } as unknown as Partial<RuntimeConfig>
    expect(() => boot(bogus)).toThrow(/未知的 hostKind/)
  })
})

describe('运行期主题接上了出厂入口', () => {
  const SEED = '#2F6FEB'

  it('data-theme 与真正写进 DOM 的派生值来自同一个主题', () => {
    const { result, props, attrs } = boot({
      hostKind: 'remote-web',
      token: TOKEN,
      primaryColor: SEED,
      theme: 'dark',
    })
    expect(attrs.get('data-theme')).toBe('dark')
    expect(result.theme).toBe('dark')
    // ★ 两头一起看:等于暗主题的值,且**不等于**亮主题的值。
    //   只断言前者的话,某个属性在两个主题下碰巧同值时这条就什么都没测到。
    expect(props.get('--accent-text')).toBe(derive(SEED, 4.5, 'dark').text)
    expect(props.get('--accent-text')).not.toBe(derive(SEED, 4.5, 'light').text)
    expect(attrs.get('data-brand')).toBe('configured')
    expect(result.branded).toBe(true)
  })

  it('未配置主色 = 中性外观:不写任何 accent 属性,也不挂 data-brand', () => {
    const { result, props, attrs } = boot({
      hostKind: 'remote-web',
      token: TOKEN,
      primaryColor: null,
    })
    expect(result.branded).toBe(false)
    expect(attrs.has('data-brand')).toBe(false)
    // 反向对照:上一条断言的是「没写」,而一个把 applyAccent 改成空函数的实现
    // 也能让它全绿。这里钉住 data-theme 仍然写了 —— 证明这条路真的走到了。
    expect(attrs.get('data-theme')).toBe('light')
    expect(props.size).toBe(0)
  })
})

/**
 * `main.tsx` 里除了一次 {@link bootstrapWorkbench} 之外没有第二个装配点。
 *
 * ⚠️ **按行跳过整行注释**。理由是 CLAUDE.md 的「守卫不能惩罚记录」:
 * 这条判据要拦的形状,恰恰是最值得在注释里写明「别搬回来」的那个 ——
 * 两者文本一模一样而语义相反。下面 `sansComments` 的反向对照就守这件事,
 * 并且**夹具在场**(`FIXTURE_*` 里真的有那样一段注释)。
 */
function sansComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'))
    })
    .join('\n')
}

const FIXTURE_COMMENT_ONLY = [
  '// 别在这里 createWorkbenchApi —— 装配在 bootstrap.tsx',
  ' * 也不要 hostConfig / applyAccent,理由见那个文件顶部',
  'bootstrapWorkbench(window, document, mount)',
].join('\n')

const FIXTURE_REAL_VIOLATION = [
  '// 别在这里 createWorkbenchApi —— 装配在 bootstrap.tsx',
  'const api = createWorkbenchApi({ baseUrl, token })',
].join('\n')

const ASSEMBLY_NAMES = ['createWorkbenchApi', 'hostConfig', 'applyAccent', 'readConfig']

describe('main.tsx 真的走出厂装配(那一行没人测得到,只能读源码)', () => {
  const main = readFileSync(join(SRC, 'main.tsx'), 'utf8')

  it('顶层调了 bootstrapWorkbench', () => {
    expect(sansComments(main)).toMatch(/^bootstrapWorkbench\(/m)
  })

  it('没有第二个装配点', () => {
    const code = sansComments(main)
    let checked = 0
    for (const name of ASSEMBLY_NAMES) {
      checked += 1
      expect(code, `main.tsx 里出现了 ${name} —— 装配应当只在 bootstrap.tsx`).not.toContain(name)
    }
    expect(checked, '一条都没断言到 —— 本条空跑了').toBe(ASSEMBLY_NAMES.length)
  })

  it('反向对照:讲这个形状的注释不算违规,而同名的代码算', () => {
    // 夹具在场才验得出来 —— 不摆夹具的话「跳过注释」这段逻辑放宽了也仍然全绿。
    expect(sansComments(FIXTURE_COMMENT_ONLY)).not.toContain('createWorkbenchApi')
    expect(sansComments(FIXTURE_REAL_VIOLATION)).toContain('createWorkbenchApi')
  })
})
