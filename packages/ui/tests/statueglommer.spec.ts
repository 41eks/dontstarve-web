import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { minimalSave, savePageUrl } from './inline-save';
import { readSaveDownload } from './save-download';

const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;

test('inline statue save renders, c_spawn adds one, and c_save reloads both identities and work', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.text().includes('保存失败')) errors.push(message.text()); });
  const save = minimalSave();
  save.world.entities = { statueglommer: [{ id: 'inline-statue', transform: { position: [5, 0, 0], rotationY: 0 },
    components: { pickable: { picked: true, caninteractwith: true }, workable: { maxwork: -1, workleft: 2 } } }] };
  const prepare = () => page.evaluate(async ({ mainUrl, sceneUrl }) => {
    const main = await import(mainUrl); await main.gameReady;
    const { scene } = await import(sceneUrl); (window as any).statueGlommerScene = scene;
  }, { mainUrl, sceneUrl });
  const entities = () => page.evaluate(() => (window as any).statueGlommerScene.children
    .filter((model: any) => model.userData.instance?.prefab === 'statueglommer')
    .map((model: any) => ({ id: model.userData.instance.entityId, position: model.position.toArray(),
      clip: model.userData.instance.sprite.sprite.peek().clip.name, loaded: model.userData.instance.sprite.loaded,
      meshes: model.getObjectsByProperty('isMesh', true).length })));
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await page.goto(savePageUrl(save)); await prepare();
  await expect.poll(entities).toEqual([expect.objectContaining({ id: 'inline-statue', position: [5, 0, 0], clip: 'med', loaded: true })]);
  expect((await entities())[0].meshes).toBeGreaterThan(0);
  await submit('c_spawn("statueglommer")');
  await expect.poll(async () => (await entities()).length).toBe(2);
  const download = page.waitForEvent('download', { timeout: 30_000 }); await submit('c_save()');
  const savedDownload = await download.catch(error => { throw new Error(`No save download: ${errors.join(' | ')}`, { cause: error }); });
  const exported = JSON.parse(await readSaveDownload((await savedDownload.path())!, 'Master'));
  expect(exported.world.entities.statueglommer).toHaveLength(2);
  expect(exported.world.entities.statueglommer[0]).toMatchObject({ id: 'inline-statue',
    transform: { position: [5, 0, 0] }, components: {
      pickable: { picked: true, caninteractwith: true }, workable: { maxwork: -1, workleft: 2 },
    } });
  await page.goto(savePageUrl(exported)); await prepare();
  await expect.poll(async () => (await entities()).filter(entity => entity.loaded).length).toBe(2);
  const restored = await entities();
  expect(restored.map(entity => [entity.id, entity.position, entity.clip]))
    .toEqual(expect.arrayContaining(exported.world.entities.statueglommer.map((record: any) =>
      [record.id, record.transform.position, record.id === 'inline-statue' ? 'med' : 'full'])));
  const secondDownload = page.waitForEvent('download'); await submit('c_save()');
  const roundtrip = JSON.parse(await readSaveDownload((await (await secondDownload).path())!, 'Master'));
  expect(roundtrip.world.entities.statueglommer).toEqual(exported.world.entities.statueglommer);
  expect(errors).toEqual([]);
});
