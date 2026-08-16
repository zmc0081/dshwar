# @dshwar/webhooks

出站事件投递:`subject.created` / `subject.updated` / `subject.deactivated`。

> 本项目不是 DeepSeek 官方产品,与 DeepSeek 无隶属关系。

## 明确不做的事:投递保证

**本包不保证送达。** 重试耗尽的事件只落审计,不落持久队列 —— 可靠投递需要落盘
队列、去重、消费位点,那是控制平面(V0.5.0)的活。在库层面伪装可靠性(内存队列 +
无限重试)比明说「尽力而为」更糟:进程一重启,「保证」就静默蒸发,而用户是按保证
来设计下游的。

**下游请按最终一致设计**:定期拉 `GET /v1/admin/subjects` 兜底,
不要假设每条事件都到了。

## 签名:任何语言都能独立验证

```
X-Dshwar-Signature: sha256=<hex>
X-Dshwar-Timestamp: <unix 秒>

expected = "sha256=" + hex(HMAC_SHA256(secret, timestamp + "." + raw_body))
```

比较 `expected` 与签名头(恒定时间比较),并拒绝时间戳超出 ±300 秒的请求 ——
签名防篡改,时间窗防重发,两者合起来才是抗重放。

测试里有一条用 `node:crypto` 从头实现验证、不 import 本包的任何代码 ——
只有我们自己算得对的签名等于没有签名。

## 用

```ts
import { WebhookDispatcher } from '@dshwar/webhooks'

const dispatcher = new WebhookDispatcher(
  [{ url: 'https://downstream.example/hooks', secret: '双方共享的密钥' }],
  { onFailure: (f) => audit.record({ action: 'webhook.failed', ...f }) },
)

// 挂到 SCIM 应用上
createScimApp({
  ...,
  onSubjectChange: (change) =>
    void dispatcher.dispatch({
      type: `subject.${change.type}`,
      subjectId: change.subject.id,
      tenantId: change.subject.tenantId,
      source: change.subject.source,
      at: new Date().toISOString(),
    }),
})
```

## 载荷只有 id

事件里**没有用户资料**,只有 `subjectId` / `tenantId` / `source` / `at` ——
webhook 会经过下游的日志、代理与重试队列,载荷越少泄漏面越小。
下游拿 id 回查 Admin API。

## 端点互不拖累

一个下游挂了不影响其它下游:各自独立投递、独立重试、独立落审计。
每次重试都用新时间戳**重签** —— 复用首签会让重试在下游看来像重放攻击。

## 许可

MIT
