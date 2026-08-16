/**
 * console 契约的版本号。
 *
 * ⚠️ **它跟随包版本(全仓统一),但语义上独立于 `/v1`。**
 *
 * 这两句话不矛盾:版本**号**统一是发布纪律(CLAUDE.md 第四节,changesets
 * fixed 模式),版本**语义**独立是契约纪律 —— `/v1` 的破坏性变更需要 major
 * changeset 并双版本并行 6 个月,console 契约不需要,因为它的消费方
 * (控制台前端)与服务端一起升。
 *
 * 这个常量存在的意义是**让控制台能在启动时校验自己配的服务端版本对不对**,
 * 而不是等到某个字段读出 undefined 才发现。
 */
export const CONSOLE_CONTRACT_VERSION = '0.5.0'
