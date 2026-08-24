//! 桌面壳的装配入口 —— **拉起 sidecar,拿到端口,再开窗**。
//!
//! # 顺序是硬的:先有端口,才有窗
//!
//! 前端的运行期配置由宿主在**加载之前**挂上(V0.9.0 Session 5 的决定,
//! 见 `workbench-web/src/bootstrap.tsx`)。而 Tauri 里 `baseUrl` 推断不出来:
//! 前端的 origin 是 `tauri://localhost`,网关在 `http://127.0.0.1:<port>`,
//! 那是**真跨源**。端口又是运行期才知道的(写死会被占,也是可预测的攻击面)。
//!
//! ⇒ 于是窗口**不在 `tauri.conf.json` 里静态声明**,而是在 sidecar 报出端口
//! 之后由 `setup` 创建,并把配置写进 `initialization_script`。
//! 静态声明的话,窗口会在端口已知之前就加载完前端 —— 那时注入是一场竞态,
//! 而竞态输掉的表现是「偶尔白屏」。
//!
//! # 🚨 令牌由壳生成,不写死
//!
//! 网关绑在 127.0.0.1 上并要求 Bearer。**本机任何进程都够得着那个端口** ——
//! 令牌一旦可预测,同一台机器上的任何程序都能驱动这个 agent(读写工作区、
//! 花掉配额)。所以每次启动现生成一把,写进只有本进程与 sidecar 读的配置文件。
//!
//! # 失败时给一句看得懂的话,而不是一个空窗
//!
//! sidecar 起不来是**装配失败**,不是运行时故障:这时前端连配置都拿不到,
//! 它自己的 fail closed 分支根本走不到。所以壳在这一层拦住,
//! 并把「哪一步失败了 / 日志在哪」直接画在窗口里。

// Windows 上不要弹一个黑框控制台 —— 它对用户没有信息,只有噪声。
// (debug 构建保留,便于看 sidecar 的 stdout。)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::mpsc;
use std::time::Duration;

use dshwar_shell::keychain;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// 等 sidecar 报出端口的上限。
///
/// ⚠️ **必须有上限**:没有的话,一个起不来的 sidecar 会让壳永远停在
/// 「没有窗口」的状态 —— 用户看到的是双击了图标什么都没发生,
/// 而那与「程序崩了」在体验上没有区别,却查不到任何东西。
const SIDECAR_READY_TIMEOUT: Duration = Duration::from_secs(20);

/// 网关启动后打印的那一行里,URL 的前缀。壳靠它认出端口。
///
/// ⚠️ 这是一条**跨进程的文本契约**。改网关那句话会让这里静默失配 ——
/// 于是 `gateway/test/server.test.ts` 有一条断言钉着这行输出的形状。
const URL_MARK: &str = "http://127.0.0.1:";

#[tauri::command]
fn store_refresh_token(issuer: String, subject: String, token: String) -> Result<(), String> {
    keychain::store_refresh_token(&issuer, &subject, &token).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_refresh_token(issuer: String, subject: String) -> Result<Option<String>, String> {
    keychain::load_refresh_token(&issuer, &subject).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_refresh_token(issuer: String, subject: String) -> Result<(), String> {
    keychain::clear_refresh_token(&issuer, &subject).map_err(|e| e.to_string())
}

/// 从网关的一行 stdout 里认出端口。
///
/// 抽成函数是为了**能单独测**:真去起一次 sidecar 才能验的话,
/// 这条文本契约就只能靠人读两边的代码来保证。
fn port_from_line(line: &str) -> Option<u16> {
    let at = line.find(URL_MARK)? + URL_MARK.len();
    let rest = &line[at..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

/// 注入运行期配置的那段脚本。
///
/// ⚠️ 值一律经 `serde_json` 序列化,**不用字符串拼接** ——
/// 拼接的话,一个带引号的产品名就能把这段脚本改成别的东西。
fn config_script(port: u16, token: &str) -> String {
    let config = serde_json::json!({
        "hostKind": "tauri",
        "gatewayPort": port,
        "token": token,
        "productName": "DSHWAR",
        "legalEntityName": "",
        // null = 未配置 = 中性外观。安装包永远中性,白牌走运行期主题。
        "primaryColor": serde_json::Value::Null,
        "theme": "light",
    });
    format!("window.__DSHWAR_CONFIG__ = {};", config)
}

/// 装配失败时画在窗口里的那一页。
///
/// 它**不注入配置** —— 前端因此根本不会启动,而不是启动之后再报一个
/// 与真实原因无关的网络错误。
fn failure_script(detail: &str) -> String {
    let text = serde_json::to_string(detail).unwrap_or_else(|_| "\"装配失败\"".into());
    format!(
        "window.addEventListener('DOMContentLoaded', function () {{ \
           document.body.innerHTML = ''; \
           var pre = document.createElement('pre'); \
           pre.style.cssText = 'padding:24px;font:13px/1.7 ui-monospace,monospace;white-space:pre-wrap'; \
           pre.textContent = {}; \
           document.body.appendChild(pre); \
         }});",
        text
    )
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            store_refresh_token,
            load_refresh_token,
            clear_refresh_token
        ])
        .setup(|app| {
            let script = match start_sidecar(app.handle()) {
                Ok((port, token)) => config_script(port, &token),
                Err(detail) => {
                    let message = format!(
                        "DSHWAR 桌面壳没能启动本地网关。\n\n{detail}\n\n\
                         这一步失败时前端不会启动 —— 它连 baseUrl 都拿不到,\n\
                         硬起来只会在第一次请求时报一句与真实原因无关的网络错误。"
                    );
                    // ⚠️ **同时落一份文件**,不只画在窗口里。
                    //    窗口可能被别的窗口盖住、可能被用户顺手关掉,
                    //    而「双击了没反应」的工单里,用户能贴上来的只有文件。
                    //    release 构建没有控制台(windows_subsystem = "windows"),
                    //    所以 stderr 也不是一条可用的通路。
                    if let Ok(dir) = app.path().app_data_dir() {
                        let _ = std::fs::create_dir_all(&dir);
                        let _ = std::fs::write(dir.join("last-start-error.txt"), &message);
                    }
                    failure_script(&message)
                }
            };

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("DSHWAR")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1100.0, 700.0)
                .initialization_script(&script)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri 运行时启动失败");
}

/// 拉起 sidecar,等它报出端口。
///
/// 返回 `(端口, 令牌)`;失败时返回一句**说得出哪一步**的话。
fn start_sidecar(app: &tauri::AppHandle) -> Result<(u16, String), String> {
    let token = fresh_token();
    let config_path = write_sidecar_config(app, &token)?;

    // sidecar 那个可执行文件**就是 Node 运行时本体**(见 scripts/pack-sidecar.mjs
    // 的说明:原生模块塞不进 SEA,所以换成 SEA 也省不掉随包的 .node)。
    // 于是第一个参数必须是网关的入口脚本,它作为 resource 随包走。
    let server_js = app
        .path()
        .resolve("sidecar/dist/server.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("找不到随包的网关入口(sidecar/dist/server.js):{e}"))?;

    // ⚠️ 路径要进错误信息。「sidecar 起不来」而不说是**哪个路径**起不来,
    //    排查的人第一步还得自己把路径拼出来 —— 而拼错的可能性正是问题本身。
    let entry = plain_path(&server_js.to_string_lossy());

    let (mut rx, _child) = app
        .shell()
        .sidecar("dshwar-gateway")
        .map_err(|e| format!("找不到打进包里的 sidecar:{e}"))?
        .args([entry.clone(), "--config".to_string(), config_path])
        .spawn()
        .map_err(|e| format!("sidecar 起不来({entry}):{e}"))?;

    // ⚠️ 用一个**有超时的**通道等,而不是 `while let Some(event) = rx.blocking_recv()`:
    //   后者在 sidecar 卡住(不退出也不打印)时会永远等下去,
    //   而「永远等下去」在界面上就是「双击了没反应」。
    let (tx, ready) = mpsc::channel::<Result<u16, String>>();
    tauri::async_runtime::spawn(async move {
        let mut tail = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    if let Some(port) = port_from_line(&line) {
                        let _ = tx.send(Ok(port));
                        return;
                    }
                    // 只留最后几行:sidecar 挂掉时这几行就是唯一的线索。
                    tail.push_str(&line);
                    if tail.len() > 4096 {
                        tail = tail.split_off(tail.len() - 4096);
                    }
                }
                CommandEvent::Terminated(status) => {
                    let _ = tx.send(Err(format!(
                        "sidecar 提前退出(code={:?})。\n入口:{}\n最后的输出:\n{}",
                        status.code, entry, tail
                    )));
                    return;
                }
                _ => {}
            }
        }
    });

    match ready.recv_timeout(SIDECAR_READY_TIMEOUT) {
        Ok(Ok(port)) => Ok((port, token)),
        Ok(Err(detail)) => Err(detail),
        Err(_) => Err(format!(
            "等了 {} 秒也没等到网关报出监听端口。",
            SIDECAR_READY_TIMEOUT.as_secs()
        )),
    }
}

/// 去掉 Windows 的**扩展长度路径前缀**(`\\?\`)。
///
/// # 🚨 为什么必须去掉:Node 不认它
///
/// Tauri 解析出来的资源路径在 Windows 上带 `\\?\`(Rust 的 `canonicalize()`
/// 返回的就是这种 verbatim 形式)。把它当脚本路径传给 Node,
/// Node 的 `resolveMainPath` 认不出这个前缀,最后去 `lstat` 了一个 `D:` ——
/// 报出来的是:
///
/// ```text
/// Error: EISDIR: illegal operation on a directory, lstat 'D:'
/// ```
///
/// ⚠️ 那句话里**一个字都没提路径前缀**,而且它出现在 sidecar 的 stdout 里,
/// 而 release 构建没有控制台。V0.9.0 Session 6 实测:第一次装出来的包
/// 就是这么「窗口白着、什么都没发生」—— 直到把失败原因也落成文件才看见。
///
/// UNC 形式(`\\?\UNC\server\share`)要还原成 `\\server\share`,
/// 不能只砍前四个字符 —— 那样会得到一个 `UNC\server\share` 的相对路径。
fn plain_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

/// 现生成一把本机令牌。
///
/// ⚠️ **不要换成固定值或按机器名派生**:网关绑在 127.0.0.1 上,
/// 本机任何进程都够得着那个端口,令牌是唯一的门。
fn fresh_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("取不到系统随机源");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 写 sidecar 的配置文件,返回它的路径。
///
/// 放在应用数据目录而不是临时目录:临时目录在某些系统上是全局可读的,
/// 而这个文件里有本次会话的令牌。
fn write_sidecar_config(app: &tauri::AppHandle, token: &str) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取不到应用数据目录:{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("建不了应用数据目录:{e}"))?;

    let config = serde_json::json!({
        "host": "127.0.0.1",
        // 0 = 让内核挑一个空闲端口。写死会被占,也会成为可预测的攻击面。
        "port": 0,
        "workspaceRoot": dir.join("workspaces").to_string_lossy(),
        "sessionRoot": dir.join("sessions").to_string_lossy(),
        "defaultProvider": "deepseek",
        "defaultModel": "deepseek-chat",
        "authEntries": [{
            "token": token,
            "id": "local-user",
            "tenantId": "local",
            "roles": ["member"],
        }],
    });

    let path = dir.join("sidecar.config.json");
    std::fs::write(&path, config.to_string()).map_err(|e| format!("配置写不进去:{e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_port_out_of_the_gateway_banner() {
        // 网关真实打印的那一行(gateway/src/server.ts)。
        let line = "DSHWAR 网关已启动  http://127.0.0.1:51789";
        assert_eq!(port_from_line(line), Some(51789));
    }

    #[test]
    fn ignores_lines_without_the_mark() {
        assert_eq!(port_from_line("  TLS 由反向代理终结"), None);
        assert_eq!(port_from_line(""), None);
    }

    /// ⚠️ 端口后面跟着别的字符时也要停下来 —— 否则 `:5178/健康检查`
    /// 会被读成一个越界的数字,而 `parse::<u16>()` 只是返回 None,
    /// 表现是「壳等到超时」,而不是「解析错了」。
    #[test]
    fn stops_at_the_first_non_digit() {
        assert_eq!(port_from_line("… http://127.0.0.1:8787/v1/sessions"), Some(8787));
        assert_eq!(port_from_line("… http://127.0.0.1:8787,"), Some(8787));
    }

    /// 配置脚本必须是**可解析的 JSON 赋值**,而不是拼出来的串。
    #[test]
    fn config_script_is_json_not_concatenation() {
        let script = config_script(51789, "deadbeef");
        assert!(script.starts_with("window.__DSHWAR_CONFIG__ = {"));
        assert!(script.contains("\"gatewayPort\":51789"));
        assert!(script.contains("\"hostKind\":\"tauri\""));
        // 🚨 主色必须是 null —— 安装包永远中性,白牌走运行期主题。
        assert!(script.contains("\"primaryColor\":null"));
    }

    /// 🚨 扩展长度前缀必须去掉 —— Node 认不出 `\\?\`,会去 lstat 一个 `D:`。
    ///
    /// 这一条是实测出来的:第一次装出来的包窗口白着什么都没发生,
    /// 而 sidecar 的 stdout 在 release 构建里没有控制台可看。
    #[test]
    fn strips_the_windows_verbatim_prefix() {
        assert_eq!(
            plain_path(r"\\?\D:\app\sidecar\dist\server.js"),
            r"D:\app\sidecar\dist\server.js"
        );
    }

    /// UNC 形式要还原成 `\\server\share`,不是砍掉前四个字符就完事 ——
    /// 那样会得到一个 `UNC\server\share` 的相对路径,而它**看起来还挺像**。
    #[test]
    fn restores_unc_paths_instead_of_blindly_trimming() {
        assert_eq!(
            plain_path(r"\\?\UNC\build-server\share\dist\server.js"),
            r"\\build-server\share\dist\server.js"
        );
    }

    /// 没有前缀的路径原样返回 —— 规则不是「见到反斜杠就动手」。
    #[test]
    fn leaves_ordinary_paths_alone() {
        assert_eq!(plain_path(r"C:\app\server.js"), r"C:\app\server.js");
        assert_eq!(plain_path("/opt/dshwar/server.js"), "/opt/dshwar/server.js");
    }

    /// 每次启动的令牌都不一样,且是 32 字节的十六进制。
    #[test]
    fn token_is_fresh_and_long_enough() {
        let a = fresh_token();
        let b = fresh_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b, "两次启动拿到同一把令牌 —— 本机任何进程都能猜到它");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
