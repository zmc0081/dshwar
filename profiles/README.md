# profiles/

cordis 组合文件。每个 profile 是一份插件清单,决定「这套运行时由哪些实现拼成」。

| profile           | 组成                          | 用途         | 状态                  |
| ----------------- | ----------------------------- | ------------ | --------------------- |
| `single-user.yml` | 上游原生插件 + 匿名 principal | **对照基线** | 骨架已就位(Session 1) |
| `team.yml`        | JWT + SQLite,逻辑隔离         | 团队内多用户 | Session 3–6           |
| `enterprise.yml`  | OIDC + Postgres + 进程隔离    | 跨信任边界   | V0.3.0+               |

## 为什么 `single-user.yml` 是最重要的那一个

它不产出任何功能,只产出**证据**。

CLAUDE.md 硬规则 8 要求:单用户场景下,`single-user.yml` 与多用户 profile 的行为
必须完全一致。Session 7 的契约测试同时跑两个 profile 并断言输出无差异 ——
这是「只加隔离、不改语义」这句话唯一的硬凭据。

**纪律:除 `principal` 外,不要往 `single-user.yml` 加任何 `@dshwar/*` 包。**
加了,对照就不再是对照。

## 隔离级别对应关系

| profile           | 隔离级别         | 适用               |
| ----------------- | ---------------- | ------------------ |
| `single-user.yml` | 无(本来就一个人) | 本地开发           |
| `team.yml`        | **逻辑**         | 仅限互相信任的用户 |
| `enterprise.yml`  | 进程 / 容器      | 跨信任边界         |

逻辑隔离的边界见 [README 的隔离模型警告](../README.md#-隔离模型警告--先读这一段)。
