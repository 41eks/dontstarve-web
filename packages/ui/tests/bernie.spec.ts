import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('giving, dropping and spawning Bernie follows player sanity and saves canonical inventory IDs', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (url) => { await import(url); }, moduleUrl('../../../src/main.ts'));
  const submit = async (command: string) => page.evaluate((command) => {
    document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
  }, command);
  await submit('c_give("bernie_inactive", 2)');
  const items = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="bernie_inactive"]');
  await expect(items).toHaveCount(2);
  await submit('c_setsanity(0.1)');
  await items.first().click({ button: 'right', modifiers: ['Shift'] });
  const state = () => page.evaluate(async (url) => {
    const { scene } = await import(url);
    const models: { id: string; prefab: string; position: number[]; count: number }[] = [];
    scene.traverse((model: any) => {
      if (model.userData.itemId === 'bernie_inactive') models.push({ id: model.userData.entityId,
        prefab: model.userData.prefab, position: model.position.toArray(), count: model.userData.count });
    });
    return models;
  }, moduleUrl('../../../src/universal.ts'));
  await expect.poll(async () => (await state()).map((model) => model.prefab)).toEqual(['bernie_big']);
  await expect(items).toHaveCount(1);
  const before = (await state())[0];
  await submit('c_setsanity(0.175)');
  await expect.poll(async () => (await state())[0].prefab).toBe('bernie_active');
  expect((await state())[0]).toMatchObject({ id: before.id, position: before.position, count: 1 });
  await page.screenshot({ path: '/tmp/dontstarve-bernie-active.png' });
  await submit('c_spawn("bernie_inactive")');
  await expect.poll(async () => (await state()).length).toBe(2);
  await submit('c_setsanity(0.1)');
  await expect.poll(async () => (await state()).map((model) => model.prefab)).toEqual(['bernie_big', 'bernie_big']);
  await page.screenshot({ path: '/tmp/dontstarve-bernie-big.png' });
  const downloadPromise = page.waitForEvent('download');
  await submit('c_save()');
  const saved = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  const bernies = saved.world.entities.ground_item.filter((record: any) => record.components.stack.itemId === 'bernie_inactive');
  expect(bernies).toHaveLength(2);
  expect(bernies.map((record: any) => record.components.stack.count)).toEqual([1, 1]);
  expect(bernies[0]).toMatchObject({ id: before.id, transform: { position: before.position } });
  expect(saved.players.local.stats.sanity).toBe(20);
  expect(errors).toEqual([]);
});
