/**
 * 验证 D 的子进程侧。被父进程以 stdio=pipe(无 TTY)拉起 —— 这正是 supervisor
 * 将来拉起 dsh 的方式。
 *
 * 走**上游真实路径**:cordis 装载 LocalSubprocessRuntime,调 ctx.subprocess.spawnTerminal()。
 * 刻意不直接 import node-pty:要验的是「dsh-subprocess-local 的 PTY 能力可用」,
 * 不是「node-pty 这个包能装上」。
 *
 * 结果以 KEY=value 行写到 stdout,父进程解析。
 */
import { Context } from '@deepseek-ai/cordis'

const say = (k: string, v: string | number | boolean) => console.log(`${k}=${v}`)

const MAGIC = 'DSHWAR_PTY_OK_7391'

async function main(): Promise<void> {
  say('PARENT_TTY', Boolean(process.stdout.isTTY))

  let LocalSubprocessRuntime: typeof import('@deepseek-ai/dsh-subprocess-local').LocalSubprocessRuntime
  try {
    ;({ LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local'))
    say('LOADED', true)
  } catch (error) {
    say('LOADED', false)
    say('ERROR', `import failed: ${(error as Error).message}`)
    process.exit(1)
  }

  const ctx = new Context()
  try {
    await ctx.plugin(LocalSubprocessRuntime)
    say('SERVICE_READY', ctx.get('subprocess') !== undefined)
  } catch (error) {
    say('SERVICE_READY', false)
    say('ERROR', `plugin load failed: ${(error as Error).message}`)
    process.exit(1)
  }

  const runtime = ctx.get('subprocess') as import('@deepseek-ai/dsh-subprocess').SubprocessRuntime

  const isWindows = process.platform === 'win32'
  const argv = isWindows
    ? ['powershell.exe', '-NoLogo', '-NoProfile', '-Command', `Write-Output '${MAGIC}'`]
    : ['/bin/sh', '-c', `echo ${MAGIC}`]

  // 先跑普通 spawn(非 PTY)。它与 spawnTerminal 是两条独立代码路径,
  // 分开验证才能界定「终端不可用」这个结论的边界。
  try {
    const handle = runtime.spawn({
      argv,
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 5_000,
    })
    const spawnOutcome = await handle.done
    const collected = handle.collected.stdout?.readFrom(0).text ?? ''
    say('PLAIN_SPAWN_OK', collected.includes(MAGIC))
    say('PLAIN_SPAWN_EXIT', String(spawnOutcome.exitCode))
    say('PLAIN_SPAWN_SAMPLE', JSON.stringify(collected.replace(/\s+/g, ' ').trim().slice(0, 80)))
  } catch (error) {
    say('PLAIN_SPAWN_OK', false)
    say('PLAIN_SPAWN_ERROR', (error as Error).message.slice(0, 160))
  }

  let terminal: import('@deepseek-ai/dsh-subprocess').SubprocessTerminalHandle
  try {
    terminal = await runtime.spawnTerminal({
      argv,
      cwd: process.cwd(),
      rows: 30,
      cols: 80,
      graceMs: 5_000,
    })
    say('SPAWNED', true)
    say('PID', terminal.pid)
  } catch (error) {
    // 平台不支持是一条**结果**,不是崩溃 —— 正常退出,让父进程去判定与归类。
    say('SPAWNED', false)
    say('ERROR', `spawnTerminal failed: ${(error as Error).message}`)
    process.exit(0)
  }

  let buffer = ''
  terminal.output.on('data', (chunk) => {
    buffer += String(chunk)
  })

  const outcome = await Promise.race([
    terminal.done.then((o) => ({ kind: 'exit' as const, o })),
    new Promise<{ kind: 'timeout' }>((r) => setTimeout(() => r({ kind: 'timeout' }), 12_000)),
  ])

  // 给输出流一点排空时间
  await new Promise((r) => setTimeout(r, 300))

  const echoOk = buffer.includes(MAGIC)
  say('ECHO_OK', echoOk)
  say(
    'ECHO_SAMPLE',
    JSON.stringify(
      buffer
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, echoOk ? 80 : 200),
    ),
  )
  say('EXIT_KIND', outcome.kind)
  if (outcome.kind === 'exit') {
    say('EXIT_CODE', String(outcome.o.exitCode))
    say('EXIT_SIGNAL', String(outcome.o.signal))
  }

  try {
    await terminal.terminate()
    say('TERMINATED', true)
  } catch (error) {
    say('TERMINATED', false)
    say('TERMINATE_NOTE', (error as Error).message.slice(0, 120))
  }

  process.exit(0)
}

void main()
