# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: container-sound.spec.ts >> ice box and treasure chest play the source samples once per open or close transition
- Location: tests/container-sound.spec.ts:4:1

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 4
+ Received  + 4

  Object {
    "autoCloseOnce": true,
    "closesDuringOpening": true,
-   "ignoresClosingClick": true,
+   "ignoresClosingClick": false,
    "ignoresOpeningClick": true,
-   "immediateClose": true,
+   "immediateClose": false,
    "immediateOpen": true,
    "silentDistantClick": true,
-   "silentHit": true,
+   "silentHit": false,
    "silentRestore": true,
    "silentSpawnAndPreview": true,
-   "staysOpenAtBoundary": true,
+   "staysOpenAtBoundary": false,
  }
```

# Test source

```ts
  1  | import { fileURLToPath } from 'node:url';
  2  | import { expect, test } from '@playwright/test';
  3  | 
  4  | test('ice box and treasure chest play the source samples once per open or close transition', async ({ page }) => {
  5  |   const errors: string[] = [];
  6  |   const audioRequests: string[] = [];
  7  |   page.on('pageerror', (error) => errors.push(error.message));
  8  |   page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  9  |   page.on('request', (request) => { if (request.url().endsWith('.wav')) audioRequests.push(new URL(request.url()).pathname); });
  10 |   await page.goto('/tests/dst-lighting.html');
  11 |   const cases = await page.evaluate(async (url) => (await import(url)).checkContainerSounds(),
  12 |     `/@fs${fileURLToPath(new URL('./container-sound-fixture.ts', import.meta.url))}`);
  13 |   expect(cases).toHaveLength(2);
  14 |   const durations = [[33810 / 44100, 20447 / 44100], [20224 / 44100, 18729 / 44100]];
  15 |   for (let i = 0; i < cases.length; i++) {
> 16 |     expect(cases[i]).toMatchObject({ silentSpawnAndPreview: true, silentDistantClick: true,
     |                      ^ Error: expect(received).toMatchObject(expected)
  17 |       immediateOpen: true, immediateClose: true, ignoresOpeningClick: true, ignoresClosingClick: true,
  18 |       silentHit: true, staysOpenAtBoundary: true, autoCloseOnce: true, closesDuringOpening: true, silentRestore: true });
  19 |     expect(cases[i].samples).toHaveLength(6);
  20 |     for (let j = 0; j < 6; j++) {
  21 |       expect(cases[i].samples[j]).toMatchObject({ loop: false, channels: 1 });
  22 |       expect(cases[i].samples[j].duration).toBeCloseTo(durations[i][j % 2], 3);
  23 |     }
  24 |   }
  25 |   expect(audioRequests.sort()).toEqual([
  26 |     '/dst/data/sound/sfx.fsb-382.wav', '/dst/data/sound/sfx.fsb-383.wav',
  27 |     '/dst/data/sound/wilson.fsb-14.wav', '/dst/data/sound/wilson.fsb-15.wav',
  28 |   ]);
  29 |   await page.mouse.click(5, 5);
  30 |   const audioState = (dispose = false) => page.evaluate((value) =>
  31 |     (window as unknown as { containerAudio: (dispose: boolean) => string }).containerAudio(value), dispose);
  32 |   await expect.poll(() => audioState()).toBe('running');
  33 |   await audioState(true);
  34 |   await expect.poll(() => audioState()).toBe('closed');
  35 |   expect(errors).toEqual([]);
  36 | });
  37 | 
```