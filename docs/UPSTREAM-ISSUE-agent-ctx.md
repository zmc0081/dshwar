# 待提交的上游 issue:`ctx.agents.create()` 无法继承调用方的 context 作用域

> **状态**:🟠 **草稿,待仓库所有者提交。**
> 提交是对外动作,且本仓当前没有配置任何 remote —— 见 `docs/RELEASE-CHECKLIST.md`。
> 提交后请把 issue 链接回填到本文件与
> [`docs/DECISIONS/principal-scope-binding.md`](DECISIONS/principal-scope-binding.md)。
>
> **目标仓库**:DeepSeek Harness(`@deepseek-ai/dsh-*` 的上游)
> **依据**:CLAUDE.md 硬规则 1 —— 需要改上游才能实现 → 提 issue,不建 patch 目录。

## 为什么现在提

上游还在 `0.1.0-rc.x` 快速迭代,**API 尚未定型** —— 这是影响它的最高性价比窗口。
DSHWAR 大概率是第一个认真做多租户的消费方,这个约束对单用户场景完全不可见,
所以不主动提,上游没有理由发现它。

它是异步的,回复可能几周,**不阻塞 DSHWAR 任何工作** —— 我们已有可行的绕法。

---

## 正文(可直接贴)

### Title

`ctx.agents.create()` should let callers control the context the agent derives from

### Body

**Summary**

`AgentHandle.agent.ctx` is derived from the `AgentRegistry` plugin's own fiber,
which is fixed at plugin-load time (the root context). There is currently no way
for a caller to have the created agent derive from *their* context instead.

For single-user Harness this is invisible. For a multi-tenant consumer it means
**any context-scoped service cannot reach the agent's execution layer** — tools
and adapters run under a context that never sees the caller's scope.

**What we observed** (measured against `0.1.0-rc.6`)

We bind a per-request value with `ctx.isolate(SLOT)` + `ctx.provide(SLOT, value)`
and expect services accessed during agent execution to see it. They do not:

| how the agent was created | binding visible on `agent.ctx` |
| --- | --- |
| outside the scoped context | ✗ |
| **`create()` called on the scoped context** | ✗ |
| entirely inside the scope, awaited to completion | ✗ |

The third row is the important one: it is not a lifetime problem. Even with the
scope alive for the whole turn, the binding is not visible — because `agent.ctx`
simply is not derived from the context that `create()` was called on.

**Why the obvious workarounds are unsatisfying**

- *Re-enter the scope at each consumer.* Works, but every new context-scoped
  service must remember to do it, and forgetting is silent. In our case one such
  consumer resolves a filesystem root — forgetting there means writing every
  tenant's files into the same directory, with no error.
- *Provide the value on the root context.* Works, but only when the process
  serves exactly one principal. It is actively wrong for a shared process: every
  agent then sees the same value.

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
`agent.ctx` is *intentionally* rooted (and that consumers must not rely on
ambient context scoping during agent execution) would also help — right now the
behaviour is discoverable only by measurement.

**Context**

We are building a multi-tenant product layer on top of Harness. Full write-up of
the investigation, including the falsified hypotheses and the measurements above:
`docs/DECISIONS/principal-scope-binding.md` in our repository.

Happy to supply a minimal reproduction or test a patch.
