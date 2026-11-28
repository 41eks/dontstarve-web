import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4175);
const baseURL = `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec vite --config tests/browser/vite.config.ts --port ${port}`,
    cwd: root,
    url: `${baseURL}/tests/browser/fixture.html`,
    reuseExistingServer: false,
  },
});
