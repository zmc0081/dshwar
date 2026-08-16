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
// `document.info.version`,不是 `document.version` —— 后者根本不存在,
// 于是这一行一直在打 `manifest.version` 那个兜底值。看起来对,因为两者
// 本来就相等;但它掩盖了一件事:**没人在验证生成出来的文档里那个字段真的写对了**。
// 这个错误活到 V0.4.6 才被发现,因为 scripts/ 从未经过 tsc。
console.log(`  info.version : ${document.info.version}`)
console.log(`  路径         : ${pathCount}`)
console.log(`  操作         : ${opCount}(其中 planned ${planned})`)
console.log(`  schemas      : ${Object.keys(document.components.schemas).length}`)
