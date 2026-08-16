# 参与 DSHWAR

> **从契约测试开始,先做插件不碰核心。**

这不是客套。DSHWAR 的核心是几条很短的语义(principal 传播、fail closed、
路径钉死),它们的正确性由测试而非评审保证。改核心之前先读懂测试,
比先读懂代码有效得多。

## 三十秒跑起来

```bash
git clone <repo> && cd dshwar
pnpm install
pnpm check:all
```

**零外部依赖** —— 不需要 Keycloak、不需要数据库、不需要 API key。
`@dshwar/auth-static` 就是为这一刻存在的。

## 从哪开始

### 1. 先跑契约测试,读它们

```bash
pnpm test:contract
```

`adapters/dsh-0.1.0/test/` 里的每一条断言都对应 `packages/**` 里的一个实现决定。
它们看起来在测上游,实际测的是**我们的假设**。读完这些,你就知道整个项目
押在上游的哪几条行为上。

特别看这三条:

- `Service 的 this.ctx 重绑` —— `withPrincipal` 单实例设计的全部依据
- `resolve 会 realpath` —— `fs-tenant` 符号链接防线的依据
- `cwd 不是 containment 边界` —— `fs-tenant` 存在的理由

### 2. 再跑守卫的负向测试

```bash
pnpm verify:guards
```

它会临时植入违规、确认守卫真的报错、再清理干净。**一条永远返回「通过」的守卫
和没有守卫是一回事,而且更危险** —— 它给人虚假的安全感。

### 3. 挑一个 good-first-issue

## good-first-issue —— 已立项的包与契约签名

每个都是**独立的插件**,不需要改核心。契约签名已定,照着实现即可。

### `@dshwar/auth-jwt` · V0.3.0

```ts
export class JwtAuth extends Auth {
  constructor(ctx: Context, config: { jwksUri: string; issuer: string; audience: string })
  async verify(token: string): Promise<Principal>
}
```

要点:用 `jose` 校验签名与 `exp`/`iss`/`aud`;`sub` 映射到 `principal.id`
(**不要用 email**);租户映射失败时 **fail closed**(硬规则 7)。
失败一律抛不带原因的 `AuthError`。

### `@dshwar/auth-oidc` · V0.3.0

同上,外加 discovery 端点与 JWKS 缓存/轮换。

### `PrincipalCredentialStore` 的持久化实现 · 随时

```ts
export class PostgresCredentialStore implements PrincipalCredentialStore {
  get(principal: Principal, ref: CredentialRef): Promise<string | undefined>
  put(principal: Principal, ref: CredentialRef, value: string): Promise<void>
  remove(principal: Principal, ref: CredentialRef): Promise<void>
}
```

要点:主键是 `(principal.id, ref)` **两元组**;不要在实现里做租户判定
(principal 已带 tenantId,越权检查在上层)。Vault / KMS / 云厂商 Secret Manager
同样欢迎。

### `@dshwar/metering` · V0.4.0

```ts
export abstract class Metering extends Service {
  abstract record(principal: Principal, usage: TokenUsage): Promise<void>
  abstract query(principal: Principal, window: TimeWindow): Promise<UsageReport>
}
```

要点:token 归属按 principal,不按会话 —— 会话可以跨人转手。

### `@dshwar/policy` · V0.4.0

```ts
export abstract class Policy extends Service {
  abstract authorize(principal: Principal, action: Action): Promise<Decision>
}
```

要点:**不要**在这里固化任何一套角色体系;`principal.roles` 原样传入,
语义由部署方定义。

## 硬规则(PR 阻塞级)

完整清单见 [`CLAUDE.md`](CLAUDE.md) 第二节。最容易踩的四条:

1. **不 fork、不 patch 上游** —— 需要改上游才能实现的,提 issue
2. **只有 `adapters/dsh-<version>/` 能 import 上游内部实现** —— ESLint + grep 双重强制
3. **上游依赖精确锁版**,禁止 `^` 与 `~`
4. **缺失 principal 一律 fail closed** —— 不回退默认值、共享 key、环境变量

提交前跑一遍:

```bash
pnpm check:all
```

## 三个会让你困惑的约定

### 每个带测试的包有两个 tsconfig

`tsconfig.json` 只管 `src/`(composite,`rootDir: "./src"`,产出 `dist/`);
`tsconfig.test.json` 只管 `test/`(`noEmit`,references 指向前者)。
不能合成一个:把 `test/` 并进 composite 项目会把 `rootDir` 抬到包根,
`dist/` 里凭空多出 `src/` 与 `test/` 两层,发布出去的 types 路径全错。

**新增包时两个都要建,并分别登记进根 `tsconfig.json` 与根 `tsconfig.test.json`。**
漏了会被 `pnpm check:guards` 拦下 —— 因为漏登记是**静默**的:`tsc -b` 只构建
references 里列出的项目,而 Vitest 用 esbuild 转译、不做类型检查,于是那个包的
测试即便 import 了根本不存在的导出,三道门禁也照样全绿。

### `Service` 子类不能用 `#private`

cordis 用 Proxy 包装服务以重绑 `this.ctx`,而 ECMAScript private field 按规范
只能在真实实例上访问 —— 在 wrapper 上必抛 `TypeError`,**且报错信息完全指不到根因**。

用 TypeScript 的 `private`(运行时是普通属性,可穿透 Proxy)。ESLint 会拦。
实测见 [`docs/FEASIBILITY-REPORT.md`](docs/FEASIBILITY-REPORT.md) §4.1。

### Windows 上有些测试会静默跳过

符号链接逃逸(`fs-tenant`)与 PTY(上游 `subprocess-local`)在 Windows 上跑不了。
它们会打警告但仍是绿的。**这两条恰好是最关键的防线**,本地想验:

```bash
pnpm test:linux
```

CI 跑在 ubuntu 上,所以 PR 里它们是真的被验证的。

## 提交规范

Conventional Commits(`feat:` / `fix:` / `docs:` / `chore:`)。
分支 `feature/v<版本号>`。PR 需含描述 / 影响范围 / 测试方式。

改动涉及包的行为时,加一条 changeset:

```bash
pnpm exec changeset
```

全部 `@dshwar/*` 包**统一版本号**(fixed 模式)—— 不要试图让某个包单独走版本。

## 行为准则

对事不对人。评审意见指向代码与其后果,不指向作者。
