---
'@dshwar/adapter-dsh-0-1-0': minor
---

新增 `adapters/dsh-0.1.0` —— 唯一允许感知上游内部的目录,以及上游契约测试。

- 版本守卫:运行时校验三个上游包的实际版本,不匹配拒绝启动并给出跟版指引
- 契约测试 33 条:cordis 作用域与 Service 重绑、credentials 四方法与 seam 语义、
  fs realpath 与「cwd 不是 containment 边界」、storage 键语义
- 其中一条故意断言 `#private` 仍不可访问 —— 上游改了包装方式它会变红,那是好消息
- R9 对照基线:编程式双 profile 对照 + 直接读 YAML 校验差异集防漂移
- 新增 `profiles/team.yml`,与 `single-user.yml` 的差异恰好是身份 + 三个契约替换
- `verify-guards` 新增第 6 条:篡改 adapters 内的上游假设,契约测试必须变红
