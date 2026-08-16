# authentik 容器验收(🟠 代码就绪待外部资源)

进程内的端到端验收在 `gateway/test/identity-e2e.test.ts`,**每次 CI 都跑**:
它驱动我们这一侧的完整链路(SCIM HTTP → 镜像 → JWT 拒绝 → webhook),
供给方请求按 REPORT-V3 §4 的文档化形状逐字构造。

本文档是**真 authentik 容器**验收的操作手册。它验证的增量只有一件事:
authentik 实际发出的请求与文档化形状是否一致 —— 即 REPORT-V3 §8 标 ⚠️ 的三条
(D1 解绑请求形状、D2 多 Group 样本、E1 JWKS 轮换)。

## 为什么不在 CI 里自动跑

authentik 是四容器栈(server + worker + Postgres + Redis,镜像约 1.5 GB),
且首次启动要走 bootstrap 流程配置 SCIM Provider。放进每次 CI 的代价
(约 10 分钟 + 网络抖动导致的假红)大于收益 —— 文档化形状已被单测钉住,
容器验收是**发布前手动跑一次**的事,不是每个 PR 跑一次的事。

## 步骤

```bash
# 1. 起 authentik(官方 compose)
curl -O https://goauthentik.io/docker-compose.yml
docker compose up -d
# 首次访问 http://localhost:9000/if/flow/initial-setup/ 建管理员

# 2. 起 DSHWAR 网关,配上 SCIM
cat > e2e.config.json <<'CFG'
{
  "workspaceRoot": "./var/e2e/workspaces",
  "sessionRoot": "./var/e2e/sessions",
  "defaultProvider": "deepseek", "defaultModel": "deepseek-chat",
  "authEntries": [{"token":"unused","id":"placeholder","tenantId":"acme"}],
  "scim": {
    "source": "authentik",
    "token": "e2e-scim-token",
    "tenantMap": { "strategy": "issuer", "issuers": { "authentik": "acme" } }
  }
}
CFG
pnpm --filter @dshwar/gateway build
node gateway/dist/server.js --config e2e.config.json

# 3. authentik 里:Applications → Providers → Create → SCIM Provider
#    URL:   http://host.docker.internal:8787/scim/v2
#    Token: e2e-scim-token
#    绑到一个 Application,分配两个测试用户,等首次全量同步

# 4. 断言(手动或脚本)
curl -H "x-dshwar-admin-key: <key>" http://127.0.0.1:8787/v1/admin/subjects
#    → 两个用户,active:true

# 5. authentik 里停用其中一个用户(Directory → Users → Deactivate)
#    等增量推送(即时)或下一轮全量(每小时)

curl -H "x-dshwar-admin-key: <key>" http://127.0.0.1:8787/v1/admin/subjects
#    → 该用户 active:false —— 验收达成

# 6. 顺带记录(REPORT-V3 的 ⚠️ 三条):
#    - 网关日志里 authentik 停用时实际用的方法与请求体(D1)
#    - 把用户加进两个组,观察 Group 载荷(D2)
#    - authentik 轮换签名密钥后 JWKS 的 kid 变化(E1)
#    把结果补进 docs/FEASIBILITY-REPORT-V3.md §8
```

## 判定

- 两个用户经 SCIM 出现在镜像 → ①
- authentik 侧停用后镜像 `active:false` → ②
- 全程零定制代码(只有配置)→ ③

三条都成立,M2.5 验收达成。
