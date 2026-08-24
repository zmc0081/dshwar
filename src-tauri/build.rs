//! `tauri-build` 的 codegen 入口。
//!
//! 它把 `tauri.conf.json`、图标、能力清单编进二进制 —— 也就是说
//! **配置错了在这里就编译不过**,而不是装出来之后运行时才发现。
//!
//! ⚠️ 这一步要求 `frontendDist` 指向的目录**已经存在**。
//! 于是打包顺序是硬的:先 `pnpm --filter @dshwar/workbench-web build`,
//! 再 `cargo tauri build`。`scripts/pack-desktop.mjs` 按这个顺序编排。
fn main() {
    tauri_build::build()
}
