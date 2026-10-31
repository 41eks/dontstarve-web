import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The shared load check for the bundled default save: every imported prefab family must restore and the game must
// finish loading without page errors. Prefab ports rerun this case instead of adding their own browser flow.
const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;

for (const shard of ['Master', 'Caves'] as const) {
  test(`the default Cluster_1 ${shard} save opens and finishes loading`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/tests/dst-lighting.html?save=Cluster_1/${shard}.json`);
    const loaded = await page.evaluate(async mainUrl => {
      const main = await import(mainUrl);
      await main.gameReady;
      return true;
    }, mainUrl);
    expect(loaded).toBe(true);
    expect(errors).toEqual([]);
  });
}
