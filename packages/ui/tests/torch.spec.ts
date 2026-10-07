import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const url = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;
const modules = Object.fromEntries(['main', 'player', 'universal', 'view', 'building', 'save/initialSave'].map((name) =>
  [name === 'save/initialSave' ? 'initialSave' : name, url(`../../../src/${name}.ts`)]));

test('torch fuel updates the UI, pauses when unequipped, survives reskin/save/reload and extinguishes on depletion', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const inputUrls = new WeakMap<ArrayBuffer, string>(), decodedUrls = new WeakMap<AudioBuffer, string>();
    const sources: any[] = [];
    (window as any).torchAudio = sources;
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const data = await arrayBuffer.call(this); inputUrls.set(data, this.url); return data;
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) {
      return decode.call(this, data).then((buffer) => { decodedUrls.set(buffer, inputUrls.get(data) ?? ''); return buffer; });
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const node = create.call(this), start = node.start.bind(node), stop = node.stop.bind(node);
      const info = { node, filename: '', stops: 0, ended: false };
      sources.push(info);
      node.addEventListener('ended', () => { info.ended = true; });
      node.start = (...args: [number?, number?, number?]) => {
        info.filename = decodedUrls.get(node.buffer!)?.split('/').pop() ?? ''; start(...args);
      };
      node.stop = (when?: number) => { info.stops++; stop(when); };
      return node;
    };
  });
  await page.goto('/tests/dst-lighting.html');
  const prepare = async () => page.evaluate(async (paths) => {
    const main = await import(paths.main);
    const { player, playerBody } = await import(paths.player);
    const { scene, dstLighting } = await import(paths.universal);
    const { view } = await import(paths.view);
    (window as any).torchGame = { main, player, playerBody, scene, view, dstLighting };
  }, modules);
  await prepare();
  await page.evaluate(async (paths) => {
    const { main, player, playerBody } = (window as any).torchGame;
    main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
      .map((slot: any) => ({ slot: slot.address, itemId: slot.item.itemId, skinId: slot.item.skinId, delta: -slot.item.count })));
    const { moonTreeForest } = await import(paths.building);
    const { initialSave } = await import(paths.initialSave);
    const key = (position: number[]) => `${Math.floor(position[0] / 12)},${Math.floor(position[2] / 12)}`;
    const occupied = new Set(moonTreeForest.entities.map((tree: any) => key(tree.position.toArray())));
    for (const records of Object.values(initialSave.world.entities) as any[]) for (const record of records) occupied.add(key(record.transform.position));
    let center: any;
    for (let col = -17; col < -5 && !center; col++) for (let row = -17; row < -5 && !center; row++) {
      if (!occupied.has(`${col},${row}`)) center = { x: col * 12 + 6, z: row * 12 + 6 };
    }
    if (!center) throw new Error('No free tile');
    playerBody.position.set(center.x, playerBody.shapes[0].radius, center.z);
    playerBody.velocity.set(0, 0, 0); player.position.set(center.x, 0, center.z);
  }, modules);
  const submit = async (command: string) => page.evaluate((command) => document.querySelector('dst-debug-console')!
    .dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } })), command);
  const spritePoint = async () => page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const { scene, player, view } = (window as any).torchGame;
    const model = scene.children.filter((model: any) => model.name === 'GroundItem:torch')
      .sort((a: any, b: any) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position))[0];
    const mesh = model.children[0].children[0]; mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index;
    const point = model.position.clone().set(0, 0, 0), vertex = point.clone();
    for (let i = 0; i < 3; i++) { vertex.fromBufferAttribute(positions, indices.getX(i)); mesh.localToWorld(vertex); point.add(vertex); }
    const ndc = point.multiplyScalar(1 / 3).project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2, id: model.userData.entityId };
  });
  const bar = page.locator('dst-inventory-bar');
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  const items = bar.locator('.inventory-bar__items');
  const equippedFuel = () => page.evaluate(() => (window as any).torchGame.main.inventory.get({ containerId: 'player:equipment', slotKey: 'hand' })?.remainingFuel);
  const audio = () => page.evaluate(() => (window as any).torchAudio
    .filter((info: any) => ['wilson.fsb-95.wav', 'wilson.fsb-96.wav', 'common.fsb-198.wav'].includes(info.filename))
    .map((info: any) => ({ filename: info.filename, loop: info.node.loop, state: info.node.context.state, stops: info.stops, ended: info.ended })));
  await submit('c_give("torch", 2)');
  await expect(items.locator('[data-item-id="torch"] .inventory-slot__percent')).toHaveText(['100%', '100%']);
  await items.locator('[data-item-id="torch"]').first().dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'torch');
  await expect.poll(audio).toMatchObject([{ filename: expect.stringMatching(/^wilson\.fsb-9[56]\.wav$/), loop: false, state: 'running' }]);
  // The software WebGL renderer can take more than five seconds to render 60 frames.
  await expect.poll(equippedFuel, { timeout: 30_000 }).toBeLessThan(74);
  await page.evaluate(() => {
    const { main } = (window as any).torchGame;
    const address = { containerId: 'player:equipment', slotKey: 'hand' };
    main.inventory.setRemainingFuel(address, 37.5);
  });
  await expect(hand.locator('.inventory-slot__percent')).toHaveText('50%');
  await hand.dragTo(items.locator('[data-item-id=""]').first());
  await expect.poll(audio).toMatchObject([{ filename: expect.stringMatching(/^wilson\.fsb-9[56]\.wav$/) },
    { filename: 'common.fsb-198.wav', loop: false, state: 'running' }]);
  const paused = await page.evaluate(() => (window as any).torchGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'torch' && slot.item.remainingFuel !== undefined));
  await page.waitForTimeout(300);
  expect(await page.evaluate((address) => (window as any).torchGame.main.inventory.get(address), paused.address)).toEqual(paused.item);
  await items.locator(`[data-slot-key="${paused.address.slotKey}"]`).click({ button: 'right', modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => (window as any).torchGame.scene.children.filter((model: any) => model.name === 'GroundItem:torch').length)).toBe(1);
  await page.evaluate(() => (window as any).torchGame.scene.children.find((model: any) => model.name === 'GroundItem:torch').userData.torch.ignite());
  const dropped = await spritePoint();
  await submit('c_give("reskin_tool")');
  await items.locator('[data-item-id="reskin_tool"]').dragTo(hand);
  await page.mouse.click(dropped.x, dropped.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).torchGame.scene.children.find((model: any) => model.name === 'GroundItem:torch')?.userData.skinId),
    { timeout: 15_000 }).toBe('torch_barber');
  const skinned = await spritePoint();
  expect(skinned.id).toBe(dropped.id);
  expect(await page.evaluate(() => (window as any).torchGame.scene.children
    .find((model: any) => model.name === 'GroundItem:torch').userData.torch.isBurning)).toBe(true);
  expect((await audio()).filter((sound: any) => sound.filename.startsWith('wilson.'))).toHaveLength(2);
  // Exercise external ground extinguishing while the player's reskin tool stays equipped.
  await page.evaluate(() => {
    const { main, scene } = (window as any).torchGame;
    const model = scene.children.find((model: any) => model.name === 'GroundItem:torch');
    const equipped = main.handEquipment.peek();
    model.userData.torch.ignite();
    model.dispatchEvent({ type: 'onextinguish' });
    if (main.handEquipment.peek() !== equipped || model.userData.torch.isBurning || model.userData.dstPrefabLocalLight) {
      throw new Error('Ground extinguish affected player equipment or left the fire active');
    }
  });
  await expect.poll(() => audio().then((sounds) => sounds.filter((sound: any) => sound.filename === 'common.fsb-198.wav').length)).toBe(2);
  await page.waitForTimeout(1800);
  await page.evaluate(() => (window as any).torchGame.scene.children.find((model: any) => model.name === 'GroundItem:torch').userData.torch.ignite());
  const pickupPoint = await spritePoint();
  await page.mouse.click(pickupPoint.x, pickupPoint.y);
  const skinnedSlot = items.locator('[data-item-id="torch"][data-skin-id="torch_barber"]');
  await expect(skinnedSlot).toHaveCount(1);
  const pickedFuel = await page.evaluate(() => (window as any).torchGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.skinId === 'torch_barber').item.remainingFuel);
  await expect(skinnedSlot.locator('.inventory-slot__percent')).toHaveText(`${Math.max(1, Math.round(pickedFuel / 75 * 100))}%`);
  const pickupSounds = await audio();
  expect(pickupSounds.filter((sound: any) => sound.filename === 'common.fsb-198.wav')).toHaveLength(3);
  expect(pickupSounds.filter((sound: any) => sound.filename.startsWith('wilson.')).at(-1)).toMatchObject({ stops: 1 });
  await skinnedSlot.click({ button: 'right', modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => (window as any).torchGame.scene.children.filter((model: any) => model.name === 'GroundItem:torch').length)).toBe(1);
  await submit('c_spawn("torch")');
  await expect.poll(() => page.evaluate(() => (window as any).torchGame.scene.children.filter((model: any) => model.name === 'GroundItem:torch').length)).toBe(2);
  await page.evaluate(() => (window as any).torchGame.scene.children
    .find((model: any) => model.name === 'GroundItem:torch' && !model.userData.skinId).userData.torch.ignite());
  // Keep one partially spent torch in inventory and another on the ground.
  await page.evaluate(() => {
    const { main } = (window as any).torchGame;
    const slot = main.inventory.exportState().slots.find((slot: any) => slot.item?.itemId === 'torch');
    main.inventory.setRemainingFuel(slot.address, 56.25);
  });
  await expect(items.locator('[data-item-id="torch"] .inventory-slot__percent')).toHaveText('75%');
  const download = page.waitForEvent('download'); await submit('c_save()');
  const save = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  const records = save.world.entities.ground_item.filter((record: any) => record.components.stack.itemId === 'torch');
  expect(records).toHaveLength(2);
  expect(records.find((record: any) => record.components.stack.skinId === 'torch_barber').components.stack.remainingFuel).toBe(pickedFuel);
  expect(records.find((record: any) => record.components.torch)?.components.torch).toEqual({ lit: true });
  await page.screenshot({ path: '/tmp/dontstarve-torch-durability.png' });
  await page.route('**/saves/initial-world.json', (route) => route.fulfill({ json: save }));
  await page.reload(); await prepare();
  expect(await audio()).toEqual([]); // Restoring a lit ground torch does not replay ignition.
  await expect(items.locator('[data-item-id="torch"] .inventory-slot__percent')).toHaveText('75%');
  const restored = await page.evaluate(() => {
    const { scene } = (window as any).torchGame;
    return scene.children.filter((model: any) => model.name === 'GroundItem:torch')
      .map((model: any) => ({ id: model.userData.entityId, position: model.position.toArray(), skinId: model.userData.skinId, count: model.userData.count }));
  });
  expect(restored).toEqual(records.map((record: any) => ({ id: record.id, position: record.transform.position,
    skinId: record.components.stack.skinId, count: record.components.stack.count })));
  // Save once more to prove ground fuel was restored, rather than inferred from art.
  const secondDownload = page.waitForEvent('download'); await submit('c_save()');
  const savedAgain = JSON.parse(await readFile((await (await secondDownload).path())!, 'utf8'));
  const again = savedAgain.world.entities.ground_item.filter((record: any) => record.components.stack.itemId === 'torch');
  expect(again.find((record: any) => !record.components.torch)).toEqual(records.find((record: any) => !record.components.torch));
  const litAgain = again.find((record: any) => record.components.torch), litBefore = records.find((record: any) => record.components.torch);
  expect(litAgain.id).toBe(litBefore.id);
  expect(litAgain.components.stack.remainingFuel).toBeGreaterThan(0);
  expect(litAgain.components.stack.remainingFuel).toBeLessThan(litBefore.components.stack.remainingFuel);
  await hand.dragTo(items.locator('[data-item-id=""]').first());
  await items.locator('[data-item-id="torch"]').dragTo(hand);
  await page.evaluate(() => {
    const { main } = (window as any).torchGame;
    const address = { containerId: 'player:equipment', slotKey: 'hand' };
    main.inventory.setRemainingFuel(address, 0.4);
  });
  await expect(hand.locator('.inventory-slot__percent')).toHaveText('1%');
  await expect(hand).toHaveAttribute('data-item-id', '', { timeout: 30_000 });
  await expect(hand.locator('.inventory-slot__percent')).toHaveText('');
  expect(await page.evaluate(() => {
    const { main, player, dstLighting } = (window as any).torchGame;
    return { equipment: main.handEquipment.peek(), carry: player.userData.animationController.equippedCarryItem,
      owner: dstLighting.localLighting.torchOwner };
  })).toEqual({ equipment: null, carry: null, owner: null });
  expect(errors).toEqual([]);
});
