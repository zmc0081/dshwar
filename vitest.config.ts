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
    ],
  },
})
