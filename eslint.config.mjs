import tseslint from 'typescript-eslint';

/**
 * ESLint for rules the TypeScript compiler and scripts/check-conventions.mjs do not cover.
 *
 * Existing violations are recorded per file and rule in eslint-suppressions.json (ESLint's bulk suppressions): a file
 * fails only when it has more of them than recorded. After fixing some, tighten the record with
 * `pnpm lint --prune-suppressions`; never grow it with `--suppress-all` to make new code pass.
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
