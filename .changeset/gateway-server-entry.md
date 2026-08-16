---
'@dshwar/gateway': minor
---

网关可执行入口:`docs/DEPLOYMENT.md` 里那条启动命令终于有对应的文件了

在此之前,唯一跑通过完整装配的地方是测试的 harness —— 部署文档写了启动命令,
但仓库里没有能被它执行的东西。

- `gateway/src/runtime.ts`:把 harness 的接线提升成产品代码。`createGateway()`
  仍然只消费一个装好的 ctx(那条边界要留着),装配是它旁边**另一个**模块。
- `gateway/src/server.ts`:`startServer()` + CLI。配置只从一个 JSON 文件读,
  只有 `--port` / `--host` 能覆盖 —— 令牌散在环境变量里,轮换时没人知道该改哪几台机器。
  `--host` 默认 127.0.0.1,要对外必须显式传 0.0.0.0。
- `GATEWAY_PLUGINS` 与 `profiles/gateway.yml` 的漂移由测试拦住:profile 里出现而
  装配里没有、又没写进 `DELIBERATELY_OMITTED` 的插件,测试直接红。三条默认不装的
  各自写明理由(node-pty 在 win32 抛错 / 用不到 / storage-scoped 根本不是根插件)。
- 11 个单测,含起真实端口后的 401、200、Admin describe 不返回凭据值、跨租户 403。

两处只有真跑起来才暴露的问题:

- 端口回显的是配置值而非实际绑定结果,传 0 时拿到连不上的 URL
- 入口守卫手拼 `file://${argv[1]}`,在 Windows 上少一个斜杠、非 ASCII 目录还会被
  百分号编码,于是 `node dist/server.js` 静默什么都不做。改用 `pathToFileURL`。
