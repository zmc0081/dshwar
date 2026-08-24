# 桌面端打包

> `pnpm pack:desktop` —— 前端产物 → sidecar → `cargo tauri build`。
> 三步的顺序是硬的,理由写在 `scripts/pack-desktop.mjs` 里。

---

## 一、装出来的是什么

| 层             | 是什么                       | 怎么进包                            |
| -------------- | ---------------------------- | ----------------------------------- |
| 壳             | Rust,`dshwar-desktop`        | Tauri 主二进制                      |
| 前端           | `workbench-web` 的 vite 产物 | `frontendDist`,编进二进制           |
| sidecar 运行时 | **Node 本体**(拷贝的)        | `externalBin`,按 target triple 命名 |
| sidecar 代码   | 网关 + 生产依赖树            | `resources`(`sidecar/**`)           |

Windows 上的产物:`DSHWAR_<版本>_x64-setup.exe`(NSIS,约 26 MB)与
`DSHWAR_<版本>_x64_en-US.msi`(约 41 MB)。

## 二、启动顺序:先有端口,才有窗

```
壳启动 → 生成本机令牌 → 写 sidecar 配置 → 拉起 sidecar
      → 读它 stdout 里的 http://127.0.0.1:<port>
      → 用这个端口 + 令牌建窗口(initialization_script 注入 __DSHWAR_CONFIG__)
```

窗口**不在 `tauri.conf.json` 里静态声明**:前端的运行期配置要在加载**之前**挂上,
而端口是运行期才知道的。静态声明会让窗口在端口已知之前就加载完前端 ——
那是一场竞态,而竞态输掉的表现是「偶尔白屏」。

⚠️ **令牌每次启动现生成**(32 字节)。网关绑在 127.0.0.1 上,
本机任何进程都够得着那个端口,令牌是唯一的门。
实测:拿壳注入的令牌请求 `/v1/sessions` 得 200,换一个猜的得 **401**。

## 三、🚨 三个只在打包时才显形的坑

这三条都**不会**在开发机的日常流程里出现 —— 记在这里是因为下一个人会重新踩。

### 1. 运行时依赖躺在 `devDependencies` 里

pnpm 的 workspace 把 devDependencies 也铺进 `node_modules`,于是测试绿、
build 绿、直接跑 dist 也能起来,而 `pnpm deploy --prod` 出来的产物
第一行 import 就 `ERR_MODULE_NOT_FOUND`。

详见 [`DECISIONS/workspace-hides-missing-deps.md`](DECISIONS/workspace-hides-missing-deps.md)。
现由 `check-guards.mjs` 的「将发布的包,import 的东西都在 dependencies 里」守着。

### 2. Windows 的 MAX_PATH(260)

pnpm 默认的符号链接布局下,NSIS 打包会在这种路径上失败(`os error 2`):

```
sidecar\node_modules\.pnpm\node_modules\@dshwar\gateway\node_modules\
@dshwar\auth-jwt\node_modules\@dshwar\subject\node_modules\…
```

⚠️ **`node` 自己走符号链接读得到**,而 NSIS 是按真实路径逐个文件打包的。
于是「跑得起来」证明不了「打得出包」。

⇒ `pnpm deploy` 加 `--config.node-linker=hoisted`,铺成扁平的 `node_modules`。
实测最长相对路径从 260+ 降到 **109** 字符。

### 3. Node 认不出 `\\?\` 前缀

Tauri 解析出的资源路径在 Windows 上是 **扩展长度路径**(`\\?\D:\…`),
而 Node 的 `resolveMainPath` 认不出这个前缀,最后去 `lstat` 了一个 `D:`:

```
Error: EISDIR: illegal operation on a directory, lstat 'D:'
```

⚠️ 那句话里**一个字都没提路径前缀**,而且它只出现在 sidecar 的 stdout 里 ——
release 构建没有控制台。第一次装出来的包就是「窗口白着、什么都没发生」。

⇒ `main.rs` 的 `plain_path()` 去掉前缀(UNC 形式另外还原),三条单测钉着。
⇒ 并且**失败原因同时落一份文件**(`%APPDATA%/com.dshwar.desktop/last-start-error.txt`)——
窗口会被盖住、会被关掉,而工单里用户能贴上来的只有文件。

## 四、原生模块:是 koffi,不是路线图里的那三个

路线图写的是 `node-pty` / `sharp` / `@vscode/ripgrep`。**三个都不在依赖树里**
(`node-pty` 随 `dsh-subprocess-local`,而那个包在 `DELIBERATELY_OMITTED` 里)。

真正要跟着走的是 **koffi** —— `dsh-fs-local` 与 `dsh-session-persistence-jsonl`
的运行时依赖,也就是网关的必经之路。它按平台专属 npm 包分发
(`@koromix/koffi-win32-x64` 等),**不需要从源码编译**。

`pack-sidecar.mjs` 最后会断言 `.node` 真的在:少了它,网关会在第一次读文件时
抛一句与打包无关的错,而那时安装包已经发出去了。

⚠️ **跨平台打包做不到一台机器出全部产物**:`pnpm deploy` 装的是本机平台的
可选依赖,Node 运行时也是本机那一份。三平台要在三平台各跑一次(CI 的 matrix)。

## 五、明写没做的

| 项                                         | 为什么                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **签名**                                   | Windows 走 SignPath Foundation(开源免费,**需先有 release**),macOS 走 Apple Developer($99/年)。两者都要外部资源 —— 打包链路得先跑通 |
| **macOS 产物**                             | 没签名的 `.dmg` 会被 Gatekeeper 直接拦下,跑一个装不上的产物只是把 CI 时间花掉                                                      |
| **自动更新的实际发布**                     | `tauri.conf.json` 的 updater 指着自托管源,而 `pubkey` 是空的 —— 签名密钥属于发布流程,不进仓库                                      |
| **断言「装进去的原生模块是本平台那一份」** | 今天只断言「有 `.node`」。跨平台交叉打包时这一条才会真正咬人                                                                       |
| **钉死 Node 版本的断言**                   | 只靠 CI 的 `node-version: 22` 一处配置,没有断言盯着                                                                                |

### ⚠️ 已知、等 macOS 进 CI 时一并修:4 条负向验证在 macOS 上会退化

`verify-guards.mjs` 的 **27a / 27c / 27d / 27e** 依赖
「当前平台在 `measure-process-cost.mjs` 的 `THRESHOLDS` 里有条目」,
而今天那张表**只有 `linux` 与 `win32`**。

| 在 macOS 上                      | 表现                                               |
| -------------------------------- | -------------------------------------------------- |
| 27a / 27c / 27d(压阈值 → 期望红) | `--assert` 直接跳过判定并退出 0,**期望的红不出现** |
| 27e(正向对照:真实阈值下不红)     | 变成**空跑** —— 没有判定,自然也不会超标            |

这属于 CLAUDE.md「负向验证不得依赖仓库当前碰巧处于的状态」那一条:
`THRESHOLDS` 缺当前平台的条目,只在**加平台**时发生,
而加平台正是最需要这四条说话的时候。

**为什么现在不修**:macOS 被签名挡在 CI 矩阵之外(没签名的 `.dmg` 装不上,
见上表第二行),于是「macOS 上这四条会怎样」今天没有任何地方能观察到 ——
修一个观察不到的东西,改完也不知道对不对。

**修的时机与做法**:macOS 进 CI 矩阵的那一次,同时
① 给 `THRESHOLDS` 补 `darwin` 的实测基线(与 linux/win32 同样先跑一版
不带 `--assert` 的拿数,不要猜),
② 把这四条的判据从「压 linux/win32 两个键」改成**压当前平台那一个键**。
两件事必须一起做:只做 ① 的话,那四条仍然在压两个写死的键。

---

## 六、Linux 只出 `.deb`,不出 AppImage

`src-tauri/tauri.conf.json` 的 `bundle.targets` 里**没有 `appimage`**。
那个文件是纯 JSON,写不了注释,所以理由记在这里。

### 起因:CI 上第一次真跑 Linux 打包就红在这一步

`deb` 打完了,`appimage` 那一步失败:

```
Bundling DSHWAR_0.9.0_amd64.deb …                          ← 成功
Bundling DSHWAR_0.9.0_amd64.AppImage …
  Downloading …/AppRun-x86_64
  Downloading …/linuxdeploy-x86_64.AppImage
  Downloading …/linuxdeploy-plugin-gtk.sh
  Downloading …/linuxdeploy-plugin-gstreamer.sh
  Downloading …/linuxdeploy-plugin-appimage-x86_64.AppImage
Error failed to bundle project: `failed to run linuxdeploy`
```

`linuxdeploy` 自己就是一个 AppImage,跑它要 **FUSE**;
`ubuntu-24.04` runner 上没有 `libfuse2`。

### 为什么是「去掉这个产物」,而不是「装上 libfuse2」

|                | 装 libfuse2                                                                                                 | 去掉 appimage |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| CI 上多一行    | `apt-get install libfuse2` —— 将来的人会问「这是干什么的」                                                  | 无            |
| 打包时联网     | 每次打包**下载 5 个第三方二进制**(其中两个来自 `raw.githubusercontent.com` 的 `master` 分支,**没有版本锁**) | 无            |
| 我们真的发它吗 | **不发**。分发路径是 `.deb`                                                                                 | ——            |

第二行是真正的理由:一个我们不发布的产物,让每次 CI 打包都去
拉五个不锁版本的外部二进制 —— 那是一条平白多出来的供应链面,
换来的东西没有人会下载。

### 什么时候该把它加回来

要覆盖非 Debian 系发行版(Fedora / Arch / openSUSE)的那一天。
到那时**先决定分发方式**再加产物:AppImage 与 `rpm` 是两条不同的路,
而 Tauri 两个都支持。加回来时记得同步 `.github/workflows/ci.yml`
的 `upload-artifact` 路径 —— 那里今天只列了 msi / exe / deb。
