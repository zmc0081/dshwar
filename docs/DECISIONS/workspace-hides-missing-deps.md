# workspace 把「漏声明的依赖」藏了起来 —— 直到第一次打包

> **形状**:开发环境比消费方**宽松**,于是一类错误在仓库里**不可能显形**。
> 它不会在某次运行里偶尔出现,也不会在某个平台上才出现 ——
> 它在开发环境里**永远**是对的,而在消费方那里**永远**是错的。

V0.9.0 Session 6 打包时实测。记在这里不是为了记住这一次的 17 个包名,
而是为了下一次遇到「开发环境更宽松」时能认出来。

---

## 那一次是什么样

第一次 `pnpm deploy --filter @dshwar/gateway --prod` 之后直接跑产物:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-credentials'
    imported from …/deploy-probe/dist/server.js
```

逐个数下来:**`@dshwar/gateway` 的 17 个运行时依赖全部躺在 `devDependencies` 里**
—— 而这个包有 `bin: dshwar-gateway`,它本来就是要发出去的。

| 数  | 什么                                                                                         |
| --- | -------------------------------------------------------------------------------------------- |
| 15  | `dist` 里真的 `import` 到的(`@deepseek-ai/dsh-*` × 10、`@dshwar/*` × 4、`@hono/node-server`) |
| 2   | 只在 `.d.ts` 里出现的类型导入(`@deepseek-ai/dsh-fs`、`@dshwar/tenant-map`)                   |

后两个尤其容易被判成「不算」:它们在运行时被擦掉了。
但消费方**做类型检查时要装它们** —— `.d.ts` 里引着一个装不到的包,
报的是「找不到类型声明」,而那与「你的 tsconfig 配错了」长得一模一样。

---

## 为什么它在仓库里不可能显形

pnpm 的 workspace 把 `devDependencies` 也铺进 `node_modules`。于是:

| 在仓库里                      | 结果              |
| ----------------------------- | ----------------- |
| `pnpm test`                   | ✅ 绿             |
| `pnpm build`                  | ✅ 绿             |
| `node gateway/dist/server.js` | ✅ **真的能起来** |
| `pnpm typecheck`              | ✅ 绿             |

**四条全绿**,而产物是坏的。这不是覆盖不够 —— 再加多少测试也测不到,
因为它们全都跑在那个更宽松的环境里。

⇒ 判据不是「测得够不够」,而是**「这条链路有没有在消费方的条件下跑过一次」**。

---

## 修法:一条守卫 + 一次真打包

**守卫**(`check-guards.mjs` 的「将发布的包,import 的东西都在 dependencies 里」):
扫非 `private` 包的 `src/`,每个裸 import 的包名必须在 `dependencies`
或 `peerDependencies` 里。负向验证 43a–43c。

三处判据值得单独说:

| 判据                       | 为什么                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 扫 `src/` **不扫 `dist/`** | dist 是产物、被 gitignore;而本守卫在 `check:all` 里排在 `typecheck` **之前** —— 新克隆的仓库那时还没有 dist,扫它会退化成「扫了 0 个文件」,而那与「全部合规」在输出上一样 |
| **类型导入也算**           | 见上:`.d.ts` 里引着的包,消费方要装                                                                                                                                       |
| 跳过整行注释               | `@dshwar/principal` 的模块注释里有一行 `import … from '@dshwar/principal'` 的用法示例 —— 那是**说明**不是依赖(守卫不能惩罚记录)                                          |

**真打包**(CI 的 `desktop-shell` job):守卫是早一步的那道,
而 `pnpm deploy --prod` + 真的启动是它的兜底实证 ——
守卫的正则写错时,这一步仍然会红。

---

## ⚠️ 同一形状的近亲:还有哪些「开发环境更宽松」的地方

写在这里,免得下一次又是打包时才发现:

| 更宽松的地方                                 | 消费方那里              | 今天有没有人盯着                                                  |
| -------------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| workspace 铺平 devDependencies               | 只装 dependencies       | ✅ 本次加的守卫                                                   |
| 仓库里有 `dist/`(tsc -b 产出)                | 只有 `files` 白名单里的 | ✅ `check-oss-purity` 的 files 检查                               |
| 本机装着 cargo / rustc                       | CI 上不一定             | ✅ `test:shell` 吵着跳过 + CI 的 desktop-shell job                |
| 本机的 Node 版本                             | 安装包里钉死的那个      | ⚠️ **只靠 CI 的 `node-version: 22` 一处**,没有断言                |
| 本机装着某个平台的原生模块                   | 装到的是另一个平台的    | ⚠️ `pack-sidecar.mjs` 只断言「有 `.node`」,不断言「是这个平台的」 |
| **本机有 `.tsbuildinfo` 与上一次的 `dist/`** | 新克隆的仓库两样都没有  | ⚠️ **只有 CI 是冷的** —— 见下                                     |

前两条 ⚠️ 是已知的空缺,写明了,没有假装它们被盖住。

---

## ⚠️ 增量状态是这一族里最会骗人的那一个

V0.9.0 Session 6 推第一次 CI 时,**三个 job 同时红**,而本机 `pnpm check:all`
刚刚全绿。原因是 `console-web` 在 Session 5.5 加了 `@dshwar/metering` 依赖,
却**没加对应的 tsconfig project reference**:

| 环境       | 结果                                                                  |
| ---------- | --------------------------------------------------------------------- |
| 本机(增量) | ✅ 绿 —— `packages/metering/dist/*.d.ts` 上一次就建好了               |
| CI(冷)     | 🚨 `Cannot find module '@dshwar/metering'` —— `tsc -b` 不知道要先建它 |

同一天里这个形状还咬过第二次:`pnpm typecheck:test` 报清白,而
`tsc -b <同一个项目> --force` 当场报两个类型错 —— 增量图**慢了一拍**。

⇒ 判据:**「本机绿」在有构建缓存时不是一个结论**。
真要在本地确认,得 `pnpm clean && pnpm build`(或 `tsc -b --force`)。

⚠️ **不要为此加一条「import 了 workspace 包就必须有 project reference」的守卫。**
实测:那条规则今天会报 **11 个项目**(gateway 一个产品项目 + 10 个 test/scripts 项目),
而它们**冷构建全都是绿的** —— references 的传递闭包已经把顺序排对了。
一条会报 11 处误报的规则,人学会的是绕过它,不是遵守它
(CLAUDE.md:误报比漏报更贵)。真正的检查是**冷构建本身**,而 CI 天生是冷的。
