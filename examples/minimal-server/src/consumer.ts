import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

const API_KEY = credentialRef('DEEPSEEK_API_KEY')

/**
 * 一个**普通的消费方** —— 想象它是上游的某个 LLM 适配器、某个工具、某个插件。
 *
 * 注意它做了什么:调 `ctx.credentials.resolve(ref)`,拿到 key,发请求。
 *
 * 注意它**没有**做什么:它不知道 principal 存在,不知道有多个用户,
 * 不知道凭据是从哪个 store 来的,更不知道那个 key 可能是网关按人换发的
 * 短时效 token。
 *
 * **整个 DSHWAR 的论点就是这个函数一行都不用改。**
 * 把 `credentials-local` 换成 `credentials-multiuser`,它自动变成多用户。
 */
export async function callModel(ctx: Context): Promise<string> {
  const credential = await ctx.credentials.resolve(API_KEY)

  if (credential === undefined) {
    // 匿名或未配置。fail closed —— 不猜、不回退、不去读环境变量。
    return '(no credential available)'
  }

  // 真实实现会在这里发 HTTP 请求。示例只把用到的 key 回显出来,
  // 好让「谁的钱」这件事肉眼可见。
  return `called model with ${credential.value} (source: ${credential.source})`
}
