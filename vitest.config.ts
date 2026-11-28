import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.{ts,mjs}', 'tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/fixtures/resetAnimationAssets.ts'],
  },
});
