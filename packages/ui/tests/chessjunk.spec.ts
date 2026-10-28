import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { minimalSave, savePageUrl } from './inline-save';
import { readSaveDownload } from './save-download';

const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;

test('inline chess junk renders, c_spawn saves, and reload preserves three styles and state', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = minimalSave();
  save.world.entities = Object.fromEntries([1, 2, 3].map(style => [`chessjunk${style}`, [{
    id: `inline-junk-${style}`, transform: { position: [style * 5, 0, 0], rotationY: 0 },
    components: style === 2 ? { chessJunk: { repaired: true, repairerid: 'u', repairerchar: 'wilson' } } : {},
  }]]));
  const prepare = () => page.evaluate(async ({ mainUrl, sceneUrl }) => {
    const main = await import(mainUrl); await main.gameReady;
    const { scene } = await import(sceneUrl); (window as any).chessJunkScene = scene;
  }, { mainUrl, sceneUrl });
  const piles = () => page.evaluate(() => (window as any).chessJunkScene.children
    .filter((model: any) => /^chessjunk[123]$/.test((window as any).__prefabInstance(model)?.prefab ?? ''))
    .map((model: any) => ({ id: (window as any).__prefabInstance(model).entityId, position: model.position.toArray(),
      clip: (window as any).__prefabInstance(model).sprite.sprite.peek().clip.name,
      loaded: (window as any).__prefabInstance(model).sprite.loaded, meshes: model.getObjectsByProperty('isMesh', true).length })));
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await page.goto(savePageUrl(save)); await prepare();
  await expect.poll(async () => (await piles()).filter(pile => pile.loaded).length).toBe(3);
  expect((await piles()).map(pile => [pile.id, pile.clip])).toEqual(expect.arrayContaining([
    ['inline-junk-1', 'idle1'], ['inline-junk-2', 'hit2'], ['inline-junk-3', 'idle3'],
  ]));
  expect((await piles()).every(pile => pile.meshes > 0)).toBe(true);
  await submit('c_spawn("chessjunk1")');
  await submit('c_spawn("chessjunk2")');
  await submit('c_spawn("chessjunk3")');
  await expect.poll(async () => (await piles()).length).toBe(6);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const exported = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  for (const style of [1, 2, 3]) {
    expect(exported.world.entities[`chessjunk${style}`]).toHaveLength(2);
    expect(exported.world.entities[`chessjunk${style}`][0]).toMatchObject({ id: `inline-junk-${style}`,
      transform: { position: [style * 5, 0, 0] } });
  }
  expect(exported.world.entities.chessjunk2[0].components.chessJunk)
    .toEqual({ repaired: true, repairerid: 'u', repairerchar: 'wilson' });
  await page.goto(savePageUrl(exported)); await prepare();
  await expect.poll(async () => (await piles()).filter(pile => pile.loaded).length).toBe(6);
  const next = page.waitForEvent('download'); await submit('c_save()');
  const roundtrip = JSON.parse(await readSaveDownload((await (await next).path())!, 'Master'));
  for (const style of [1, 2, 3])
    expect(roundtrip.world.entities[`chessjunk${style}`]).toEqual(exported.world.entities[`chessjunk${style}`]);
  expect(errors).toEqual([]);
});
