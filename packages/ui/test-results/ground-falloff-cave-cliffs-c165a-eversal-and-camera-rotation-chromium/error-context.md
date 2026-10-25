# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ground-falloff.spec.ts >> cave cliffs preserve occlusion and transparent blending after face-order reversal and camera rotation
- Location: tests/ground-falloff.spec.ts:5:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | test.use({ viewport: { width: 900, height: 600 } });
  4  | 
  5  | test('cave cliffs preserve occlusion and transparent blending after face-order reversal and camera rotation', async ({ page }, testInfo) => {
  6  |   const errors: string[] = [];
  7  |   page.on('pageerror', error => errors.push(error.message));
  8  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  9  |   await page.goto('/tests/ground-falloff.html');
  10 |   await expect.poll(() => page.evaluate(() => Boolean((window as any).falloffTest))).toBe(true);
  11 |   const comparisons = await page.evaluate(() => [135, 315].map(heading => (window as any).falloffTest.compare(heading)));
  12 |   for (const result of comparisons) expect(result.orderDifferences).toBeLessThanOrEqual(4);
> 13 |   expect(comparisons.some(result => result.occlusionDifferences > 100)).toBe(true);
     |                                                                         ^ Error: expect(received).toBe(expected) // Object.is equality
  14 |   await page.evaluate(() => { (window as any).falloffTest.preview(); });
  15 |   await page.screenshot({ path: testInfo.outputPath('cave-falloff-depth.png') });
  16 |   expect(errors).toEqual([]);
  17 | });
  18 | 
```