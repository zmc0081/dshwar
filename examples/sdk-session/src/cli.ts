/**
 * 命令行入口。对着一个真实网关跑:
 *
 * ```bash
 * DSHWAR_BASE_URL=https://api.example.com DSHWAR_TOKEN=dev-alice \
 *   node examples/sdk-session/src/cli.ts "用一句话介绍你自己"
 * ```
 */
import { runSession } from './session.ts'

const baseUrl = process.env['DSHWAR_BASE_URL']
const token = process.env['DSHWAR_TOKEN']

if (baseUrl === undefined || token === undefined) {
  console.error('需要 DSHWAR_BASE_URL 与 DSHWAR_TOKEN 两个环境变量。')
  process.exit(2)
}

const transcript = await runSession({
  baseUrl,
  token,
  prompt: process.argv[2] ?? '用一句话介绍你自己',
  log: (line) => console.error(`· ${line}`),
})

// 进度走 stderr,回答走 stdout —— 这样管道里拿到的是干净的正文
console.log(transcript.text)
