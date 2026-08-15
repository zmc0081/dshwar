/**
 * minimal-server —— 三十行证明论点。
 *
 * 两个用户、两把 key、同一个运行时、同一个 `ctx.credentials.resolve(ref)` 调用点,
 * 各自解析到自己的凭据。消费方(`consumer.ts`)一行都不用改。
 *
 * 跑:`pnpm --filter @dshwar/example-minimal-server start`
 */
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { StaticAuth } from '@dshwar/auth-static'
import {
  InMemoryPrincipalCredentialStore,
  MultiuserCredentials,
} from '@dshwar/credentials-multiuser'
import { PrincipalService, runWithPrincipal } from '@dshwar/principal'
import { callModel } from './consumer.ts'

const API_KEY = credentialRef('DEEPSEEK_API_KEY')

const ctx = new Context()

// ---- 组装:三个 DSHWAR 插件,零上游改动 ----
await ctx.plugin(PrincipalService)
await ctx.plugin(StaticAuth, {
  entries: [
    { token: 'dev-alice', id: 'alice-e6f1', tenantId: 'acme', roles: ['member'] },
    { token: 'dev-bob', id: 'bob-a2b3', tenantId: 'globex', roles: ['member'] },
  ],
})

const store = new InMemoryPrincipalCredentialStore()
await ctx.plugin(MultiuserCredentials, { store })

// ---- 各自配一把 key ----
const alice = await ctx.auth.verify('dev-alice')
const bob = await ctx.auth.verify('dev-bob')
await store.put(alice, API_KEY, 'sk-alice-XXXX')
await store.put(bob, API_KEY, 'sk-bob-YYYY')

// ---- 服务端处理两个请求 ----
console.log('=== 两个用户，同一个消费方，同一个运行时 ===\n')

for (const token of ['dev-alice', 'dev-bob']) {
  const principal = await ctx.auth.verify(token) // 边缘认证
  const result = await runWithPrincipal(ctx, principal, callModel) // 会话作用域
  console.log(`${token.padEnd(10)} → ${result}`)
}

// ---- 匿名:fail closed ----
console.log('')
console.log(`${'(匿名)'.padEnd(10)} → ${await callModel(ctx)}`)

console.log('\n消费方 callModel() 完全不知道 principal 存在。这就是论点。')
