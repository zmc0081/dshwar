import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 骨架阶段还没有测试文件(Session 2 起才有)。没有测试不等于失败,
    // 但**测试跑不起来**等于失败 —— 二者要能区分,所以这里放行空集,
    // 由 CI 的其它步骤保证质量。
    passWithNoTests: true,
    include: ['**/*.{test,spec}.{ts,mts}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Session 0 的验证脚本自成一套,不走 Vitest(见 feasibility/README.md)
      'feasibility/**',
      'feasibility-v2/**',
      // git worktree 在仓库内部展开时会带来一份完整副本。跑进去的话,
      // 会在一个没装依赖的树上执行整套测试 —— 红得毫无信息量。
      // 那份副本在它自己的根目录下跑自己的门禁。
      '.claude/worktrees/**',
      // 第二层冒烟(真实 API key)只在**有 key 时**才纳入。
      //
      // 为什么按条件排除而不是写死:写死会让「手工跑一次」这件事也做不到,
      // 而那正是它存在的意义 —— 它是发布清单上的一个待办项,不是死代码。
      // 无 key 时排除掉,是为了让 check:all 的输出里不出现一个永远 skip 的文件。
      //
      // 跑法:把 DEEPSEEK_API_KEY 放进 .env(已在 .gitignore 里),然后
      //   pnpm vitest run gateway/test/live-smoke.test.ts
      ...(process.env['DEEPSEEK_API_KEY'] === undefined || process.env['DEEPSEEK_API_KEY'] === ''
        ? ['gateway/test/live-smoke.test.ts']
        : []),
      // Stripe live smoke:同一套机制,key 是 STRIPE_TEST_KEY(只认 sk_test_ 前缀)。
      ...(process.env['STRIPE_TEST_KEY'] === undefined || process.env['STRIPE_TEST_KEY'] === ''
        ? ['gateway/test/stripe-live-smoke.test.ts']
        : []),
    ],
  },
})
