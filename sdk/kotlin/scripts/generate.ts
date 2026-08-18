#!/usr/bin/env node
/**
 * 从契约生成 Kotlin 模型。
 *
 * ⚠️ **渲染逻辑不在这里** —— 它在 `render.ts`,与校验测试共用同一个函数。
 * 生成脚本只负责「读文件 / 写文件」这两件有副作用的事。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderKotlin } from './render.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const contract = join(packageRoot, '..', '..', 'packages', 'api-contract', 'openapi.json')
const target = join(packageRoot, 'src', 'generated', 'Models.kt')

const document = JSON.parse(readFileSync(contract, 'utf8')) as Record<string, unknown>
const source = renderKotlin(document)
writeFileSync(target, source, 'utf8')

const models = (source.match(/^data class /gm) ?? []).length
console.log(`已生成 ${target}`)
console.log(`  模型 : ${models}`)
console.log(`  行数 : ${source.split('\n').length}`)
