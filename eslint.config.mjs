import tseslint from 'typescript-eslint';

/**
 * ESLint for rules the TypeScript compiler and scripts/check-conventions.mjs do not cover. The pre-commit hook
 * (.githooks/pre-commit) runs it on the staged files; `pnpm lint` runs it on the whole repository.
 */
export default [
  {
    ignores: ['**/node_modules/**', 'public/**', '**/dist/**', '**/test-results/**', '**/playwright-report/**'],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      // Every if / else / for / while / do body is a braced block, even a single statement.
      curly: ['error', 'all'],
    },
  },
];
