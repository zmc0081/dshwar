/**
 * 纯渲染函数 —— 无副作用,由生成脚本与校验测试**共用**。
 *
 * 两者必须走同一条代码路径:输出哪怕只差一个换行,
 * 「是否已重新生成」的校验就会永远红或永远绿。
 */
import openapiTS, { astToString } from 'openapi-typescript'

export const HEADER = [
  '/**',
  ' * 由 packages/api-contract/openapi.json 自动生成 —— auto-generated,请勿手改。',
  ' * 重新生成:pnpm --filter @dshwar/sdk generate',
  ' */',
  '',
].join('\n')

/** 把 OpenAPI 文档渲染成 TS 类型源码。 */
export async function renderSchema(document: Record<string, unknown>): Promise<string> {
  return `${HEADER}${astToString(await openapiTS(document))}`
}
