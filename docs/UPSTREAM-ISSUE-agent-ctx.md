# 待提交的上游 issue:`ctx.agents.create()` 无法继承调用方的 context 作用域

> **状态**:🟠 **草稿,待仓库所有者提交。**
> 提交是对外动作 —— 由仓库所有者决定时机。
> ~~本仓当前没有配置任何 remote~~ 已不成立:仓库已 public
> (<https://github.com/zmc0081/dshwar>),正文里引用的
> `docs/DECISIONS/principal-scope-binding.md` **可以直接给链接**,
> 不必再让对方「在我们仓库里找」。
> 提交后请把 issue 链接回填到本文件与
> [`docs/DECISIONS/principal-scope-binding.md`](DECISIONS/principal-scope-binding.md)。
>
> **目标仓库**:DeepSeek Harness(`@deepseek-ai/dsh-*` 的上游)
> **依据**:CLAUDE.md 硬规则 1 —— 需要改上游才能实现 → 提 issue,不建 patch 目录。

## 为什么现在提

**口径已改(V0.4.7)。** 最初写的是「希望有个更干净的绑定方式」——那低估了它。
补测之后确认:**这是通往低成本多租户模式的唯一路径。**

没有这个钩子,一个 runtime 只能服务一个 principal,多租户就只剩「一人一进程」
一条路 —— 50 人团队 = 50 进程 ≈ **3.2 GB** 常驻(Linux 实测 63 MB/进程;
Windows 是 58 MB,≈ 2.9 GB)。有了它,同一个 runtime 能安全地服务多个主体,
内存成本降一到两个数量级。

上游还在 `0.1.x-rc.x` 快速迭代,**API 尚未定型** —— 这是影响它的最高性价比窗口。

> 🚨 **提交前必须先处理这一条(2026-08-24 核实)。**
>
> 正文里的全部实测都是对着 **`0.1.0-rc.6`** 做的,而上游 npm 上现在是
> **`0.1.1-rc.2`**(`@deepseek-ai/dsh` 的 `latest` 与 `next` 都指向它)。
> 本仓仍锁在 `0.1.0-rc.6`。
>
> **「这个在最新版上还复现吗?」几乎一定是对方的第一句话。** 两个选择:
>
> | 做法                                   | 代价     | 得到什么                   |
> | -------------------------------------- | -------- | -------------------------- |
> | 先在 `0.1.1-rc.2` 上重测一遍再提       | 一次实测 | 不给对方一个合理的搁置理由 |
> | 照提,但在正文里写明测的是 `0.1.0-rc.6` | 0        | 诚实,但很可能换来一次往返  |
>
> ⚠️ 无论走哪条,**正文里的版本号必须与实际测过的那个一致** ——
> 这正是本仓反复付学费的那一类:一个没验过的前提,写下来就会被当成事实。
> DSHWAR 大概率是第一个认真做多租户的消费方,这个约束对单用户场景完全不可见,
> 所以不主动提,上游没有理由发现它。

它是异步的,回复可能几周,**不阻塞 DSHWAR 任何工作** —— 进程隔离档已经可用。

---

## 正文(可直接贴)

### Title

`ctx.agents.create()` should let callers control the context the agent derives from

### Body

**Summary**

`AgentHandle.agent.ctx` is derived from the `AgentRegistry` plugin's own fiber,
which is fixed at plugin-load time (the root context). There is currently no way
for a caller to have the created agent derive from _their_ context instead.

For single-user Harness this is invisible. For a multi-tenant consumer it means
**any context-scoped service cannot reach the agent's execution layer** — tools
and adapters run under a context that never sees the caller's scope.

**What we observed** (measured against `0.1.0-rc.6`)

We bind a per-request value with `ctx.isolate(SLOT)` + `ctx.provide(SLOT, value)`
and expect services accessed during agent execution to see it. They do not:

| how the agent was created                        | binding visible on `agent.ctx` |
| ------------------------------------------------ | ------------------------------ |
| outside the scoped context                       | ✗                              |
| **`create()` called on the scoped context**      | ✗                              |
| entirely inside the scope, awaited to completion | ✗                              |

The third row is the important one: it is not a lifetime problem. Even with the
scope alive for the whole turn, the binding is not visible — because `agent.ctx`
simply is not derived from the context that `create()` was called on.

**Every workaround we could find, and why each fails**

This is the part we would most like a second opinion on — we tried four routes
and all of them dead-end:

| Route                                                                         | Result                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provide the value on the **root** context                                     | Works, but applies to **every** agent — a shared process would attribute Bob's session to Alice                                                                                                                        |
| Provide it on **each agent's own** `ctx`                                      | First agent succeeds; the second throws `service "X" has been registered at <scope>`. Worse: if that error is swallowed (a very ordinary `try/catch`), the second agent **silently inherits the first one's identity** |
| Walk the fiber chain from the service's `this.ctx` back to the owning agent   | `cannot get property "ctx" without inject` — the inject guard blocks ancestry traversal                                                                                                                                |
| Plug a **per-agent instance** of the service onto the agent's ctx (shadowing) | `service "fs" has been registered at <TenantFileSystem>` — same mechanism as row 2                                                                                                                                     |

**The discriminating information exists** — `this.ctx` inside a service method
_is_ different per agent (we verified this). What is missing is any public API to
resolve that back to an agent identity.

**Why this matters beyond tidiness**

Without it, a runtime can serve exactly one principal, so multi-tenancy costs one
process per user. Measured, five-sample median:

| platform | cold start | resident per process |
| -------- | ---------- | -------------------- |
| Linux    | 86 ms      | 63 MB                |
| Windows  | 115 ms     | 58 MB                |

A 50-person deployment is ~3.2 GB resident before doing any work. With it, one
runtime could serve many principals safely.

**Proposed change**

Let the caller supply the context to derive from:

```ts
await ctx.agents.create({
  sessionId,
  agentOptions,
  // new, optional; defaults to today's behaviour
  parentCtx: scopedCtx,
})
```

Anything derived from that context — tool execution, adapter calls — would then
observe the caller's scope. This is additive and does not change existing
behaviour when the option is omitted.

**Alternative**

If exposing the parent context is undesirable, a documented statement that
`agent.ctx` is _intentionally_ rooted (and that consumers must not rely on
ambient context scoping during agent execution) would also help — right now the
behaviour is discoverable only by measurement.

**Context**

We are building a multi-tenant product layer on top of Harness. Full write-up of
the investigation, including the falsified hypotheses and the measurements above:
`docs/DECISIONS/principal-scope-binding.md` in our repository.

Happy to supply a minimal reproduction or test a patch.
