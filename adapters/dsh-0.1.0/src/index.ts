/**
 * `adapters/dsh-0.1.0` —— ★ **唯一允许感知上游内部的目录**。
 *
 * ## 这个目录存在的唯一理由
 *
 * 上游 DeepSeek Harness 还在 rc 阶段,破坏性变更是高频事件。问题不是「会不会变」,
 * 而是「变了之后修复成本是改一个目录,还是翻遍全仓」。
 *
 * 全仓只有这里可以 import 上游的内部实现路径(`/lib/` `/src/` `/dist/`)。
 * `packages/**` 与 `gateway/**` 只能依赖上游契约包的公开导出 ——
 * 这条边界由 ESLint 的 `no-restricted-imports` 与 `scripts/check-guards.mjs`
 * 双重强制(CLAUDE.md 硬规则 2),且 `scripts/verify-guards.mjs` 会验证
 * **豁免本身有效**(否则一个「一律禁止」的规则也能骗过负向测试)。
 *
 * ## 当前状态:接触面为零
 *
 * 截至 V0.1.0,`packages/**` 里**没有任何一处**需要深链上游内部 ——
 * 六个包全部只依赖公开导出:
 *
 * | 包 | 依赖的上游公开导出 |
 * |---|---|
 * | `credentials-multiuser` | `CredentialProvider` / `credentialRef` / 三个类型 |
 * | `fs-tenant` | `FileSystem` 抽象类 + 类型 |
 * | `storage-scoped` | `StorageBackend` / `KvFacet` / `KvUnit` 类型 |
 *
 * 这是**好消息**:说明上游的契约包设计得足够干净,DSHWAR 不必偷任何东西。
 * 本目录因此只承担两件事:
 *
 * 1. **版本守卫**({@link assertUpstreamVersion})—— 硬规则 3 的运行时落点
 * 2. **契约测试的宿主** —— 上游改语义时,红点直指这里
 *
 * 接触面为零不代表这个目录多余:它是**预留的着陆点**。哪天真的需要碰上游内部,
 * 代码必须落在这里,而不是散进 `packages/`。纪律先于需求就位,是它唯一有效的时机。
 *
 * @module @dshwar/adapter-dsh-0.1.0
 */

export {
  assertUpstreamVersion,
  EXPECTED_UPSTREAM_VERSION,
  GUARDED_PACKAGES,
  inspectUpstreamVersions,
  UpstreamVersionMismatchError,
} from './version-guard.ts'
