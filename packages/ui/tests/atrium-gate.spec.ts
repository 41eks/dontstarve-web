import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { minimalSave, savePageUrl } from './inline-save';
import { readSaveDownload } from './save-download';

const mainUrl = `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;

test('inline atrium gate renders, c_spawn adds one, and c_save reloads their records and animations', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.text().includes('保存失败')) errors.push(message.text()); });
  const save = minimalSave();
  save.world.entities = { atrium_gate: [{ id: 'inline-atrium', transform: { position: [8, 0, 0], rotationY: 0 },
    components: { pickable: { picked: true } } }] };
  const prepare = () => page.evaluate(async ({ mainUrl, sceneUrl }) => {
    const main = await import(mainUrl); await main.gameReady;
    const { scene } = await import(sceneUrl); (window as any).atriumGateScene = scene;
  }, { mainUrl, sceneUrl });
  const gates = () => page.evaluate(() => (window as any).atriumGateScene.children
    .filter((model: any) => (window as any).__prefabInstance(model)?.prefab === 'atrium_gate')
    .map((model: any) => ({ id: (window as any).__prefabInstance(model).entityId, position: model.position.toArray(),
      clip: (window as any).__prefabInstance(model).sprite.sprite.peek().clip.name, loaded: (window as any).__prefabInstance(model).sprite.loaded,
      meshes: model.getObjectsByProperty('isMesh', true).length })));
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await page.goto(savePageUrl(save)); await prepare();
  await expect.poll(gates).toEqual([expect.objectContaining({ id: 'inline-atrium', position: [8, 0, 0], clip: 'idle', loaded: true })]);
  expect((await gates())[0].meshes).toBeGreaterThan(0);
  await submit('c_spawn("atrium_gate")');
  await expect.poll(async () => (await gates()).length).toBe(2);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const exported = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(exported.world.entities.atrium_gate).toHaveLength(2);
  expect(exported.world.entities.atrium_gate[0]).toMatchObject({ id: 'inline-atrium',
    transform: { position: [8, 0, 0] }, components: { pickable: { picked: true } } });
  await page.goto(savePageUrl(exported)); await prepare();
  await expect.poll(async () => (await gates()).filter(gate => gate.loaded).length).toBe(2);
  const restored = await gates();
  expect(restored.map(gate => [gate.id, gate.position, gate.clip]))
    .toEqual(expect.arrayContaining(exported.world.entities.atrium_gate.map((record: any) => [record.id, record.transform.position, 'idle'])));
  const nextDownload = page.waitForEvent('download'); await submit('c_save()');
  const roundtrip = JSON.parse(await readSaveDownload((await (await nextDownload).path())!, 'Master'));
  expect(roundtrip.world.entities.atrium_gate).toEqual(exported.world.entities.atrium_gate);
  expect(errors).toEqual([]);
});
