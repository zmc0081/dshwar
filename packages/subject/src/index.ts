/**
 * `@dshwar/subject` —— Subject Mirror(身份镜像)。
 *
 * 外部身份源里某个用户在 DSHWAR 这一侧的副本,用于**归属与授权**:
 * 这个 token 背后是谁、属于哪个租户、现在还有没有效。
 *
 * ## 它不是什么
 *
 * **不是用户表。** DSHWAR 是身份消费者,不是身份提供者(CLAUDE.md 硬规则 4)。
 * 客户的用户目录在他们自己的 IdP 里 —— 这里没有密码字段、没有注册流程、
 * 没有「新建用户」入口。
 *
 * ## 停用是本包存在的理由
 *
 * V0.3.0 的验收标准是「在身份源侧停用某用户后,该用户下一次请求被拒绝」。
 * 那条链路的落点就是这里的 `active: false`:SCIM 写进来,auth 读出去。
 * 停用**不删除**记录 —— 审计要能回答「这个人什么时候被停的」。
 *
 * @module @dshwar/subject
 */

export { assertNoCredentialFields, normalizeInput, primaryEmail, SubjectError } from './subject.ts'
export type { Subject, SubjectEmail, SubjectInput } from './subject.ts'

export { InMemorySubjectStore, KvSubjectStore, SUBJECTS_TABLE, subjectKey } from './store.ts'
export type { KvUnitLike, SubjectFilter, SubjectStore } from './store.ts'
