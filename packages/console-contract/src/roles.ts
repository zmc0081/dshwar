/**
 * 角色 → 能力的映射。**唯一来源**,服务端与前端都从这里读。
 *
 * ## 为什么放契约包而不是各自实现
 *
 * 前端要用它决定「这个按钮显不显示」,服务端要用它决定「这个请求准不准」。
 * 两边各写一份的结果是**它们会不一致**,而不一致的方向几乎总是同一个:
 * **前端藏了按钮,服务端却没拦**。那是个真实的越权口子,
 * 且因为界面上看不见,不会有人报告它。
 *
 * ⚠️ **前端用它藏按钮是体验,服务端用它拦请求是安全。**
 * 共用一份映射消除的是「两份不一致」,不是「服务端可以不检查」——
 * 服务端必须照样检查,因为前端的判断在客户端,客户端不可信。
 *
 * @module @dshwar/console-contract/roles
 */
import type { ConsoleRole, ConsoleRoleCapabilities } from './wire.ts'

const CAPABILITIES: Readonly<Record<ConsoleRole, ConsoleRoleCapabilities>> = {
  owner: { manageMembers: true, viewUsage: true, manageBilling: true },
  admin: { manageMembers: true, viewUsage: true, manageBilling: false },
  member: { manageMembers: false, viewUsage: false, manageBilling: false },
}

/**
 * 查一个角色能做什么。
 *
 * ⚠️ 认不出的角色返回**最小权限**(全 false),而不是抛错或给默认值。
 * 这是 CLAUDE.md 硬规则 6 的同款判断:**认不出就拒,不降级服务**。
 * 抛错会让一个拼错的角色名把整个页面打挂;给默认值可能是给了权限。
 */
export function capabilitiesOf(role: string): ConsoleRoleCapabilities {
  return (
    CAPABILITIES[role as ConsoleRole] ?? {
      manageMembers: false,
      viewUsage: false,
      manageBilling: false,
    }
  )
}

/** 全部角色,按权限从高到低。界面上的下拉框按这个顺序排。 */
export const CONSOLE_ROLES: readonly ConsoleRole[] = ['owner', 'admin', 'member']
