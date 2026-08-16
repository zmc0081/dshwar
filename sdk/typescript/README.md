# @dshwar/sdk

DSHWAR API v1 的 TypeScript SDK。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 装

```bash
npm install @dshwar/sdk
```

## 用

```ts
import { DshwarClient } from '@dshwar/sdk'

const client = new DshwarClient({
  baseUrl: 'https://api.example.com',
  token: process.env.DSHWAR_TOKEN!, // 由**你的** IdP 签发,不是 DSHWAR 发的
})

const session = await client.createSession()
await client.createTurn(session.id, '用一句话介绍你自己')

for await (const event of client.stream(session.id)) {
  if (event.type === 'message.delta') process.stdout.write(event.text)
  if (event.type === 'turn.completed') break
}

await client.deleteSession(session.id)
```

完整可跑的例子见 [`examples/sdk-session`](../../examples/sdk-session)。那个包**只依赖
本 SDK** —— 没有 `@deepseek-ai/dsh-*`,没有 cordis。这不是巧合,是被测试钉住的验收标准。

## 三件值得知道的事

### 类型是生成的,不是手写的

`src/generated/schema.d.ts` 由 `packages/api-contract/openapi.json` 生成,提交进仓库。
CI 会重新生成一遍并逐字节比对:契约改了而 SDK 没跟上,构建就红。

手写类型等于第二个事实源。两个事实源里总有一个是错的,而你不知道是哪个。

```bash
pnpm --filter @dshwar/sdk generate
```

### 错误码是闭集,所以 `switch` 能被编译器查漏

```ts
import { DshwarApiError, type DshwarErrorCode } from '@dshwar/sdk'

try {
  await client.createTurn(id, text)
} catch (error) {
  if (error instanceof DshwarApiError) {
    switch (error.code) {
      case 'conflict':
        return '上一轮还没跑完'
      case 'rate_limited':
        return '慢一点'
      // 漏掉分支时 TS 会因为 never 断言编译不过
    }
  }
}
```

契约里错误码定的是 `z.enum` 而不是 `z.string()`,换来的就是这个。反过来说:
**给契约加一个错误码是破坏性变更** —— 它会让下游已经写全的 `switch` 编译失败。

报障时把 `error.requestId` 给运维,他们能在日志与审计里精确定位那一次调用。

### 运行时与 Admin 是两个类

```ts
import { DshwarAdminClient } from '@dshwar/sdk'
```

令牌不同:Admin Key 按租户签发,不能冒充用户发起会话。分成两个类,是为了让
「拿错令牌」在类型层就写不出来。

`listCredentials()` 返回的 `CredentialDescriptor` 里**没有任何值字段** ——
`configured` / `source` / `writable` 三个,仅此。这不是 SDK 的选择,是契约层就
没给值留位置(CLAUDE.md 硬规则 5)。

## 流式的取消

`stream()` 是异步生成器,`break` 出循环即释放连接,服务端据此移除订阅:

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 30_000)

for await (const event of client.stream(id, { signal: controller.signal })) {
  // ...
}
```

断线续传传 `lastEventId`:

```ts
for await (const event of client.stream(id, { lastEventId: '42' })) {
  // 从第 43 条事件开始补发
}
```

## 许可

MIT
