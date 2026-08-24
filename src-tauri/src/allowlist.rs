//! Tauri 的 HTTP 允许清单 —— **跨源那笔账在这里结**。
//!
//! # 问题:前端与网关是**真跨源**
//!
//! | | 源 |
//! | --- | --- |
//! | 前端 | `tauri://localhost`(Windows 上是 `http://tauri.localhost`) |
//! | 网关 | `http://127.0.0.1:<port>` |
//!
//! 两者的 scheme、host、port 全不同 —— 浏览器引擎按同源策略拦下,
//! 而报出来的是一句 `TypeError: Failed to fetch`,**不提 CORS**。
//! 那句话与「网关没起来」长得一模一样(Session 2 实测过一次,查了好几步)。
//!
//! # 🚨 解法是 Tauri 侧的允许清单,**不是给网关加 CORS**
//!
//! 给网关加 CORS 会给**远端部署**开一个不需要的口子:远端 Web 宿主
//! 与网关本来就同源,它一行 CORS 都不需要。为了桌面壳给所有部署
//! 放开跨源,是拿一个长期的攻击面换一次性的便利。
//!
//! ⇒ 允许清单让**这一个壳**能访问**这一个回环端口**,范围最小。
//!
//! # ⚠️ 清单里只有回环地址,而且端口是**运行期**决定的
//!
//! sidecar 的端口不是写死的(写死会被占,也会成为可预测的攻击面),
//! 所以清单不能在 `tauri.conf.json` 里静态列出来 —— 它要在壳启动、
//! 拉起 sidecar、拿到实际端口之后再装配。
//!
//! 本模块提供的就是那个装配的**判据**:什么样的 URL 允许放行。

/// 一条允许规则。
///
/// ⚠️ 刻意**不做成通配符字符串**。`"http://127.0.0.1:*"` 这类写法看起来方便,
/// 而它的问题是**没人能一眼看出它到底放行了什么** ——
/// 尤其是当有人后来写成 `"http://127.0.0.1*"`(少一个冒号,
/// 于是 `http://127.0.0.1.evil.com` 也匹配)。
///
/// 拆成字段之后,每一维都是**相等判断**,没有解析歧义。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowRule {
    /// 只允许 `http` —— 回环地址上的 https 需要一张没人能签的证书(RFC 8252 §7.3)。
    pub scheme: &'static str,
    /// 只允许回环 IP **字面量**。`localhost` 的解析取决于 hosts 与 DNS。
    pub host: &'static str,
    /// 运行期决定 —— sidecar 实际绑到的那个端口。
    pub port: u16,
}

/// 给一个已知端口的 sidecar 造允许规则。
pub fn sidecar_rule(port: u16) -> AllowRule {
    AllowRule {
        scheme: "http",
        host: "127.0.0.1",
        port,
    }
}

/// 这个 URL 允不允许放行。
///
/// # ⚠️ 判据是**逐维相等**,不是前缀匹配
///
/// 前缀匹配的经典失效:`url.starts_with("http://127.0.0.1")` 会放行
/// `http://127.0.0.1.evil.com/`(那是一个**公网域名**,只是长得像回环地址)。
/// 这一族 bug 的特征是它在所有正常输入上都表现正确。
pub fn is_allowed(url: &str, rules: &[AllowRule]) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else {
        return false;
    };
    // 去掉路径与 query,只留 authority
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // ⚠️ 拒绝带凭据的 authority(`user:pass@host`)—— 那是一条经典的
    //   「看起来像 A 其实是 B」路径:`http://127.0.0.1@evil.com/` 的 host 是 evil.com。
    if authority.contains('@') {
        return false;
    }
    let Some((host, port_str)) = authority.rsplit_once(':') else {
        return false; // 必须显式带端口 —— 省略端口意味着默认端口,而我们只放行一个具体端口
    };
    let Ok(port) = port_str.parse::<u16>() else {
        return false;
    };
    rules
        .iter()
        .any(|r| r.scheme == scheme && r.host == host && r.port == port)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> Vec<AllowRule> {
        vec![sidecar_rule(51789)]
    }

    #[test]
    fn allows_exactly_the_sidecar() {
        assert!(is_allowed("http://127.0.0.1:51789/v1/sessions", &rules()));
        assert!(is_allowed("http://127.0.0.1:51789/", &rules()));
    }

    /// ★ 这一条是本模块存在的理由。
    ///
    /// `http://127.0.0.1.evil.com/` 是一个**公网域名**,只是长得像回环地址。
    /// 前缀匹配会放行它,而放行之后壳里的前端可以向任意公网地址发请求 ——
    /// 带着它持有的 access token。
    #[test]
    fn rejects_a_public_domain_that_looks_like_loopback() {
        assert!(!is_allowed("http://127.0.0.1.evil.com/", &rules()));
        assert!(!is_allowed("http://127.0.0.1.evil.com:51789/", &rules()));
    }

    /// ★ 带凭据的 authority:`http://127.0.0.1@evil.com/` 的 host 是 **evil.com**。
    #[test]
    fn rejects_userinfo_in_authority() {
        assert!(!is_allowed("http://127.0.0.1@evil.com:51789/", &rules()));
        assert!(!is_allowed("http://127.0.0.1:51789@evil.com:51789/", &rules()));
    }

    /// ★ 别的端口一律不放行 —— 本机上别的服务不该被壳里的前端访问到。
    #[test]
    fn rejects_other_ports() {
        assert!(!is_allowed("http://127.0.0.1:8080/", &rules()));
        assert!(!is_allowed("http://127.0.0.1:51788/", &rules()));
    }

    /// ★ `localhost` 不算 —— 它的解析取决于 hosts 与 DNS。
    #[test]
    fn rejects_localhost_by_name() {
        assert!(!is_allowed("http://localhost:51789/", &rules()));
    }

    /// ★ 没有端口就不放行 —— 省略端口意味着默认端口,而我们只放行一个具体端口。
    #[test]
    fn rejects_missing_port() {
        assert!(!is_allowed("http://127.0.0.1/", &rules()));
    }

    /// ★ https 不放行:回环上的 https 需要一张没人能签的证书。
    #[test]
    fn rejects_https_on_loopback() {
        assert!(!is_allowed("https://127.0.0.1:51789/", &rules()));
    }

    /// ★ 反向对照:空清单**什么都不放行** ——
    /// 少了这条,一个「永远返回 true」的实现也能通过上面全部的放行断言……
    /// 不对,它通不过拒绝那几条。真正要防的是**反过来**:
    /// 一个「永远返回 false」的实现能通过全部拒绝断言,而 `allows_exactly_the_sidecar`
    /// 会拦住它。两个方向各有对照,这条补的是「规则从哪来」:
    /// 放行与否取决于**传进来的清单**,不是硬编码。
    #[test]
    fn empty_rules_allow_nothing() {
        assert!(!is_allowed("http://127.0.0.1:51789/", &[]));
    }

    /// ★ 换一个端口,清单跟着变 —— 证明端口是运行期决定的,不是写死的。
    #[test]
    fn rules_follow_the_runtime_port() {
        let other = vec![sidecar_rule(60000)];
        assert!(is_allowed("http://127.0.0.1:60000/", &other));
        assert!(!is_allowed("http://127.0.0.1:51789/", &other));
    }
}
