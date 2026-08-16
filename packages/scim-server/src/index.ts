/**
 * `@dshwar/scim-server` —— SCIM 2.0 服务端子集。
 *
 * 供给方(authentik / Entra / Okta)往这里推用户与组;DSHWAR 是 SCIM 的
 * **服务提供方**,不是客户端。落点是 `@dshwar/subject` 的身份镜像 ——
 * `active:false` 写进去,auth 层读出来拒绝。
 *
 * 一个实例服务一个身份源。挂载与 token 鉴权由网关负责(V0.3.0 Session 6)。
 *
 * @module @dshwar/scim-server
 */

export { createScimApp } from './app.ts'
export type { ScimAppOptions, ScimAuditRecord } from './app.ts'

export { InMemoryGroupStore } from './groups.ts'
export type { GroupInput, GroupStore, ScimGroup } from './groups.ts'

export {
  applyGroupPatch,
  applyUserPatch,
  listResponse,
  parseActiveValue,
  parseFilter,
  parsePatchBody,
  PatchError,
  scimError,
  UnsupportedFilterError,
} from './protocol.ts'
export type {
  EqFilter,
  GroupPatchResult,
  ListResponse,
  PatchOp,
  ScimErrorBody,
} from './protocol.ts'
