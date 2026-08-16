/**
 * `@dshwar/console-contract` —— 控制平面的共享契约。
 *
 * ## 为什么它在主仓,而 console 服务本体在独立仓
 *
 * 控制台的**服务本体**(API server + 数据库)与运行时零耦合,该独立仓
 * (`dshwar-console`)。但**契约**不一样:它引用运行时平面的概念
 * (principal、租户、配额、用量),**必须与运行时版本联动**。
 *
 * 放主仓的实际收益是它被 `check:all` 覆盖 —— 契约冻结、版本一致性、
 * 类型检查、开源纯净度全都照到它。放独立仓则要把那整套门禁复制一份,
 * 而复制出来的第二份清单迟早会漂。
 *
 * ## ⚠️ 这**不是** `/v1` 运行时契约
 *
 * 两者分开版本化,理由是它们的承诺对象不同:
 *
 * | | `/v1` 运行时契约 | console 契约(本包) |
 * | --- | --- | --- |
 * | 承诺给谁 | **最终用户**与他们的集成 | **管理端**(控制台自己) |
 * | 破坏的代价 | 客户的生产集成挂掉 | 控制台与服务端一起升就行 |
 * | 冻结检查 | ✅ `scripts/check-contract.mjs` | ❌ 不进 `/v1` 冻结基线 |
 *
 * 混在一起的后果很具体:**「改一个管理端字段」会变成「破坏运行时契约」**,
 * 于是要么滥用 major changeset,要么绕过冻结检查 —— 两条都在侵蚀那道门禁。
 *
 * @module @dshwar/console-contract
 */

export { CONSOLE_CONTRACT_VERSION } from './version.ts'

export { capabilitiesOf, CONSOLE_ROLES } from './roles.ts'

export type {
  ConsoleAuditEntry,
  ConsoleCapacity,
  ConsoleMember,
  ConsoleQuota,
  ConsoleRole,
  ConsoleRoleCapabilities,
  ConsoleUsageRow,
} from './wire.ts'
