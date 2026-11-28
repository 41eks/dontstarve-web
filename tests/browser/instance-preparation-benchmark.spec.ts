import { expect, test } from '@playwright/test';
test('measure dense forest preparation without timing instrumentation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/browser/fixture.html');
  const result = await page.evaluate(async ({ url }) => (await import(url)).benchmarkInstancePreparation(), {
    url: '/tests/browser/instance-preparation-benchmark-fixture.ts',
  });
  console.log('INSTANCE_PREPARATION', JSON.stringify(result));
  expect(result.count).toBe(3000);
});
