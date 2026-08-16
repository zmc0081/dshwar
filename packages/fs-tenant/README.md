# @dshwar/fs-tenant

> 工作区根按租户钉死 —— **隔离的真实边界**。

`credentials` 解决的是「用谁的钱」,`fs` 解决的才是「能看谁的数据」。

## ⚠️ 先读这一段:它不是强边界

Harness agent **能执行 shell**。路径钉死抬高了越界成本,但一个能跑 `bash` 的 agent
不受本包约束。

**逻辑隔离仅适用于互相信任的用户。** 跨信任边界必须用进程隔离 + 容器。

本包也**不是沙箱**:只做路径钉死,策略结果喂给上游 `sandbox-policy` / `fs-sandbox`,
不另起炉灶(CLAUDE.md 第七节)。

## 用法

包装一个内层 `FileSystem`(通常是上游 `fs-local`):

```ts
const innerCtx = ctx.isolate('fs') // 两个 FileSystem 不能抢同一个服务名
await innerCtx.plugin(LocalFileSystem, { cwd: root })

await ctx.plugin(TenantFileSystem, { inner: innerCtx.fs, root })
```

每个主体的工作区根是 `{root}/{tenantId}/{userId}/{workspaceId}`(V0.4.1 起四段),
每次操作现场计算。省略 `workspaceId` 时落到 `default`,改造前的调用方零改动仍能工作。

**`workspaceId` 与 `tenantId` / `userId` 同级对待** —— 同一套白名单校验与
SHA-256 编码,不因它来自请求而放松。校验顺序是**先逐段校验 → 拼接 → resolve →
断言仍在根内**,四步都要:只做「拼接后再检查」拦不住一个叫 `..` 的 workspaceId,
它会先把路径抬回用户根、再由后续段落补回来,最终落在别人的目录下。

⚠️ **缺省只发生在取值阶段,不发生在校验阶段。** 给缺省值开旁路,那条旁路就是
攻击面 —— 非法的 `workspaceId` 会被直接拒绝,不会回落到 `default`。

> 上游 `fs-local` 自己的文档写明:`cwd` 是「a resolution default, **NOT a containment
> boundary** … enforce containment with a stricter backend」。`fs-tenant` 就是那个
> stricter backend —— 这是上游明示的扩展点,不是绕过。

## 两道防线,缺一不可

| 层                    | 拦什么                             | 挡不住什么                    |
| --------------------- | ---------------------------------- | ----------------------------- |
| **字面层**(`pinPath`) | `../`、绝对路径、UNC、盘符、空字节 | 符号链接                      |
| **realpath 层**       | 符号链接指向根外                   | 不存在的路径(realpath 会失败) |

两者的失效场景正好互补。少任何一道都有洞。

写路径的复查比读路径更要紧:读错文件是泄漏,写错文件是破坏,且不可逆。

## 标识符编码:白名单 + 哈希,而不是拒绝

`tenantId` 与 `userId` 要变成目录名。能放进白名单
(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)的**原样保留** —— 运维 `ls` 工作区根时看到
`acme/` 比看到一串哈希有用得多。

放不进的(`auth0|5f3c…`、SAML URN、中文租户名、`PROGRA~1`、`CON`、尾部点号)
一律 `_h_<sha256前32位>`:

- **不拒绝** —— 这些 id 完全合法,拒绝等于把用户挡在门外
- **不转义** —— 把 `|` 换成 `_` 会让 `a|b` 与 `a_b` 碰撞,那是跨用户的数据串通
- `_h_` 前缀落在白名单之外,所以没人能把 id 起成 `_h_<别人的哈希>` 去占用别人的目录

> 这一层用**白名单**,而 `@dshwar/principal` 用**黑名单**。不是不一致 ——
> 那一层判断「什么样的 IdP subject 该被接受」,白名单会挡住合法用户;
> 这一层判断「什么字符串能直接拼进路径」,只有白名单是安全的。

## ⚠️ Windows 本地开发:符号链接测试会静默跳过

Windows 非管理员且未开开发者模式时建不了符号链接,于是三条**最关键**的防线测试
跑了个空 —— 会打警告,但仍然是绿的。

CI 跑在 ubuntu 上,这道防线在 CI 里是真的被验证的。本地想复现:

```bash
pnpm test:linux packages/fs-tenant
```

## 许可

MIT
