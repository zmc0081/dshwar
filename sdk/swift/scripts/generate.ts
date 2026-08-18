#!/usr/bin/env node
/**
 * 从契约生成 Swift 模型。
 *
 * ⚠️ **渲染逻辑不在这里** —— 它在 `render.ts`,与校验测试共用同一个函数。
 * 生成脚本只负责「读文件 / 写文件」这两件有副作用的事。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSwift } from './render.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const contract = join(packageRoot, '..', '..', 'packages', 'api-contract', 'openapi.json')
const target = join(packageRoot, 'src', 'generated', 'Models.swift')

const document = JSON.parse(readFileSync(contract, 'utf8')) as Record<string, unknown>
const source = renderSwift(document)
writeFileSync(target, source, 'utf8')

const models = (source.match(/^public struct /gm) ?? []).length
console.log(`已生成 ${target}`)
console.log(`  模型 : ${models}`)
console.log(`  行数 : ${source.split('\n').length}`)
