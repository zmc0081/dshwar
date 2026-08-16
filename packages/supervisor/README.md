# @dshwar/supervisor

进程隔离的进程池。**一 principal 一进程** —— 越界成本从「一段提示词」升到「一个进程逃逸漏洞」。

> ⚠️ **进程隔离不是容器隔离。** 它不防内核提权,不限制 CPU / 内存,不隔离网络。
> 面向公众的多租户 SaaS 仍需要容器档 —— 由部署方的编排系统提供,本包不实现。

## 为什么需要它

到 V0.4.1 为止,DSHWAR 只有**逻辑隔离**:所有 principal 跑在同一个进程里,靠
`ctx.isolate()` 划分作用域。Harness 的 agent 能执行 shell、读写文件系统,所以
提示词注入、恶意 MCP、污染 skill 都可能越界 —— 逻辑隔离**只适用于互相信任的用户**。

这把产品挡在「一家公司内部」这个天花板下。本包拆掉那个天花板。

## 用法

```ts
import { createPrincipal } from '@dshwar/principal'
import { forkLauncher, Supervisor, AtCapacityError } from '@dshwar/supervisor'

const supervisor = new Supervisor({
  launcher: forkLauncher('./worker.mjs'),
  profile: 'enterprise',
  maxProcesses: 64, // 63 MB/进程 —— 这是必需项,不是调优项
  idleTimeoutMs: 300_000,
  onEvent: (e) => audit.record(e),
})

const lease = supervisor.acquire(createPrincipal({ id: 'u-alice', tenantId: 'acme' }))

const off = lease.onMessage((m) => console.log(m.kind, m.payload))
lease.send({ prompt: '你好' })

lease.cancel() // 只取消本路会话,不波及同进程的其他会话
off()
lease.release() // 引用归零后开始计空闲
```

## 设计要点

### 一 principal 一进程,不是一会话一进程

同一 principal 的多个并发会话**共用一个进程**,各持一个 `Lease`。这是数量级的差别:
冷启动 ~115 ms、常驻 ~63 MB(`docs/FEASIBILITY-REPORT-V45.md` §6),而冷启动里
九成花在进程创建与模块加载上 —— 优化装配代码没用,只能压进程复用率。

共用一条 IPC 通道意味着消息必须打 `leaseId` 标签,否则父进程收到一个事件无从知道
它属于哪一路。**取消尤其依赖这个标签**:取消一路会话不能波及同进程的其他会话,
否则「隔离」反而制造了新的越界。

### 满了就拒绝,不排队

排队的问题不在等待本身,而在**等待时间不可预测且不可观测** —— 槽位何时空出取决于
别的 principal 何时闲下来。排队意味着 HTTP 请求一直挂着,而挂着的请求本身占用网关的
连接与内存,于是「进程不够」这个局部问题升级成「网关被挂起的请求拖垮」的全局问题。
那正是加上限想避免的事故。

拒绝给出立即、明确、可重试的答复。网关把 `AtCapacityError` 映射成 `503` +
`Retry-After`,客户端和负载均衡器都认得这个语义。沿用 `@dshwar/policy` 的
**判定与执行分离**:本包只抛类型化错误,状态码由网关决定。

### 健康检查有两种,不能只做一种

- `isAlive(principalId)` —— 进程还活着吗(没退出)
- `ping(principalId, timeoutMs)` —— 还能响应吗(事件循环没被卡死)

一个陷入死循环或被同步 IO 阻塞的进程完全「活着」,但送进去的消息永远没有回音。
只检查存活会把这种进程一直留在池子里,占着 63 MB 谁也用不上。

### 身份走启动参数,不走环境变量

环境变量会被子进程 fork 出的孙进程继承(agent 会执行 shell 工具),principal 跟着漏
下去没有意义,而且在 `ps` 看得到环境的系统上等于把租户拓扑写在明面上。

### 匿名主体拿不到进程

硬规则 6,fail closed。给「认不出是谁」发一个专属沙箱是没有意义的 ——
那个沙箱属于谁?

## 隔离三档里的位置

| 档       | 是否经过本包 | 说明                                                  |
| -------- | ------------ | ----------------------------------------------------- |
| 逻辑     | ❌           | 就是 V0.2.0 以来的进程内驱动,加一层只多一次往返       |
| **进程** | ✅           | 本包                                                  |
| 容器     | 留接口       | 自定义 `ProcessLauncher` 即可 —— 池逻辑与创建方式正交 |

容器编排是部署方的 Kubernetes / Nomad 的事,在这里自造一套只会和它们打架(V0.4.5 红线 4)。

## 它**不**解决什么

**「上游 SDK 协议没有 cancel」不是本包的动机。** 那句话在 DSHWAR 语境下是错的:
进程内的 `Agent.cancel(cause)` 早在 V0.2.0 就实测可用,`DELETE /v1/sessions/{id}`
从那时起就能截断输出。**进程隔离是把一个已经好用的取消变成需要重新解决的问题**,
是代价而非收益(`ARCHITECTURE.md` §2.4)。

本包唯一的动机是**跨信任边界的安全隔离**。
