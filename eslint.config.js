import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

/**
 * 上游内部实现的深链模式。CLAUDE.md 硬规则 2 的正则等价物:
 *   @deepseek-ai/dsh-<name>/(lib|src|dist)/...
 *
 * 一并覆盖 cordis 的 `./src/*` 导出 —— 它是同一个隐患:上游把内部路径
 * 开在 exports 里,不等于那是稳定契约。
 */
const UPSTREAM_INTERNAL_PATTERNS = [
  '@deepseek-ai/dsh-*/lib',
  '@deepseek-ai/dsh-*/lib/**',
  '@deepseek-ai/dsh-*/src',
  '@deepseek-ai/dsh-*/src/**',
  '@deepseek-ai/dsh-*/dist',
  '@deepseek-ai/dsh-*/dist/**',
  '@deepseek-ai/cordis/src',
  '@deepseek-ai/cordis/src/**',
]

const BOUNDARY_MESSAGE = [
  '禁止深链上游内部实现(CLAUDE.md 硬规则 2)。',
  '只有 adapters/dsh-<version>/ 允许感知上游内部。',
  'packages/** 与 gateway/** 只能依赖上游契约包的公开导出;',
  '需要内部实现时,把它收进 adapters/ 并对外暴露稳定接口。',
].join(' ')

export default tseslint.config(
  {
    // dist 与 node_modules 之外,feasibility/ 也排除:
    // 它是 Session 0 的验证工作区,不受产品代码纪律约束(有自己的 README 说明)。
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.tsbuildinfo',
      'feasibility/**',
      'feasibility-v2/**',
      '.changeset/**',
      // git worktree 在仓库内部展开时会带来一份完整副本,typescript-eslint
      // 会因此看到两个候选的 tsconfig 根目录并直接拒绝解析。
      // 那份副本有它自己的门禁,不该在这里被重复检查。
      '.claude/worktrees/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },

  // ---------------------------------------------------------------
  // R2 · adapters 边界(本 Session 最重要的产出)
  // ---------------------------------------------------------------
  {
    files: ['packages/**/*.{ts,tsx,mts,cts}', 'gateway/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: UPSTREAM_INTERNAL_PATTERNS,
              message: BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // adapters/** 是唯一豁免区 —— 这里就是用来碰上游内部的
  {
    files: ['adapters/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ---------------------------------------------------------------
  // Session 0 §4.1 发现:cordis 用 Proxy 包装服务以重绑 this.ctx,
  // ECMAScript #private 字段在 wrapper 上访问必抛 TypeError。
  // 这条规则把那半天的排查提前到写代码的那一秒。
  // ---------------------------------------------------------------
  {
    files: ['packages/**/*.ts', 'gateway/**/*.ts', 'adapters/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ClassDeclaration[superClass.type="Identifier"][superClass.name=/(Service|Provider|Runtime)$/] > ClassBody > PropertyDefinition[key.type="PrivateIdentifier"]',
          message:
            'cordis Service 子类禁止使用 #private 字段:服务经 Proxy 包装后 this 不是真实实例,#private 必抛 TypeError。改用 TypeScript private(运行时是普通属性,可穿透 Proxy)。见 docs/FEASIBILITY-REPORT.md §4.1。',
        },
        {
          selector:
            'ClassDeclaration[superClass.type="Identifier"][superClass.name=/(Service|Provider|Runtime)$/] > ClassBody > MethodDefinition[key.type="PrivateIdentifier"]',
          message:
            'cordis Service 子类禁止使用 #private 方法:理由同 #private 字段。改用 TypeScript private。见 docs/FEASIBILITY-REPORT.md §4.1。',
        },
      ],
    },
  },

  // ---------------------------------------------------------------
  // CLAUDE.md 第六节:禁止 any
  // ---------------------------------------------------------------
  {
    files: ['packages/**/*.ts', 'gateway/**/*.ts', 'adapters/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // `const { $schema, $id, ...rest } = obj` 是「剔除若干字段」的惯用写法,
      // 被剔除的那几个名字按定义就是不会被用到的。ignoreRestSiblings 正是
      // 为这个场景存在 —— 不开的话,唯一的替代是逐个 delete,那更啰嗦也更易错。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_' },
      ],
    },
  },

  // 构建脚本:纯 Node ESM,不参与 TS project references
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
)
