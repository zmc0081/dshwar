/**
 * 上游版本守卫。
 *
 * CLAUDE.md 硬规则 3 要求「运行时校验实际版本,不匹配拒绝启动并给出可读提示」。
 *
 * ⚠️ **以 npm registry 版本为准。** 上游 monorepo 的根版本号与 registry 上的
 * 包版本号不一致,而我们消费的是 registry 上的那个。
 *
 * @module @dshwar/adapter-dsh-0.1.0/version-guard
 */
import { createRequire } from 'node:module'

/** 本适配层锁定的上游版本。 */
export const EXPECTED_UPSTREAM_VERSION = '0.1.0-rc.6'

/**
 * 本适配层触碰的全部上游包。
 *
 * 这份清单就是「上游接触面」的完整定义 —— 加一个包进来之前先问:
 * 它能不能只靠契约包的公开导出解决?
 */
export const GUARDED_PACKAGES = [
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-storage',
] as const

/** 上游版本与预期不符。 */
export class UpstreamVersionMismatchError extends Error {
  override readonly name = 'UpstreamVersionMismatchError'
  constructor(
    message: string,
    /** 实际解析到的版本,按包名列出。 */
    readonly actual: Readonly<Record<string, string>>,
  ) {
    super(message)
  }
}

/** 读取某个上游包在**当前解析结果**下的实际版本。 */
function readInstalledVersion(packageName: string): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require(`${packageName}/package.json`) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * 校验全部上游包的实际版本与 {@link EXPECTED_UPSTREAM_VERSION} 一致。
 *
 * 为什么要在运行时查而不是只靠 lockfile:lockfile 保证的是**安装**结果,
 * 而实际跑起来的可能是别的 —— monorepo 里的 `resolutions` 覆盖、
 * 打包工具的去重、容器里挂进来的 volume、以及有人手工 `npm i` 过。
 * 这些情况下 lockfile 仍然是对的,而进程里跑的是另一个版本。
 *
 * 版本不匹配时**拒绝启动**,而不是打一行警告。上游还在 rc 阶段,
 * 小版本之间的行为差异真实存在(Session 0 已经踩到过一次子包 `latest`
 * 标签指向半年前版本的坑)。带着不匹配的版本跑起来,故障会出现在
 * 离根因很远的地方。
 *
 * @throws {UpstreamVersionMismatchError} 任一上游包版本不符或解析不到
 */
export function assertUpstreamVersion(): void {
  const actual: Record<string, string> = {}
  const problems: string[] = []

  for (const packageName of GUARDED_PACKAGES) {
    const version = readInstalledVersion(packageName)
    if (version === undefined) {
      problems.push(`  ${packageName}: 解析不到(未安装?)`)
      continue
    }
    actual[packageName] = version
    if (version !== EXPECTED_UPSTREAM_VERSION) {
      problems.push(`  ${packageName}: 实际 ${version},预期 ${EXPECTED_UPSTREAM_VERSION}`)
    }
  }

  if (problems.length > 0) {
    throw new UpstreamVersionMismatchError(
      [
        `上游版本与本适配层(adapters/dsh-0.1.0)不匹配,拒绝启动。`,
        ...problems,
        '',
        '处理方式:',
        `  1. 若要跟版,先跑 pnpm test:contract —— 它会指出上游改了哪些语义`,
        `  2. 只改 adapters/ 目录,packages/** 不应因跟版而变动`,
        `  3. 改完把 EXPECTED_UPSTREAM_VERSION 与目录名一起升到新版本`,
        '',
        '⚠️ 上游子包的 npm dist-tags.latest 是坏的(停在 0.0.1-rc.1),',
        '   跟版请按版本号,不要依赖 latest 标签。',
      ].join('\n'),
      actual,
    )
  }
}

/**
 * 非抛错版本,供诊断端点与启动日志使用。
 *
 * @returns 每个受守卫包的实际版本与是否匹配
 */
export function inspectUpstreamVersions(): {
  expected: string
  packages: { name: string; actual: string | undefined; matches: boolean }[]
} {
  return {
    expected: EXPECTED_UPSTREAM_VERSION,
    packages: GUARDED_PACKAGES.map((name) => {
      const actual = readInstalledVersion(name)
      return { name, actual, matches: actual === EXPECTED_UPSTREAM_VERSION }
    }),
  }
}
