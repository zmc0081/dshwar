# feasibility-v2/ —— V0.2.0 Session 0 网关可行性证伪

> **这不是产品代码。** 不发布、不进 `gateway/`、不参与 workspace 构建。
> 它的唯一职责是回答:**网关能不能在进程内驱动 dsh agent。**
>
> 结论见 [`../docs/FEASIBILITY-REPORT-V2.md`](../docs/FEASIBILITY-REPORT-V2.md)。

## 目录

| 路径                      | 作用                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| `verify/runtime.ts`       | 进程内 harness 的最小组装 —— **这本身就是一项产出**:网关要拼哪七个插件 |
| `verify/fake-llm.ts`      | 确定性假 LLM 适配器                                                    |
| `verify/a-inprocess.ts`   | 验证 A —— 进程内驱动 agent(**止损点**)                                 |
| `verify/b-streaming.ts`   | 验证 B —— 流式输出                                                     |
| `verify/c-cancel.ts`      | 验证 C —— 取消(**止损点**)                                             |
| `verify/d-concurrency.ts` | 验证 D —— 并发会话隔离(**止损点**)                                     |
| `verify/run-all.ts`       | 入口,含止损判定                                                        |
| `verify-linux.sh`         | Linux 容器内复跑                                                       |

## 跑法

```bash
pnpm install
node verify/run-all.ts

# Linux 复跑
docker run --rm -v "$PWD:/src:ro" -w / node:24 bash /src/verify-linux.sh
```

## 为什么用假 LLM

验的是**网关能否驱动 harness**,不是模型质量。真模型会引入三个与结论无关的变量 ——
网络抖动、非确定输出、费用 —— 其中前两个会让「取消是否真的停住了输出」这类断言
**变得不可判定**。

上游 `LlmAdapter` 只有一个必需的抽象方法 `stream()`,替身成本极低。

## 结论

**32 条断言全部通过,Windows 与 Linux 一致。止损未触发。**

最要紧的一条:`ARCHITECTURE.md` §2.4 说「上游 SDK 协议没有 cancel」——
那说的是 **stdio JSON-RPC 协议层**;**进程内的 `Agent` 有 `cancel()`,而且真的截断输出**。
Supervisor 不需要提前。
