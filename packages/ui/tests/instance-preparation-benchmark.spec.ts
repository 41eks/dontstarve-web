import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
for (const variant of ['before', 'after']) test(`measure dense forest preparation ${variant} without timing instrumentation`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async ({ url, variant }) => (await import(url)).benchmarkInstancePreparation(variant),
    { url: `/@fs${fileURLToPath(new URL('./instance-preparation-benchmark-fixture.ts', import.meta.url))}`, variant });
  console.log('INSTANCE_PREPARATION', JSON.stringify(result));
  expect(result.count).toBe(3000);
});
