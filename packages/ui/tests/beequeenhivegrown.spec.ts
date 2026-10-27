import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { minimalSave, savePageUrl } from './inline-save';
import { readSaveDownload } from './save-download';

const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;

test('c_spawn draws a bee queen hive and c_save reloads its identity, position and work', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(savePageUrl(minimalSave()));
  await page.evaluate(async ({ mainUrl, sceneUrl }) => {
    const main = await import(mainUrl); await main.gameReady;
    const { scene } = await import(sceneUrl);
    (window as any).beeQueenHiveGame = { scene };
  }, { mainUrl, sceneUrl });
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await submit('c_spawn("beequeenhivegrown")');
  const entity = () => page.evaluate(() => {
    const model = (window as any).beeQueenHiveGame.scene.children.find((child: any) => child.userData.instance?.prefab === 'beequeenhivegrown');
    return model && { id: model.userData.instance.entityId, position: model.position.toArray(),
      loaded: model.userData.instance.sprite.loaded,
      meshes: model.getObjectsByProperty('isMesh', true).length };
  });
  await expect.poll(entity).toMatchObject({ loaded: true, meshes: expect.any(Number) });
  const before = await entity();
  expect(before.meshes).toBeGreaterThan(0);
  const download = page.waitForEvent('download');
  await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(saved.world.entities.beequeenhivegrown).toHaveLength(1);
  expect(saved.world.entities.beequeenhivegrown[0]).toMatchObject({ id: before.id,
    transform: { position: before.position }, components: { workable: { maxwork: 16, workleft: 16 } } });
  await page.goto(savePageUrl(saved));
  await page.evaluate(async ({ mainUrl, sceneUrl }) => {
    const main = await import(mainUrl); await main.gameReady;
    const { scene } = await import(sceneUrl);
    (window as any).beeQueenHiveGame = { scene };
  }, { mainUrl, sceneUrl });
  await expect.poll(entity).toMatchObject({ id: before.id, position: before.position, loaded: true });
  expect(errors).toEqual([]);
});
