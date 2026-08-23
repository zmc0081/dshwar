/**
 * 品牌配置的**转换层** —— 验收②「`primaryColor: null` 走中性令牌而非兜底色」。
 *
 * ## 这一层为什么不能省
 *
 * `TenantBranding`(契约)与 `BrandingDraft`(界面)字段几乎同名,
 * 看起来直接透传就行。**不行** —— 契约里有几个字段是可空的,
 * 而界面的输入框要的是字符串。这一跳就是「可空 → 可显示」的换算,
 * 而它有一处**绝不能顺手做掉**:
 *
 * > 🚨 `primaryColor: null` 的 `null` **不许被兜底**。
 *
 * `null` = 未配置 = 无彩中性外观(`NEUTRAL_BRANDING`)。
 * V0.8.0 把哨兵默认色 `#2F6FEB` 改成 `string | null`,为的就是让
 * 「未配置」与「配置成某个颜色」在**类型层**可分。
 *
 * 一行 `branding.primaryColor ?? SUGGESTED_PRIMARY_COLOR` 能把那次改动
 * **完全抵消**,而不会有任何东西变红 —— 类型上仍然是分开的,行为上又合并了。
 *
 * ⚠️ 判空必须**收敛在派生入口一处**(设计系统的 `BrandingScreen` 里那句
 * `seed === null || seed === ''`),不在这里判。每个调用点各判一次的后果是:
 * 总有一个点判错,而那个点的表现是「这个租户的界面莫名其妙有颜色」。
 *
 * ## ⚠️ 建议色是**输入框的占位**,不是默认值
 *
 * `SUGGESTED_PRIMARY_COLOR` 原样传给 `suggestedSeed`。它只影响
 * 「用建议起点」那个按钮和 placeholder —— **不参与派生**。
 * 传给 `primaryColor` 就成了兜底,那正是上面禁的事。
 *
 * @module @dshwar/console-web/view/branding
 */
import type { TenantBranding } from '@dshwar/console-contract'
import type { BrandingDraft } from '@dshwar/design-system/screens/console/BrandingScreen'

/**
 * 契约 → 界面草稿。
 *
 * ⚠️ `primaryColor` **原样传递**,不做任何合并。其余可空字段转成空串 ——
 * 那些是纯文本输入,空串与 null 在界面上都是「输入框是空的」,
 * 没有第二种含义可区分。`primaryColor` 不一样:它的 null 有明确语义。
 */
export function toDraft(branding: TenantBranding): BrandingDraft {
  return {
    productName: branding.productName,
    // ★ 原样。这一行是验收②的落点 —— 任何 `?? '#xxx'` 都会让它失效。
    primaryColor: branding.primaryColor,
    legalEntityName: branding.legalEntityName ?? '',
    supportEmail: branding.supportEmail ?? '',
  }
}

/**
 * 界面草稿 → 契约(保存时用)。
 *
 * ⚠️ **空串要还原成 `null`,而不是原样送上去。**
 * 用户清空一个可选输入框,意思是「不配置它」,不是「配置成空字符串」。
 * 送一个空串上去,服务端会当成一个已配置的值 ——
 * 于是「没填」与「填了个空的」在数据库里再也分不开。
 *
 * 🚨 **`primaryColor` 例外:空串在这里是配置错误,不是「不配置」。**
 * 色值输入框被清空时,`BrandingScreen` 已经不派生了(它判 `=== ''`),
 * 但保存下去的仍应是 `null` —— 一个空串的主色在服务端校验时会被拒,
 * 而拒绝信息说的是「不是合法颜色」,与「你没配」是两回事。
 * 这里统一还原成 `null`,让语义与「重置为中性外观」一致。
 */
export function toBranding(draft: BrandingDraft, base: TenantBranding): TenantBranding {
  return {
    ...base,
    productName: draft.productName,
    primaryColor: draft.primaryColor === '' ? null : draft.primaryColor,
    legalEntityName: draft.legalEntityName === '' ? null : draft.legalEntityName,
    supportEmail: draft.supportEmail === '' ? null : draft.supportEmail,
  }
}
