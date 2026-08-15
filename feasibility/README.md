# feasibility/ —— Session 0 可行性证伪

> **这不是产品代码。** 不发布、不进 `packages/`、不参与 workspace 构建。
> 它的唯一职责是回答:ARCHITECTURE.md §2.2 押注的两条上游行为,到底成不成立。
>
> 结论见 [`../docs/FEASIBILITY-REPORT.md`](../docs/FEASIBILITY-REPORT.md)。

## 目录

| 路径                                      | 作用                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `verify/harness.ts`                       | 断言登记与结果汇总,刻意不引测试框架(测试基建在 Session 1 用 Vitest 建)          |
| `verify/a-isolate.ts`                     | 验证 A —— `ctx.isolate` 作用域传播(**止损点**)                                  |
| `verify/b-credentials.ts`                 | 验证 B —— 凭据不跨操作缓存(**止损点**)+ B10 `#private` 约束探查                 |
| `verify/c-concurrency.ts`                 | 验证 C —— 并发无串号(**止损点**)                                                |
| `verify/d-pty.ts` + `verify/pty-child.ts` | 验证 D —— PTY 在非交互父进程下可用                                              |
| `verify/run-all.ts`                       | 入口,含止损判定                                                                 |
| `verify-linux.sh`                         | 在 Linux 容器内复跑同一套脚本(验证 D 的结论必须在部署目标平台取得)              |
| `dsh-runtime/`                            | 单独安装上游 `dsh` CLI,用于探明通道形态;与验证工作区分开以免 caret 依赖干扰锁版 |

## 跑法

```bash
pnpm install
node verify/run-all.ts
```

Linux 复跑(部署目标平台):

```bash
docker run --rm -v "$PWD:/src:ro" -w / node:24 bash /src/verify-linux.sh
```

## 退出码

全绿为 0,任一断言失败为 1。

**当前恒为 1** —— B10a/B10b 是**预期失败**:cordis 用 Proxy 包装服务以重绑 `this.ctx`,
ECMAScript `#private` 字段在其上必然抛错。这条断言留着不改成「预期失败」,
是为了让上游哪天改了包装方式时,它能自己变绿并提醒我们放宽约束。

详见报告 §4.1 —— 该约束要求 Session 2–6 的所有 `Service` 子类改用 TypeScript `private`。
