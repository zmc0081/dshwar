# @dshwar/subject

## 0.5.0

### Minor Changes

- fcd7396: `@dshwar/subject`:Subject Mirror —— 外部身份源的用户镜像
  
  V0.3.0 的验收标准是「在身份源侧停用某用户后,该用户下一次请求被拒绝」。
  那条链路的落点就是这个包的 `active: false`:SCIM 写进来,auth 读出去。
  
  - `Subject` 契约里**没有任何凭据字段**,与 `CredentialDescriptor` 同款做法 ——
    留一个 optional 的密码字段,迟早有人往里写东西。
  - `assertNoCredentialFields()` 在供给方载荷带 `password` 时**报错而非静默丢弃**。
    SCIM 的 User schema 里真的有这个字段(RFC 7643 §4.1.1),静默丢弃会让部署方
    以为密码同步成功了。
  - **没有 `create`,只有 `upsert` 且必须带 `source`** —— DSHWAR 不新建用户。
    换 `source` 被拒绝:那会让另一个身份源接管这条记录。
  - `deactivate` 不删除记录;`remove` 才是硬删除,且文档写明它**绝不能**用来实现停用
    (Entra 硬删除延迟 30 天才发 DELETE,当停用信号意味着离职员工还能再用一个月)。
  - 内部 id 由 `subjectKey(source, externalId)` 派生,复用 storage-scoped 的长度前缀
    编码:两者都是外部可控字符串,分隔符拼接能被构造碰撞。
  - 两个实现(内存 / 上游 storage 契约)跑同一套断言,29 个单测。
  
  顺带给守卫加了行级豁免机制:执行一条规则的代码往往长得像违反那条规则 ——
  这份**拒绝**密码字段的清单必须写出 `password` 这个词。没有豁免机制时,
  人会去弱化守卫的正则或把字符串拆成 `'pass' + 'word'` 绕过,两者都更糟。
  豁免是行级的、必须写理由、一条 grep 能审计完,且有两条负向测试证明它不是后门。

### Patch Changes

- @dshwar/storage-scoped@0.5.0
  - @dshwar/principal@0.5.0
