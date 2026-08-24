# `src-tauri` —— 桌面壳

> **本目录不是一个可打包的 Tauri 应用。** 它是壳的**宿主能力**部分:
> 系统钥匙串、跨源允许清单。打包(Node 22 运行时 + 三个原生模块)
> 是**单独两周**,见 `SESSION_TASKS.md` 的 Session 6。

---

## 一、为什么先做成 lib

一个完整的 Tauri app crate 要跑 `tauri-build` 的 codegen,那一步要前端产物、
要图标、要签名配置 —— 全是打包那一档的东西。

拆成 lib 之后,**安全关键的那两部分现在就能编译、能测**:

| 模块        | 它是什么       | 为什么不能等                   |
| ----------- | -------------- | ------------------------------ |
| `keychain`  | 系统钥匙串读写 | 这一版**唯一**碰长效凭据的代码 |
| `allowlist` | 跨源允许清单   | 唯一决定「壳能访问什么」的代码 |

```bash
pnpm test:shell        # 或 cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 二、🚨 keyring 的默认后端是一条假成功回执

`keyring` 3 在**一个 store feature 都没开**时回落到一个 mock 后端:

```
set_password() → Ok(())        ← 报告成功
get_password() → NoEntry       ← 而东西不在那儿
```

用户看到的是「记住我」显示成功,下次启动却要重新登录,**没有任何错误**。

⚠️ **本仓实测撞上过。** `round_trip_through_the_real_keychain` 第一次跑就红了,
而另外四条纯字符串断言(key 格式、issuer 分槽、服务名中性)**全绿** ——
结构上的绿证明不了行为。

⇒ `Cargo.toml` 按平台显式开 feature,并有一条负向验证:
去掉 `windows-native` 之后那条 round-trip 立刻红。

---

## 三、跨源:允许清单 vs 给网关加 CORS

|      | 源                                                         |
| ---- | ---------------------------------------------------------- |
| 前端 | `tauri://localhost`(Windows 上是 `http://tauri.localhost`) |
| 网关 | `http://127.0.0.1:<port>`                                  |

scheme、host、port 全不同 —— 浏览器引擎按同源策略拦下,而报出来的是
`TypeError: Failed to fetch`,**不提 CORS**。那句话与「网关没起来」
长得一模一样(V0.9.0 Session 2 实测,查了好几步才落到这里)。

🚨 **解法是 Tauri 侧的允许清单,不是给网关加 CORS。**
后者会给**远端部署**开一个不需要的口子:远端 Web 宿主与网关本来就同源。
为了桌面壳给所有部署放开跨源,是拿一个长期的攻击面换一次性的便利。

⚠️ 允许清单的判据是**逐维相等**,不是前缀匹配。
`url.starts_with("http://127.0.0.1")` 会放行 `http://127.0.0.1.evil.com/` ——
那是一个**公网域名**,只是长得像回环地址。这一族 bug 的特征是
它在所有正常输入上都表现正确。`allowlist.rs` 有对应的断言。

---

## 四、更新:频道分离

`tauri.conf.json` 的 updater 指向自托管源。**频道分离**是刻意的:

| 频道     | 内容              | 节奏          |
| -------- | ----------------- | ------------- |
| 前端资源 | React 产物        | 热更,MB 级    |
| sidecar  | Node 运行时 + dsh | 随大版本,季度 |
| 壳       | Rust 二进制       | 几乎不动      |

⚠️ `pubkey` 现在是空串 —— **签名密钥属于发布流程,不进仓库**。
留空是让它在配置里可见,而不是假装已经配好了。

---

## 五、明写没做的

| 项                                       | 归属                           |
| ---------------------------------------- | ------------------------------ |
| `tauri build` / 安装包 / 签名            | **Session 6(单独两周)**        |
| Node 22 运行时与三个原生模块的打包       | 同上                           |
| 图标、`bundle.active: true`              | 同上                           |
| sidecar 进程编排(拉起 / 守护 / 端口协商) | 同上 —— 它依赖打包好的 sidecar |
| CI 上跑 Rust 测试                        | ✅ desktop-shell job —— 见下   |

### CI 上谁跑这些断言:`desktop-shell` job

`.github/workflows/ci.yml` 的 **desktop-shell** job(ubuntu + windows 矩阵)
装 WebKitGTK、起 keyring 后端、真跑 `cargo test`,然后真打一次包。

`pnpm test:shell` 是**本机**入口,三条路径各自说清「谁在别处跑」:

| 环境           | 做什么                     | 谁跑那些断言                 |
| -------------- | -------------------------- | ---------------------------- |
| 本机有 cargo   | **真跑**,失败就是失败      | 自己                         |
| 本机没有 cargo | 跳过,并印出一段刺眼的说明  | 只有 CI 的 desktop-shell job |
| **CI 上**      | 跳过 —— 但先**核对**有人跑 | desktop-shell job            |

⚠️ 第三行不是无条件跳过:它从 `ci.yml` 里现取,确认那个 job 还在调
`cargo test --manifest-path`,**读不到就红**。因为「交给别人跑」这句话会过期,
而过期之后它与「已委托」在输出上一模一样。
负向验证在 `scripts/verify-guards.mjs` 的 46a/46b/46c —— 其中 46c 钉的是
**注释里提到不算数**:说明不该被算成合规。

> 🚨 **上一版这里写着「CI 里没有 Rust(实测)」,那是错的。**
> `ubuntu-latest` 镜像自带 Cargo(实测 1.97.1)。实测过的是
> 「workflow 里没写 cargo」,而结论说的是「机器上没有 cargo」——
> 两句话只差一个词。后果是门禁 job 里 `test:shell` 走了「真跑」那一档,
> 撞上它没装的 WebKitGTK,`Node 22` / `Node 24` 一模一样地红。
> 完整复盘见 `docs/DECISIONS/unverified-plausible-causation.md` 例 5。

⚠️ 无头环境里没有 Secret Service,round-trip 那条会红;
正解是起一个 keyring 后端(job 里用 `dbus-run-session` + `gnome-keyring-daemon`),
不是加 `#[ignore]` 把它藏起来 —— 藏起来之后就再也没人验过了。
