/**
 * 平台声明带。恒定在文档流末端,贯穿整幅宽度,r-0 直角,零 accent。
 *
 * 06 · 平台声明带:n-025 底、n-100 上边线、caption 11px、n-600 色、r-0 直角、贯穿整幅宽度
 * —— 与所有卡片(r-3 圆角)形态相反,位置恒定在文档流末端。
 * 同带两行:第一行客户版权(n-700,客户内容),细线之后第二行平台自述(n-600)。
 *
 * ## 与设计 kit 的差别:样式全在 CSS,组件只出 `className`
 *
 * kit 原版把 footer、链接、竖分隔线、细线、mono 片段各写成一个 JS style 对象。
 * 移植时逐个落到 `styles/components/platformfooter.css` 的类上,取值不变。
 * 本组件没有任何交互态,因此不涉及伪类改写。
 *
 * @module @dshwar/design-system/components/PlatformFooter
 */
import type * as React from 'react'

export interface PlatformFooterProps extends Omit<React.HTMLAttributes<HTMLElement>, 'className'> {
  /** 契约 legalEntityName。null → 隐藏版权行(NEUTRAL_BRANDING 的受支持形态)。⚠ 界面显示用,不进发票 */
  legalEntityName?: string | null
  year?: number
  /** 契约 privacyPolicyUrl。null → 隐藏该链接 */
  privacyUrl?: string | null
  /** 契约 termsOfServiceUrl。null → 隐藏该链接 */
  termsUrl?: string | null
}

export function PlatformFooter({
  legalEntityName = null,
  year = 2026,
  privacyUrl = null,
  termsUrl = null,
  ...rest
}: PlatformFooterProps): React.JSX.Element {
  // NEUTRAL_BRANDING:legalEntityName 与两条链接皆为 null 时,客户行整行消失,
  // 平台自述行保留 —— 未配置是受支持的完整形态,不是半成品。
  const hasCustomerRow = !!(legalEntityName || privacyUrl || termsUrl)
  return (
    <footer {...rest} className="ds-platform-footer">
      {hasCustomerRow ? (
        <>
          <div className="ds-platform-footer__customer">
            {legalEntityName ? (
              <span>
                © {year} {legalEntityName}
              </span>
            ) : null}
            {legalEntityName && privacyUrl ? <span className="ds-platform-footer__sep" /> : null}
            {privacyUrl ? <a href={privacyUrl}>隐私政策</a> : null}
            {privacyUrl && termsUrl ? <span className="ds-platform-footer__sep" /> : null}
            {termsUrl ? <a href={termsUrl}>服务条款</a> : null}
          </div>
          <div className="ds-platform-footer__rule" />
        </>
      ) : null}
      <div className="ds-platform-footer__platform">
        模型能力由上游模型提供方提供；平台不对生成内容作准确性担保 · 含第三方开源组件，许可见{' '}
        <span className="ds-platform-footer__mono">/licenses</span>（
        <span className="ds-platform-footer__mono">Apache-2.0</span>、
        <span className="ds-platform-footer__mono">MIT</span>、
        <span className="ds-platform-footer__mono">BSD-3-Clause</span>
        ）· 桌面应用图标与安装包签名主体属平台构建产物，不随租户品牌变化
      </div>
    </footer>
  )
}
