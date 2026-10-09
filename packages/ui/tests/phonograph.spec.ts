import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const url = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('cursor records, machine switches and pickup use real input and release decoded music sources', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const sources: any[] = [];
    (window as any).phonographAudio = sources;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const node = create.call(this), start = node.start.bind(node), stop = node.stop.bind(node);
      const info = { node, started: false, stops: 0 };
      sources.push(info);
      node.start = (...args: [number?, number?, number?]) => { info.started = true; start(...args); };
      node.stop = (when?: number) => { info.stops++; stop(when); };
      return node;
    };
  });
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (paths) => {
    const main = await import(paths.main);
    // The initial save equips a reskin tool, whose right click takes precedence over machines.
    const hand = main.inventory.exportState().slots.find((slot: any) => slot.address.slotKey === 'hand');
    if (hand?.item) main.inventory.applySlotChanges([{ slot: hand.address, ...hand.item, delta: -hand.item.count }]);
    const { player, playerBody } = await import(paths.player);
    const { scene } = await import(paths.universal);
    const { view } = await import(paths.view);
    const { moonTreeForest } = await import(paths.building);
    let center: { x: number; z: number } | undefined;
    for (let col = -17; col < -5 && !center; col++) {
      for (let row = -17; row < -5 && !center; row++) {
        const point = { x: col * 12 + 6, z: row * 12 + 6 };
        if (!moonTreeForest.entities.some((tree: any) => Math.hypot(tree.position.x - point.x, tree.position.z - point.z) < 14)) center = point;
      }
    }
    if (!center) throw new Error('No free spot for phonograph');
    const radius = playerBody.shapes[0].radius;
    playerBody.position.set(center.x, radius, center.z); playerBody.velocity.set(0, 0, 0);
    player.position.set(center.x, 0, center.z);
    (window as any).phonographGame = { main, player, playerBody, scene, view, center };
  }, Object.fromEntries(['main', 'player', 'universal', 'view', 'building'].map((name) => [name, url(`../../../src/${name}.ts`)])));
  const submit = async (command: string) => page.evaluate((command) => {
    document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
  }, command);
  await submit('c_spawn("phonograph")');
  await expect.poll(() => page.evaluate(() => (window as any).phonographGame.scene.children
    .filter((model: any) => model.userData.itemId === 'phonograph').length)).toBe(1);
  await submit('c_give("record")');
  const record = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="record"]');
  await expect(record.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await page.evaluate(() => {
    const { player, playerBody, center } = (window as any).phonographGame;
    playerBody.position.x = center.x + 4; player.position.x = center.x + 4;
  });
  const music = () => page.evaluate(() => (window as any).phonographAudio.filter((info: any) =>
    info.started && Math.abs((info.node.buffer?.duration ?? 0) - 41.514) < 0.01)
    .map((info: any) => ({ stops: info.stops, loop: info.node.loop, state: info.node.context.state, channels: info.node.buffer.numberOfChannels })));
  const point = async () => page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const { scene, view } = (window as any).phonographGame;
    const model = scene.children.find((model: any) => model.userData.itemId === 'phonograph');
    const mesh = model.children[0].children[0]; mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute('position');
    const vertex = model.position.clone();
    const min = vertex.clone().set(Infinity, Infinity, Infinity), max = vertex.clone().set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++) {
      vertex.fromBufferAttribute(positions, i); mesh.localToWorld(vertex); min.min(vertex); max.max(vertex);
    }
    const ndc = min.add(max).multiplyScalar(0.5).project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  const clickMachine = async (button: 'left' | 'right') => { const p = await point(); await page.mouse.click(p.x, p.y, { button }); };
  await record.click();
  await expect(page.locator('.slot-drag-preview[data-cursor="true"]')).toHaveAttribute('data-item-id', 'record');
  await expect(record).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(record).toHaveCount(1);
  await expect(page.locator('.slot-drag-preview')).toHaveCount(0);
  await record.click();
  await clickMachine('left');
  await expect(record).toHaveCount(0);
  await expect.poll(music).toEqual([{ stops: 0, loop: true, state: 'running', channels: 1 }]);
  await clickMachine('right');
  await expect.poll(music).toEqual([{ stops: 1, loop: true, state: 'running', channels: 1 }]);
  await clickMachine('right');
  await expect.poll(music).toHaveLength(2);
  await clickMachine('left');
  const machine = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="phonograph"]');
  await expect(machine.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  expect((await music()).map(({ stops }) => stops)).toEqual([1, 1]);
  await page.keyboard.down('Shift'); await machine.click({ button: 'right' }); await page.keyboard.up('Shift');
  await expect(machine).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).phonographGame.scene.children
    .filter((model: any) => model.userData.itemId === 'phonograph').length)).toBe(1);
  expect(await music()).toHaveLength(2);
  await clickMachine('right');
  await expect.poll(music).toHaveLength(3);
  await page.evaluate(() => {
    const { scene, player } = (window as any).phonographGame;
    player.visible = false;
    scene.traverse((object: any) => { if (object.material?.wireframe) object.visible = false; });
  });
  await page.screenshot({ path: '/tmp/dontstarve-phonograph-playing.png' });
  expect(errors).toEqual([]);
});
