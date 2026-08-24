//! 系统钥匙串 —— 这一版**唯一**碰长效凭据的代码。
//!
//! # 它兑现的是 Session 4 留下的那个端口
//!
//! `packages/auth-pkce/src/host.ts` 定义了 `SecretStore`(store / load / clear),
//! 并把远端 Web 那一份做成**一律拒绝**:浏览器里没有钥匙串,
//! `localStorage` 对任何同源脚本可读,一次 XSS 就能带走 refresh token。
//!
//! 桌面宿主不一样 —— 它有系统钥匙串。这个文件就是那个实现。
//!
//! # ⚠️ 为什么落在 Rust 侧而不是 Node sidecar
//!
//! sidecar 是一个**普通的 Node 进程**,它读得到的东西,同机器上任何
//! 以同一用户身份运行的进程也读得到。系统钥匙串的价值恰恰在于操作系统
//! 替你做那道访问控制 —— 而访问控制要在**壳**里做,壳是那个被签名的二进制。
//!
//! # 🚨 三条约束,写进类型与函数签名里
//!
//! 1. **只存 refresh token,不存 access token。** 后者短效,存下来的收益
//!    (省一次刷新)远小于代价(多一个泄漏面)。函数名与 key 前缀都点明这件事。
//! 2. **key 里带 issuer**,不同 IdP 的凭据不共用一个槽位 ——
//!    换 IdP 之后拿到旧的那一个,表现是「登录成功但拿到的是过期的会话」。
//! 3. **`load` 取不到返回 `None`,不是错误。** 没登录过是正常状态;
//!    做成 `Err` 会让调用方每次启动都要处理一次「不是错误的错误」。

use keyring::Entry;

/// 钥匙串条目的服务名。用户在系统的凭据管理器里看到的就是它。
///
/// ⚠️ **不带租户名、不带品牌名。** 安装包永远中性(白牌走运行期主题),
/// 而钥匙串条目是**安装期**就固定的 —— 带上品牌名等于让一个中性的安装包
/// 在系统凭据管理器里暴露它服务的是哪家客户。
const SERVICE: &str = "DSHWAR";

/// 钥匙串里的一次失败。
#[derive(Debug)]
pub enum KeychainError {
    /// 系统钥匙串本身报的错(被锁、无权限、后端不可用)。
    Backend(String),
}

impl std::fmt::Display for KeychainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeychainError::Backend(m) => write!(f, "系统钥匙串不可用:{m}"),
        }
    }
}

impl std::error::Error for KeychainError {}

/// 拼一个条目的用户名。
///
/// 形如 `refresh:https://idp.example.com:alice-e6f1`。三段各有理由:
///
/// | 段 | 为什么 |
/// | --- | --- |
/// | `refresh:` | 点明这里**只有 refresh token**。哪天有人想塞 access token 进来,这个前缀会让他先停一下 |
/// | issuer | 换 IdP 之后不会拿到旧凭据 —— 那种错的表现是「登录成功却是过期的会话」 |
/// | subject | 同一台机器上多个账号各自一格 |
pub fn entry_key(issuer: &str, subject: &str) -> String {
    format!("refresh:{issuer}:{subject}")
}

/// 存一个 refresh token。
///
/// ⚠️ 参数名写死 `refresh_token` 而不是泛化的 `secret` —— 见文件头约束 1。
/// 一个叫 `store_secret` 的函数会被下一个人拿去存别的东西。
pub fn store_refresh_token(
    issuer: &str,
    subject: &str,
    refresh_token: &str,
) -> Result<(), KeychainError> {
    let key = entry_key(issuer, subject);
    let entry = Entry::new(SERVICE, &key).map_err(|e| KeychainError::Backend(e.to_string()))?;
    entry
        .set_password(refresh_token)
        .map_err(|e| KeychainError::Backend(e.to_string()))
}

/// 取回。
///
/// # ⚠️ 取不到是 `Ok(None)`,不是 `Err`
///
/// 「没登录过」是应用的**正常状态**,不是故障。做成 `Err` 会让调用方
/// 每次启动都处理一次不是错误的错误 —— 而处理不是错误的错误,
/// 最后总会退化成 `unwrap_or_default()`,把真正的钥匙串故障也一起吞掉。
///
/// 真正的故障(钥匙串被锁、后端不可用)仍然是 `Err` —— 两者必须分得开:
/// 前者该走登录流程,后者该告诉用户「解锁你的钥匙串」。
pub fn load_refresh_token(issuer: &str, subject: &str) -> Result<Option<String>, KeychainError> {
    let key = entry_key(issuer, subject);
    let entry = Entry::new(SERVICE, &key).map_err(|e| KeychainError::Backend(e.to_string()))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(KeychainError::Backend(e.to_string())),
    }
}

/// 清掉。登出时调。
///
/// ⚠️ **本来就不存在也算成功。** 登出要能反复点而不报错 ——
/// 一个「已经登出了却报错」的按钮会让用户以为没登出成功,然后去找别的办法。
pub fn clear_refresh_token(issuer: &str, subject: &str) -> Result<(), KeychainError> {
    let key = entry_key(issuer, subject);
    let entry = Entry::new(SERVICE, &key).map_err(|e| KeychainError::Backend(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(KeychainError::Backend(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_has_all_three_segments() {
        let k = entry_key("https://idp.example.com", "alice-e6f1");
        assert_eq!(k, "refresh:https://idp.example.com:alice-e6f1");
    }

    /// ★ 不同 issuer 必须落在不同的槽位。
    ///
    /// 换 IdP 之后拿到旧凭据,表现是「登录成功但拿到的是过期的会话」——
    /// 那种错不会报任何异常,只会让用户看到一个空的工作台。
    #[test]
    fn different_issuers_do_not_share_a_slot() {
        let a = entry_key("https://a.example.com", "alice");
        let b = entry_key("https://b.example.com", "alice");
        assert_ne!(a, b);
    }

    /// ★ 同一 IdP 下不同 subject 也各自一格。
    #[test]
    fn different_subjects_do_not_share_a_slot() {
        let a = entry_key("https://idp.example.com", "alice");
        let b = entry_key("https://idp.example.com", "bob");
        assert_ne!(a, b);
    }

    /// ★ key 里带 `refresh:` 前缀 —— 见文件头约束 1。
    ///
    /// 这条断言看起来琐碎,它守的是**意图**:哪天有人想把 access token
    /// 也塞进钥匙串,这个前缀会让他先停一下。
    #[test]
    fn key_says_it_holds_only_refresh_tokens() {
        assert!(entry_key("i", "s").starts_with("refresh:"));
    }

    /// ★ 服务名不带品牌 —— 安装包永远中性。
    ///
    /// 钥匙串条目是**安装期**固定的,而白牌走运行期主题。带上品牌名
    /// 等于让一个中性的安装包在系统凭据管理器里暴露它服务的是哪家客户。
    #[test]
    fn service_name_is_brand_neutral() {
        assert_eq!(SERVICE, "DSHWAR");
    }

    /// ★ 真的往系统钥匙串写一次、读回来、再删掉。
    ///
    /// # ⚠️ 为什么这条必须存在
    ///
    /// 上面四条都是**纯字符串**断言 —— 它们全绿而钥匙串一次都没被碰过,
    /// 与「钥匙串工作正常」在输出上一模一样。那正是本仓反复在追的那条:
    /// **结构上的绿证明不了行为**。
    ///
    /// # ⚠️ 它在无头环境里会失败,而那是**对的**
    ///
    /// Linux CI 没有 Secret Service,这条会 `Err(Backend(...))`。
    /// 不用 `#[ignore]` 把它藏起来:藏起来之后「钥匙串能不能用」
    /// 就再也没人验过了。真要在 CI 上跑,该做的是起一个 keyring 后端,
    /// 而不是把断言删掉。
    #[test]
    fn round_trip_through_the_real_keychain() {
        let issuer = "https://dshwar-test.invalid";
        let subject = "roundtrip-probe";

        // 先清一次 —— 上一次跑崩可能留下残骸。
        let _ = clear_refresh_token(issuer, subject);

        assert!(
            matches!(load_refresh_token(issuer, subject), Ok(None)),
            "清干净之后应当读到 None(没登录过),而不是错误或旧值"
        );

        store_refresh_token(issuer, subject, "the-refresh-token").expect("写钥匙串失败");
        assert_eq!(
            load_refresh_token(issuer, subject).expect("读钥匙串失败"),
            Some("the-refresh-token".to_string())
        );

        clear_refresh_token(issuer, subject).expect("删钥匙串失败");
        assert!(
            matches!(load_refresh_token(issuer, subject), Ok(None)),
            "删掉之后应当读到 None"
        );

        // ★ 反复删要能成功 —— 登出按钮要能反复点。
        clear_refresh_token(issuer, subject).expect("重复删除应当成功");
    }
}
