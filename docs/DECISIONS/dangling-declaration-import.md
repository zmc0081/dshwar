# 类型坏成 `never` 时,消费方代码反而「编译通过」

日期:2026-08-23(V0.9.0 Session 2)· 状态:已修

> **形状**:一个包的**声明产物**里有一条解析不了的 import。
> 于是它导出的类型全部退化,而**退化的方向是「更宽松」** ——
> 消费方那些本该报错的写法,因此一个都不报。
>
> 换句话说:**类型系统坏掉的表现,不是编译失败,是编译成功。**

---

## 一、实例:`dist/generated/` 根本不存在

`sdk/typescript` 的类型链是:

```
packages/api-contract/openapi.json
  → scripts/render.ts
  → src/generated/schema.d.ts     ← 一个**声明文件**
  → src/client.ts 里 import type { components } from './generated/schema.d.ts'
```

而 `tsc` **永远不会把 `.d.ts` 输入产出到 `outDir`** ——
声明文件的产物就是它自己,没有可生成的东西。

于是构建之后:

```
sdk/typescript/dist/
  client.d.ts        ← 里面写着 import type { components } from './generated/schema.d.ts'
  errors.d.ts
  index.d.ts
  (没有 generated/)  ← 🚨
```

`dist/client.d.ts` 的那条 import **指向一个不存在的文件**。
而 `package.json` 的 `types` 指向 `dist/index.d.ts` ——
**每一个跨包消费者拿到的 `Session` / `StreamEvent` / `CredentialDescriptor`
都是坏的。**

---

## 二、为什么两年没人发现

### ① 坏掉的方向是「更宽松」

`components` 解析不了 → `Schemas = components['schemas']` 退化 →
`Session = Schemas['Session']` 退化。

消费方写 `session.status`、`session.完全不存在的字段`、
把 `Session` 赋给任何东西 —— **一个都不报错**。
类型检查没有变严,它变没了。

⇒ **「编译通过」在这里不是好消息**,而正是症状本身。

### ② 包内测试看不见它

`sdk/typescript` 自己的测试 import 的是 `../src/client.ts` ——
走**源码**路径,`./generated/schema.d.ts` 相对 `src/` 存在,解析正常。

**只有跨包消费者会经过 `dist/`。** 而在 V0.9.0 之前,唯一的跨包消费者是
`console-web`,它只用 `DshwarAdminClient.capacity()` ——
那个方法的返回类型是**手写的内联对象**,不经过 `Schemas`。
于是它一直编译得好好的。

### ③ 它是被一句看不懂的错误间接暴露的

Session 2 给 `Session['status']` 写穷尽性检查:

```ts
default: {
  const never: never = status   // 契约加了新状态时这里编译不过
  throw new Error(…)
}
```

报出来的是:

```
Type 'components' is not assignable to type 'never'.
```

**这句话与「你的 switch 少写了一个 case」长得很像**,而真相完全不同。
第一反应是去补 case;顺着那条路走会写出一个映射了不存在状态的 switch。

⇒ 判断依据是那个 `components`:一个**顶层命名空间类型**出现在
本该是字符串字面量联合的位置,说明索引访问整条失败了,不是少了一个成员。

---

## 三、修法:让生成物成为**可产出**的模块

改名 `src/generated/schema.d.ts` → `schema.ts`。

一个只含类型的 `.ts` 与 `.d.ts` 对 tsc 是等价的输入,
但 `.ts` **会被编译**,于是产出 `dist/generated/schema.d.ts` + 一个空的
`schema.js`。那条 import 从此解析得到。

影响面 5 处,全部同改:`client.ts` / `errors.ts` / `index.ts` /
`scripts/generate.ts`(生成目标)/ `test/generated.test.ts`(同步断言的路径)。

⚠️ **试过的另外两条路,都不行**:

| 方案                        | 为什么不行                                                            |
| --------------------------- | --------------------------------------------------------------------- |
| 构建时复制到 `dist/`        | `pnpm typecheck` 也是 `tsc -b`,它不会跑复制步骤 —— 新克隆的仓库照样坏 |
| `types` 指向 `src/index.ts` | 消费者会去编译 SDK 的源码,项目引用的整个意义就没了                    |

---

## 四、谁盯着它

**今天没有直接盯着的东西。** 明写这一点,而不是假装有。

间接的一层是:`workbench-web` 现在**跨包消费 `Schemas` 派生的类型**
(`view/runs.ts` 与 `view/session.ts` 各有一处穷尽性检查)。
那条 import 若再次悬空,`never` 那两处会立刻编译不过 ——
`pnpm typecheck` 会红,而且红在同一个位置。

⚠️ 这是**偶然的覆盖**,不是设计出来的:它成立只因为工作台恰好用了穷尽性检查。
把这句话写下来,是因为「有东西盯着」与「恰好有东西盯着」的区别,
正是这个仓库反复在追的那一条。

⇒ 真正该做的是一条断言:**构建产物的每条相对 import 都能解析**。
它不难写(遍历 `*/dist/**/*.d.ts`,抽 `from '...'`,查文件在不在),
但它属于「构建产物的完整性」这一族,与 `check-oss-purity` 同层 ——
排进将来的收尾,不是这一版临时塞进来。

## 相关

- [[test-host-differs-from-run-host]] —— 同一轮里发现的另一处「消费者才看得见」的缺陷
- CLAUDE.md 第六节「★ 元规则:每新增一个验证机制,必须回答『谁验证它?』」
