import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { minimalSave, savePageUrl } from './inline-save';
import { readSaveDownload } from './save-download';

const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;

test('inline pandoraschest renders, c_spawn saves, and reload preserves identity, contents and clip', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = minimalSave();
  const contents = { slotCount: 9, slots: [
    { slotKey: '0', item: { entityId: 'inline-chest_0', itemId: 'footballhat', count: 1 } },
    { slotKey: '4', item: { entityId: 'inline-chest_4', itemId: 'spear', count: 1 } },
  ] };
  save.world.entities = { pandoraschest: [{ id: 'inline-chest', transform: { position: [8, 0, 0], rotationY: 0 },
    components: { container: contents, building: { state: 'closed' } } }] } as never;
  const prepare = () => page.evaluate(async ({ mainUrl, sceneUrl }) => {
    const main = await import(mainUrl); await main.gameReady;
    const { scene } = await import(sceneUrl); (window as any).pandorasChestScene = scene;
  }, { mainUrl, sceneUrl });
  const chests = () => page.evaluate(() => (window as any).pandorasChestScene.children
    .filter((model: any) => (window as any).__prefabInstance(model)?.prefab === 'pandoraschest')
    .map((model: any) => {
      const instance = (window as any).__prefabInstance(model), clip = instance.sprite.sprite.peek().clip;
      return { id: instance.entityId, position: model.position.toArray(), clip: clip.name, loop: clip.loop,
        loaded: instance.sprite.loaded, meshes: model.getObjectsByProperty('isMesh', true).length };
    }));
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await page.goto(savePageUrl(save)); await prepare();
  await expect.poll(chests).toEqual([expect.objectContaining({ id: 'inline-chest', clip: 'closed', loop: false, loaded: true })]);
  expect((await chests())[0].meshes).toBeGreaterThan(0);
  await submit('c_spawn("pandoraschest")');
  await expect.poll(async () => (await chests()).length).toBe(2);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const exported = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(exported.world.entities.pandoraschest).toHaveLength(2);
  expect(exported.world.entities.pandoraschest[0]).toEqual({ id: 'inline-chest',
    transform: { position: [8, 0, 0], rotationY: 0 }, components: { container: contents, building: { state: 'closed' } } });
  await page.goto(savePageUrl(exported)); await prepare();
  await expect.poll(async () => (await chests()).filter(chest => chest.loaded).length).toBe(2);
  expect((await chests()).map(chest => [chest.id, chest.clip, chest.loop])).toEqual(expect.arrayContaining(
    exported.world.entities.pandoraschest.map((record: any) => [record.id, 'closed', false])));
  const next = page.waitForEvent('download'); await submit('c_save()');
  const roundtrip = JSON.parse(await readSaveDownload((await (await next).path())!, 'Master'));
  expect(roundtrip.world.entities.pandoraschest).toEqual(exported.world.entities.pandoraschest);
  expect(errors).toEqual([]);
});
