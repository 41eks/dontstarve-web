import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const paths = Object.fromEntries(['minimap-icon-view', 'minimap-view'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))}`]));

test('zooms the Master tree population on one viewport surface without per-icon layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  const result = await page.evaluate(async paths => {
    const { MinimapIconView } = await import(paths['minimap-icon-view']);
    const { MinimapView } = await import(paths['minimap-view']);
    const { map } = (window as any).minimapEdges;
    const display = new MinimapIconView();
    const view = new MinimapView(9480, 1920, 1080);
    view.heading = 45;
    const save = await (await fetch('/saves/Cluster_1/Master.json')).json();
    let count = 0;
    for (const [prefab, records] of Object.entries(save.world.entities)) {
      const name = prefab === 'evergreen' || prefab === 'evergreen_sparse' ? 'evergreen.png'
        : prefab === 'deciduoustree' ? 'tree_leaf.png' : prefab === 'moon_tree' ? 'moon_tree.png' : undefined;
      if (!name) continue;
      const icon = map.renderer.icons.get(map.renderer.icons.index(name));
      for (const record of records as any[]) {
        const [x, , z] = record.transform.position;
        display.set({ position: { x, z }, priority: -1 }, icon);
        count++;
      }
    }
    map.renderer.stop();
    map.shadowRoot.querySelector('section').append(display.root);
    display.update(view); display.start();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const samples: number[] = [];
    for (let i = 0; i < 120; i++) {
      const start = performance.now();
      view.zoom = 3 + 14 * (1 - Math.cos(i * Math.PI / 40)) / 2;
      display.update(view);
      await new Promise(requestAnimationFrame);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const dimensions = [display.canvas.width, display.canvas.height];
    display.dispose();
    return { count, elements: display.root.childElementCount, dimensions,
      median: samples[60], p95: samples[114], max: samples[119] };
  }, paths);
  await testInfo.attach('map-zoom-timings', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.count).toBeGreaterThan(3000);
  expect(result.elements).toBe(1);
  expect(result.dimensions).toEqual([1920, 1080]);
  expect(result.p95).toBeLessThan(40);
  expect(errors).toEqual([]);
});
