import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { inventorySlotAddress, cursorSlotAddress } from '../../inventory/src';
import { createInventoryStore } from '../../../src/inventory';
import { GroundItemManager } from '../../../src/groundItems';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { BUTTERFLY_PERISH_TIME } from '../../prefab/src/butterfly';
import { createPerishWorld } from './perishWorldFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('settles captured butterflies every ten seconds, pauses on the ground and preserves freshness through pickup and save/load', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const world = createPerishWorld(), restoredWorld = createPerishWorld();
  const inventory = createInventoryStore([]), restored = createInventoryStore([]);
  inventory.entities.bindPerishWorld(world); restored.entities.bindPerishWorld(restoredWorld);
  const scene = new THREE.Scene(), player = new THREE.Group();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  ground.entities.bindPerishWorld(world);
  const restoredGround = new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', restored, '/dst/data/anim', player);
  try {
    const address = inventorySlotAddress(0);
    expect((await executeDebugCommand('c_give("butterfly",2)', inventory)).ok).toBe(true);
    const entity = inventory.getEntity(address)!, perish = entity.components.perishable;
    expect(perish.perishtime.peek()).toBe(BUTTERFLY_PERISH_TIME);
    expect(entity.hasTag('show_spoilage')).toBe(true);
    const timer = perish.timer.peek();
    world.advance(9); expect(perish.timer.peek()).toBe(timer);
    world.advance(1); expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: 1430 });
    world.advance(3);
    inventory.DropItem(entity, new THREE.Vector3(9, 0, 6));
    expect(perish.timer.peek()).toEqual({ status: 'paused', remainingSeconds: 1427 });
    expect(perish.updateTimer.peek()).toEqual({ status: 'stopped' });
    world.advance(3000); expect(perish.timer.peek()).toEqual({ status: 'paused', remainingSeconds: 1427 });
    expect(inventory.GiveItem(entity)).toBe(true);
    world.advance(7); inventory.exportState();
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: 1420 });
    expect(inventory.transfer(address, cursorSlotAddress(), 2)).toBe(true);
    let json = '';
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(template, { entities: {}, inventory: inventory.exportState(), elapsedSeconds: world.scheduler.now,
        playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    restored.replaceState(inventoryStateFromSave(deserializeSave(json, SAVE_CATALOG)), SAVE_CATALOG.recipes);
    expect(restored.exportState()).toEqual(inventory.exportState());
    expect(restored.getEntity(cursorSlotAddress())!.components.perishable.GetPercent()).toBeCloseTo(1420 / 1440);
    // c_spawn creates a live butterfly whose starvation is stopped until captured.
    expect((await executeDebugCommand('c_spawn("butterfly")', inventory, async id => {
      await ground.spawnFromSave('wild', { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, new THREE.Vector3(30, 0, 0));
      return true;
    })).ok).toBe(true);
    const wild = ground.entities.get('wild')!;
    expect(wild.components.perishable.timer.peek()).toEqual({ status: 'paused', remainingSeconds: 1440 });
    world.advance(1500); expect(wild.components.perishable.GetPercent()).toBe(1);
    expect((await executeDebugCommand('c_give("butter",2);c_spawn("butter")', inventory, async id => {
      await ground.spawnFromSave('butter:command', { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, new THREE.Vector3(12, 0, 9));
      return true;
    })).ok).toBe(true);
    const butter = ground.exportRecords().find(record => record.id === 'butter:command')!;
    expect(butter.components.stack).toMatchObject({ itemId: 'butter', count: 1, freshnessPercent: 1 });
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(template, { entities: { ground_item: [butter] }, inventory: inventory.exportState(), elapsedSeconds: world.scheduler.now,
        playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const savedButter = deserializeSave(json, SAVE_CATALOG);
    restored.replaceState(inventoryStateFromSave(savedButter), SAVE_CATALOG.recipes);
    const record = savedButter.world.entities.ground_item[0], stack = record.components.stack!;
    await restoredGround.spawnFromSave(record.id, { ...SAVE_CATALOG.items[stack.itemId], ...stack }, new THREE.Vector3(...record.transform.position));
    expect(restoredGround.exportRecords()).toEqual([butter]);
    expect(restored.exportState()).toEqual(inventory.exportState());
  } finally { ground.dispose(); restoredGround.dispose(); inventory.dispose(); restored.dispose(); }
});

it('starves an entire stack into independently rolled loot after removing the butterflies', async () => {
  const inventory = createInventoryStore([]), world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  try {
    expect((await executeDebugCommand('c_give("butterfly",3)', inventory)).ok).toBe(true);
    const entity = inventory.getEntity(inventorySlotAddress(0))!;
    const events: string[] = [];
    inventory.bindActor({ hasTag: tag => tag === 'player', GetPosition: () => new THREE.Vector3(),
      PushEvent: name => events.push(name) });
    entity.ListenForEvent('onremove', () => events.push('removed'));
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(.5).mockReturnValueOnce(.5).mockReturnValue(.5);
    world.advance(BUTTERFLY_PERISH_TIME);
    expect(entity.isRemoved).toBe(true);
    expect(inventory.count('butterfly')).toBe(0);
    expect(inventory.count('butter')).toBe(1);
    expect(inventory.count('butterflywings')).toBe(2);
    expect(events).toEqual(['murdered', 'removed']);
    expect(entity.components.perishable.updateTimer.peek()).toEqual({ status: 'stopped' });
    let saved = '';
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      saved = serializeSave(template, { entities: {}, inventory: inventory.exportState(), elapsedSeconds: world.scheduler.now,
        playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    expect(deserializeSave(saved, SAVE_CATALOG).players.local.inventory.containers['player:inventory'].slots.map(slot => slot.item?.itemId)).toEqual(['butter', 'butterflywings']);
  } finally { inventory.dispose(); }
});
