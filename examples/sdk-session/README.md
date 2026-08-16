# examples/sdk-session

**第三方视角:仅凭 `@dshwar/sdk` 完成一次完整会话,不接触 dsh。**

这个包的 `package.json` 只有一个依赖:

```json
"dependencies": { "@dshwar/sdk": "workspace:*" }
```

没有 `@deepseek-ai/dsh-*`,没有 cordis,没有 `@dshwar/gateway`,连 devDependencies
都没有。**这是 M2 的验收标准本身** —— 如果在这个依赖面下写得出会话,那句
「第三方仅凭 SDK 完成一次完整会话」就是真的。

依赖面由 `gateway/test/sdk-example.test.ts` 钉住:往这里加一个上游依赖,测试就红。

## 跑

对着一个真实网关:

```bash
DSHWAR_BASE_URL=https://api.example.com DSHWAR_TOKEN=<你的令牌> \
  node examples/sdk-session/src/cli.ts "用一句话介绍你自己"
```

进度走 stderr,回答走 stdout —— 管道里拿到的是干净的正文。

## 五步

`src/session.ts` 走的是一次会话的全程:

| 步  | 调用              | 说明                                         |
| --- | ----------------- | -------------------------------------------- |
| 1   | `createSession()` |                                              |
| 2   | `createTurn()`    | 不等本轮跑完,只确认已受理                    |
| 3   | `stream()`        | 输出走 SSE;网关有事件缓冲,先发起再建流不会漏 |
| 4   | `getSession()`    |                                              |
| 5   | `deleteSession()` | 失败路径也走,否则网关侧留下挂着订阅的会话    |

## 测试在哪

在 `gateway/test/sdk-example.test.ts`,不在这里。装配网关需要上游那七个插件,
测试放进本包就污染了它的依赖面 —— 而依赖面干净正是本包要证明的东西。

那边起的是**真实 HTTP 服务器**(绑真实端口),不是 `app.fetch` 直调:SSE 走
chunked transfer,不过 socket 就等于把「流式能穿过 HTTP」跳过了。
