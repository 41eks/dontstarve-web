import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'view'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('picks a lunar flower, nets its insect, and preserves spawned insects and captured stacks through c_save/reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = { lightflier_flower: [{ id: 'lunar-flower', transform: { position: [0, 0, -3], rotationY: 0 },
      components: { lightflierFlower: { variant: 'single', lightState: 'CHARGED', childspawner: { childreninside: 1, childrenoutside: [] } } } }] };
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    await import(urls.main);
    const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
    const { view } = await import(urls.view);
    (window as any).lightFlierGame = { scene, renderer, camera, view };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const point = (prefab: string) => page.evaluate(prefab => {
    const { scene, renderer, camera, view } = (window as any).lightFlierGame;
    const model = scene.children.find((m: any) => (window as any).__prefabInstance(m)?.prefab === prefab || m.userData.itemId === prefab);
    if (!model) return null;
    let mesh: any; model.traverse((m: any) => { if (!mesh && m.isMesh && m.geometry.getAttribute('position')?.count) mesh = m; });
    if (!mesh) return null;
    mesh.updateWorldMatrix(true, false); mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox, rect = renderer.domElement.getBoundingClientRect();
    // The lightflier's wings leave transparent space at the frame centre. Sample
    // the visible input shape rather than treating the atlas rectangle as opaque.
    for (const y of [.5, .4, .6, .3, .7, .2, .8]) for (const x of [.5, .4, .6, .3, .7, .2, .8]) {
      const p = bounds.min.clone().lerp(bounds.max, .5); p.x = bounds.min.x + (bounds.max.x - bounds.min.x) * x;
      p.y = bounds.min.y + (bounds.max.y - bounds.min.y) * y; mesh.localToWorld(p); p.project(camera);
      const point = { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
      const actions = view.mouseActions.getMouseActions(new PointerEvent('pointermove', { clientX: point.x, clientY: point.y }));
      if (actions.left?.target?.prefab === prefab && ['PICK', 'NET'].includes(actions.left.action)) return point;
    }
    return null;
  }, prefab);
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  await expect.poll(() => page.evaluate(() => !(window as any).__prefabInstance((window as any).lightFlierGame.view.player).animationController.stategraph.hasStateTag('busy')), { timeout: 15000 }).toBe(true);
  await submit('c_give("bugnet")'); await submit('c_give("panflute")');
  const bar = page.locator('dst-inventory-bar'), hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await bar.locator('.inventory-bar__items [data-item-id="bugnet"]').click(); await hand.click(); await expect(hand).toHaveAttribute('data-item-id', 'bugnet');
  await expect.poll(() => page.evaluate(() => !(window as any).__prefabInstance((window as any).lightFlierGame.view.player).animationController.stategraph.hasStateTag('busy')), { timeout: 15000 }).toBe(true);
  const flower = await point('lightflier_flower'); expect(flower).not.toBeNull(); await page.mouse.click(flower!.x, flower!.y);
  await expect.poll(() => page.evaluate(() => (window as any).lightFlierGame.scene.children.filter((m: any) => m.userData.itemId === 'lightflier').length), { timeout: 15000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => !(window as any).__prefabInstance((window as any).lightFlierGame.view.player).animationController.stategraph.hasStateTag('busy'))).toBe(true);
  await bar.locator('.inventory-bar__items [data-item-id="panflute"]').click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).lightFlierGame.scene.children.find((m: any) => m.userData.itemId === 'lightflier')?.userData.lightflier.components.sleeper.IsAsleep()), { timeout: 10000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !(window as any).__prefabInstance((window as any).lightFlierGame.view.player).animationController.stategraph.hasStateTag('busy')), { timeout: 15000 }).toBe(true);
  const bug = await point('lightflier'); expect(bug).not.toBeNull(); await page.mouse.click(bug!.x, bug!.y);
  await expect(bar.locator('.inventory-bar__items [data-item-id="lightflier"]')).toHaveCount(1, { timeout: 15000 });
  await submit('c_give("lightflier", 2)'); await submit('c_spawn("lightflier")'); await submit('c_spawn("lightflier_flower")');
  await expect.poll(() => page.evaluate(() => (window as any).lightFlierGame.scene.children.filter((m: any) => (window as any).__prefabInstance(m)?.prefab === 'lightflier_flower').length)).toBe(2);
  const saved = await saveGame();
  const stack = Object.values(saved.players.local.inventory.containers).flatMap((c: any) => c.slots).find((s: any) => s.item.itemId === 'lightflier') as any;
  expect(stack.item.count).toBe(3); expect(stack.item.lightflier.health).toBe(25);
  expect(saved.world.entities.lightflier_flower).toHaveLength(2);
  const groundBug = saved.world.entities.ground_item.filter((r: any) => r.components.stack.itemId === 'lightflier');
  expect(groundBug).toHaveLength(1); expect(groundBug[0].components.stack.lightflier.health).toBe(25);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved })); await page.reload(); await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  const restored = await saveGame();
  const loadedStack = Object.values(restored.players.local.inventory.containers).flatMap((c: any) => c.slots).find((s: any) => s.item.itemId === 'lightflier') as any;
  expect(loadedStack.item.entityId).toBe(stack.item.entityId); expect(loadedStack.item.count).toBe(3);
  expect(loadedStack.item.lightflier.knownHome).toEqual(stack.item.lightflier.knownHome);
  const restoredBug = restored.world.entities.ground_item.find((r: any) => r.id === groundBug[0].id);
  expect(restoredBug.components.stack.itemId).toBe('lightflier');
  expect(restoredBug.components.stack.lightflier.health).toBe(groundBug[0].components.stack.lightflier.health);
  expect(restored.world.entities.lightflier_flower.map((r: any) => [r.id, r.transform.position])).toEqual(saved.world.entities.lightflier_flower.map((r: any) => [r.id, r.transform.position]));
  expect(errors).toEqual([]);
});
