# CHANGELOG

## 0.2.0 —— API 平面(开发中)

任务详情见 `SESSION_TASKS.md` 的 V0.2.0 块。

---

## 0.1.0 —— 运行时平面 MVP(开发完成,**未发布**)

> ⚠️ 这一版从未发布到 npm —— 首发被 npm 组织占名与 GitHub 仓库创建阻塞
> (见 [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md))。
> 因此**首个公开版本将是 0.2.0**,内容包含本节与上节两部分。
>
> 相应地,V0.1.0 的变更集已在版本号提升到 0.2.0 时并入本文件并删除 ——
> 否则 `changeset version` 会把 0.2.0 再推成 0.3.0(这正是发布清单里记录的那个陷阱)。

**核心论点已被证明:Harness 的服务契约可以被换成多用户实现,消费方零改动。**

### 新增

| 包 | 作用 |
| --- | --- |
| `@dshwar/principal` | principal 传播 —— DSHWAR 引入的唯一新概念 |
| `@dshwar/auth` | 认证契约:token → Principal |
| `@dshwar/auth-static` | 静态 token 映射(开发与测试,**禁止部署**) |
| `@dshwar/credentials-multiuser` | per-principal 凭据 + 网关短时效 token 遮蔽 |
| `@dshwar/fs-tenant` | 工作区根按租户钉死 —— 隔离的真实边界 |
| `@dshwar/storage-scoped` | 租户维度的存储作用域 |
| `adapters/dsh-0.1.0` | 唯一允许感知上游内部的目录 + 上游契约测试 |

### 核心语义

- **fail closed**:匿名 principal 解析不到任何凭据,不回退默认值 / 共享 key / 环境变量
- **不跨操作缓存**:凭据每次操作现场解析,相邻两次操作可能属于不同的人
- **`describe` 永不返回值**:只暴露 `configured` / `source` / `writable`
- **不做 IdP**:不存密码、不签发身份令牌、不实现注册流程
- **`AuthError` 不携带失败原因**:认证接口是预言机,区分失败原因等于给攻击者探针

### 工程纪律

- adapters 边界:ESLint + grep 双重强制,且**豁免本身**也有负向测试
- PR 自查清单整条脚本化(`pnpm check:guards`)
- 守卫的负向测试 9 条(`pnpm verify:guards`)—— 确认每道守卫真的会拦
- 版本号全仓一致性检查,含 changesets fixed 组覆盖
- CI:守卫单独成 job + Node 22/24 构建矩阵

### 测试

207 条(174 单测 + 33 契约测试),含:

- 并发 100 组 principal 无串号(三处随机挂起制造交错)
- 44 条路径逃逸(`../`、绝对路径、UNC、8.3 短名、NTFS 数据流、Windows 保留名、
  URL 编码、Unicode 规范化、同前缀兄弟目录的 off-by-one)
- 符号链接逃逸(对着真实 `fs-local`,须在 Linux 验证)
- R9 双 profile 对照:单用户场景下 `single-user.yml` 与 `team.yml` 行为一致

### 已知限制

见 [README 的已知限制](README.md#已知限制)。

### 兼容性

上游 `@deepseek-ai/dsh-*` **0.1.0-rc.6**,cordis 4.0.1,Node `^22.19.0 || >=24`。
