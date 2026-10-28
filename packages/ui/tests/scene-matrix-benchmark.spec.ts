import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = (name: string) => `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`;
const matrixUrl = `/@fs${fileURLToPath(new URL('../../animation/src/matrixUpdates.ts', import.meta.url))}`;

test('measures unchanged scene matrix preparation separately from drawing', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async urls => {
    const main = await import(urls.main); await main.gameReady;
    const { scene } = await import(urls.universal);
    const { updateSceneMatrices } = await import(urls.matrices);
    const { Matrix4 } = await import('/node_modules/.vite/deps/three.js');
    let objects = 0, automatic = 0, observed = 0;
    const families: Record<string, number> = {};
    scene.traverse((object: any) => {
      objects++; if (object.matrixAutoUpdate) automatic++;
      if (Object.hasOwn(object, 'updateMatrixWorld')) observed++;
      const family = (window as any).__prefabInstance(object)?.prefab;
      if (family) families[family] = (families[family] ?? 0) + 1;
    });
    for (let i = 0; i < 10; i++) updateSceneMatrices(scene);
    let compositions = 0, multiplications = 0;
    const compose = Matrix4.prototype.compose, multiply = Matrix4.prototype.multiplyMatrices;
    Matrix4.prototype.compose = function(...args: any[]) { compositions++; return compose.apply(this, args); };
    Matrix4.prototype.multiplyMatrices = function(...args: any[]) { multiplications++; return multiply.apply(this, args); };
    try { updateSceneMatrices(scene); }
    finally { Matrix4.prototype.compose = compose; Matrix4.prototype.multiplyMatrices = multiply; }
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now(); updateSceneMatrices(scene); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { objects, automatic, observed, compositions, multiplications, families,
      mean: samples.reduce((sum, time) => sum + time, 0) / samples.length,
      median: samples[50], p90: samples[90] };
  }, { main: moduleUrl('main'), universal: moduleUrl('universal'), matrices: matrixUrl });
  console.log('MATRIX_SCENE', JSON.stringify(result));
  expect(result.objects).toBeGreaterThan(100);
});

test('measures matrix preparation during live game frames', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async url => { await (await import(url)).gameReady; }, moduleUrl('main'));
  const client = await page.context().newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.start');
  const result = await page.evaluate(async url => {
    const { scene } = await import(url);
    const update = scene.updateMatrixWorld;
    const samples: number[] = [];
    try {
      await new Promise<void>(resolve => {
        scene.updateMatrixWorld = function(force: boolean) {
          const start = performance.now(); update.call(this, force); samples.push(performance.now() - start);
          if (samples.length === 120) resolve();
        };
      });
    } finally { scene.updateMatrixWorld = update; }
    samples.sort((a, b) => a - b);
    return { mean: samples.reduce((sum, time) => sum + time, 0) / samples.length,
      median: samples[60], p90: samples[108] };
  }, moduleUrl('universal'));
  const { profile } = await client.send('Profiler.stop');
  const hot = [...profile.nodes].sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0)).slice(0, 20)
    .map(node => ({ name: node.callFrame.functionName, url: node.callFrame.url.split('/').pop(),
      line: node.callFrame.lineNumber + 1, hits: node.hitCount }));
  console.log('MATRIX_LIVE', JSON.stringify({ ...result, hot }));
  expect(result.mean).toBeGreaterThanOrEqual(0);
});
