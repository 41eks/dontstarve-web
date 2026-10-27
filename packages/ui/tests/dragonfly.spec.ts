import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { minimalSave, savePageUrl } from './inline-save';
import { readSaveDownload } from './save-download';

const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;

test('inline dragonfly save renders, c_spawn adds one, and c_save reloads both', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = minimalSave();
  save.world.entities = { dragonfly: [{ id: 'dragonfly-inline', transform: { position: [4, 0, 4], rotationY: 0 },
    components: { dragonfly: { health: { health: 27000 }, inventory: { items: {}, equip: {} },
      moisture: { moisture: 7 }, rampingspawner: { current_wave: 1, wave_num: 1, spawning_on: false } } } }] };
  const boot = async (data: unknown) => {
    await page.goto(savePageUrl(data));
    await page.evaluate(async ({ mainUrl, sceneUrl }) => {
      const main = await import(mainUrl); await main.gameReady;
      const { scene } = await import(sceneUrl);
      (window as any).dragonflyGame = { scene };
    }, { mainUrl, sceneUrl });
  };
  const entities = () => page.evaluate(() => (window as any).dragonflyGame.scene.children
    .filter((child: any) => child.userData.instance?.prefab === 'dragonfly')
    .map((model: any) => ({ id: model.userData.instance.entityId, position: model.position.toArray(),
      clip: model.userData.instance.sprite.currentAnimation, loaded: model.userData.instance.sprite.loaded,
      meshes: model.getObjectsByProperty('isMesh', true).length })));
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await boot(save);
  await expect.poll(entities).toEqual([expect.objectContaining({ id: 'dragonfly-inline', clip: 'idle', loaded: true,
    meshes: expect.any(Number) })]);
  expect((await entities())[0].meshes).toBeGreaterThan(0);
  await submit('c_spawn("dragonfly")');
  await expect.poll(entities).toHaveLength(2);
  const before = await entities();
  const download = page.waitForEvent('download');
  await submit('c_save()');
  const exported = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(exported.world.entities.dragonfly).toHaveLength(2);
  expect(exported.world.entities.dragonfly[0]).toMatchObject({ id: before[0].id,
    transform: { position: before[0].position }, components: { dragonfly: {
      health: { health: 27000 }, moisture: { moisture: 7 },
      rampingspawner: { current_wave: 1, wave_num: 1, spawning_on: false },
    } } });
  await boot(exported);
  await expect.poll(entities).toEqual(before);
  expect(errors).toEqual([]);
});
