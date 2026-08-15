/**
 * 验证 D —— node-pty 在外部拉起的子进程中行为正常
 *
 * 为什么要验:DSHWAR 的 supervisor(V0.4.0,若验证 A/C 失败则提前到 V0.1.0)
 * 会以非交互方式拉起 dsh 进程。node-pty 在没有真实控制台的父进程下是否还能
 * 分配 PTY,决定了 dsh-tool-bash / dsh-terminal 这条链在服务端是否可用。
 * Windows 上走 ConPTY,与 Linux 的 forkpty 是两套实现,必须在目标平台实测。
 *
 * 本项**不是止损点**:失败只影响终端类工具在服务端的可用性,
 * 不动摇 principal 传播这一架构前提。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { check, checkEqual, groupHeader } from './harness.ts'

const G = '验证 D · node-pty 在非交互父进程下的可用性'
const here = dirname(fileURLToPath(import.meta.url))

interface ChildOutcome {
  code: number | null
  stdout: string
  stderr: string
}

/** 以非交互方式(stdio 全 pipe,无 TTY)拉起子进程,模拟 supervisor 的拉起方式。 */
function spawnNonInteractive(scriptPath: string): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'], // 关键:父进程不给 TTY
      cwd: join(here, '..'),
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    // 兜底:20 秒还没结束就杀掉,避免 PTY 卡住整个验证
    setTimeout(() => child.kill('SIGKILL'), 20_000).unref()
  })
}

export async function runD(): Promise<void> {
  groupHeader(`${G}(非止损点)`)

  // 父进程自身是否有 TTY —— 用于说明本次验证确实在「非交互」条件下进行
  check(
    G,
    'D0 父进程确认无 TTY(验证条件成立)',
    !process.stdout.isTTY,
    `process.stdout.isTTY = ${process.stdout.isTTY}`,
  )

  const outcome = await spawnNonInteractive(join(here, 'pty-child.ts'))

  const lines = outcome.stdout.split(/\r?\n/).filter(Boolean)
  const marker = (tag: string): string | undefined =>
    lines.find((l) => l.startsWith(`${tag}=`))?.slice(tag.length + 1)

  checkEqual(G, 'D1 子进程正常退出', outcome.code, 0)
  checkEqual(G, 'D1b 子进程侧确认自身无 TTY', marker('PARENT_TTY'), 'false')
  check(
    G,
    'D2 dsh-subprocess-local 可加载并注册为 ctx.subprocess',
    marker('LOADED') === 'true' && marker('SERVICE_READY') === 'true',
    marker('ERROR') ?? `LOADED=${marker('LOADED')} SERVICE_READY=${marker('SERVICE_READY')}`,
  )
  // 普通 spawn 与 spawnTerminal 是两条独立路径,分开判定才能界定结论边界
  check(
    G,
    'D2b 无 TTY 的父进程下普通 spawn 可用(非 PTY 路径)',
    marker('PLAIN_SPAWN_OK') === 'true',
    marker('PLAIN_SPAWN_OK') === 'true'
      ? `exit=${marker('PLAIN_SPAWN_EXIT')} 采样=${marker('PLAIN_SPAWN_SAMPLE')}`
      : (marker('PLAIN_SPAWN_ERROR') ?? ''),
  )

  check(
    G,
    'D3 无 TTY 的父进程下 spawnTerminal 成功分配 PTY',
    marker('SPAWNED') === 'true',
    marker('SPAWNED') === 'true' ? `pid=${marker('PID') ?? 'n/a'}` : (marker('ERROR') ?? ''),
  )
  check(
    G,
    'D4 PTY 回显可读(shell 真的在跑)',
    marker('ECHO_OK') === 'true',
    marker('ECHO_SAMPLE') ? `采样: ${marker('ECHO_SAMPLE')}` : (marker('ERROR') ?? ''),
  )
  check(
    G,
    'D5 终端会话可正常终止并达到静默',
    marker('TERMINATED') === 'true',
    `EXIT_KIND=${marker('EXIT_KIND') ?? 'n/a'} EXIT_CODE=${marker('EXIT_CODE') ?? 'n/a'}${
      marker('TERMINATE_NOTE') ? ` note=${marker('TERMINATE_NOTE')}` : ''
    }`,
  )

  if (outcome.code !== 0 || marker('ERROR')) {
    console.log(
      `\n  子进程 stderr(前 600 字符):\n  ${outcome.stderr.slice(0, 600).replace(/\n/g, '\n  ')}`,
    )
    if (marker('ERROR')) console.log(`  子进程报告的错误: ${marker('ERROR')}`)
  }
}
