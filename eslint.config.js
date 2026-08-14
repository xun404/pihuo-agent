import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/dist-runtime/**',
      '**/coverage/**',
      '.worktrees/**',
      'release/**',
      'packages/pi-runtime/.mastra/**',
      '**/*.min.js',
      // Bundled / generated snapshots
      'packages/adapters/src/bundled/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Existing codebase uses intentional `any` at boundaries (Mastra/Hono/tests).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 3 },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      // Intentional: ANSI / C0 stripping in worker streams and terminal paths.
      'no-control-regex': 'off',
      // Noisy on intentional “assign then overwrite” patterns in recovery code.
      'no-useless-assignment': 'off',
      // Test stubs often declare async generators without yield.
      'require-yield': 'off',
      // Node 22+ rule; rethrow-without-cause is common in this codebase.
      'preserve-caught-error': 'off',
      'no-useless-catch': 'warn',
    },
  },
  {
    files: ['apps/desktop/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Classic Rules of Hooks only. React Compiler rules (refs-during-render,
      // setState-in-effect, etc.) are too aggressive for this brownfield UI.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Scripts and config files are plain JS/MJS
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
