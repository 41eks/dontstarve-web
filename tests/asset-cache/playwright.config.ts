import { defineConfig, devices } from '@playwright/test';

// This suite serves the actual production build, including the generated worker.
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/asset-cache',
  workers: 1,
  reporter: 'line',
  use: { ...devices['Desktop Chrome'] },
});
