/**
 * 由契约的 OpenAPI 生成 SDK 类型。
 *
 * 用**编程式 API** 而非 `openapi-typescript` 的 CLI:CLI 走路径解析,
 * 而仓库路径含非 ASCII 字符时它会在 URL 编码上出错。
 *
 * 渲染逻辑在 `render.ts`,与校验测试共用同一条代码路径。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSchema } from './render.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = join(packageRoot, '..', '..', 'packages', 'api-contract', 'openapi.json')
const target = join(packageRoot, 'src', 'generated', 'schema.ts')

const document = JSON.parse(readFileSync(contractPath, 'utf8')) as Record<string, unknown>
const rendered = await renderSchema(document)

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, rendered, 'utf8')

const info = document['info'] as { version?: string } | undefined
console.log(`已生成 ${target}`)
console.log(`  契约版本 : ${info?.version ?? '(未知)'}`)
console.log(`  行数     : ${rendered.split('\n').length}`)
