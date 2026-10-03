import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('ice box and treasure chest play the source samples once per open or close transition', async ({ page }) => {
  const errors: string[] = [];
  const audioRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  page.on('request', (request) => { if (request.url().endsWith('.wav')) audioRequests.push(new URL(request.url()).pathname); });
  await page.goto('/tests/dst-lighting.html');
  const cases = await page.evaluate(async (url) => (await import(url)).checkContainerSounds(),
    `/@fs${fileURLToPath(new URL('./container-sound-fixture.ts', import.meta.url))}`);
  expect(cases).toHaveLength(2);
  const durations = [[33810 / 44100, 20447 / 44100], [20224 / 44100, 18729 / 44100]];
  for (let i = 0; i < cases.length; i++) {
    expect(cases[i]).toMatchObject({ silentSpawnAndPreview: true, silentDistantClick: true,
      immediateOpen: true, immediateClose: true, ignoresOpeningClick: true, ignoresClosingClick: true,
      silentHit: true, staysOpenAtBoundary: true, autoCloseOnce: true, closesDuringOpening: true, silentRestore: true });
    expect(cases[i].samples).toHaveLength(6);
    for (let j = 0; j < 6; j++) {
      expect(cases[i].samples[j]).toMatchObject({ loop: false, channels: 1 });
      expect(cases[i].samples[j].duration).toBeCloseTo(durations[i][j % 2], 3);
    }
  }
  expect(audioRequests.sort()).toEqual([
    '/dst/data/sound/sfx.fsb-382.wav', '/dst/data/sound/sfx.fsb-383.wav',
    '/dst/data/sound/wilson.fsb-14.wav', '/dst/data/sound/wilson.fsb-15.wav',
  ]);
  await page.mouse.click(5, 5);
  const audioState = (dispose = false) => page.evaluate((value) =>
    (window as unknown as { containerAudio: (dispose: boolean) => string }).containerAudio(value), dispose);
  await expect.poll(() => audioState()).toBe('running');
  await audioState(true);
  await expect.poll(() => audioState()).toBe('closed');
  expect(errors).toEqual([]);
});
