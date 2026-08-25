/**
 * R9 · 对照基线 —— 「只加隔离,不改语义」的证明。
 *
 * 硬规则 8:单用户场景下,`single-user.yml` 与 `team.yml` 的行为必须完全一致。
 *
 * ## 实现方式的说明(与任务书的偏差)
 *
 * 任务书写的是「全部契约测试同时跑 single-user.yml 与 team.yml」。这里做的是
 * **等价的编程式对照**:按两个 profile 的实际组成各搭一个 context,对同一组
 * 操作断言输出一致。
 *
 * 不走 YAML 加载有两个原因:
 * 1. 加载 cordis.yml 需要 `cordis-plugin-loader` 与 `dshHomePath` 等宿主设施,
 *    那会把测试变成「测上游的 loader」,而不是测我们的语义
 * 2. profile 里的插件(llm / agent / session)需要真实的模型凭据才能起来,
 *    在 CI 里不可用
 *
 * 为了防止编程式组合与 YAML 漂移,下面另有一组断言直接读 YAML 文件,
 * 校验两个 profile 的**差异集**恰好是预期的那三个契约 + 身份插件。
 */
import { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { StaticAuth } from '@dshwar/auth-static'
import {
  InMemoryPrincipalCredentialStore,
  MultiuserCredentials,
} from '@dshwar/credentials-multiuser'
import { TenantFileSystem, tenantWorkspaceRoot } from '@dshwar/fs-tenant'
import { createPrincipal, PrincipalService, runWithPrincipal } from '@dshwar/principal'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REF: CredentialRef = credentialRef('DEEPSEEK_API_KEY')

/** 单用户场景里的那一个用户。 */
const soleUser = createPrincipal({ id: 'sole', tenantId: 'default' })

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'dshwar-parity-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
})

/** single-user.yml 的等价组合:上游原生插件 + 匿名 principal。 */
async function singleUserContext(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  return ctx
}

/** team.yml 的等价组合:换掉三个契约,其余不动。 */
async function teamContext(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(PrincipalService)
  await ctx.plugin(StaticAuth, {
    entries: [{ token: 'sole', id: soleUser.id, tenantId: soleUser.tenantId }],
    quiet: true,
  })

  const innerCtx = ctx.isolate('fs')
  await innerCtx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(TenantFileSystem, { inner: innerCtx.fs as FileSystem, root })

  return ctx
}

describe('文件系统 · 单用户下语义一致', () => {
  it('写入后读回的内容相同', async () => {
    const nativeRoot = join(tmp, 'native')
    const teamRoot = join(tmp, 'team')
    await mkdir(nativeRoot, { recursive: true })
    await mkdir(tenantWorkspaceRoot(teamRoot, soleUser), { recursive: true })

    const native = await singleUserContext(nativeRoot)
    const team = await teamContext(teamRoot)

    const nativeResult = await (async () => {
      const t = await native.fs.resolve('notes.md')
      await native.fs.writeText(t, 'same content')
      return native.fs.readText(t)
    })()

    const teamResult = await runWithPrincipal(team, soleUser, async (c) => {
      const t = await c.fs.resolve('notes.md')
      await c.fs.writeText(t, 'same content')
      return c.fs.readText(t)
    })

    expect(teamResult).toBe(nativeResult)
  })

  it('stat 的存在性判断一致', async () => {
    const nativeRoot = join(tmp, 'native2')
    const teamRoot = join(tmp, 'team2')
    await mkdir(nativeRoot, { recursive: true })
    await mkdir(tenantWorkspaceRoot(teamRoot, soleUser), { recursive: true })

    const native = await singleUserContext(nativeRoot)
    const team = await teamContext(teamRoot)

    const nativeMissing = await native.fs.stat(await native.fs.resolve('nope.txt'))
    const teamMissing = await runWithPrincipal(team, soleUser, async (c) =>
      c.fs.stat(await c.fs.resolve('nope.txt')),
    )

    expect(nativeMissing).toBeUndefined()
    expect(teamMissing).toBeUndefined()
  })

  it('listDir 的条目名一致', async () => {
    const nativeRoot = join(tmp, 'native3')
    const teamRoot = join(tmp, 'team3')
    await mkdir(nativeRoot, { recursive: true })
    await mkdir(tenantWorkspaceRoot(teamRoot, soleUser), { recursive: true })

    const native = await singleUserContext(nativeRoot)
    const team = await teamContext(teamRoot)

    for (const name of ['a.txt', 'b.txt']) {
      await native.fs.writeText(await native.fs.resolve(name), 'x')
    }
    const nativeNames = (await native.fs.listDir(await native.fs.resolve('.')))
      .map((e) => e.name)
      .sort()

    const teamNames = await runWithPrincipal(team, soleUser, async (c) => {
      for (const name of ['a.txt', 'b.txt']) {
        await c.fs.writeText(await c.fs.resolve(name), 'x')
      }
      const entries = await c.fs.listDir(await c.fs.resolve('.'))
      return entries.map((e) => e.name).sort()
    })

    expect(teamNames).toEqual(nativeNames)
  })

  it('sandboxMode 一致(都不做约束)', async () => {
    const nativeRoot = join(tmp, 'native4')
    const teamRoot = join(tmp, 'team4')
    await mkdir(nativeRoot, { recursive: true })
    await mkdir(tenantWorkspaceRoot(teamRoot, soleUser), { recursive: true })

    const native = await singleUserContext(nativeRoot)
    const team = await teamContext(teamRoot)

    expect(team.fs.sandboxMode).toBe(native.fs.sandboxMode)
  })
})

describe('凭据 · 单用户下语义一致', () => {
  it('已配置时 resolve 拿到值,describe 报 configured', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    const store = new InMemoryPrincipalCredentialStore()
    await store.put(soleUser, REF, 'sk-only-user')
    await ctx.plugin(MultiuserCredentials, { store })

    const resolved = await runWithPrincipal(ctx, soleUser, (c) => c.credentials.resolve(REF))
    const info = await runWithPrincipal(ctx, soleUser, (c) => c.credentials.describe(REF))

    expect(resolved?.value).toBe('sk-only-user')
    expect(info.configured).toBe(true)
    expect(info.writable).toBe(true)
  })

  it('未配置时 resolve 返回 undefined —— 与上游 seam 语义一致', async () => {
    const ctx = new Context()
    await ctx.plugin(PrincipalService)
    await ctx.plugin(MultiuserCredentials, { store: new InMemoryPrincipalCredentialStore() })

    const resolved = await runWithPrincipal(ctx, soleUser, (c) => c.credentials.resolve(REF))
    expect(resolved).toBeUndefined()
  })
})

describe('两个 profile 的差异集恰好是预期的那几个插件', () => {
  /** 从 profile YAML 里抽出插件名清单。刻意不引 yaml 解析器 —— 只需要 name 行。 */
  async function pluginNames(profile: string): Promise<string[]> {
    const text = await readFile(join(process.cwd(), 'profiles', profile), 'utf8')
    return [...text.matchAll(/^\s*name:\s*'([^']+)'/gm)].map((m) => m[1] as string).sort()
  }

  it('single-user.yml 只含上游插件加一个 principal', async () => {
    const names = await pluginNames('single-user.yml')
    const dshwarPlugins = names.filter((n) => n.startsWith('@dshwar/'))
    expect(dshwarPlugins).toEqual(['@dshwar/principal'])
  })

  // 对照的价值全在这里：差异集越小，「只加隔离」这句话越可信
  it('team.yml 相对 single-user.yml 只多出身份与三个契约替换', async () => {
    const single = await pluginNames('single-user.yml')
    const team = await pluginNames('team.yml')

    const addedInTeam = team.filter((n) => !single.includes(n)).sort()
    const removedInTeam = single.filter((n) => !team.includes(n)).sort()

    expect(addedInTeam).toEqual([
      '@dshwar/auth-static',
      '@dshwar/credentials-multiuser',
      '@dshwar/fs-tenant',
      '@dshwar/storage-scoped',
    ])
    expect(removedInTeam).toEqual([
      '@deepseek-ai/dsh-credentials-local',
      '@deepseek-ai/dsh-fs-local',
      '@deepseek-ai/dsh-storage',
    ])
  })

  it('team.yml 不含 session-query-sqlite(它会跨租户)', async () => {
    const names = await pluginNames('team.yml')
    expect(names).not.toContain('@deepseek-ai/dsh-session-query-sqlite')
  })

  // gateway.yml 是 V0.2.0 Session 6 加的部署组合。它的价值同样在「差异集小」:
  // 网关只是换了个入口,不该顺手改变隔离语义。
  it('gateway.yml 的身份与隔离部分与 team.yml 逐行相同', async () => {
    const team = await pluginNames('team.yml')
    const gateway = await pluginNames('gateway.yml')

    const dshwarIn = (names: string[]) => names.filter((n) => n.startsWith('@dshwar/')).sort()
    expect(dshwarIn(gateway)).toEqual(dshwarIn(team))
  })

  it('gateway.yml 相对 team.yml 只多出驱动 agent 所需的插件', async () => {
    const team = await pluginNames('team.yml')
    const gateway = await pluginNames('gateway.yml')

    const added = gateway.filter((n) => !team.includes(n)).sort()
    const removed = team.filter((n) => !gateway.includes(n)).sort()

    // 这四个分两类,理由不同 —— 合成一句「驱动 agent 所需」会把第二类的
    // 决定隐掉,而那是一次**安全决定**,该被看见。
    //
    // ① 前三个:少任何一个,ctx.agents.create() 能建出对象但 followup() 不产生输出。
    //    清单来自 docs/FEASIBILITY-REPORT-V2.md §4.2 的实测装配。
    // ② dsh-tool-fs:**能力**,不是驱动。出厂带它是因为 fs-tenant 存在的
    //    全部意义就是隔离文件操作 —— 不带的话那把锁没有门
    //    (docs/DECISIONS/gateway-registers-no-tools.md)。
    //    ⚠️ team.yml 不需要它:那份 profile 交给 dsh 自己的 loader,
    //    而 dsh 的默认装配本来就带工具。
    // ⚠️ bash / 网络工具**不在这里** —— 那是部署方的安全决定,不是基座替他做。
    expect(added).toEqual([
      '@deepseek-ai/dsh-agent-loop',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tools',
    ])

    // ★ 反向对照:能跑命令的工具一个都不许出厂。
    //   上一条是「多了什么」,这一条是「不许多什么」—— 方向相反,
    //   而只有前者的话,哪天有人往 profile 里加个 bash 工具,
    //   改一行期望值就过了。
    for (const forbidden of [
      '@deepseek-ai/dsh-tool-bash',
      '@deepseek-ai/dsh-tool-pwsh',
      '@deepseek-ai/dsh-tool-web',
      // ⚠️ `dsh-subprocess-local` **不在这张表里**,而它确实在 profile 里 ——
      //    它是 shell 的**后端**,不是模型能调的工具,且程序化装配刻意不装它
      //    (runtime.ts 的 DELIBERATELY_OMITTED:node-pty 原生构建 + win32 抛错)。
      //    这条对照管的是「模型手上有什么」,不是「profile 里声明了什么」——
      //    后者由出厂装配那一侧的断言管(gateway/test/factory-tools.test.ts)。
    ]) {
      expect(gateway, forbidden + ' 不该出厂 —— 那是部署方的安全决定').not.toContain(forbidden)
    }
    expect(removed).toEqual([])
  })

  it('gateway.yml 同样不含 session-query-sqlite', async () => {
    const names = await pluginNames('gateway.yml')
    expect(names).not.toContain('@deepseek-ai/dsh-session-query-sqlite')
  })

  it('两个 profile 的上游插件部分逐个相同', async () => {
    const single = (await pluginNames('single-user.yml')).filter((n) =>
      n.startsWith('@deepseek-ai/'),
    )
    const team = (await pluginNames('team.yml')).filter((n) => n.startsWith('@deepseek-ai/'))

    // 差异只允许出现在被替换掉的那三个契约上
    const replaced = [
      '@deepseek-ai/dsh-credentials-local',
      '@deepseek-ai/dsh-fs-local',
      '@deepseek-ai/dsh-storage',
    ]
    expect(single.filter((n) => !replaced.includes(n))).toEqual(team)
  })
})
