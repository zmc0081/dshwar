/**
 * 纯渲染函数 —— 无副作用,由生成脚本与校验测试**共用**。
 *
 * 两者必须走同一条代码路径:输出哪怕只差一个换行,
 * 「是否已重新生成」的校验就会永远红或永远绿。
 */
import openapiTS, { astToString, type OpenAPI3 } from 'openapi-typescript'

export const HEADER = [
  '/**',
  ' * 由 packages/api-contract/openapi.json 自动生成 —— auto-generated,请勿手改。',
  ' * 重新生成:pnpm --filter @dshwar/sdk generate',
  ' */',
  '',
].join('\n')

/**
 * 把 OpenAPI 文档渲染成 TS 类型源码。
 *
 * 入参写 `Record<string, unknown>` 而不是 `OpenAPI3`:调用方拿到的就是
 * `JSON.parse` 的结果,让它们各自去断言等于把同一个断言抄两遍。文档本身由
 * `@dshwar/api-contract` 生成并有冻结测试守着,形状不对会先在那里红 ——
 * 所以这里的收窄只此一处,经 `unknown` 中转(两者无结构重叠,直接断言不成立)。
 */
export async function renderSchema(document: Record<string, unknown>): Promise<string> {
  return `${HEADER}${astToString(await openapiTS(document as unknown as OpenAPI3))}`
}
