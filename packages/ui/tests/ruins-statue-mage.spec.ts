import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { minimalSave, savePageUrl } from './inline-save';
import { readSaveDownload } from './save-download';

const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;

test('inline ruins mage renders, c_spawn saves, and reload preserves identity, gem and clip', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = minimalSave();
  save.world.entities = { ruins_statue_mage: [{ id: 'inline-mage', transform: { position: [8, 0, 0], rotationY: 0 },
    components: { ruinsStatueMage: { gem: 'orangegem' } } }] };
  const prepare = () => page.evaluate(async ({ mainUrl, sceneUrl }) => {
    const main = await import(mainUrl); await main.gameReady;
    const { scene } = await import(sceneUrl); (window as any).ruinsMageScene = scene;
  }, { mainUrl, sceneUrl });
  const statues = () => page.evaluate(() => (window as any).ruinsMageScene.children
    .filter((model: any) => (window as any).__prefabInstance(model)?.prefab === 'ruins_statue_mage')
    .map((model: any) => ({ id: (window as any).__prefabInstance(model).entityId, position: model.position.toArray(),
      clip: (window as any).__prefabInstance(model).sprite.sprite.peek().clip.name, loaded: (window as any).__prefabInstance(model).sprite.loaded,
      meshes: model.getObjectsByProperty('isMesh', true).length })));
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await page.goto(savePageUrl(save)); await prepare();
  await expect.poll(statues).toEqual([expect.objectContaining({ id: 'inline-mage', clip: 'idle_full', loaded: true })]);
  expect((await statues())[0].meshes).toBeGreaterThan(0);
  await submit('c_spawn("ruins_statue_mage")');
  await expect.poll(async () => (await statues()).length).toBe(2);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const exported = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(exported.world.entities.ruins_statue_mage).toHaveLength(2);
  expect(exported.world.entities.ruins_statue_mage[0]).toMatchObject({ id: 'inline-mage',
    transform: { position: [8, 0, 0] }, components: { ruinsStatueMage: { gem: 'orangegem' } } });
  await page.goto(savePageUrl(exported)); await prepare();
  await expect.poll(async () => (await statues()).filter(statue => statue.loaded).length).toBe(2);
  expect((await statues()).map(statue => [statue.id, statue.clip])).toEqual(expect.arrayContaining(
    exported.world.entities.ruins_statue_mage.map((record: any) => [record.id, 'idle_full'])));
  const next = page.waitForEvent('download'); await submit('c_save()');
  const roundtrip = JSON.parse(await readSaveDownload((await (await next).path())!, 'Master'));
  expect(roundtrip.world.entities.ruins_statue_mage).toEqual(exported.world.entities.ruins_statue_mage);
  expect(errors).toEqual([]);
});
