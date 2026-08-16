# @dshwar/audit

仅追加的操作审计。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 「仅追加」是接口层的事实,不是文档里的许诺

`AuditStore` 只有两个方法:

```ts
interface AuditStore {
  append(input: AuditInput): Promise<AuditRecord>
  query(filter: AuditQuery): Promise<{ data: AuditRecord[]; nextCursor: string | null }>
}
```

**没有 update,没有 delete** —— 类型层就写不出修改。改得掉的审计等于没有审计:
出事之后第一个想改记录的人,恰恰是有权限改的那个。走上游 storage 的实现连
`deleteRecord` 都不出现在它声明的接口子集里。

需要「修正一条审计」时,追加一条修正记录(`action: 'audit.correction'`,
`target` 指向原记录)—— 历史不改,只追加。

存储介质层面的防篡改(WORM、外部归档)是部署方的事;本包保证的是
**代码路径上不存在修改入口**。

## 租户过滤是强制参数

`query()` 的 `tenantId` 必填。把过滤做成可选,总有一天有人会忘了传 ——
而那次查询返回的就是全部客户的操作史。

## 其它约束

- **id 由 store 生成**(零填充单调序号,字典序 = 追加序):可指定的 id 就是可伪造的顺序
- **凭据类操作只记 describe 层面的事实,绝不记录值**:审计的保留期比凭据的
  轮换周期长得多,把值写进去等于造一个长期留存的密钥副本
- 网关侧的 `StoreAuditSink` 追加失败**不抛**:审计是治理组件不是安全闸门,
  它挂了不该把 Admin 操作也拖挂;失败退化到 console 让日志系统兜底

## 两个实现

`InMemoryAuditStore`(测试与单进程)与 `KvAuditStore`(上游 storage 契约),
跑同一套测试断言。KV 实现重启后从已有记录续号,游标分页不断裂。

## 许可

MIT
