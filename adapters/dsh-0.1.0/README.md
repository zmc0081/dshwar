# adapters/dsh-0.1.0

> ★ **唯一允许感知上游内部的目录。**

上游 DeepSeek Harness 还在 rc 阶段,破坏性变更是高频事件。问题不是「会不会变」,
而是**变了之后修复成本是改一个目录,还是翻遍全仓**。

全仓只有这里可以 import 上游的内部实现路径(`/lib/` `/src/` `/dist/`)。
`packages/**` 与 `gateway/**` 只能依赖上游契约包的公开导出。

这条边界由三重强制:

| 机制                           | 作用                                                     |
| ------------------------------ | -------------------------------------------------------- |
| ESLint `no-restricted-imports` | 写的时候就报错                                           |
| `scripts/check-guards.mjs`     | grep 双保险,不依赖 TS 解析                               |
| `scripts/verify-guards.mjs`    | 验证**豁免本身有效** —— 否则「一律禁止」也能骗过负向测试 |

## 当前状态:上游接触面为零

截至 V0.1.0,`packages/**` 里**没有任何一处**需要深链上游内部。六个包全部只用公开导出:

| 包                      | 用到的上游公开导出                                |
| ----------------------- | ------------------------------------------------- |
| `credentials-multiuser` | `CredentialProvider` / `credentialRef` / 三个类型 |
| `fs-tenant`             | `FileSystem` 抽象类 + 类型                        |
| `storage-scoped`        | `StorageBackend` / `KvFacet` / `KvUnit` 类型      |

这是**好消息**:上游的契约包设计得足够干净,DSHWAR 不必偷任何东西。

接触面为零不代表这个目录多余 —— 它是**预留的着陆点**。哪天真的需要碰上游内部,
代码必须落在这里。纪律先于需求就位,是它唯一有效的时机。

## 两件职责

### 1. 版本守卫(硬规则 3 的运行时落点)

```ts
import { assertUpstreamVersion } from '@dshwar/adapter-dsh-0-1-0'
assertUpstreamVersion() // 不匹配即抛错，拒绝启动
```

为什么运行时还要查一遍,lockfile 不够吗:lockfile 保证的是**安装**结果,
而实际跑的可能是别的 —— `resolutions` 覆盖、打包去重、容器挂进来的 volume、
有人手工 `npm i` 过。这些情况下 lockfile 仍然是对的,而进程里跑的是另一个版本。

### 2. 契约测试的宿主

`pnpm test:contract` 跑 `adapters/` 下的全部测试。它们把 DSHWAR 依赖的每一条
上游语义变成断言 —— 看起来像在测别人的代码,实际测的是**我们的假设**。

| 文件                        | 覆盖                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `upstream-contract.test.ts` | cordis 作用域与 Service 重绑、credentials 四方法与 seam 语义、fs 路径与 realpath、storage 键语义 |
| `version-guard.test.ts`     | 版本守卫本身                                                                                     |
| `profile-parity.test.ts`    | R9 对照基线,见下                                                                                 |

其中一条**故意断言一个失败**:`Service` 子类的 `#private` 仍然无法访问。
上游哪天改了包装方式,这条会变红 —— 那是好消息,意味着可以放宽 ESLint 规则。

## R9 · 对照基线

硬规则 8:单用户场景下,`single-user.yml` 与 `team.yml` 行为必须完全一致。

`profile-parity.test.ts` 做两件事:

1. **编程式对照** —— 按两个 profile 的实际组成各搭一个 context,对同一组操作
   断言输出一致(fs 读写 / stat / listDir / sandboxMode,credentials resolve / describe)
2. **防漂移** —— 直接读 YAML,校验两个 profile 的**差异集**恰好是
   身份插件 + 三个契约替换,上游插件部分逐个相同

> **与任务书的偏差**:任务书写「全部契约测试同时跑两个 YAML」。这里没走 YAML 加载,
> 因为那需要 `cordis-plugin-loader` 与 `dshHomePath` 等宿主设施,会把测试变成
> 「测上游的 loader」;且 profile 里的 llm / agent 需要真实模型凭据才能起来,CI 里不可用。
> 第 2 组断言是为了补上这个偏差带来的漂移风险。

## 跟版

见 [README 的双轨与跟版流程](../../README.md#双轨)。一句话:
**只改这个目录**,`packages/**` 不应因跟版而变动。

## 许可

MIT
