# `.mjs` 测试夹具的类型检查

> **决定**:方案 C —— 测试 tsconfig 开 `allowJs` + `checkJs`,`include` 覆盖 `**/*.mjs`。
> **日期**:2026-08-16 · **落地于**:V0.4.6 Session 1

## 问题

V0.4.5 引入了两个 `.mjs` 测试夹具:

| 文件                                          | 用途                             |
| --------------------------------------------- | -------------------------------- |
| `packages/supervisor/test/fixtures/echo-child.mjs` | 进程池的最小子进程               |
| `adapters/dsh-0.1.0/test/fixtures/child-agent.mjs` | 跨进程驱动的子进程(装 harness 全集) |

**它们必须是 `.mjs`。** 子进程由 `child_process.fork` 拉起,走 Node 原生模块解析,
不经过 Vitest 的转译 —— 改成 `.ts` 就跑不起来。

而 V0.4.5 建立的 `tsconfig.test.json` 机制 `include: ["test/**/*.ts"]`,
结构上够不到 `.mjs`。后果不是理论上的:

> `child-agent.mjs` 里 `yield { type: 'finish', reason: 'stop' }` —— 上游的
> `FinishReason` 是**对象** `{ kind: 'stop' }`。**同款错误在 7 个 `.ts` 测试文件里
> 被类型检查一次抓出来**(V0.4.6 立项时合并的 `b635a2d`),而 `.mjs` 这份活了
> 一整个版本,最后是靠人 grep 出来的。

## 三个方案

### A. 改写成 `.ts`,用 `node --experimental-strip-types` 跑

- ✅ 类型检查最强,与其余测试同一套机制
- ❌ **改变运行时形态**:要给 `fork` 传 Node 标志。V0.4.5 已经踩过一次 ——
  `gateway/test/cross-process-driving.test.ts` 不得不往 `NODE_OPTIONS` 里塞
  `--experimental-strip-types`,那是个全局副作用,会影响同进程里所有后续 fork
- ❌ 标志名带 `experimental`,Node 版本之间会变。CI 矩阵跑 22 与 24 两个版本,
  22.19 需要显式传、24 默认开 —— 又一处版本分叉

### B. 保持 `.mjs`,不检查,靠人看

- ✅ 零成本
- ❌ **这就是现状**,而现状已经放走了一个 bug。V0.4.6 整版存在的理由就是
  「绿色本身不构成证据」,在这里接受「靠人看」等于自相矛盾

### C. 保持 `.mjs`,测试 tsconfig 开 `allowJs` + `checkJs` ★ 采纳

- ✅ **运行时零改动**,不需要任何 Node 标志
- ✅ 与既有机制同一套(`tsconfig.test.json`),不新增概念
- ⚠️ JS 推断比 TS 弱,需要少量 JSDoc 补形状 —— 实测成本见下

## 实测:C 的成本与效力

开启后暴露 **31 处**类型错误,全部修完,分三类:

| 类别                   | 处理                                        | 例                                                      |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------- |
| 跨 IPC 边界的入参无类型 | 加 `@typedef` + `@param`                    | `process.on('message', (msg) => …)`                     |
| 生成器 yield 的字面量推成 `string` | ★ 给 `stream()` 标 `@returns`      | `{ type: 'block-start' }` 的 type 被推成 `string`        |
| 上游联合类型需要收窄    | 一处 `@type` 断言,与 `asUpstreamEvent` 同款 | `event.data?.turn`                                      |

**最关键的一条是第二类。** 不标 `@returns`,每个 `yield` 的对象字面量都被推成
`{ type: string, … }`,与 `StreamChunk` 的判别联合对不上 —— 报的是一个笼统的
「整个 stream 方法不兼容」,指不到具体哪一行。**标上返回类型,判别才生效:**

```js
/**
 * @param {import('@deepseek-ai/dsh-llm').GenerateOptions} request
 * @returns {AsyncGenerator<import('@deepseek-ai/dsh-llm').StreamChunk>}
 */
async *stream(request) { … }
```

### 负向验证:它真的会红

把 `reason` 改回错误形状:

```
adapters/dsh-0.1.0/test/fixtures/child-agent.mjs(90,29):
  error TS2322: Type 'string' is not assignable to type 'FinishReason'.
```

**正是活了一整个版本的那个 bug,精确指到行。**

## 配套守卫

`scripts/check-guards.mjs` 的「test/ 下的 .mjs 夹具都被 checkJs 覆盖」:
任何 `test/**/*.mjs` 所在的项目,其 `tsconfig.test.json` 必须同时有
`allowJs: true`、`checkJs: true`,且 `include` 含 `*.mjs`。

⚠️ **单独立一条而不是并进已有那条**,因为已有的
`checkTestTsconfigReferences` 只看 `.ts` —— 一个**只有** `.mjs` 夹具的包
对它完全不可见。这与 `examples/minimal-server` 漏掉的是同一类洞:
**守卫从「已经存在的东西」出发遍历,就看不见「本该存在却不存在」的东西。**

## 顺带修掉的一个隐患

`child-agent.mjs` 里 `request.signal?.aborted === true` 连读两次 ——
`aborted` 是 `readonly`,TypeScript 认定它读过一次就不会变,于是 `await` 之后的
第二次检查被判成恒假。而那里要的恰恰是**重新读一次**:取消就发生在那个 `await`
期间。已包成 `const aborted = () => …`,与 `gateway/test/harness.ts` 同款处理
(那一处是 `b635a2d` 修的,同一个坑在 `.mjs` 里又来了一次 —— 因为它当时不在检查范围内)。
