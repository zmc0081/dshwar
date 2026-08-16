/**
 * 生成 `openapi.json`。
 *
 * 产物**提交进仓库**,理由有二:
 * 1. `redocly lint` 与契约冻结检查(Session 6)需要一个可 diff 的文件
 * 2. 第三方工具(Refine / Appsmith)可以直接指向仓库里的这个 URL,
 *    不必先跑构建
 *
 * `info.version` 取自本包的 `package.json`,因此它自动参与全仓版本一致性检查。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpenApiDocument } from '../src/openapi.ts'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  version: string
}

const document = buildOpenApiDocument(manifest.version)
const target = join(packageRoot, 'openapi.json')

writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

const pathCount = Object.keys(document.paths).length
const opCount = Object.values(document.paths).reduce((n, ops) => n + Object.keys(ops).length, 0)
const planned = Object.values(document.paths).reduce(
  (n, ops) =>
    n +
    Object.values(ops).filter(
      (op) => (op as Record<string, unknown>)['x-dshwar-status'] === 'planned',
    ).length,
  0,
)

console.log(`已生成 ${target}`)
console.log(`  info.version : ${document.version ?? manifest.version}`)
console.log(`  路径         : ${pathCount}`)
console.log(`  操作         : ${opCount}(其中 planned ${planned})`)
console.log(`  schemas      : ${Object.keys(document.components.schemas).length}`)
